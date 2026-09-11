import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COMMENT_SEVERITIES,
  SIGNATURE_ENV_VAR,
  renderComment,
  signature,
  type ReviewComment,
} from "../../src/review/comments.js";
import { stubEnv } from "../helpers/env.js";

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    scope: "line",
    path: "src/OrderService.java",
    line: 45,
    severity: "blocker",
    title: "La excepción se traga sin registrar",
    body: "Registra el error y propaga.",
    ...overrides,
  };
}

describe("signature", () => {
  test("defaults to the one that says a machine wrote the comment", (t) => {
    stubEnv(t, { [SIGNATURE_ENV_VAR]: undefined });

    assert.equal(signature(), "Powered by Claude Code");
  });

  test("takes the configured one, trimmed", (t) => {
    stubEnv(t, { [SIGNATURE_ENV_VAR]: "  Equipo Plataforma  " });

    assert.equal(signature(), "Equipo Plataforma");
  });

  test("falls back to the default when the variable is empty", (t) => {
    stubEnv(t, { [SIGNATURE_ENV_VAR]: "   " });

    assert.equal(signature(), "Powered by Claude Code");
  });
});

describe("renderComment", () => {
  test("renders a line comment whole", (t) => {
    stubEnv(t, { [SIGNATURE_ENV_VAR]: undefined });

    assert.equal(
      renderComment(comment()),
      [
        "> [!CAUTION]",
        "> **🛑 Bloqueante — La excepción se traga sin registrar**",
        "> `src/OrderService.java` L45",
        ">",
        "> Registra el error y propaga.",
        "",
        "_Powered by Claude Code_",
      ].join("\n"),
    );
  });

  test("uses one GitHub alert per severity", () => {
    const alerts = COMMENT_SEVERITIES.map(
      (severity) => renderComment(comment({ severity })).split("\n")[0],
    );

    assert.deepEqual(alerts, ["> [!CAUTION]", "> [!WARNING]", "> [!TIP]", "> [!NOTE]"]);
  });

  test("keeps the severity label readable where the alert is not rendered", () => {
    const labels = COMMENT_SEVERITIES.map(
      (severity) => renderComment(comment({ severity })).split("\n")[1],
    );

    assert.deepEqual(labels, [
      "> **🛑 Bloqueante — La excepción se traga sin registrar**",
      "> **⚠️ Problema — La excepción se traga sin registrar**",
      "> **💡 Sugerencia — La excepción se traga sin registrar**",
      "> **❓ Duda — La excepción se traga sin registrar**",
    ]);
  });

  test("shows a range when the comment spans several lines", () => {
    assert.match(renderComment(comment({ line: 78, endLine: 92 })), /`src\/OrderService\.java` L78-92/u);
  });

  test("shows a single line when the range collapses onto it", () => {
    assert.match(renderComment(comment({ line: 78, endLine: 78 })), /`src\/OrderService\.java` L78\n/u);
  });

  test("shows only the file for a file-scoped comment", () => {
    // The line is ignored on purpose: the comment is about the whole file.
    const rendered = renderComment(comment({ scope: "file", line: 45 }));

    assert.match(rendered, /^> `src\/OrderService\.java`$/mu);
    assert.doesNotMatch(rendered, /L45/u);
  });

  test("shows no location at all for a PR-scoped comment", () => {
    const rendered = renderComment(
      comment({ scope: "pr", path: undefined, line: undefined, severity: "question" }),
    );

    assert.equal(rendered.split("\n")[2], ">");
    assert.doesNotMatch(rendered, /`/u);
  });

  test("falls back to the file when a line comment carries no line", () => {
    assert.match(renderComment(comment({ line: undefined })), /^> `src\/OrderService\.java`$/mu);
  });

  test("quotes every line of a multi-line body, blank lines included", () => {
    const rendered = renderComment(comment({ body: "Primera.\n\nSegunda." }));

    assert.deepEqual(rendered.split("\n").slice(3, 7), [">", "> Primera.", ">", "> Segunda."]);
  });

  test("trims the body, so trailing whitespace does not leak into the alert", () => {
    const rendered = renderComment(comment({ body: "\n  Registra el error.  \n\n" }));

    assert.deepEqual(rendered.split("\n").slice(3), [">", "> Registra el error.", "", "_Powered by Claude Code_"]);
  });

  test("puts the signature outside the alert, on its own line", (t) => {
    stubEnv(t, { [SIGNATURE_ENV_VAR]: "Equipo Plataforma" });

    const lines = renderComment(comment()).split("\n");

    assert.equal(lines.at(-1), "_Equipo Plataforma_");
    assert.equal(lines.at(-2), "");
  });

  test("leaves every line of the alert quoted: alerts cannot be nested", () => {
    const lines = renderComment(comment({ body: "Una.\n\nDos." })).split("\n").slice(0, -2);

    for (const line of lines) {
      assert.ok(line.startsWith(">"), `not quoted: ${line}`);
    }
  });
});
