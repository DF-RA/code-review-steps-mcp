import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { toDraftComment, type Draft, type DraftComment } from "../../src/draft/draft.js";
import type { ReviewComment } from "../../src/review/comments.js";
import { buttonNamed, byTag, type StubElement } from "../helpers/dom.js";
import { useTempDb } from "../helpers/db.js";
import { openPage } from "../helpers/page.js";

function comment(id: string, overrides: Partial<ReviewComment> = {}): DraftComment {
  return toDraftComment(
    {
      scope: "line",
      path: "src/app.ts",
      line: 12,
      severity: "issue",
      title: `Título de ${id}`,
      body: `Cuerpo de ${id}.`,
      ...overrides,
    },
    id,
  );
}

function draftOf(...comments: DraftComment[]): Draft {
  return { comments, confirmed: false, createdAt: Date.now() };
}

function editorOf(card: StubElement): StubElement {
  const [editor] = byTag(card, "textarea");

  if (!editor) {
    throw new Error("the card has no editor");
  }

  return editor;
}

describe("the draft page", () => {
  test("renders one card per comment", async (t) => {
    useTempDb(t);

    const page = await openPage(draftOf(comment("c1"), comment("c2")));

    await page.load();

    assert.equal(page.cards().length, 2);
  });

  test("marks a comment as valid", async (t) => {
    useTempDb(t);

    const page = await openPage(draftOf(comment("c1")));

    await page.load();
    await buttonNamed(page.cards()[0]!, "Válido").onclick?.();

    assert.equal((await page.stored("c1")).status, "valid");
  });

  test("marks a comment for rework", async (t) => {
    useTempDb(t);

    const page = await openPage(draftOf(comment("c1")));

    await page.load();
    await buttonNamed(page.cards()[0]!, "Otra vuelta").onclick?.();

    assert.equal((await page.stored("c1")).status, "rework");
  });

  test("offers no field to write in: marking is the whole message", async (t) => {
    useTempDb(t);

    // What to change is asked in the conversation, where the answer can be as
    // long as it needs to be. A field here would have to survive the list being
    // rebuilt on every click, and that is what used to throw away what you had
    // half written on another comment.
    const page = await openPage(draftOf(comment("c1"), comment("c2")));

    await page.load();
    await buttonNamed(page.cards()[0]!, "Otra vuelta").onclick?.();

    for (const card of page.cards()) {
      assert.deepEqual(byTag(card, "input"), []);
    }
  });

  test("keeps the editor open and its text when another comment is acted on", async (t) => {
    useTempDb(t);

    const page = await openPage(draftOf(comment("c1"), comment("c2")));

    await page.load();
    await buttonNamed(page.cards()[0]!, "Editar").onclick?.();

    const editor = editorOf(page.cards()[0]!);
    editor.value = "Cuerpo reescrito a mano.";
    editor.oninput?.();

    await buttonNamed(page.cards()[1]!, "Válido").onclick?.();

    const reopened = page.cards()[0]!;

    assert.equal(editorOf(reopened).classList.contains("hidden"), false);
    assert.equal(editorOf(reopened).value, "Cuerpo reescrito a mano.");
    assert.equal(buttonNamed(reopened, "Guardar").textContent, "Guardar");
  });

  test("saves the edited body and closes the editor", async (t) => {
    useTempDb(t);

    const page = await openPage(draftOf(comment("c1")));

    await page.load();
    await buttonNamed(page.cards()[0]!, "Editar").onclick?.();

    const editor = editorOf(page.cards()[0]!);
    editor.value = "Cuerpo reescrito a mano.";
    editor.oninput?.();

    await buttonNamed(page.cards()[0]!, "Guardar").onclick?.();

    const stored = await page.stored("c1");

    assert.equal(stored.body, "Cuerpo reescrito a mano.");
    assert.equal(stored.edited, true);
    assert.equal(editorOf(page.cards()[0]!).classList.contains("hidden"), true);
    assert.equal(buttonNamed(page.cards()[0]!, "Editar").textContent, "Editar");
  });

  test("does not carry what was typed on one card over to another", async (t) => {
    useTempDb(t);

    const page = await openPage(draftOf(comment("c1"), comment("c2")));

    await page.load();
    await buttonNamed(page.cards()[0]!, "Editar").onclick?.();

    const editor = editorOf(page.cards()[0]!);
    editor.value = "Solo de c1.";
    editor.oninput?.();

    await buttonNamed(page.cards()[1]!, "Válido").onclick?.();

    assert.equal(editorOf(page.cards()[1]!).value, "Cuerpo de c2.");
    assert.equal(editorOf(page.cards()[1]!).classList.contains("hidden"), true);
  });

  test("goes back to pending when the status it already had is pressed again", async (t) => {
    useTempDb(t);

    const page = await openPage(draftOf(comment("c1")));

    await page.load();
    await buttonNamed(page.cards()[0]!, "Válido").onclick?.();
    await buttonNamed(page.cards()[0]!, "Válido").onclick?.();

    assert.equal((await page.stored("c1")).status, "pending");
  });

  test("keeps the count of each status in the header", async (t) => {
    useTempDb(t);

    const page = await openPage(draftOf(comment("c1"), comment("c2")));

    await page.load();
    await buttonNamed(page.cards()[0]!, "Válido").onclick?.();

    assert.equal(
      page.summary.textContent,
      "1 sin revisar · 1 válidos · 0 descartados · 0 para otra vuelta",
    );
  });
});
