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
 * Resolve the template for a run: the client's uploaded template for this doc
 * type wins; otherwise the master ships. Returns the buffer (or undefined for
 * master) and a version label for the audit record.
 */
export async function resolveTemplate(
  run: Pick<RunRecord, "clientId" | "docType" | "templateVersion">,
): Promise<{ buffer?: Buffer; versionLabel: string }> {
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
