import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseSarif } from "../../src/analysis/sarif.js";

/** The log parseSarif takes; the interface itself is internal to the module. */
type SarifLog = Parameters<typeof parseSarif>[0];
type SarifRun = NonNullable<SarifLog["runs"]>[number];
type SarifResult = NonNullable<SarifRun["results"]>[number];
type SarifRule = NonNullable<NonNullable<NonNullable<SarifRun["tool"]>["driver"]>["rules"]>[number];

/** A minimal SARIF log with one run, as the tools that emit it produce it. */
function log(results: SarifResult[], rules: SarifRule[] = []): SarifLog {
  return { runs: [{ tool: { driver: { rules } }, results }] };
}

describe("parseSarif", () => {
  test("returns nothing for a log without runs", () => {
    assert.deepEqual(parseSarif({}, "detekt", "/repo"), []);
    assert.deepEqual(parseSarif({ runs: [] }, "detekt", "/repo"), []);
  });

  test("reads a result into a finding", () => {
    const [finding] = parseSarif(
      log([
        {
          ruleId: "MagicNumber",
          level: "warning",
          message: { text: "  Do not use magic numbers  " },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "/repo/src/Main.kt" },
                region: { startLine: 12, endLine: 14 },
              },
            },
          ],
        },
      ]),
      "detekt",
      "/repo",
    );

    assert.deepEqual(finding, {
      tool: "detekt",
      path: "src/Main.kt",
      line: 12,
      endLine: 14,
      rule: "MagicNumber",
      severity: "medium",
      message: "Do not use magic numbers",
      url: undefined,
    });
  });

  test("maps the SARIF levels onto the three severities", () => {
    const levels = ["error", "WARNING", "note", "none", undefined];

    const severities = parseSarif(
      log(
        levels.map((level) => ({
          ruleId: "r",
          level,
          message: { text: "m" },
          locations: [{ physicalLocation: { artifactLocation: { uri: "a.kt" } } }],
        })),
      ),
      "detekt",
      "/repo",
    ).map((finding) => finding.severity);

    assert.deepEqual(severities, ["high", "medium", "low", "low", "low"]);
  });

  test("falls back to the level configured on the rule", () => {
    const [finding] = parseSarif(
      log(
        [
          {
            ruleId: "r",
            message: { text: "m" },
            locations: [{ physicalLocation: { artifactLocation: { uri: "a.kt" } } }],
          },
        ],
        [{ id: "r", defaultConfiguration: { level: "error" }, helpUri: "https://example.test/r" }],
      ),
      "detekt",
      "/repo",
    );

    assert.equal(finding?.severity, "high");
    assert.equal(finding?.url, "https://example.test/r");
  });

  test("strips the file:// scheme and makes the path relative", () => {
    const [finding] = parseSarif(
      log([
        {
          ruleId: "r",
          message: { text: "m" },
          locations: [
            { physicalLocation: { artifactLocation: { uri: "file:///repo/src/Main.kt" } } },
          ],
        },
      ]),
      "semgrep",
      "/repo",
    );

    assert.equal(finding?.path, "src/Main.kt");
  });

  test("skips a result with no location: there is nothing to anchor it to", () => {
    assert.deepEqual(parseSarif(log([{ ruleId: "r", message: { text: "m" } }]), "detekt", "/repo"), []);
  });

  test("defaults the lines to zero and the rule to an explicit unknown", () => {
    const [finding] = parseSarif(
      log([{ message: { text: "m" }, locations: [{ physicalLocation: { artifactLocation: { uri: "a.kt" } } }] }]),
      "detekt",
      "/repo",
    );

    assert.equal(finding?.line, 0);
    assert.equal(finding?.endLine, 0);
    assert.equal(finding?.rule, "desconocida");
  });

  test("takes the end line from the start when the region has none", () => {
    const [finding] = parseSarif(
      log([
        {
          ruleId: "r",
          message: { text: "m" },
          locations: [
            { physicalLocation: { artifactLocation: { uri: "a.kt" }, region: { startLine: 9 } } },
          ],
        },
      ]),
      "detekt",
      "/repo",
    );

    assert.equal(finding?.line, 9);
    assert.equal(finding?.endLine, 9);
  });

  test("reads every run of the log", () => {
    const run = (ruleId: string, uri: string): SarifRun => ({
      tool: { driver: { rules: [] } },
      results: [
        { ruleId, message: { text: "m" }, locations: [{ physicalLocation: { artifactLocation: { uri } } }] },
      ],
    });

    const rules = parseSarif({ runs: [run("a", "a.kt"), run("b", "b.kt")] }, "detekt", "/repo").map(
      (finding) => finding.rule,
    );

    assert.deepEqual(rules, ["a", "b"]);
  });
});
