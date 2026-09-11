import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";

import { toDraftComment, type Draft, type DraftComment } from "../../src/draft/draft.js";
import type { ReviewComment } from "../../src/review/comments.js";
import { buttonNamed, byTag, type StubElement } from "../helpers/dom.js";
import { useTempDb } from "../helpers/db.js";
import { openPage } from "../helpers/page.js";
import { createTempRepo } from "../helpers/repo.js";

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

describe("the code a comment points at", () => {
  /** A clone with one commit on top of another, as a review reads it. */
  async function clone(t: TestContext): Promise<{ repoPath: string; range: string }> {
    const repo = await createTempRepo();
    const lines = Array.from({ length: 12 }, (_, index) => `linea ${index + 1}`);

    t.after(() => repo.cleanup());

    await repo.write("src/app.ts", `${lines.join("\n")}\n`);
    await repo.commit("base");
    const base = (await repo.git("rev-parse", "HEAD")).trim();

    lines[2] = "LINEA 3 CAMBIADA";

    await repo.write("src/app.ts", `${lines.join("\n")}\n`);
    await repo.commit("cambio");
    const head = (await repo.git("rev-parse", "HEAD")).trim();

    return { repoPath: repo.dir, range: `${base}...${head}` };
  }

  test("shows the lines of the diff, with the one commented on marked", async (t) => {
    useTempDb(t);

    const page = await openPage(draftOf(comment("c1", { line: 3 })), await clone(t));

    await page.load();
    const card = page.cards()[0]!;

    assert.match(card.innerHTML, /class="snip"/u);
    assert.match(card.innerHTML, /<tr class="added target">/u);
    assert.match(card.innerHTML, /CAMBIADA/u);
    // The line it replaced is there too, as the diff shows it.
    assert.match(card.innerHTML, /<tr class="removed">/u);
    assert.doesNotMatch(card.innerHTML, /irá como comentario del archivo/u);
  });

  test("paints the code, so the band is not the only thing you see", async (t) => {
    useTempDb(t);

    const page = await openPage(draftOf(comment("c1", { line: 3 })), await clone(t));

    await page.load();

    // The server sends the line already tokenised; the page only paints it.
    assert.match(page.cards()[0]!.innerHTML, /<span class="t-[kscnfyo]">/u);
  });

  test("keeps the band where something around it did not change", async (t) => {
    useTempDb(t);

    const page = await openPage(draftOf(comment("c1", { line: 3 })), await clone(t));

    await page.load();

    assert.doesNotMatch(page.cards()[0]!.innerHTML, /class="snip flat"/u);
  });

  test("drops the band in a file the PR adds whole: every line would carry it", async (t) => {
    useTempDb(t);

    const repo = await createTempRepo();

    t.after(() => repo.cleanup());

    await repo.write("otro.ts", "uno\n");
    await repo.commit("base");
    const base = (await repo.git("rev-parse", "HEAD")).trim();

    await repo.write("src/app.ts", `${["uno", "dos", "tres"].join("\n")}\n`);
    await repo.commit("archivo nuevo");
    const head = (await repo.git("rev-parse", "HEAD")).trim();

    const page = await openPage(draftOf(comment("c1", { line: 2 })), {
      repoPath: repo.dir,
      range: `${base}...${head}`,
    });

    await page.load();
    const card = page.cards()[0]!;

    assert.match(card.innerHTML, /class="snip flat"/u);
    // The marker column still says which lines the pull request added.
    assert.match(card.innerHTML, /<td class="mk">\+<\/td>/u);
  });

  test("shows the code but warns when the line is context and not a change", async (t) => {
    useTempDb(t);

    // Line 5 is inside the hunk, so there is code to show; but the PR does not
    // change it, and that is the comment publish_review has to demote.
    const page = await openPage(draftOf(comment("c1", { line: 5 })), await clone(t));

    await page.load();
    const card = page.cards()[0]!;

    assert.match(card.innerHTML, /class="snip"/u);
    assert.match(card.innerHTML, /<tr class="context target">/u);
    assert.match(card.innerHTML, /irá como comentario del archivo/u);
  });

  test("says so, with no code, when the line is nowhere near the diff", async (t) => {
    useTempDb(t);

    const page = await openPage(draftOf(comment("c1", { line: 12 })), await clone(t));

    await page.load();
    const card = page.cards()[0]!;

    assert.doesNotMatch(card.innerHTML, /class="snip"/u);
    assert.match(card.innerHTML, /irá como comentario del archivo/u);
  });

  test("shows no code for a comment that points at no line", async (t) => {
    useTempDb(t);

    const page = await openPage(
      draftOf(comment("c1", { scope: "file", line: undefined })),
      await clone(t),
    );

    await page.load();
    const card = page.cards()[0]!;

    assert.doesNotMatch(card.innerHTML, /class="snip"|irá como comentario del archivo/u);
  });

  test("does not fall over when the clone is not there any more", async (t) => {
    useTempDb(t);

    const page = await openPage(draftOf(comment("c1", { line: 3 })), {
      repoPath: "/no/existe/este/clon",
    });

    await page.load();

    assert.equal(page.cards().length, 1);
    assert.doesNotMatch(page.cards()[0]!.innerHTML, /class="snip"/u);
  });
});
