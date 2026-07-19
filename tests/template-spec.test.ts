import { describe, expect, it } from "vitest";
import {
  applySpecPatch,
  contrastRatio,
  defaultSpec,
  getSpecPatchSchema,
  guardSpecPatch,
  lintSpec,
  patchIsEmpty,
} from "@/lib/template-spec";
import { deriveBrandKit, specFromBrandKit } from "@/lib/brand";

describe("spec patch (revision rounds)", () => {
  it("preserves every field the patch omits, byte for byte", () => {
    const previous = defaultSpec("sop");
    const next = applySpecPatch("sop", previous, { colors: { accent: "8B0000" } });
    expect(next.colors.accent).toBe("8B0000");
    // Everything untouched is identical — the drift guarantee.
    expect(next.colors.table_header_fill).toBe(previous.colors.table_header_fill);
    expect(next.typography).toEqual(previous.typography);
    expect(next.cover).toEqual(previous.cover);
    expect(next.sections).toEqual(previous.sections);
    expect(next.design_rationale).toBe(previous.design_rationale);
  });

  it("normalizes patched values (bad hex falls back, numbers clamp)", () => {
    const previous = defaultSpec("ra");
    const next = applySpecPatch("ra", previous, {
      colors: { accent: "not-a-color" },
      headings: { size_pt: 99 },
    });
    expect(next.colors.accent).toBe(previous.colors.accent); // fallback on invalid hex
    expect(next.headings.size_pt).toBe(18); // clamped to max
  });

  it("detects empty patches (nothing but rationale)", () => {
    expect(patchIsEmpty({ design_rationale: "changed nothing" })).toBe(true);
    expect(patchIsEmpty({ design_rationale: "x", colors: {} })).toBe(true);
    expect(patchIsEmpty({ colors: { accent: "112233" } })).toBe(false);
  });

  it("guard reverts retitles of sections the reviewer never commented on", () => {
    const previous = defaultSpec("sop");
    const patch = guardSpecPatch(
      {
        sections: previous.sections.map((s) =>
          s.id === "procedure" ? { id: s.id, title: "Work Method" } : { id: s.id, title: `HIJACKED ${s.title}` },
        ),
      },
      previous,
      new Set(["procedure"]),
    );
    const titles = new Map(patch.sections!.map((s) => [s.id, s.title]));
    expect(titles.get("procedure")).toBe("Work Method"); // commented — allowed
    expect(titles.get("purpose")).toBe("Purpose"); // uncommented — reverted
  });

  it("patch schema requires only design_rationale and keeps section items strict", () => {
    const schema = getSpecPatchSchema() as {
      required?: string[];
      properties: Record<string, { required?: string[]; items?: { required?: string[] } }>;
    };
    expect(schema.required).toEqual(["design_rationale"]);
    expect(schema.properties.colors.required).toBeUndefined();
    expect(schema.properties.sections.items?.required).toEqual(["id", "title"]);
  });
});

describe("lintSpec (deterministic quality gate)", () => {
  it("passes the house default spec", () => {
    expect(lintSpec(defaultSpec("sop"))).toEqual([]);
  });

  it("flags illegible contrast and unavailable fonts", () => {
    const spec = defaultSpec("sop");
    spec.colors.accent = "FFFF99"; // pale yellow on white
    spec.tables.header_text_color = "E8EDF4"; // ~same as its fill
    spec.typography.heading_font = "Neue Haas Grotesk";
    const issues = lintSpec(spec);
    expect(issues.some((i) => i.includes("accent"))).toBe(true);
    expect(issues.some((i) => i.includes("Table header text"))).toBe(true);
    expect(issues.some((i) => i.includes("Neue Haas Grotesk"))).toBe(true);
  });

  it("accepts uploaded client fonts as allowed", () => {
    const spec = defaultSpec("sop");
    spec.typography.heading_font = "Neue Haas Grotesk";
    expect(lintSpec(spec, ["Neue Haas Grotesk"])).toEqual([]);
  });

  it("contrast ratio math is sane (black on white = 21:1)", () => {
    expect(contrastRatio("000000", "FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("FFFFFF", "FFFFFF")).toBeCloseTo(1, 5);
  });
});

describe("brand kit derivation", () => {
  const source = { buildId: "b-1", docType: "sop" as const, finalizedAt: "2026-07-19T00:00:00.000Z", logoFilename: "logo-acme.png" };

  it("round-trips styling into another doc type unchanged", () => {
    const spec = defaultSpec("sop");
    spec.colors.accent = "8B0000";
    spec.typography.heading_font = "Georgia";
    const kit = deriveBrandKit(spec, source);
    const ra = specFromBrandKit("ra", kit, "Acme Mining", true);
    expect(ra.colors).toEqual(spec.colors);
    expect(ra.typography).toEqual(spec.typography);
    expect(ra.tables).toEqual(spec.tables);
    expect(ra.cover.subtitle_text).toBe("Risk Assessment"); // doc-type specific, not inherited
    expect(ra.sections.map((s) => s.id)).toContain("risk_register"); // RA catalog, not SOP's
  });

  it("disables the cover logo when the logo file could not be carried over", () => {
    const kit = deriveBrandKit(defaultSpec("sop"), source);
    expect(specFromBrandKit("hmp", kit, "Acme", false).cover.show_logo).toBe(false);
    expect(specFromBrandKit("hmp", kit, "Acme", true).cover.show_logo).toBe(true);
  });
});
