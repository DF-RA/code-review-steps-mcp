import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isAbsolute } from "node:path";

import { PMD_RULESET_ENV_VAR, pmdRuleset } from "../../src/analysis/pmd.js";
import { SEMGREP_CONFIG_ENV_VAR, semgrepConfig } from "../../src/analysis/semgrep.js";
import { stubEnv } from "../helpers/env.js";

describe("pmdRuleset", () => {
  test("defaults to the ruleset shipped with the package", (t) => {
    stubEnv(t, { [PMD_RULESET_ENV_VAR]: undefined });

    const ruleset = pmdRuleset();

    assert.ok(isAbsolute(ruleset));
    assert.match(ruleset, /rulesets\/java\.xml$/u);
  });

  test("takes the one configured, trimmed", (t) => {
    stubEnv(t, { [PMD_RULESET_ENV_VAR]: "  category/java/bestpractices.xml  " });

    assert.equal(pmdRuleset(), "category/java/bestpractices.xml");
  });

  test("falls back to the default when the variable is only whitespace", (t) => {
    stubEnv(t, { [PMD_RULESET_ENV_VAR]: "   " });

    assert.match(pmdRuleset(), /rulesets\/java\.xml$/u);
  });
});

describe("semgrepConfig", () => {
  test("defaults to the public ruleset", (t) => {
    stubEnv(t, { [SEMGREP_CONFIG_ENV_VAR]: undefined });

    assert.equal(semgrepConfig(), "p/default");
  });

  test("takes the one configured, trimmed, so it can point at local rules", (t) => {
    stubEnv(t, { [SEMGREP_CONFIG_ENV_VAR]: "  ./rules  " });

    assert.equal(semgrepConfig(), "./rules");
  });
});
