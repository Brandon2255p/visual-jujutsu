import type { PullRequest } from "../shared/types";
import { CommandLog, Runner } from "../jj/cli";

/** "owner/name" from a GitHub remote URL, or null for other hosts. */
export function githubSlug(url: string): string | null {
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

interface RawPr {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  state: PullRequest["state"];
  isDraft: boolean;
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
  reviewDecision: string | null;
  mergedAt: string | null;
}

interface PrPage {
  data: {
    repository: {
      pullRequests: { nodes: RawPr[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    };
  };
}

/** Small pages: one request for 100 PRs with their checks can time out at the gateway. */
const PAGE_SIZE = 25;
const MAX_PAGES = 2;

const PR_QUERY = `query($owner: String!, $name: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: $first, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {
        number title url headRefName baseRefName state isDraft reviewDecision mergedAt
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

function review(decision: string | null): PullRequest["review"] {
  switch (decision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "review_required";
    default:
      return "none";
  }
}

function rollup(pr: RawPr): PullRequest["checks"] {
  switch (pr.commits.nodes[0]?.commit.statusCheckRollup?.state) {
    case "SUCCESS":
      return "passing";
    case "FAILURE":
    case "ERROR":
      return "failing";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "none";
  }
}

export class GitHub {
  private readonly runner: Runner;

  constructor(
    ghPath: () => string,
    cwd: string,
    log: CommandLog,
    private readonly slug: string,
  ) {
    this.runner = new Runner(ghPath, cwd, log);
  }

  /** The newest PRs in any state, fetched in pages of 25. */
  async pullRequests(): Promise<PullRequest[]> {
    const [owner, name] = this.slug.split("/");
    const prs: RawPr[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const args = ["api", "graphql", "-f", `query=${PR_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `first=${PAGE_SIZE}`];
      if (after) args.push("-f", `after=${after}`);
      let out: string;
      try {
        out = await this.runner.run(args, { quiet: true });
      } catch (err) {
        // Keep the first page if a later one fails; the failure is already in the log.
        if (page === 0) throw err;
        break;
      }
      const { nodes, pageInfo } = (JSON.parse(out) as PrPage).data.repository.pullRequests;
      prs.push(...nodes);
      if (!pageInfo.hasNextPage) break;
      after = pageInfo.endCursor;
    }
    return prs.map((p) => ({
      number: p.number,
      title: p.title,
      url: p.url,
      headRefName: p.headRefName,
      baseRefName: p.baseRefName,
      state: p.state,
      isDraft: p.isDraft,
      checks: rollup(p),
      review: review(p.reviewDecision),
      mergedAt: p.mergedAt,
    }));
  }

  /** Returns the new PR's URL. */
  async createPullRequest(req: { head: string; base: string; title: string; body: string; draft: boolean }): Promise<string> {
    const args = ["pr", "create", "--repo", this.slug, "--head", req.head, "--base", req.base, "--title", req.title, "--body-file", "-"];
    if (req.draft) args.push("--draft");
    const out = await this.runner.run(args, { stdin: req.body });
    return out.trim().split("\n").pop() ?? "";
  }

  editBase(pr: number, base: string) {
    return this.runner.run(["pr", "edit", String(pr), "--repo", this.slug, "--base", base]);
  }

  markReady(pr: number) {
    return this.runner.run(["pr", "ready", String(pr), "--repo", this.slug]);
  }

  close(pr: number, deleteBranch: boolean) {
    const args = ["pr", "close", String(pr), "--repo", this.slug];
    if (deleteBranch) args.push("--delete-branch");
    return this.runner.run(args);
  }

  /** Whether the official gh stack extension (github/gh-stack) is installed. */
  async hasStackExtension(): Promise<boolean> {
    try {
      const out = await this.runner.run(["extension", "list"], { quiet: true });
      return /\bgithub\/gh-stack\b/.test(out);
    } catch {
      return false;
    }
  }

  /**
   * Links open PRs (bottom to top) into a native GitHub stack with
   * `gh stack link`. PR URLs are never read as branches or stack numbers, so
   * it pushes nothing; GH_REPO names the repo, since a jj repo may have no
   * .git for gh to read.
   */
  linkStack(prUrls: string[], base: string) {
    return this.runner.run(["stack", "link", "--base", base, ...prUrls], {
      env: { GH_REPO: this.slug, GH_STACK_NO_UPDATE_NOTIFIER: "1" },
    });
  }
}
