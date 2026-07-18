import fs from "fs";
import path from "path";
import { Ajv, type ValidateFunction } from "ajv";
import type { DocType } from "./types";
import { DOC_TYPE_NAMES } from "./types";

const ROOT = process.cwd();

interface DocTypeAssets {
  schema: Record<string, unknown>;
  schemaVersion: string;
  templatePath: string;
  templateVersion: string;
  promptVersion: string;
  promptText: string;
  validate: ValidateFunction;
}

const cache = new Map<DocType, DocTypeAssets>();

function readPrompt(): { text: string; version: string } {
  const raw = fs.readFileSync(path.join(ROOT, "prompts", "extract.md"), "utf8");
  const match = raw.match(/prompt_version:\s*([\w.\-]+)/);
  return { text: raw, version: match ? match[1] : "unknown" };
}

export function getDocTypeAssets(docType: DocType): DocTypeAssets {
  const cached = cache.get(docType);
  if (cached) return cached;

  const schemaRaw = fs.readFileSync(path.join(ROOT, "schemas", `${docType}.schema.json`), "utf8");
  const schema = JSON.parse(schemaRaw) as Record<string, unknown>;
  const schemaVersion = typeof schema.version === "string" ? schema.version : "unknown";

  // The API rejects unknown top-level keywords in output_config schemas; keep
  // the on-disk file authoritative and strip metadata before sending.
  const apiSchema = { ...schema };
  delete apiSchema.version;
  delete apiSchema.$id;

  const prompt = readPrompt();
  const promptText = prompt.text.replaceAll("{{DOC_TYPE_NAME}}", DOC_TYPE_NAMES[docType]);

  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(apiSchema);

  const templatePath = path.join(ROOT, "templates", `${docType}.docx`);

  const assets: DocTypeAssets = {
    schema: apiSchema,
    schemaVersion,
    templatePath,
    templateVersion: "1.0.0",
    promptVersion: prompt.version,
    promptText,
    validate,
  };
  cache.set(docType, assets);
  return assets;
}
