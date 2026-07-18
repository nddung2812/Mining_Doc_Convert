// Generates the master docxtemplater templates (templates/*.docx).
// These are placeholder masters: swap in client-branded versions after the
// Phase 0 diff exercise — keep the {tags} identical and rendering keeps working.
import fs from "fs";
import path from "path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const OUT_DIR = path.join(process.cwd(), "templates");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FONT = "Calibri";
const ACCENT = "1F3A5F"; // deep mining-industry navy

const text = (t, opts = {}) => new TextRun({ text: t, font: FONT, size: 22, ...opts });
const para = (t, opts = {}) => new Paragraph({ children: [text(t, opts.run ?? {})], ...opts });

const heading = (t) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 120 },
    children: [new TextRun({ text: t, font: FONT, size: 26, bold: true, color: ACCENT })],
  });

const loopTag = (t) => new Paragraph({ children: [text(t, { size: 2, color: "FFFFFF" })] });

const cell = (t, { bold = false, shaded = false, width } = {}) =>
  new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: shaded ? { fill: "E8EDF4" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [text(t, { bold })] })],
  });

const fullWidthTable = (rows) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "9FB3CC" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "9FB3CC" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "9FB3CC" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "9FB3CC" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "9FB3CC" },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "9FB3CC" },
    },
    rows,
  });

const metaTable = (pairs) =>
  fullWidthTable(pairs.map(([label, tag]) => new TableRow({ children: [cell(label, { bold: true, shaded: true, width: 30 }), cell(tag, { width: 70 })] })));

const loopTable = (headers, openRowCells) =>
  fullWidthTable([
    new TableRow({ children: headers.map((h) => cell(h, { bold: true, shaded: true })) }),
    new TableRow({ children: openRowCells.map((t) => cell(t)) }),
  ]);

const titleBlock = (docTypeName) => [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 60 },
    children: [new TextRun({ text: "{client_name}", font: FONT, size: 28, bold: true, color: ACCENT })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: docTypeName, font: FONT, size: 22, color: "666666" })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: "{title}", font: FONT, size: 40, bold: true })],
  }),
];

const warningsBlock = [
  loopTag("{#has_review_warnings}"),
  new Paragraph({
    spacing: { before: 300, after: 120 },
    children: [new TextRun({ text: "REVIEWER CHECKLIST — items flagged during extraction", font: FONT, size: 24, bold: true, color: "B00020" })],
  }),
  loopTag("{#review_warnings}"),
  para("• {.}", { run: { color: "B00020" } }),
  loopTag("{/review_warnings}"),
  loopTag("{/has_review_warnings}"),
];

const draftFooter = new Footer({
  children: [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: "DRAFT generated {generated_at} — {doc_number} Rev {revision} — not valid until reviewed and approved by a qualified person",
          font: FONT,
          size: 16,
          color: "888888",
        }),
      ],
    }),
  ],
});

function buildDoc(children) {
  return new Document({
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ footers: { default: draftFooter }, children }],
  });
}

const sopChildren = [
  ...titleBlock("Standard Operating Procedure"),
  metaTable([
    ["Document number", "{doc_number}"],
    ["Revision", "{revision}"],
    ["Site", "{site}"],
    ["Effective date", "{effective_date}"],
    ["Next review date", "{review_date}"],
  ]),
  heading("1. Purpose"),
  para("{purpose}"),
  heading("2. Scope"),
  para("{scope}"),
  heading("3. Definitions"),
  loopTable(["Term", "Definition"], ["{#definitions}{term}", "{definition}{/definitions}"]),
  heading("4. Responsibilities"),
  loopTable(["Role", "Duties"], ["{#responsibilities}{role}", "{duties}{/responsibilities}"]),
  heading("5. PPE Requirements"),
  loopTag("{#ppe_requirements}"),
  para("• {.}"),
  loopTag("{/ppe_requirements}"),
  heading("6. Hazards and Controls"),
  loopTable(["Hazard", "Risk level", "Controls"], ["{#hazards}{hazard}", "{risk_level}", "{controls}{/hazards}"]),
  heading("7. Procedure"),
  loopTag("{#procedure_steps}"),
  para("Step {step_number}: {instruction}", { run: {} }),
  para("⚠ {warning}", { run: { italics: true, color: "B00020" } }),
  loopTag("{/procedure_steps}"),
  heading("8. References"),
  loopTag("{#references}"),
  para("• {.}"),
  loopTag("{/references}"),
  ...warningsBlock,
];

const raChildren = [
  ...titleBlock("Risk Assessment"),
  metaTable([
    ["Document number", "{doc_number}"],
    ["Revision", "{revision}"],
    ["Site", "{site}"],
    ["Activity assessed", "{activity}"],
    ["Assessment date", "{assessment_date}"],
  ]),
  heading("1. Assessment Team"),
  loopTag("{#assessors}"),
  para("• {.}"),
  loopTag("{/assessors}"),
  heading("2. Methodology"),
  para("{methodology}"),
  heading("3. Risk Register"),
  loopTable(
    ["Hazard", "Associated risk", "Initial risk", "Controls", "Residual risk", "Owner"],
    ["{#risk_items}{hazard}", "{associated_risk}", "{initial_risk}", "{controls}", "{residual_risk}", "{control_owner}{/risk_items}"],
  ),
  heading("4. References"),
  loopTag("{#references}"),
  para("• {.}"),
  loopTag("{/references}"),
  ...warningsBlock,
];

const hmpChildren = [
  ...titleBlock("Hazard Management Plan"),
  metaTable([
    ["Document number", "{doc_number}"],
    ["Revision", "{revision}"],
    ["Site", "{site}"],
    ["Principal hazard", "{hazard_category}"],
    ["Effective date", "{effective_date}"],
    ["Next review date", "{review_date}"],
  ]),
  heading("1. Purpose"),
  para("{purpose}"),
  heading("2. Scope"),
  para("{scope}"),
  heading("3. Hazard Description"),
  para("{hazard_description}"),
  heading("4. Control Measures"),
  loopTable(["Control", "Hierarchy type", "Owner"], ["{#controls}{control}", "{type}", "{owner}{/controls}"]),
  heading("5. Monitoring and Inspection"),
  loopTable(["Activity", "Frequency", "Responsible"], ["{#monitoring}{activity}", "{frequency}", "{responsible}{/monitoring}"]),
  heading("6. Responsibilities"),
  loopTable(["Role", "Duties"], ["{#responsibilities}{role}", "{duties}{/responsibilities}"]),
  heading("7. Trigger Action Response Plan (TARP)"),
  loopTable(["Trigger", "Level", "Response"], ["{#trigger_action_responses}{trigger}", "{level}", "{response}{/trigger_action_responses}"]),
  heading("8. References"),
  loopTag("{#references}"),
  para("• {.}"),
  loopTag("{/references}"),
  ...warningsBlock,
];

for (const [name, children] of [
  ["sop", sopChildren],
  ["ra", raChildren],
  ["hmp", hmpChildren],
]) {
  const buffer = await Packer.toBuffer(buildDoc(children));
  fs.writeFileSync(path.join(OUT_DIR, `${name}.docx`), buffer);
  console.log(`templates/${name}.docx written (${buffer.length} bytes)`);
}
