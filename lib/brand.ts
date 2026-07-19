import type { BrandKit, DocType, TemplateSpec } from "./types";
import { DOC_TYPE_NAMES } from "./types";
import { normalizeSpec, sectionCatalog } from "./template-spec";

/**
 * Distil the client-level brand identity out of a finalised template's spec.
 * Doc-type specifics (subtitle text, section list) stay behind — the kit is
 * what every doc type shares.
 */
export function deriveBrandKit(
  spec: TemplateSpec,
  source: { buildId: string; docType: DocType; finalizedAt: string; logoFilename: string | null },
): BrandKit {
  const { subtitle_text: _subtitle, ...cover } = spec.cover;
  return {
    typography: { ...spec.typography },
    colors: { ...spec.colors },
    cover,
    headings: { ...spec.headings },
    tables: { ...spec.tables },
    spacing: spec.spacing,
    derivedFrom: { buildId: source.buildId, docType: source.docType, finalizedAt: source.finalizedAt },
    logoFilename: source.logoFilename,
  };
}

/**
 * Deterministic template derivation — the "don't rebuild the brand per doc
 * type" path. Brand kit + the doc type's fixed section catalog compile into a
 * complete spec with zero model calls, so a client's SOP/RA/HMP/Proposal
 * templates are visually identical by construction.
 */
export function specFromBrandKit(
  docType: DocType,
  kit: BrandKit,
  clientName: string,
  hasLogo: boolean,
): TemplateSpec {
  const spec: TemplateSpec = {
    design_rationale:
      `Derived deterministically from ${clientName}'s brand kit (their finalised ` +
      `${kit.derivedFrom.docType.toUpperCase()} template) — colours, fonts, cover treatment, and table ` +
      `styling are identical across the client's document set. No AI design round was run.`,
    typography: { ...kit.typography },
    colors: { ...kit.colors },
    cover: { ...kit.cover, subtitle_text: DOC_TYPE_NAMES[docType], show_logo: kit.cover.show_logo && hasLogo },
    headings: { ...kit.headings },
    tables: { ...kit.tables },
    spacing: kit.spacing,
    sections: sectionCatalog(docType).map((s) => ({ id: s.id, title: s.defaultTitle })),
  };
  return normalizeSpec(docType, spec);
}
