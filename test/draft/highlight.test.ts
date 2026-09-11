import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { flavorOf, highlight, textOf, type Token } from "../../src/draft/highlight.js";

/** The classes of one line, as "text:class" for what carries one. */
function painted(tokens: Token[]): string[] {
  return tokens.filter((token) => token.c).map((token) => `${token.t}:${token.c}`);
}

function one(line: string, flavor: "c" | "hash" = "c"): Token[] {
  return highlight([line], flavor)[0] ?? [];
}

describe("highlight", () => {
  test("gives back the line it was given, letter for letter", () => {
    const line = "  const total = items.length + 1; // suma";

    assert.equal(textOf(one(line)), line);
  });

  test("paints keywords, strings and numbers", () => {
    const tokens = one('const name = "Ana";');

    assert.ok(painted(tokens).includes("const:k"));
    assert.ok(painted(tokens).includes('"Ana":s'));
    assert.ok(painted(one("let x = 42;")).includes("42:n"));
  });

  test("paints a name that is being called, and a type by its capital", () => {
    assert.ok(painted(one("renderComment(comment);")).includes("renderComment:f"));
    assert.ok(painted(one("const entry: InlineComment = {};")).includes("InlineComment:y"));
  });

  test("leaves an ordinary name with no colour of its own", () => {
    // Only the operator is painted; the names around it travel as plain text,
    // joined with the spaces between them.
    assert.deepEqual(one("total = otro;"), [{ t: "total " }, { t: "=", c: "o" }, { t: " otro;" }]);
  });

  test("paints a line comment to the end of the line", () => {
    const tokens = one("hacer(); // esto no es código: const x = 1");
    const comment = tokens.find((token) => token.c === "c");

    assert.equal(comment?.t, "// esto no es código: const x = 1");
  });

  test("takes # as a comment only where # is a comment", () => {
    assert.ok(painted(one("valor = 1  # comentario", "hash")).includes("# comentario:c"));
    // In the C family it is not: a colour there would be a lie about the code.
    assert.equal(
      one("this.#privado = 1").some((token) => token.c === "c"),
      false,
    );
  });

  test("keeps a block comment open across the lines it spans", () => {
    const lines = highlight(["/**", " * Documenta const y function.", " */", "const x = 1;"]);

    assert.deepEqual(lines[0]?.map((token) => token.c), ["c"]);
    assert.deepEqual(lines[1]?.map((token) => token.c), ["c"]);
    assert.deepEqual(lines[2]?.map((token) => token.c), ["c"]);
    // And closes it: the code after is code again.
    assert.ok(painted(lines[3] ?? []).includes("const:k"));
  });

  test("closes a block comment that opens and ends on the same line", () => {
    const tokens = one("const x = 1; /* nota */ const y = 2;");

    assert.equal(painted(tokens).filter((entry) => entry.endsWith(":c")).length, 1);
    assert.equal(painted(tokens).filter((entry) => entry === "const:k").length, 2);
  });

  test("paints half a string as a string: the line ends before the quote does", () => {
    assert.ok(painted(one('const mensaje = "sin cerrar')).includes('"sin cerrar:s'));
  });

  test("paints operators, and leaves brackets plain", () => {
    const tokens = one("a === b");

    assert.ok(painted(tokens).includes("===:o"));
    assert.equal(
      one("lista[0]").some((token) => token.t === "[" && token.c),
      false,
    );
  });

  test("joins a run of the same colour instead of emitting a span per letter", () => {
    // Two names and a dot in a row carry no class: one token, not three.
    assert.deepEqual(one("session.repoPath"), [{ t: "session.repoPath" }]);
  });

  test("colours nothing in an empty line, and gives back no token", () => {
    assert.deepEqual(one(""), []);
  });
});

describe("flavorOf", () => {
  test("knows the languages that comment with #", () => {
    for (const path of ["src/app.py", "deploy/run.sh", ".github/workflows/ci.yml", "Dockerfile"]) {
      assert.equal(flavorOf(path), "hash", path);
    }
  });

  test("takes the C family for everything else, which is the safe guess", () => {
    for (const path of ["src/app.ts", "Main.java", "main.go", "estilo.css", "sin-extension"]) {
      assert.equal(flavorOf(path), "c", path);
    }
  });
});
