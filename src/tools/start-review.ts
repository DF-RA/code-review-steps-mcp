import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { UserFacingError } from "../errors.js";
import { resolveRange, revParse } from "../git/git.js";
import { locatePullRequest } from "../github/pr-query.js";
import { fetchPullRequest, type PullRequestInfo } from "../github/pull-request.js";
import { findReviewByHead, findReviewsOfPr } from "../review/db.js";
import { createSession, requireSession, type ReviewSession } from "../review/session.js";

const inputSchema = {
  pr: z
    .union([z.number().int().positive(), z.string()])
    .describe("Pull request: su número (200) o su URL completa."),
  repo: z
    .string()
    .describe(
      "Ruta local del clon (/Users/tu/github/proyecto). Todos los pasos trabajan sobre este checkout.",
    ),
};

const outputSchema = {
  reviewId: z.string(),
  prNumber: z.number(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  author: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  range: z.string(),
  baseSha: z.string(),
  headSha: z.string(),
  headRefOid: z.string(),
  resumed: z.boolean(),
  cloneBehind: z.boolean(),
  supersedes: z.array(z.string()),
  pipeline: z.object({
    status: z.enum(["passing", "failing", "pending", "none"]),
    total: z.number(),
    failed: z.array(z.object({ name: z.string(), url: z.string().optional() })),
  }),
};

function formatPipeline(pipeline: PullRequestInfo["pipeline"]): string[] {
  const { status, total, failed } = pipeline;

  if (status === "none") {
    return ["Pipeline: sin checks configurados"];
  }

  if (status === "failing") {
    return [
      `Pipeline: failing (${failed.length} de ${total} checks fallando)`,
      ...failed.map((check) => `  ✗ ${check.name}${check.url ? ` — ${check.url}` : ""}`),
    ];
  }

  return status === "pending"
    ? [`Pipeline: pending (${total} checks, alguno todavía en curso)`]
    : [`Pipeline: passing (${total} checks en verde)`];
}

interface Recognition {
  resumed: boolean;
  cloneBehind: boolean;
  headRefOid: string;
  /** Reviews of this same pull request made against a head that has moved on. */
  supersedes: string[];
}

/** What the stored reviews say about this pull request beyond its own data. */
function formatRecognition({ resumed, cloneBehind, headRefOid, supersedes }: Recognition): string[] {
  const lines: string[] = [`Head en GitHub: ${headRefOid.slice(0, 8)}`];

  if (cloneBehind) {
    lines.push(
      "El clon apunta a otro commit que GitHub. Haz `git fetch` y vuelve a empezar,",
      "o revisarás un código que ya no es el del PR.",
    );
  }

  if (supersedes.length > 0) {
    lines.push(
      `El PR se movió desde ${supersedes.length} revisión(es) anterior(es) de este mismo clon.`,
    );
  }

  lines.push(
    resumed
      ? "Ya había una revisión de este mismo head: se retoma, no se abre otra."
      : "Revisión nueva: no había ninguna de este head.",
  );

  return lines;
}

function format(
  session: ReviewSession,
  pipeline: PullRequestInfo["pipeline"],
  recognition: Recognition,
): string {
  return [
    `PR #${session.prNumber} — ${session.title}`,
    `Autor: ${session.author}`,
    `Rama: ${session.sourceBranch} → ${session.targetBranch}`,
    ...formatPipeline(pipeline),
    `URL: ${session.url}`,
    "",
    ...formatRecognition(recognition),
    "",
    `reviewId: ${session.id}`,
    "Pásalo a los demás pasos. Siguiente: el prompt task_context, para saber qué pedía la tarea.",
  ].join("\n");
}

export function registerStartReview(server: McpServer): void {
  server.registerTool(
    "start_review",
    {
      title: "[Step 1] Iniciar la revisión de un PR",
      description:
        "Primer paso, obligatorio. Abre una revisión sobre un pull request y devuelve su reviewId, junto con el autor, las ramas y el estado del pipeline. Congela los commits que se van a revisar, de modo que todos los pasos siguientes vean exactamente el mismo código aunque alguien empuje al PR mientras tanto. El reviewId es la entrada de get_pr_files, analyze_pr y get_file_diff.",
      inputSchema,
      outputSchema,
    },
    async ({ pr, repo }) => {
      try {
        const location = await locatePullRequest(pr, repo);

        if (location.target.kind !== "path") {
          throw new UserFacingError(
            "La revisión necesita el clon local: pasa en `repo` la ruta del repositorio en tu máquina.",
          );
        }

        const info = await fetchPullRequest(pr, repo);

        if (info.state !== "OPEN") {
          throw new UserFacingError(
            `El PR #${info.number} está en estado ${info.state}. Solo se revisan pull requests abiertos.`,
          );
        }

        const cwd = location.target.cwd;

        // Branch names only get us as far as the commits they point at today.
        // From here on the review travels on the commits themselves: a name
        // moves under a later `git fetch`, and then a step would be reading a
        // different diff than the one this review says it is about.
        const refRange = await resolveRange(cwd, info.targetBranch, info.sourceBranch);
        const [baseRef, headRef] = refRange.split("...");
        const baseSha = await revParse(baseRef ?? info.targetBranch, cwd);
        const headSha = await revParse(headRef ?? info.sourceBranch, cwd);
        const range = `${baseSha}...${headSha}`;

        // The clone is what every later step reads, so it having a different
        // head than GitHub is worth saying now and not three steps in.
        const cloneBehind = Boolean(info.headRefOid) && headSha !== info.headRefOid;

        // Same clone, same pull request, same head: this is the review of this
        // exact code, so continue it instead of opening a second one.
        const existing = findReviewByHead(cwd, info.number, info.headRefOid);
        const previous = findReviewsOfPr(cwd, info.number)
          .filter((review) => review.headRefOid !== info.headRefOid)
          .map((review) => review.id);

        const session = existing
          ? requireSession(existing.id)
          : createSession({
              prNumber: info.number,
              title: info.title,
              body: info.body,
              url: info.url,
              author: info.author,
              repoPath: cwd,
              targetBranch: info.targetBranch,
              sourceBranch: info.sourceBranch,
              baseSha,
              headSha,
              headRefOid: info.headRefOid,
              range,
            });

        return {
          content: [
            {
              type: "text",
              text: format(session, info.pipeline, {
                resumed: Boolean(existing),
                cloneBehind,
                headRefOid: info.headRefOid,
                supersedes: previous,
              }),
            },
          ],
          structuredContent: {
            reviewId: session.id,
            prNumber: session.prNumber,
            title: session.title,
            body: session.body,
            url: session.url,
            author: session.author,
            sourceBranch: session.sourceBranch,
            targetBranch: session.targetBranch,
            range: session.range,
            baseSha: session.baseSha,
            headSha: session.headSha,
            headRefOid: session.headRefOid,
            resumed: Boolean(existing),
            cloneBehind,
            supersedes: previous,
            pipeline: info.pipeline,
          },
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError ? error.message : `Error inesperado: ${String(error)}`;

        return {
          content: [{ type: "text", text: `No se pudo iniciar la revisión.\n${message}` }],
          isError: true,
        };
      }
    },
  );
}
