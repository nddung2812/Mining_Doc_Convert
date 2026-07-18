import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import { generateObject, jsonSchema } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import type { DocType, EngineId, SectionFeedback, TemplateSpec } from "./types";
import { DOC_TYPE_NAMES } from "./types";
import { ExtractionError, gatewayCostUsd, type EngineChoice, type EngineOutput } from "./engine";
import { getSpecSchema, normalizeSpec, sectionCatalog } from "./template-spec";

const MAX_MATERIAL_CHARS = 30_000;

export interface DesignInput {
  docType: DocType;
  clientName: string;
  brief: string;
  styleGuides: { filename: string; text: string }[];
  references: { filename: string; text: string }[];
  fontNames: string[];
  hasLogo: boolean;
  /** Present on revision rounds only. */
  previousSpec?: TemplateSpec;
  feedback?: SectionFeedback[];
}

export interface SpecEngineOutput {
  spec: TemplateSpec;
  engine: EngineId;
  model: string;
  usage: EngineOutput["usage"];
  reportedCostUsd: number | null;
}

let promptCache: { text: string; version: string } | null = null;

export function getDesignPrompt(): { text: string; version: string } {
  if (!promptCache) {
    const raw = fs.readFileSync(path.join(process.cwd(), "prompts", "template-design.md"), "utf8");
    const match = raw.match(/prompt_version:\s*([\w.\-]+)/);
    promptCache = { text: raw, version: match ? match[1] : "unknown" };
  }
  return promptCache;
}

const clip = (text: string) =>
  text.length > MAX_MATERIAL_CHARS ? `${text.slice(0, MAX_MATERIAL_CHARS)}\n[…truncated]` : text;

function buildDesignContent(input: DesignInput): string {
  const catalog = sectionCatalog(input.docType)
    .map((s) => `- ${s.id} — "${s.defaultTitle}" — ${s.hint}`)
    .join("\n");

  const parts: string[] = [
    `Doc type: ${input.docType.toUpperCase()} — ${DOC_TYPE_NAMES[input.docType]}`,
    `Client: ${input.clientName}`,
    "",
    "Section catalog (your sections array must contain exactly these ids, each once):",
    catalog,
    "",
    `Logo uploaded: ${input.hasLogo ? "yes" : "no"}`,
    `Uploaded font files: ${input.fontNames.length ? input.fontNames.join(", ") : "none"}`,
  ];

  for (const guide of input.styleGuides) {
    parts.push("", `<style_guide name="${guide.filename}">`, clip(guide.text), "</style_guide>");
  }
  for (const ref of input.references) {
    parts.push("", `<reference_document name="${ref.filename}">`, clip(ref.text), "</reference_document>");
  }

  parts.push("", "<brief>", input.brief.trim() || "(none given — design from the materials)", "</brief>");

  if (input.previousSpec && input.feedback) {
    parts.push(
      "",
      "## Revision round",
      "Previous TemplateSpec:",
      "```json",
      JSON.stringify(input.previousSpec, null, 2),
      "```",
      "",
      "Reviewer feedback by section:",
      ...input.feedback.map((f) => `- [${f.sectionId}] ${f.comment}`),
      "",
      "Apply the feedback and return the complete revised TemplateSpec.",
    );
  }

  return parts.join("\n");
}

/** Pull the first top-level JSON object out of possibly-noisy model text. */
function parseJsonLoose(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new ExtractionError("Design engine returned no JSON object.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ExtractionError("Design engine returned malformed JSON.");
  }
}

async function designViaApi(input: DesignInput, apiKey: string, model: string): Promise<SpecEngineOutput> {
  const { schema } = getSpecSchema();
  const client = new Anthropic({ apiKey });

  const stream = client.messages.stream({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: getDesignPrompt().text,
    messages: [{ role: "user", content: buildDesignContent(input) }],
    output_config: { format: { type: "json_schema", schema } },
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new ExtractionError("The model declined to process this content (safety refusal).");
  }
  if (response.stop_reason === "max_tokens") {
    throw new ExtractionError("Design was truncated (max_tokens). Try smaller style guides / references.");
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new ExtractionError("The model returned no text content.");

  return {
    spec: normalizeSpec(input.docType, parseJsonLoose(textBlock.text)),
    engine: "api",
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
    reportedCostUsd: null,
  };
}

async function designViaGateway(input: DesignInput, model: string, apiKey: string): Promise<SpecEngineOutput> {
  const { schema } = getSpecSchema();
  const gateway = createGateway({ apiKey });

  let object: unknown;
  let usage: NonNullable<EngineOutput["usage"]>;
  try {
    const result = await generateObject({
      model: gateway(model),
      schema: jsonSchema<Record<string, unknown>>(schema),
      system: getDesignPrompt().text,
      prompt: buildDesignContent(input),
      maxOutputTokens: 16000,
    });
    object = result.object;
    usage = {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      cacheCreationInputTokens: result.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
      cacheReadInputTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ExtractionError(`Gateway design with ${model} failed: ${message.slice(0, 500)}`);
  }

  return {
    spec: normalizeSpec(input.docType, object),
    engine: "gateway",
    model,
    usage,
    reportedCostUsd: await gatewayCostUsd(apiKey, model, usage),
  };
}

interface CliEnvelope {
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  is_error?: boolean;
}

async function designViaCli(input: DesignInput, model: string): Promise<SpecEngineOutput> {
  const { schema } = getSpecSchema();
  const prompt = [
    getDesignPrompt().text,
    "",
    "## JSON Schema your output must conform to",
    "```json",
    JSON.stringify(schema, null, 2),
    "```",
    "",
    buildDesignContent(input),
  ].join("\n");

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "json", "--model", model], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new ExtractionError("CLI engine timed out after 10 minutes."));
    }, 600_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      reject(new ExtractionError(`Could not launch the claude CLI (${e.message}). Is Claude Code installed?`)),
    );
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new ExtractionError(`claude CLI exited with code ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });

  let envelope: CliEnvelope;
  try {
    envelope = JSON.parse(stdout) as CliEnvelope;
  } catch {
    throw new ExtractionError("Could not parse the claude CLI response envelope.");
  }
  if (envelope.is_error || typeof envelope.result !== "string") {
    throw new ExtractionError(`claude CLI reported an error: ${JSON.stringify(envelope).slice(0, 500)}`);
  }

  return {
    spec: normalizeSpec(input.docType, parseJsonLoose(envelope.result)),
    engine: "cli",
    model,
    usage: envelope.usage
      ? {
          inputTokens: envelope.usage.input_tokens ?? 0,
          outputTokens: envelope.usage.output_tokens ?? 0,
          cacheCreationInputTokens: envelope.usage.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: envelope.usage.cache_read_input_tokens ?? 0,
        }
      : null,
    reportedCostUsd: envelope.total_cost_usd ?? null,
  };
}

/**
 * Generate (or revise) a TemplateSpec with whichever engine resolveEngine
 * chose. The returned spec is already normalized — safe to compile.
 */
export async function runTemplateDesign(input: DesignInput, choice: EngineChoice): Promise<SpecEngineOutput> {
  if (choice.engine === "gateway") {
    if (!choice.apiKey) throw new ExtractionError("Gateway engine selected but no AI Gateway key resolved.");
    return designViaGateway(input, choice.model, choice.apiKey);
  }
  if (choice.engine === "api") {
    if (!choice.apiKey) throw new ExtractionError("API engine selected but no API key resolved.");
    return designViaApi(input, choice.apiKey, choice.model);
  }
  return designViaCli(input, choice.model);
}
