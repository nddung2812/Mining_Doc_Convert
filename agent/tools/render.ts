import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { getStorage } from "../../lib/storage";
import { renderDocx } from "../../lib/render";
import { resolveTemplate } from "../../lib/clients";

/**
 * Deterministic template render, gated on human approval (Eve parks the
 * session until a human approves — the HITL step as a framework primitive).
 * Content comes from the stored run record, never from the conversation.
 */
export default defineTool({
  description:
    "Render the approved extraction for a run into the client-branded .docx. " +
    "Requires human approval — approving here is the reviewer sign-off that releases the document.",
  inputSchema: z.object({
    runId: z.string().min(1).describe("Run id returned by extract"),
    approvedBy: z.string().min(1).describe("Full name of the human reviewer approving this content"),
  }),
  approval: always(),
  async execute({ runId, approvedBy }) {
    const storage = getStorage();
    const run = await storage.getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.status === "failed" || !run.extracted) throw new Error(`Run ${runId} failed — nothing to render`);

    const template = await resolveTemplate(run);
    const docx = renderDocx(run.docType, run.extracted, run.createdAt, template.buffer);
    await storage.saveFile(runId, "output.docx", docx);

    run.templateVersion = template.versionLabel;
    run.status = "complete";
    run.approval = { approvedBy, at: new Date().toISOString() };
    await storage.saveRun(run);

    return {
      runId,
      status: "complete",
      approval: run.approval,
      downloadPath: `/api/runs/${runId}/download`,
      bytes: docx.length,
    };
  },
});
