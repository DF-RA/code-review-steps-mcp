import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerAnalyzePr } from "./analyze-pr.js";
import { registerCreateDraft } from "./create-draft.js";
import { registerExportImport } from "./export-import.js";
import { registerFixList } from "./fix-list.js";
import { registerGetCommentLayout } from "./get-comment-layout.js";
import { registerGetDraftStatus } from "./get-draft-status.js";
import { registerGetFileDiff } from "./get-file-diff.js";
import { registerGetPrFiles } from "./get-pr-files.js";
import { registerRecordFileReview } from "./record-file-review.js";
import { registerPublishReview } from "./publish-review.js";
import { registerRecordTaskContext } from "./record-task-context.js";
import { registerStartReview } from "./start-review.js";

/**
 * The review steps, in order. Each one needs what the previous produced, and
 * says so when it is missing.
 */
export function registerTools(server: McpServer): void {
  registerStartReview(server);
  registerRecordTaskContext(server);
  registerGetPrFiles(server);
  registerAnalyzePr(server);
  registerGetFileDiff(server);
  registerRecordFileReview(server);
  registerCreateDraft(server);
  registerGetDraftStatus(server);
  registerGetCommentLayout(server);
  registerPublishReview(server);
  registerFixList(server);
  registerExportImport(server);
}
