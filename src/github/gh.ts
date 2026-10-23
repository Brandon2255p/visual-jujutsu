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
  statusCheckRollup: { conclusion?: string; status?: string; state?: string }[] | null;
}

function rollup(checks: RawPr["statusCheckRollup"]): PullRequest["checks"] {
  if (!checks || checks.length === 0) return "none";
  const results = checks.map((c) => (c.conclusion || c.state || c.status || "").toUpperCase());
  if (results.some((r) => ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(r))) return "failing";
  if (results.some((r) => ["", "PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED"].includes(r))) return "pending";
  return "passing";
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

  async pullRequests(): Promise<PullRequest[]> {
    const out = await this.runner.run(
      [
        "pr",
        "list",
        "--repo",
        this.slug,
        "--state",
        "all",
        "--limit",
        "100",
        "--json",
        "number,title,url,headRefName,baseRefName,state,isDraft,statusCheckRollup",
      ],
      { quiet: true },
    );
    return (JSON.parse(out) as RawPr[]).map((p) => ({
      number: p.number,
      title: p.title,
      url: p.url,
      headRefName: p.headRefName,
      baseRefName: p.baseRefName,
      state: p.state,
      isDraft: p.isDraft,
      checks: rollup(p.statusCheckRollup),
    }));
  }

  /** Returns the new PR's URL. */
  async createPullRequest(req: { head: string; base: string; title: string; body: string; draft: boolean }): Promise<string> {
    const args = ["pr", "create", "--repo", this.slug, "--head", req.head, "--base", req.base, "--title", req.title, "--body-file", "-"];
    if (req.draft) args.push("--draft");
    const out = await this.runner.run(args, { stdin: req.body });
    return out.trim().split("\n").pop() ?? "";
  }
}
