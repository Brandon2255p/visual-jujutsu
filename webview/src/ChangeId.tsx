import type { Revision } from "../../src/shared/types";

/** The shortest unique prefix of a change ID; the full ID shows on hover. */
export function ChangeId({ rev }: { rev: Revision }) {
  return (
    <span class="change-id mono" title={rev.divergentChangeId ?? rev.changeId}>
      <span class="p">{rev.short.prefix}</span>
    </span>
  );
}
