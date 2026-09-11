import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { COMMENT_SEVERITIES, SIGNATURE_ENV_VAR } from "../../src/review/comments.js";
import { commentLayoutDoc, commentLayoutFor } from "../../src/review/layout-doc.js";
import { stubEnv } from "../helpers/env.js";

describe("commentLayoutFor", () => {
  test("documents every severity, with its heading and when to use it", () => {
    for (const severity of COMMENT_SEVERITIES) {
      const doc = commentLayoutFor(severity);

      assert.match(doc, new RegExp(`^# Comentarios de severidad \`${severity}\``, "u"));
      assert.ok(doc.includes("## Estructura"));
    }
  });

  test("shows only the examples of the severity asked for", () => {
    const doc = commentLayoutFor("blocker");

    assert.match(doc, /🛑 Bloqueante/u);
    assert.doesNotMatch(doc, /💡 Sugerencia|❓ Duda/u);
  });

  test("gives the blocker its line example and the issue its range example", () => {
    assert.match(commentLayoutFor("blocker"), /L45/u);
    assert.match(commentLayoutFor("issue"), /L78-92/u);
  });

  test("says so instead of going silent when a severity has no example", () => {
    // Every severity has one today; the branch is what must not be dropped.
    const withoutExamples = COMMENT_SEVERITIES.filter(
      (severity) => commentLayoutFor(severity).includes("(no hay ejemplo registrado"),
    );

    assert.deepEqual(withoutExamples, []);
  });

  test("uses the configured signature in the template", (t) => {
    stubEnv(t, { [SIGNATURE_ENV_VAR]: "Equipo Plataforma" });

    assert.match(commentLayoutFor("blocker"), /_Equipo Plataforma_/u);
  });
});

describe("commentLayoutDoc", () => {
  test("shows one example of each scope, so the differences are visible", () => {
    const doc = commentLayoutDoc();

    assert.match(doc, /Anclado a una línea/u);
    assert.match(doc, /Rango de líneas/u);
    assert.match(doc, /Del archivo entero/u);
    assert.match(doc, /Del PR, cuando no pertenece a ningún archivo/u);
  });

  test("lists every severity in the table, with its mark", () => {
    const doc = commentLayoutDoc();

    for (const [severity, mark] of [
      ["blocker", "🛑 Bloqueante"],
      ["issue", "⚠️ Problema"],
      ["suggestion", "💡 Sugerencia"],
      ["question", "❓ Duda"],
    ]) {
      assert.ok(doc.includes(`| \`${severity}\` | ${mark} |`), `missing row for ${severity}`);
    }
  });

  test("names the variable that changes the signature", (t) => {
    stubEnv(t, { [SIGNATURE_ENV_VAR]: undefined });

    assert.match(commentLayoutDoc(), /CODE_REVIEW_MCP_SIGNATURE/u);
  });

  test("renders the examples with the real renderer, alerts included", () => {
    assert.match(commentLayoutDoc(), /> \[!CAUTION\]/u);
    assert.match(commentLayoutDoc(), /> \[!NOTE\]/u);
  });
});
