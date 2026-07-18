import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { blocksToDocx } from "@/lib/blocks-docx";
import type { EditorDoc } from "@/lib/blocks";

async function documentXml(doc: EditorDoc): Promise<string> {
  const buffer = await blocksToDocx(doc);
  const zip = new PizZip(buffer);
  return zip.file("word/document.xml")!.asText();
}

describe("blocksToDocx", () => {
  it("renders headers, formatted text, lists, and tables into document.xml", async () => {
    const xml = await documentXml({
      blocks: [
        { type: "header", data: { text: "Hazard Management Plan", level: 1 } },
        { type: "paragraph", data: { text: "Applies to <b>all personnel</b> on site." } },
        { type: "list", data: { style: "ordered", items: [{ content: "Induction" }, { content: "PPE issue" }] } },
        { type: "table", data: { withHeadings: true, content: [["Hazard", "Control"], ["Dust", "Suppression"]] } },
      ],
    });
    expect(xml).toContain("Hazard Management Plan");
    expect(xml).toContain("all personnel");
    expect(xml).toContain("Induction");
    expect(xml).toContain("Suppression");
    expect(xml).toContain("<w:tbl>"); // a real Word table, not text
  });

  it("produces a valid zip for an empty document", async () => {
    const buffer = await blocksToDocx({ blocks: [] });
    const zip = new PizZip(buffer);
    expect(zip.file("word/document.xml")).toBeTruthy();
  });
});
