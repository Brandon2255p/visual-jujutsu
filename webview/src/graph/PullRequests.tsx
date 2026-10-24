import { useMemo, useState } from "preact/hooks";
import type { GraphState, PullRequest } from "../../../src/shared/types";
import { expectedBase, groupPullRequests, stackFor, syncPlan, trunkBookmark } from "../../../src/shared/stacks";
import { Icon } from "../icons";
import { act } from "../vscode";
import { cls, relativeTime } from "../util";
import type { MenuEntry } from "./Menu";
import { pullRequestMenu } from "./menus";

type OpenMenu = (x: number, y: number, entries: MenuEntry[]) => void;

const REVIEW_TEXT: Record<PullRequest["review"], { text: string; cls: string } | null> = {
  approved: { text: "approved", cls: "pr-review-ok" },
  changes_requested: { text: "changes requested", cls: "pr-review-bad" },
  review_required: { text: "review required", cls: "" },
  none: null,
};

function PrRow({ pr, note, openMenu }: { pr: PullRequest; note?: string; openMenu: OpenMenu }) {
  const review = REVIEW_TEXT[pr.review];
  const state = pr.state === "OPEN" && pr.isDraft ? "draft" : pr.state.toLowerCase();
  return (
    <div
      class="pr-row"
      title={`Open #${pr.number} on GitHub`}
      onClick={() => act({ kind: "openPullRequest", url: pr.url })}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY, pullRequestMenu(pr));
      }}
    >
      <span class={cls("pr", `pr-${state}`)}>
        <Icon name="pull-request" />#{pr.number}
      </span>
      <div class="pr-body">
        <div class="pr-title">{pr.title}</div>
        <div class="pr-meta">
          <span class="mono">
            {pr.headRefName} → {pr.baseRefName}
          </span>
          {pr.checks !== "none" && (
            <span title={`Checks ${pr.checks}`}>
              <Icon name={pr.checks === "passing" ? "check" : pr.checks === "failing" ? "x-circle" : "clock"} class={`check check-${pr.checks}`} />
            </span>
          )}
          {review && <span class={review.cls}>{review.text}</span>}
          {note && <span>{note}</span>}
        </div>
      </div>
      <button
        class="icon-btn pr-more"
        title="Pull request actions"
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openMenu(r.left, r.bottom + 2, pullRequestMenu(pr));
        }}
      >
        <Icon name="more" />
      </button>
    </div>
  );
}

/** Pull requests grouped into stacks, with Sync stack and post-merge cleanup. */
export function PullRequests({ state, openMenu }: { state: GraphState; openMenu: OpenMenu }) {
  const [filter, setFilter] = useState("");
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const groups = useMemo(() => {
    // Link each PR to the PR below it in the graph, so out-of-date bases still group together.
    const parents = new Map<string, string>();
    const trunk = trunkBookmark(state.revisions);
    for (const pr of state.pullRequests) {
      if (pr.state !== "OPEN") continue;
      const rev = state.revisions.find((r) => r.localBookmarks.some((b) => b.name === pr.headRefName));
      if (!rev) continue;
      const below = expectedBase(stackFor(state.revisions, rev.changeId, state.pullRequests), 0, trunk).below;
      if (below?.bookmark) parents.set(pr.headRefName, below.bookmark);
    }
    return groupPullRequests(state.pullRequests, state.localBookmarks, parents);
  }, [state]);
  const local = new Set(state.localBookmarks);
  const matches = (p: PullRequest) => !filter || `#${p.number} ${p.title} ${p.headRefName}`.toLowerCase().includes(filter.toLowerCase());

  // Base changes Sync stack would make, worked out from the graph when the stack is visible in it.
  const outOfDate = (stack: PullRequest[]) => {
    const top = state.revisions.find((r) => r.localBookmarks.some((b) => b.name === stack[0].headRefName));
    if (!top) return [];
    return syncPlan(stackFor(state.revisions, top.changeId, state.pullRequests), trunkBookmark(state.revisions)).retarget;
  };

  const mine = groups.stacks.filter((s) => s.some((p) => local.has(p.headRefName)) && s.some(matches));
  const others = groups.stacks.filter((s) => !s.some((p) => local.has(p.headRefName))).flat().filter(matches);
  const merged = groups.mergedWithBookmark.filter((p) => !dismissed.has(p.number) && matches(p));

  return (
    <>
      <div class="revset">
        <div class="input-wrap">
          <Icon name="search" />
          <input value={filter} placeholder="Filter pull requests" spellcheck={false} onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)} />
        </div>
      </div>
      <div class="graph prs" tabIndex={0}>
        {!state.github && (
          <div class="empty-state">
            Pull requests need a GitHub remote and the <span class="mono">gh</span> CLI (run <span class="mono">gh auth login</span>).
          </div>
        )}
        {state.github && !mine.length && !others.length && !merged.length && (
          <div class="empty-state">No open pull requests. Right-click a revision and choose “Create pull request…”.</div>
        )}

        {mine.map((stack) => {
          const fixes = outOfDate(stack);
          return (
            <div class="pr-section" key={stack[0].number}>
              <div class="pr-section-head">
                <Icon name="chevron-down" />
                <span class="pr-section-title">{stack.length > 1 ? `Stack · ${stack[0].headRefName}` : stack[0].headRefName}</span>
                <span class="spacer" />
                <button class="btn btn-ghost btn-sm" title="Push every bookmark and update PR bases" onClick={() => act({ kind: "syncStack", bookmark: stack[0].headRefName })}>
                  Sync stack
                </button>
              </div>
              {stack.map((pr) => (
                <PrRow pr={pr} openMenu={openMenu} />
              ))}
              {fixes.map((f) => (
                <div class="pr-warning">
                  <Icon name="info" />
                  <span>
                    #{f.pr.number}’s base should be {f.to}, not {f.from}. Sync stack pushes the bookmarks and updates bases.
                  </span>
                </div>
              ))}
            </div>
          );
        })}

        {merged.length > 0 && (
          <div class="pr-section">
            <div class="pr-section-head">
              <Icon name="chevron-down" />
              <span class="pr-section-title">Recently merged</span>
            </div>
            {merged.map((pr) => (
              <>
                <PrRow pr={pr} openMenu={openMenu} note={pr.mergedAt ? `merged ${relativeTime(pr.mergedAt)} ago` : "merged"} />
                <div class="cleanup">
                  <span>
                    #{pr.number} was merged. Fetch, rebase the work on top of it onto main, and delete bookmark “{pr.headRefName}”?
                  </span>
                  <div class="cleanup-actions">
                    <button class="btn btn-primary btn-sm" onClick={() => act({ kind: "cleanUpMergedPr", number: pr.number })}>
                      Clean up
                    </button>
                    <button class="btn btn-secondary btn-sm" onClick={() => setDismissed(new Set([...dismissed, pr.number]))}>
                      Dismiss
                    </button>
                  </div>
                </div>
              </>
            ))}
          </div>
        )}

        {others.length > 0 && (
          <div class="pr-section">
            <div class="pr-section-head">
              <Icon name="chevron-down" />
              <span class="pr-section-title">Other open PRs</span>
            </div>
            {others.map((pr) => (
              <PrRow pr={pr} openMenu={openMenu} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
