/**
 * Line numbers each file gained or changed in a diff, on the new side.
 * Built from `git diff --unified=0`, where every hunk covers exactly the changed
 * lines with no surrounding context.
 */
export function changedLinesByFile(diff: string): Map<string, Set<number>> {
  const byFile = new Map<string, Set<number>>();
  let current: Set<number> | undefined;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // "diff --git a/path b/path": the new path is what PMD will report.
      const match = /^diff --git a\/.+ b\/(.+)$/.exec(line);
      current = undefined;

      if (match?.[1]) {
        current = new Set<number>();
        byFile.set(match[1], current);
      }
      continue;
    }

    if (!current || !line.startsWith("@@")) {
      continue;
    }

    // "@@ -12,3 +14,5 @@": start at 14 and cover 5 lines. A count of 0 means the
    // hunk only deletes, so there is no new line to attribute a finding to.
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);

    if (!hunk?.[1]) {
      continue;
    }

    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);

    for (let offset = 0; offset < count; offset += 1) {
      current.add(start + offset);
    }
  }

  return byFile;
}
