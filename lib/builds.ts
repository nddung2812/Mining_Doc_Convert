import type { DocType, SectionFeedback, TemplateBuildRecord, TemplateSpec } from "./types";
import { MAX_REVIEW_ROUNDS } from "./types";
import { getStorage } from "./storage";
import { extractSourceText } from "./source";
import { sectionCatalog } from "./template-spec";
import { parseLogo, type LogoAsset } from "./template-compile";
import type { DesignInput } from "./template-engine";

export const FINAL_TEMPLATE_FILENAME = "template.docx";

export function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_");
}

/** "Neue-Haas-Grotesk_Bold.otf" -> "Neue Haas Grotesk Bold" */
export function fontDisplayName(filename: string): string {
  return filename
    .replace(/\.(ttf|otf|woff2?|eot)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

/** Review submissions already spent on this build. */
export function reviewRoundsUsed(build: TemplateBuildRecord): number {
  return Math.max(0, build.iterations.length - 1);
}

export function reviewRoundsLeft(build: TemplateBuildRecord): number {
  return Math.max(0, MAX_REVIEW_ROUNDS - reviewRoundsUsed(build));
}

export function latestSpec(build: TemplateBuildRecord): TemplateSpec | null {
  return build.iterations.length ? build.iterations[build.iterations.length - 1].spec : null;
}

/** Reviewers may also comment on the fixed page footer. */
export function parseFeedback(docType: DocType, raw: unknown): SectionFeedback[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) return null;
  const validIds = new Set([...sectionCatalog(docType).map((s) => s.id), "footer"]);
  const out: SectionFeedback[] = [];
  for (const entry of raw as { sectionId?: unknown; comment?: unknown }[]) {
    const sectionId = String(entry?.sectionId ?? "");
    const comment = String(entry?.comment ?? "").trim();
    if (!validIds.has(sectionId) || !comment) return null;
    out.push({ sectionId, comment: comment.slice(0, 2000) });
  }
  return out;
}

export async function loadLogo(build: TemplateBuildRecord): Promise<LogoAsset | null> {
  if (!build.materials.logo) return null;
  const buffer = await getStorage().getBuildFile(build.id, build.materials.logo.filename);
  return buffer ? parseLogo(build.materials.logo.filename, buffer) : null;
}

/**
 * Assemble the design-model input from the stored materials. Unreadable
 * style guides / references degrade to a note rather than failing the round —
 * the user already had them accepted at upload time.
 */
export async function designInputFromBuild(
  build: TemplateBuildRecord,
  revision?: { previousSpec: TemplateSpec; feedback: SectionFeedback[] },
): Promise<DesignInput> {
  const storage = getStorage();

  const readText = async (filename: string): Promise<{ filename: string; text: string }> => {
    const buffer = await storage.getBuildFile(build.id, filename);
    if (!buffer) return { filename, text: "(file missing)" };
    try {
      return { filename, text: await extractSourceText(filename, buffer) };
    } catch {
      return { filename, text: "(no extractable text)" };
    }
  };

  return {
    docType: build.docType,
    clientName: build.clientName,
    brief: build.brief,
    styleGuides: await Promise.all(build.materials.styleGuides.map((m) => readText(m.filename))),
    references: await Promise.all(build.materials.references.map((m) => readText(m.filename))),
    fontNames: build.materials.fonts.map((m) => fontDisplayName(m.filename)),
    hasLogo: build.materials.logo !== null,
    previousSpec: revision?.previousSpec,
    feedback: revision?.feedback,
  };
}
