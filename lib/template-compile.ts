import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { DocType, TemplateSpec } from "./types";
import { SECTION_BODIES, footerText, type SectionBody } from "./template-sections";

export interface LogoAsset {
  data: Buffer;
  type: "png" | "jpg" | "svg";
  width: number;
  height: number;
}

/** 1×1 transparent PNG — the raster fallback docx requires for SVG images. */
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==",
  "base64",
);

/** Read pixel dimensions from PNG/JPEG headers or SVG attributes — enough to keep aspect ratio. */
export function parseLogo(filename: string, buffer: Buffer): LogoAsset | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  try {
    if (ext === "png" && buffer.length > 24 && buffer.readUInt32BE(12) === 0x49484452) {
      return { data: buffer, type: "png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (ext === "svg") {
      const svg = buffer.toString("utf8");
      if (!/<svg[\s>]/i.test(svg)) return null;
      const dim = (name: string) => {
        const m = svg.match(new RegExp(`<svg[^>]*\\b${name}="([\\d.]+)(?:px)?"`, "i"));
        return m ? parseFloat(m[1]) : null;
      };
      let width = dim("width");
      let height = dim("height");
      if (!width || !height) {
        const viewBox = svg.match(/<svg[^>]*\bviewBox="[\d.\-]+[ ,]+[\d.\-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/i);
        if (viewBox) {
          width = parseFloat(viewBox[1]);
          height = parseFloat(viewBox[2]);
        }
      }
      if (!width || !height) return null;
      return { data: buffer, type: "svg", width, height };
    }
    if ((ext === "jpg" || ext === "jpeg") && buffer.readUInt16BE(0) === 0xffd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        // SOFn markers carry the frame dimensions.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return {
            data: buffer,
            type: "jpg",
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
          };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Mix a hex colour toward white; ratio 0 = unchanged, 1 = white. */
export function lighten(hexColor: string, ratio: number): string {
  const n = parseInt(hexColor, 16);
  const mix = (c: number) => Math.round(c + (255 - c) * ratio);
  const [red, green, blue] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return ((red << 16) | (green << 8) | blue).toString(16).padStart(6, "0").toUpperCase();
}

const BORDER_SIZE = { hairline: 2, light: 4, medium: 8 } as const;
const SPACING_FACTOR = { compact: 0.6, regular: 1, airy: 1.4 } as const;

/**
 * Deterministic compile: TemplateSpec -> docxtemplater template (.docx).
 * The {tags} come from SECTION_BODIES and are identical to the masters, so the
 * output must always pass validateTemplate — a failure here is a bug, not bad
 * model output.
 */
export async function compileTemplate(docType: DocType, spec: TemplateSpec, logo: LogoAsset | null): Promise<Buffer> {
  const bodySize = spec.typography.base_size_pt * 2; // docx uses half-points
  const factor = SPACING_FACTOR[spec.spacing];
  const sp = (v: number) => Math.round(v * factor);
  const borderSize = BORDER_SIZE[spec.tables.border_weight];

  const text = (t: string, opts: Record<string, unknown> = {}) =>
    new TextRun({ text: t, font: spec.typography.body_font, size: bodySize, ...opts });
  const para = (t: string, opts: { run?: Record<string, unknown>; [k: string]: unknown } = {}) => {
    const { run, ...rest } = opts;
    return new Paragraph({ children: [text(t, run ?? {})], ...rest });
  };
  // Loop tags need their own paragraph but no visible footprint.
  const loopTag = (t: string) => new Paragraph({ children: [text(t, { size: 2, color: "FFFFFF" })] });

  let headingIndex = 0;
  const heading = (title: string) => {
    headingIndex += 1;
    const label = `${spec.headings.numbered ? `${headingIndex}. ` : ""}${
      spec.headings.uppercase ? title.toUpperCase() : title
    }`;
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: sp(300), after: sp(120) },
      border: spec.headings.underline_rule
        ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: spec.colors.accent, space: 2 } }
        : undefined,
      children: [
        new TextRun({
          text: label,
          font: spec.typography.heading_font,
          size: spec.headings.size_pt * 2,
          bold: true,
          color: spec.colors.accent,
        }),
      ],
    });
  };

  const stripeFill = lighten(spec.colors.table_header_fill, 0.55);
  const cell = (t: string, opts: { header?: boolean; body?: boolean; width?: number } = {}) =>
    new TableCell({
      width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
      shading: opts.header
        ? spec.tables.style === "minimal"
          ? undefined
          : { fill: spec.colors.table_header_fill }
        : opts.body && spec.tables.style === "striped"
          ? { fill: stripeFill }
          : undefined,
      borders:
        opts.header && spec.tables.style === "minimal"
          ? { bottom: { style: BorderStyle.SINGLE, size: 8, color: spec.colors.accent } }
          : undefined,
      margins: { top: sp(60), bottom: sp(60), left: 100, right: 100 },
      children: [
        new Paragraph({
          children: [text(t, opts.header ? { bold: true, color: spec.tables.header_text_color } : {})],
        }),
      ],
    });

  const border = { style: BorderStyle.SINGLE, size: borderSize, color: spec.colors.table_border };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const tableBorders =
    spec.tables.style === "grid"
      ? { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border }
      : spec.tables.style === "striped"
        ? { top: border, bottom: border, left: none, right: none, insideHorizontal: border, insideVertical: none }
        : { top: none, bottom: border, left: none, right: none, insideHorizontal: border, insideVertical: none };

  const table = (rows: TableRow[]) =>
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders, rows });

  const metaTable = (rows: [string, string][]) =>
    table(
      rows.map(
        ([label, tag]) =>
          new TableRow({
            children: [cell(label, { header: true, width: 30 }), cell(tag, { body: true, width: 70 })],
          }),
      ),
    );

  const loopTable = (body: Extract<SectionBody, { kind: "table" }>) =>
    table([
      new TableRow({ children: body.columns.map((c) => cell(c.header, { header: true })) }),
      new TableRow({
        children: body.columns.map((c, i) => {
          const first = i === 0 ? `{#${body.loop}}` : "";
          const last = i === body.columns.length - 1 ? `{/${body.loop}}` : "";
          return cell(`${first}${c.tag}${last}`, { body: true });
        }),
      }),
    ]);

  const bullets = (loop: string) => [loopTag(`{#${loop}}`), para("• {.}"), loopTag(`{/${loop}}`)];

  const coverChildren = (): (Paragraph | Table)[] => {
    const align =
      spec.cover.style === "centered" ? AlignmentType.CENTER : AlignmentType.LEFT;
    const out: (Paragraph | Table)[] = [];

    if (spec.cover.show_logo && logo) {
      const heightPx = Math.round((spec.cover.logo_height_pt * 4) / 3);
      const widthPx = Math.round(heightPx * (logo.width / logo.height));
      const transformation = { width: widthPx, height: heightPx };
      // SVG renders natively in modern Word; the fallback only shows in
      // legacy renderers, where a transparent pixel beats a broken icon.
      const image =
        logo.type === "svg"
          ? new ImageRun({
              type: "svg",
              data: logo.data,
              transformation,
              fallback: { type: "png", data: TRANSPARENT_PNG },
            })
          : new ImageRun({ type: logo.type, data: logo.data, transformation });
      out.push(
        new Paragraph({
          alignment: align,
          spacing: { before: sp(200), after: sp(160) },
          children: [image],
        }),
      );
    }

    if (spec.cover.style === "banner") {
      out.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  shading: { fill: spec.colors.accent },
                  margins: { top: 160, bottom: 160, left: 200, right: 200 },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: "{client_name}",
                          font: spec.typography.heading_font,
                          size: 32,
                          bold: true,
                          color: "FFFFFF",
                        }),
                      ],
                    }),
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: spec.cover.subtitle_text,
                          font: spec.typography.heading_font,
                          size: 20,
                          color: lighten(spec.colors.accent, 0.75),
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      );
    } else {
      out.push(
        new Paragraph({
          alignment: align,
          spacing: { before: sp(200), after: sp(60) },
          children: [
            new TextRun({
              text: "{client_name}",
              font: spec.typography.heading_font,
              size: 28,
              bold: true,
              color: spec.colors.accent,
            }),
          ],
        }),
        new Paragraph({
          alignment: align,
          spacing: { after: sp(60) },
          children: [
            new TextRun({
              text: spec.cover.subtitle_text,
              font: spec.typography.heading_font,
              size: 22,
              color: spec.colors.muted_text,
            }),
          ],
        }),
      );
    }

    out.push(
      new Paragraph({
        alignment: align,
        spacing: { before: spec.cover.style === "banner" ? sp(240) : 0, after: sp(240) },
        children: [
          new TextRun({
            text: "{title}",
            font: spec.typography.heading_font,
            size: spec.cover.title_size_pt * 2,
            bold: true,
          }),
        ],
      }),
    );

    if (spec.cover.show_rule) {
      out.push(
        new Paragraph({
          spacing: { after: sp(240) },
          border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: spec.colors.accent, space: 1 } },
          children: [text("", {})],
        }),
      );
    }
    return out;
  };

  const bodyFor = (body: SectionBody): (Paragraph | Table)[] => {
    switch (body.kind) {
      case "cover":
        return coverChildren();
      case "meta":
        return [metaTable(body.rows)];
      case "paragraph":
        return [para(body.tag)];
      case "bullets":
        return bullets(body.loop);
      case "table":
        return [loopTable(body)];
      case "steps":
        return [
          loopTag("{#procedure_steps}"),
          para("Step {step_number}: {instruction}"),
          para("⚠ {warning}", { run: { italics: true, color: "B00020" } }),
          loopTag("{/procedure_steps}"),
        ];
      case "approach":
        return [
          loopTag("{#approach}"),
          para("{phase} ({duration})", { run: { bold: true, color: spec.colors.accent } }),
          para("{description}"),
          loopTag("{/approach}"),
        ];
    }
  };

  const bodies = SECTION_BODIES[docType];
  const children: (Paragraph | Table)[] = [];
  for (const section of spec.sections) {
    const body = bodies[section.id];
    if (!body) continue;
    // Cover and doc-info render their content without a section heading.
    if (body.kind !== "cover" && body.kind !== "meta") children.push(heading(section.title));
    children.push(...bodyFor(body));
  }

  // Mandatory reviewer checklist — part of the review gate, never designable away.
  children.push(
    loopTag("{#has_review_warnings}"),
    new Paragraph({
      spacing: { before: sp(300), after: sp(120) },
      children: [
        new TextRun({
          text: "REVIEWER CHECKLIST — items flagged during extraction",
          font: spec.typography.heading_font,
          size: 24,
          bold: true,
          color: "B00020",
        }),
      ],
    }),
    loopTag("{#review_warnings}"),
    para("• {.}", { run: { color: "B00020" } }),
    loopTag("{/review_warnings}"),
    loopTag("{/has_review_warnings}"),
  );

  const doc = new Document({
    styles: { default: { document: { run: { font: spec.typography.body_font, size: bodySize } } } },
    sections: [
      {
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: footerText(docType),
                    font: spec.typography.body_font,
                    size: 16,
                    color: spec.colors.muted_text,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
