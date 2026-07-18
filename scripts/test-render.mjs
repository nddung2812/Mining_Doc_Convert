// Renders each template with representative dummy data and fails loudly on
// any unresolved tag / loop error. Run: node scripts/test-render.mjs
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

const OUT_DIR = path.join(process.cwd(), "data", "test-output");
fs.mkdirSync(OUT_DIR, { recursive: true });

const common = {
  title: "Isolation and Tagging of Mobile Plant",
  doc_number: "SOP-041",
  revision: "3",
  client_name: "Example Mining Co",
  site: "Blackwater Operations",
  effective_date: "1 July 2026",
  review_date: "«NOT FOUND — REVIEW REQUIRED»",
  purpose: "To define the mandatory process for isolating mobile plant before maintenance.",
  scope: "All maintenance personnel and contractors at Blackwater Operations.",
  references: ["AS/NZS 4836", "Coal Mining Safety and Health Act 1999 (Qld)"],
  generated_at: new Date().toISOString(),
  review_warnings: ["Source references Appendix B which was not supplied."],
  has_review_warnings: true,
};

const dataByType = {
  sop: {
    ...common,
    definitions: [{ term: "Isolation", definition: "Physical separation of plant from energy sources." }],
    responsibilities: [{ role: "Maintenance Supervisor", duties: "Verify isolations before work commences." }],
    ppe_requirements: ["Hard hat", "High-visibility clothing", "Safety boots"],
    procedure_steps: [
      { step_number: "1", instruction: "Park plant on level ground and apply park brake.", warning: "" },
      { step_number: "2", instruction: "Attach personal danger tag and lock.", warning: "Never rely on another person's lock." },
    ],
    hazards: [{ hazard: "Stored hydraulic energy", risk_level: "High", controls: "Bleed down circuits before disconnecting hoses." }],
  },
  ra: {
    ...common,
    activity: "Tyre change on haul truck",
    assessment_date: "12 June 2026",
    assessors: ["J. Citizen — HSE Advisor", "M. Nguyen — Maintenance Super"],
    methodology: "5x5 qualitative risk matrix per site standard.",
    risk_items: [
      {
        hazard: "Tyre explosion",
        associated_risk: "Fatality from pressure release",
        initial_risk: "Extreme",
        controls: "Deflate before removal; exclusion zone 300m.",
        residual_risk: "Medium",
        control_owner: "Maintenance Supervisor",
      },
    ],
  },
  hmp: {
    ...common,
    hazard_category: "Ground control",
    hazard_description: "Unsupported strata in development headings can fail without warning.",
    controls: [{ control: "Ground support installed per design", type: "Engineering", owner: "Mining Manager" }],
    monitoring: [{ activity: "Convergence monitoring", frequency: "Weekly", responsible: "Geotech Engineer" }],
    responsibilities: [{ role: "Mining Manager", duties: "Maintain ground control management system." }],
    trigger_action_responses: [{ trigger: "Convergence > 5mm/week", level: "Amber", response: "Restrict access; notify Geotech." }],
  },
};

let failed = false;
for (const type of ["sop", "ra", "hmp"]) {
  try {
    const zip = new PizZip(fs.readFileSync(path.join(process.cwd(), "templates", `${type}.docx`)));
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render(dataByType[type]);
    const buf = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
    const outPath = path.join(OUT_DIR, `${type}-test.docx`);
    fs.writeFileSync(outPath, buf);
    console.log(`OK  ${type} -> ${outPath} (${buf.length} bytes)`);
  } catch (e) {
    failed = true;
    const details = e.properties?.errors?.map((x) => x.properties?.explanation).join("; ") ?? e.message;
    console.error(`FAIL ${type}: ${details}`);
  }
}
process.exit(failed ? 1 : 0);
