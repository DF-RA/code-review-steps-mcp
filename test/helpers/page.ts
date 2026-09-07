import type { Draft, DraftComment } from "../../src/draft/draft.js";
import { renderPage } from "../../src/draft/page.js";
import { draftUrl, ensureServer } from "../../src/draft/server.js";
import { saveDraft } from "../../src/review/db.js";
import { createSession, type ReviewSession } from "../../src/review/session.js";
import { createDocument, type StubDocument, type StubElement } from "./dom.js";
import { sessionData } from "./session.js";

/** Pulls the browser script out of the page, which is where the behaviour is. */
function scriptOf(html: string): string {
  const match = /<script>([\s\S]*?)<\/script>/u.exec(html);

  if (!match?.[1]) {
    throw new Error("the page carries no script");
  }

  // The page runs load() on open; the test decides when that happens instead.
  const source = match[1].replace(/\nload\(\);\s*$/u, "\n");

  if (source === match[1]) {
    throw new Error("the page no longer ends with load(); update this helper");
  }

  return source;
}

interface PageApi {
  load(): Promise<void>;
}

export interface PageHarness {
  session: ReviewSession;
  document: StubDocument;
  /** Where the page renders the accordions of comments. */
  list: StubElement;
  summary: StubElement;
  confirmed: StubElement;
  /** Renders from what the server holds, as any action does. */
  load(): Promise<void>;
  /** The cards on screen, in the order the page laid them out. */
  cards(): StubElement[];
  /** What the server holds for a comment right now. */
  stored(id: string): Promise<DraftComment>;
}

/**
 * Runs the draft page against the real draft server.
 *
 * Not a mock of the server: the page talks to the HTTP handler that ships, so
 * what a click leaves stored is the real thing and not a fake of it.
 */
export async function openPage(draft: Draft): Promise<PageHarness> {
  const base = await ensureServer();
  const session = createSession(sessionData());

  session.draft = draft;

  // Stored as create_draft would leave it, so what the page writes lands on a
  // row that exists and the test sees the real path.
  saveDraft(session.id, draft);

  const { document, byId } = createDocument(["list", "summary", "confirmed", "confirm"]);
  const url = draftUrl(base, session.id);

  // The page uses absolute paths; the browser would resolve them against the
  // origin it was served from.
  const fetchFromPage = (path: string, init?: RequestInit): Promise<Response> =>
    fetch(new URL(path, base), init);

  const script = scriptOf(renderPage(session));
  const run = new Function(
    "document",
    "fetch",
    `${script}\nreturn { load };`,
  ) as (document: StubDocument, fetch: typeof fetchFromPage) => PageApi;

  const api = run(document, fetchFromPage);

  const required = (id: string): StubElement => {
    const element = byId.get(id);

    if (!element) {
      throw new Error(`no element with id ${id}`);
    }

    return element;
  };

  const list = required("list");

  return {
    session,
    document,
    list,
    summary: required("summary"),
    confirmed: required("confirmed"),
    load: () => api.load(),
    cards: () =>
      list.children.flatMap((group) =>
        group.children.filter((child) => child.classList.contains("card")),
      ),
    async stored(id) {
      const stored = (await (await fetch(`${url}/data`)).json()) as Draft;
      const comment = stored.comments.find((candidate) => candidate.id === id);

      if (!comment) {
        throw new Error(`no comment with id ${id}`);
      }

      return comment;
    },
  };
}
