import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FIX_STATUSES, countFixes, type FixItem } from "../../src/review/fixes.js";

function fix(status: FixItem["status"], id: string = status): FixItem {
  return { id, severity: "issue", title: "t", body: "b", status };
}

describe("countFixes", () => {
  test("reports a zero for every status when there is nothing to do", () => {
    assert.deepEqual(countFixes([]), { pending: 0, done: 0, skipped: 0 });
  });

  test("counts one bucket per status", () => {
    const fixes = [fix("pending", "a"), fix("pending", "b"), fix("done"), fix("skipped")];

    assert.deepEqual(countFixes(fixes), { pending: 2, done: 1, skipped: 1 });
  });

  test("covers every declared status, so a new one cannot go uncounted", () => {
    const counts = countFixes(FIX_STATUSES.map((status) => fix(status)));

    for (const status of FIX_STATUSES) {
      assert.equal(counts[status], 1);
    }
  });
});
