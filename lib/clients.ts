import type { DocType, RunRecord } from "./types";
import { getStorage } from "./storage";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function clientTemplateFilename(docType: DocType): string {
  return `template-${docType}.docx`;
}

/**
 * Resolve the template for a run. Priority: the specific built template the
 * user chose, then the client's registered template for this doc type, then
 * the master. Returns the buffer (or undefined for master) and a version
 * label for the audit record.
 */
export async function resolveTemplate(
  run: Pick<RunRecord, "clientId" | "docType" | "templateVersion" | "templateBuildId">,
): Promise<{ buffer?: Buffer; versionLabel: string }> {
  if (run.templateBuildId) {
    const storage = getStorage();
    const build = await storage.getBuild(run.templateBuildId);
    if (build?.status === "final" && build.final) {
      const buffer = await storage.getBuildFile(build.id, build.final.templateFilename);
      if (buffer) {
        return {
          buffer,
          versionLabel: `template:${build.name || build.id.slice(0, 8)}@${build.final.finalizedAt}`,
        };
      }
    }
  }
  if (run.clientId) {
    const storage = getStorage();
    const client = await storage.getClient(run.clientId);
    const entry = client?.templates[run.docType];
    if (client && entry) {
      const buffer = await storage.getClientFile(run.clientId, clientTemplateFilename(run.docType));
      if (buffer) {
        return { buffer, versionLabel: `client:${client.id}@${entry.uploadedAt}` };
      }
    }
  }
  return { versionLabel: run.templateVersion };
}
