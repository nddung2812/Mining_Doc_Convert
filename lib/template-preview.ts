import type { DocType, TemplateSpec } from "./types";
import { SECTION_BODIES, footerText, type SectionBody } from "./template-sections";
import { lighten } from "./template-compile";

export interface PreviewSection {
  id: string;
  title: string;
  html: string;
}

/** Sample values shown in the preview instead of {tags} — layout only. */
const META_SAMPLES: Record<string, string> = {
  "{doc_number}": "DOC-001",
  "{revision}": "1",
  "{site}": "Sample Site",
  "{effective_date}": "1 Jan 2026",
  "{review_date}": "1 Jan 2027",
  "{activity}": "Sample activity",
  "{assessment_date}": "1 Jan 2026",
  "{hazard_category}": "Sample principal hazard",
  "{proposal_number}": "P-001",
  "{date}": "1 Jan 2026",
  "{client_contact}": "A. Contact",
  "{prepared_by}": "Your team",
  "{validity}": "30 days",
};

const SAMPLE_PARAGRAPH =
  "Sample text — the client's extracted content will appear here. This preview demonstrates layout, typography, and colour only.";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The same design decisions as the .docx compiler, rendered as HTML so each
 * section can be reviewed and commented on in the browser. Sample content is
 * deliberately generic: the template carries no client content by design.
 */
export function renderPreviewSections(
  docType: DocType,
  spec: TemplateSpec,
  clientName: string,
  logoUrl: string | null,
): PreviewSection[] {
  const factorMap = { compact: 0.6, regular: 1, airy: 1.4 } as const;
  const f = factorMap[spec.spacing];
  const px = (v: number) => `${Math.round(v * f)}px`;
  const bodyFont = `'${spec.typography.body_font}', 'Calibri', sans-serif`;
  const headingFont = `'${spec.typography.heading_font}', 'Calibri', sans-serif`;
  const bodyStyle = `font-family:${bodyFont};font-size:${spec.typography.base_size_pt + 3}px;color:#1a1a1a;line-height:1.5;`;
  const accent = `#${spec.colors.accent}`;
  const muted = `#${spec.colors.muted_text}`;
  const headerFill = `#${spec.colors.table_header_fill}`;
  const borderColor = `#${spec.colors.table_border}`;
  const stripeFill = `#${lighten(spec.colors.table_header_fill, 0.55)}`;
  const borderWidth = { hairline: 1, light: 1, medium: 2 }[spec.tables.border_weight];

  let headingIndex = 0;
  const heading = (title: string) => {
    headingIndex += 1;
    const label = `${spec.headings.numbered ? `${headingIndex}. ` : ""}${
      spec.headings.uppercase ? title.toUpperCase() : title
    }`;
    const rule = spec.headings.underline_rule ? `border-bottom:2px solid ${accent};padding-bottom:4px;` : "";
    return `<h3 style="font-family:${headingFont};font-size:${spec.headings.size_pt + 4}px;font-weight:700;color:${accent};margin:${px(18)} 0 ${px(8)};${rule}">${esc(label)}</h3>`;
  };

  const cellBorder =
    spec.tables.style === "grid"
      ? `border:${borderWidth}px solid ${borderColor};`
      : `border-bottom:${borderWidth}px solid ${borderColor};`;
  const th = (t: string) => {
    const fill = spec.tables.style === "minimal" ? `border-bottom:2px solid ${accent};` : `background:${headerFill};`;
    return `<th style="${cellBorder}${fill}color:#${spec.tables.header_text_color};text-align:left;padding:6px 8px;font-weight:700;">${esc(t)}</th>`;
  };
  const td = (t: string) => {
    const fill = spec.tables.style === "striped" ? `background:${stripeFill};` : "";
    return `<td style="${cellBorder}${fill}padding:6px 8px;">${esc(t)}</td>`;
  };
  const tableHtml = (headers: string[], rows: string[][]) =>
    `<table style="width:100%;border-collapse:collapse;margin:${px(6)} 0;"><thead><tr>${headers.map(th).join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map(td).join("")}</tr>`)
      .join("")}</tbody></table>`;

  const sampleRows = (headers: string[]) =>
    [1, 2, 3].map((n) => headers.map((h) => `Sample ${h.toLowerCase()} ${n}`));

  const paragraphHtml = `<p style="margin:${px(6)} 0;color:#555;">${esc(SAMPLE_PARAGRAPH)}</p>`;
  const bulletsHtml = `<ul style="margin:${px(6)} 0;padding-left:20px;color:#555;">${[1, 2, 3]
    .map((n) => `<li>Sample item ${n}</li>`)
    .join("")}</ul>`;

  const coverHtml = () => {
    const align = spec.cover.style === "centered" ? "center" : "left";
    const logoImg =
      spec.cover.show_logo && logoUrl
        ? `<img src="${logoUrl}" alt="Client logo" style="height:${Math.round(spec.cover.logo_height_pt * 1.1)}px;max-width:60%;object-fit:contain;margin-bottom:${px(14)};" />`
        : "";
    const title = `<div style="font-family:${headingFont};font-size:${spec.cover.title_size_pt + 6}px;font-weight:700;margin-top:${px(16)};">Document Title</div>`;
    const rule = spec.cover.show_rule
      ? `<div style="border-bottom:3px solid ${accent};margin-top:${px(16)};"></div>`
      : "";
    if (spec.cover.style === "banner") {
      return `<div style="text-align:left;">${logoImg}<div style="background:${accent};padding:14px 18px;"><div style="font-family:${headingFont};font-size:20px;font-weight:700;color:#fff;">${esc(clientName)}</div><div style="font-family:${headingFont};font-size:13px;color:#${lighten(spec.colors.accent, 0.75)};">${esc(spec.cover.subtitle_text)}</div></div>${title}${rule}</div>`;
    }
    return `<div style="text-align:${align};">${logoImg}<div style="font-family:${headingFont};font-size:19px;font-weight:700;color:${accent};">${esc(clientName)}</div><div style="font-family:${headingFont};font-size:14px;color:${muted};margin-top:4px;">${esc(spec.cover.subtitle_text)}</div>${title}${rule}</div>`;
  };

  const bodyFor = (body: SectionBody): string => {
    switch (body.kind) {
      case "cover":
        return coverHtml();
      case "meta":
        return `<table style="width:100%;border-collapse:collapse;margin:${px(6)} 0;"><tbody>${body.rows
          .map(
            ([label, tag]) =>
              `<tr>${th(label)}${td(META_SAMPLES[tag] ?? "Sample value")}</tr>`,
          )
          .join("")}</tbody></table>`;
      case "paragraph":
        return paragraphHtml;
      case "bullets":
        return bulletsHtml;
      case "table":
        return tableHtml(
          body.columns.map((c) => c.header),
          sampleRows(body.columns.map((c) => c.header)),
        );
      case "steps":
        return [1, 2]
          .map(
            (n) =>
              `<p style="margin:${px(6)} 0;color:#555;">Step ${n}: Sample instruction text.</p><p style="margin:${px(4)} 0;color:#B00020;font-style:italic;">⚠ Sample warning where one applies.</p>`,
          )
          .join("");
      case "approach":
        return [1, 2]
          .map(
            (n) =>
              `<p style="margin:${px(6)} 0 2px;font-weight:700;color:${accent};">Phase ${n} (2 weeks)</p><p style="margin:2px 0 ${px(6)};color:#555;">Sample phase description.</p>`,
          )
          .join("");
    }
  };

  const bodies = SECTION_BODIES[docType];
  const sections: PreviewSection[] = [];
  for (const section of spec.sections) {
    const body = bodies[section.id];
    if (!body) continue;
    const inner = bodyFor(body);
    const withHeading =
      body.kind === "cover" || body.kind === "meta" ? inner : `${heading(section.title)}${inner}`;
    sections.push({
      id: section.id,
      title: section.title,
      html: `<div style="${bodyStyle}">${withHeading}</div>`,
    });
  }

  sections.push({
    id: "footer",
    title: "Page footer",
    html: `<div style="${bodyStyle}"><p style="text-align:center;font-size:11px;color:${muted};border-top:1px solid #ddd;padding-top:8px;margin:0;">${esc(
      footerText(docType).replace("{generated_at}", "(generation date)").replace(/\{[a-z_]+\}/g, "…"),
    )}</p></div>`,
  });

  return sections;
}
