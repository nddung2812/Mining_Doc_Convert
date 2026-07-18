import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { EditorDoc, ListItem } from "./blocks";

/**
 * Deterministic render of a Content Studio block document to a Word (.docx)
 * buffer. Server-only (pulls in the `docx` library) — never import from a
 * client component. The inline HTML that Editor.js stores in text fields
 * (bold/italic/underline/links) is converted to styled runs.
 */

const ACCENT = "1F3A5F";
const TABLE_BORDER = "9FB3CC";
const TABLE_HEADER_FILL = "E8EDF4";
const MUTED = "475569";
// docx sizes are half-points.
const HEADING_HALF_PT: Record<number, number> = { 1: 48, 2: 30, 3: 26, 4: 24, 5: 22, 6: 22 };
const BODY_HALF_PT = 22;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

const INLINE_TAGS = new Set(["b", "strong", "i", "em", "u", "code", "a"]);

/** Editor.js inline HTML -> docx TextRuns, carrying `base` run options through. */
function htmlToRuns(html: unknown, base: Record<string, unknown> = {}): TextRun[] {
  const text = typeof html === "string" ? html : "";
  const runs: TextRun[] = [];
  const stack: string[] = [];

  const format = (): Record<string, unknown> => {
    const f: Record<string, unknown> = { ...base };
    for (const tag of stack) {
      if (tag === "b" || tag === "strong") f.bold = true;
      else if (tag === "i" || tag === "em") f.italics = true;
      else if (tag === "u") f.underline = {};
      else if (tag === "code") f.font = "Courier New";
      else if (tag === "a") {
        f.underline = {};
        f.color = ACCENT;
      }
    }
    return f;
  };

  const pushText = (raw: string) => {
    if (raw) runs.push(new TextRun({ text: decodeEntities(raw), ...format() }));
  };

  const re = /<\/?([a-zA-Z0-9]+)[^>]*?(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    pushText(text.slice(last, m.index));
    const tag = m[1].toLowerCase();
    const closing = m[0].startsWith("</");
    const selfClosing = m[2] === "/";
    if (tag === "br") {
      runs.push(new TextRun({ break: 1 }));
    } else if (INLINE_TAGS.has(tag)) {
      if (closing) {
        const idx = stack.lastIndexOf(tag);
        if (idx >= 0) stack.splice(idx, 1);
      } else if (!selfClosing) {
        stack.push(tag);
      }
    }
    last = re.lastIndex;
  }
  pushText(text.slice(last));

  if (runs.length === 0) runs.push(new TextRun({ text: "", ...base }));
  return runs;
}

function headingParagraph(text: unknown, level: number): Paragraph {
  const lvl = Math.min(6, Math.max(1, level || 2));
  return new Paragraph({
    spacing: { before: lvl <= 1 ? 0 : 260, after: 110 },
    children: htmlToRuns(text, { bold: true, color: ACCENT, size: HEADING_HALF_PT[lvl] ?? 26 }),
  });
}

function listParagraphs(items: ListItem[], ordered: boolean, level: number): Paragraph[] {
  const out: Paragraph[] = [];
  for (const item of items) {
    out.push(
      new Paragraph({
        spacing: { before: 20, after: 20 },
        ...(ordered ? { numbering: { reference: "studio-ol", level } } : { bullet: { level } }),
        children: htmlToRuns(item.content, { size: BODY_HALF_PT }),
      }),
    );
    if (item.items && item.items.length > 0) {
      out.push(...listParagraphs(item.items, ordered, level + 1));
    }
  }
  return out;
}

function tableBlock(content: string[][], withHeadings: boolean): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER };
  const rows = content.map((row, i) => {
    const isHead = withHeadings && i === 0;
    return new TableRow({
      tableHeader: isHead,
      children: row.map(
        (cell) =>
          new TableCell({
            shading: isHead ? { fill: TABLE_HEADER_FILL } : undefined,
            margins: { top: 50, bottom: 50, left: 90, right: 90 },
            children: [
              new Paragraph({
                children: htmlToRuns(cell, isHead ? { bold: true, color: ACCENT, size: 20 } : { size: 20 }),
              }),
            ],
          }),
      ),
    });
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows,
  });
}

function quoteParagraph(text: unknown, caption: unknown): Paragraph[] {
  const out = [
    new Paragraph({
      spacing: { before: 100, after: caption ? 20 : 120 },
      indent: { left: 360 },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 10 } },
      children: htmlToRuns(text, { italics: true, color: MUTED, size: BODY_HALF_PT }),
    }),
  ];
  if (caption) {
    out.push(
      new Paragraph({
        spacing: { after: 120 },
        indent: { left: 360 },
        children: htmlToRuns(caption, { color: "94A3B8", size: 18 }),
      }),
    );
  }
  return out;
}

export async function blocksToDocx(doc: EditorDoc): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  for (const block of doc.blocks ?? []) {
    const d = block.data ?? {};
    switch (block.type) {
      case "header":
        children.push(headingParagraph(d.text, Number(d.level) || 2));
        break;
      case "paragraph":
        children.push(new Paragraph({ spacing: { after: 130 }, children: htmlToRuns(d.text, { size: BODY_HALF_PT }) }));
        break;
      case "list":
        children.push(
          ...listParagraphs(Array.isArray(d.items) ? (d.items as ListItem[]) : [], String(d.style) === "ordered", 0),
        );
        break;
      case "quote":
        children.push(...quoteParagraph(d.text, d.caption));
        break;
      case "table":
        children.push(tableBlock(Array.isArray(d.content) ? (d.content as string[][]) : [], d.withHeadings === true));
        break;
      default:
        if (typeof d.text === "string") {
          children.push(new Paragraph({ spacing: { after: 130 }, children: htmlToRuns(d.text, { size: BODY_HALF_PT }) }));
        }
    }
  }
  if (children.length === 0) children.push(new Paragraph({ children: [new TextRun({ text: "" })] }));

  const document = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: BODY_HALF_PT } } } },
    numbering: {
      config: [
        {
          reference: "studio-ol",
          levels: [0, 1, 2, 3, 4].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } },
          })),
        },
      ],
    },
    sections: [{ children }],
  });

  return Packer.toBuffer(document);
}
