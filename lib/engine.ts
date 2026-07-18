import { spawn } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import type { DocType, EngineId, ExtractionResult } from "./types";
import { getDocTypeAssets } from "./doctypes";

export const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

export interface EngineOutput {
  extracted: ExtractionResult;
  engine: EngineId;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  } | null;
  /** Reported by the CLI for subscription runs; computed from usage for API runs. */
  reportedCostUsd: number | null;
}

export class ExtractionError extends Error {}

function buildUserContent(docType: DocType, clientName: string, sourceText: string): string {
  return [
    `Doc type: ${docType.toUpperCase()}`,
    `Client (for the client_name field only if the source itself does not name one): ${clientName}`,
    "",
    "<source_content>",
    sourceText,
    "</source_content>",
  ].join("\n");
}

/** Pull the first top-level JSON object out of possibly-noisy model text. */
function parseJsonLoose(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new ExtractionError("Engine returned no JSON object.");
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ExtractionError("Engine returned malformed JSON.");
  }
}

function validateExtraction(docType: DocType, data: unknown): ExtractionResult {
  const { validate } = getDocTypeAssets(docType);
  if (!validate(data)) {
    const errors = (validate.errors ?? [])
      .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`)
      .join("; ");
    throw new ExtractionError(`Extraction did not conform to the ${docType} schema: ${errors}`);
  }
  return data as unknown as ExtractionResult;
}

async function extractViaApi(
  docType: DocType,
  clientName: string,
  sourceText: string,
  apiKey: string,
): Promise<EngineOutput> {
  const assets = getDocTypeAssets(docType);
  const client = new Anthropic({ apiKey });

  const stream = client.messages.stream({
    model: DEFAULT_MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    system: assets.promptText,
    messages: [{ role: "user", content: buildUserContent(docType, clientName, sourceText) }],
    output_config: { format: { type: "json_schema", schema: assets.schema } },
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new ExtractionError("The model declined to process this content (safety refusal).");
  }
  if (response.stop_reason === "max_tokens") {
    throw new ExtractionError("Extraction was truncated (max_tokens). The source may be too large for one run.");
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new ExtractionError("The model returned no text content.");
  }

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
  };

  return {
    extracted: validateExtraction(docType, parseJsonLoose(textBlock.text)),
    engine: "api",
    model: response.model,
    usage,
    reportedCostUsd: null,
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

/**
 * Local-only engine: shells out to the Claude Code CLI (`claude -p`), which is
 * covered by the operator's Max subscription. Never used on Vercel.
 */
async function extractViaCli(docType: DocType, clientName: string, sourceText: string): Promise<EngineOutput> {
  const assets = getDocTypeAssets(docType);
  const prompt = [
    assets.promptText,
    "",
    "## JSON Schema your output must conform to",
    "```json",
    JSON.stringify(assets.schema, null, 2),
    "```",
    "",
    buildUserContent(docType, clientName, sourceText),
  ].join("\n");

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "json", "--model", DEFAULT_MODEL], {
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

  const usage = envelope.usage
    ? {
        inputTokens: envelope.usage.input_tokens ?? 0,
        outputTokens: envelope.usage.output_tokens ?? 0,
        cacheCreationInputTokens: envelope.usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: envelope.usage.cache_read_input_tokens ?? 0,
      }
    : null;

  return {
    extracted: validateExtraction(docType, parseJsonLoose(envelope.result)),
    engine: "cli",
    model: DEFAULT_MODEL,
    usage,
    reportedCostUsd: envelope.total_cost_usd ?? null,
  };
}

export interface EngineChoice {
  engine: EngineId;
  apiKey?: string;
}

/**
 * Engine resolution:
 * 1. A per-request API key (BYOK header) always wins -> api engine.
 * 2. ANTHROPIC_API_KEY in the environment -> api engine.
 * 3. Locally (not on Vercel), fall back to the Claude Code CLI (Max subscription).
 */
export function resolveEngine(requestApiKey: string | null): EngineChoice {
  const forced = process.env.EXTRACTION_ENGINE; // "api" | "cli" | unset
  if (requestApiKey) return { engine: "api", apiKey: requestApiKey };
  if (forced === "cli") {
    if (process.env.VERCEL) throw new ExtractionError("EXTRACTION_ENGINE=cli is not available on Vercel.");
    return { engine: "cli" };
  }
  if (process.env.ANTHROPIC_API_KEY) return { engine: "api", apiKey: process.env.ANTHROPIC_API_KEY };
  if (forced === "api") {
    throw new ExtractionError("EXTRACTION_ENGINE=api but no API key was provided (env or Settings).");
  }
  if (!process.env.VERCEL) return { engine: "cli" };
  throw new ExtractionError(
    "No Claude API key available. Add your own key in Settings — deployed instances require a bring-your-own Anthropic API key.",
  );
}

export async function runExtraction(
  docType: DocType,
  clientName: string,
  sourceText: string,
  choice: EngineChoice,
): Promise<EngineOutput> {
  if (choice.engine === "api") {
    if (!choice.apiKey) throw new ExtractionError("API engine selected but no API key resolved.");
    return extractViaApi(docType, clientName, sourceText, choice.apiKey);
  }
  return extractViaCli(docType, clientName, sourceText);
}
