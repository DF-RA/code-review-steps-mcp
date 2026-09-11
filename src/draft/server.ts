import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { DRAFT_STATUSES, type DraftComment, type DraftStatus } from "./draft.js";
import { renderPage } from "./page.js";
import { snippetFor, type Snippet } from "./snippet.js";
import { rawFileDiff } from "../file-diff.js";
import { saveDraftComment, saveDraftConfirmed, saveFix } from "../review/db.js";
import { requireSession, type ReviewSession } from "../review/session.js";

/**
 * Local server that serves the draft for review.
 *
 * Bound to the loopback interface and on a random free port: this exists so a
 * person can read and edit the draft in a browser, not to be reachable from
 * anywhere else. The review id in the path is a UUID, so the URL is not
 * guessable by anything else running on the machine.
 */
let server: Server | undefined;
let baseUrl: string | undefined;

const MAX_BODY_BYTES = 256 * 1024;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += (chunk as Buffer).length;

    if (size > MAX_BODY_BYTES) {
      throw new Error("cuerpo demasiado grande");
    }

    chunks.push(chunk as Buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, {
    "content-type": type,
    // Nothing here should be cached: the page reflects live state.
    "cache-control": "no-store",
  });
  response.end(body);
}

/**
 * The diff of one file, asked of git once.
 *
 * The page reloads itself after every click, and the range of a review never
 * moves, so the text can only be the same one: keying by range and path means
 * one call per file for the whole session instead of one per click.
 */
const diffs = new Map<string, Promise<string | undefined>>();

function diffOf(session: ReviewSession, path: string): Promise<string | undefined> {
  const key = `${session.range}:${path}`;
  let pending = diffs.get(key);

  if (!pending) {
    // A file the range does not touch has no diff, and that is an answer and
    // not a failure: the comment is shown without its piece of code.
    pending = rawFileDiff(session.repoPath, session.range, path).catch(() => undefined);
    diffs.set(key, pending);
  }

  return pending;
}

type CommentWithSnippet = DraftComment & { snippet?: Snippet };

/** Each line comment with the piece of code it points at. */
async function withSnippets(
  session: ReviewSession,
  comments: DraftComment[],
): Promise<CommentWithSnippet[]> {
  return Promise.all(
    comments.map(async (comment) => {
      if (comment.scope !== "line" || !comment.path || comment.line === undefined) {
        return comment;
      }

      const diff = await diffOf(session, comment.path);
      const snippet = diff
        ? snippetFor(diff, comment.path, comment.line, comment.endLine)
        : undefined;

      return snippet ? { ...comment, snippet } : comment;
    }),
  );
}

function sessionOf(reviewId: string): ReviewSession | undefined {
  try {
    return requireSession(reviewId);
  } catch {
    return undefined;
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] !== "r" || !parts[1]) {
    send(response, 404, "text/plain; charset=utf-8", "No encontrado");
    return;
  }

  const session = sessionOf(parts[1]);

  if (!session?.draft) {
    send(response, 404, "text/plain; charset=utf-8", "Esta revisión ya no existe o no tiene borrador.");
    return;
  }

  const draft = session.draft;

  if (request.method === "GET" && parts.length === 2) {
    send(response, 200, "text/html; charset=utf-8", renderPage(session));
    return;
  }

  if (request.method === "GET" && parts[2] === "data") {
    send(
      response,
      200,
      "application/json; charset=utf-8",
      JSON.stringify({
        ...draft,
        comments: await withSnippets(session, draft.comments),
        fixes: session.fixes ?? null,
      }),
    );
    return;
  }

  if (request.method === "POST" && parts[2] === "fix" && parts[3]) {
    const fix = session.fixes?.find((candidate) => candidate.id === parts[3]);

    if (!fix) {
      send(response, 404, "application/json", '{"error":"punto no encontrado"}');
      return;
    }

    const payload = (await readJson(request)) as { status?: string; note?: string };

    if (payload.status && ["pending", "done", "skipped"].includes(payload.status)) {
      fix.status = payload.status as typeof fix.status;
    }

    if (typeof payload.note === "string") {
      fix.note = payload.note.trim() || undefined;
    }

    saveFix(session.id, fix);

    send(response, 200, "application/json; charset=utf-8", JSON.stringify(fix));
    return;
  }

  if (request.method === "POST" && parts[2] === "comment" && parts[3]) {
    const comment = draft.comments.find((candidate) => candidate.id === parts[3]);

    if (!comment) {
      send(response, 404, "application/json", '{"error":"comentario no encontrado"}');
      return;
    }

    const payload = (await readJson(request)) as {
      status?: string;
      body?: string;
    };

    if (payload.status && (DRAFT_STATUSES as readonly string[]).includes(payload.status)) {
      comment.status = payload.status as DraftStatus;
    }

    if (typeof payload.body === "string" && payload.body.trim() !== comment.body) {
      comment.body = payload.body.trim();
      comment.edited = true;
    }

    // The page is a second writer of the review: what somebody marks here has
    // to outlive this process, the same as what the tools record.
    saveDraftComment(session.id, comment);

    send(response, 200, "application/json; charset=utf-8", JSON.stringify(comment));
    return;
  }

  if (request.method === "POST" && parts[2] === "confirm") {
    const payload = (await readJson(request)) as { confirmed?: boolean };
    draft.confirmed = payload.confirmed !== false;

    saveDraftConfirmed(session.id, draft.confirmed);

    send(response, 200, "application/json; charset=utf-8", JSON.stringify({ confirmed: draft.confirmed }));
    return;
  }

  send(response, 404, "text/plain; charset=utf-8", "No encontrado");
}

/** Starts the server on first use and returns its base URL. */
export async function ensureServer(): Promise<string> {
  if (baseUrl) {
    return baseUrl;
  }

  server = createServer((request, response) => {
    handle(request, response).catch(() => {
      send(response, 400, "text/plain; charset=utf-8", "Petición inválida");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    // Port 0: the operating system hands out a free one.
    server?.listen(0, "127.0.0.1", resolve);
  });

  // Must not keep the process alive on its own: the MCP transport decides that.
  server.unref();

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  return baseUrl;
}

export function draftUrl(base: string, reviewId: string): string {
  return `${base}/r/${reviewId}`;
}
