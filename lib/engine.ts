import { spawn } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import { generateObject, generateText, jsonSchema } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import type { DocType, EngineId, ExtractionResult } from "./types";
import { getDocTypeAssets } from "./doctypes";

export const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

/** Gateway model ids are "vendor/model" (e.g. "openai/gpt-5.2"); bare ids are Anthropic-direct. */
export function isGatewayModel(model: string): boolean {
  return model.includes("/");
}

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
export function parseJsonLoose(text: string): unknown {
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
  model: string,
): Promise<EngineOutput> {
  const assets = getDocTypeAssets(docType);
  const client = new Anthropic({ apiKey });

  const stream = client.messages.stream({
    model,
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

// Gateway model catalog pricing (USD per token), cached so cost estimation
// doesn't add a round-trip to every run. Pricing is public catalog data.
let gatewayPricingCache: { at: number; byId: Map<string, { input: number; output: number; cacheRead: number }> } | null =
  null;

export async function gatewayCostUsd(
  apiKey: string,
  model: string,
  usage: NonNullable<EngineOutput["usage"]>,
): Promise<number | null> {
  try {
    if (!gatewayPricingCache || Date.now() - gatewayPricingCache.at > 3_600_000) {
      const catalog = await createGateway({ apiKey }).getAvailableModels();
      const byId = new Map<string, { input: number; output: number; cacheRead: number }>();
      for (const entry of catalog.models) {
        if (!entry.pricing) continue;
        byId.set(entry.id, {
          input: Number(entry.pricing.input),
          output: Number(entry.pricing.output),
          cacheRead: Number(entry.pricing.cachedInputTokens ?? entry.pricing.input),
        });
      }
      gatewayPricingCache = { at: Date.now(), byId };
    }
    const p = gatewayPricingCache.byId.get(model);
    if (!p) return null;
    return (
      usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheCreationInputTokens * p.input +
      usage.cacheReadInputTokens * p.cacheRead
    );
  } catch {
    return null; // cost estimation must never fail a run
  }
}

/**
 * Multi-vendor engine via Vercel AI Gateway: one key, any catalog model
 * ("openai/…", "google/…", "anthropic/…", "xai/…"). The AI SDK maps our JSON
 * schema onto each vendor's structured-output mechanism; ajv re-validates the
 * result afterwards regardless, so the schema gate holds for every vendor.
 */
async function extractViaGateway(
  docType: DocType,
  clientName: string,
  sourceText: string,
  model: string,
  apiKey: string,
): Promise<EngineOutput> {
  const assets = getDocTypeAssets(docType);
  const gateway = createGateway({ apiKey });

  let object: unknown;
  let usage: NonNullable<EngineOutput["usage"]>;
  try {
    const result = await generateObject({
      model: gateway(model),
      schema: jsonSchema<Record<string, unknown>>(assets.schema as Record<string, unknown>),
      system: assets.promptText,
      prompt: buildUserContent(docType, clientName, sourceText),
      maxOutputTokens: 32000,
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
    throw new ExtractionError(`Gateway extraction with ${model} failed: ${message.slice(0, 500)}`);
  }

  return {
    extracted: validateExtraction(docType, object),
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

export interface CliOutput {
  resultText: string;
  usage: EngineOutput["usage"];
  totalCostUsd: number | null;
}

/**
 * Shared local-only completion: shells out to the Claude Code CLI (`claude -p`),
 * covered by the operator's Max subscription. Never used on Vercel.
 */
export async function runCli(prompt: string, model: string, timeoutMs = 600_000): Promise<CliOutput> {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "json", "--model", model], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new ExtractionError(`CLI engine timed out after ${Math.round(timeoutMs / 60_000)} minutes.`));
    }, timeoutMs);
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
    resultText: envelope.result,
    usage: envelope.usage
      ? {
          inputTokens: envelope.usage.input_tokens ?? 0,
          outputTokens: envelope.usage.output_tokens ?? 0,
          cacheCreationInputTokens: envelope.usage.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: envelope.usage.cache_read_input_tokens ?? 0,
        }
      : null,
    totalCostUsd: envelope.total_cost_usd ?? null,
  };
}

async function extractViaCli(
  docType: DocType,
  clientName: string,
  sourceText: string,
  model: string,
): Promise<EngineOutput> {
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

  const cli = await runCli(prompt, model);
  return {
    extracted: validateExtraction(docType, parseJsonLoose(cli.resultText)),
    engine: "cli",
    model,
    usage: cli.usage,
    reportedCostUsd: cli.totalCostUsd,
  };
}

export interface EngineChoice {
  engine: EngineId;
  apiKey?: string; // Anthropic key (api engine) or AI Gateway key (gateway engine)
  model: string;
}

export interface EngineKeys {
  anthropicKey: string | null;
  gatewayKey: string | null;
  model?: string | null;
}

/**
 * Engine resolution. A "vendor/model" id always routes through the AI Gateway
 * (per-request BYOK gateway key, or AI_GATEWAY_API_KEY). Bare Claude model ids
 * keep the original order:
 * 1. A per-request Anthropic key (BYOK header) always wins -> api engine.
 * 2. ANTHROPIC_API_KEY in the environment -> api engine.
 * 3. Locally (not on Vercel), fall back to the Claude Code CLI (Max subscription).
 */
export function resolveEngine({ anthropicKey, gatewayKey, model }: EngineKeys): EngineChoice {
  const chosenModel = model?.trim() || DEFAULT_MODEL;

  if (isGatewayModel(chosenModel)) {
    const key = gatewayKey || process.env.AI_GATEWAY_API_KEY;
    if (!key) {
      throw new ExtractionError(
        `Model ${chosenModel} runs through the Vercel AI Gateway — add your AI Gateway key in Settings (or set AI_GATEWAY_API_KEY).`,
      );
    }
    return { engine: "gateway", apiKey: key, model: chosenModel };
  }

  const forced = process.env.EXTRACTION_ENGINE; // "api" | "cli" | unset
  if (anthropicKey) return { engine: "api", apiKey: anthropicKey, model: chosenModel };
  if (forced === "cli") {
    if (process.env.VERCEL) throw new ExtractionError("EXTRACTION_ENGINE=cli is not available on Vercel.");
    return { engine: "cli", model: chosenModel };
  }
  if (process.env.ANTHROPIC_API_KEY) return { engine: "api", apiKey: process.env.ANTHROPIC_API_KEY, model: chosenModel };
  if (forced === "api") {
    throw new ExtractionError("EXTRACTION_ENGINE=api but no API key was provided (env or Settings).");
  }
  if (!process.env.VERCEL) return { engine: "cli", model: chosenModel };
  throw new ExtractionError(
    "No API key available. Add your own key in Settings — an Anthropic key for Claude models, or a Vercel AI Gateway key for any vendor's models.",
  );
}

export async function runExtraction(
  docType: DocType,
  clientName: string,
  sourceText: string,
  choice: EngineChoice,
): Promise<EngineOutput> {
  if (choice.engine === "gateway") {
    if (!choice.apiKey) throw new ExtractionError("Gateway engine selected but no AI Gateway key resolved.");
    return extractViaGateway(docType, clientName, sourceText, choice.model, choice.apiKey);
  }
  if (choice.engine === "api") {
    if (!choice.apiKey) throw new ExtractionError("API engine selected but no API key resolved.");
    return extractViaApi(docType, clientName, sourceText, choice.apiKey, choice.model);
  }
  return extractViaCli(docType, clientName, sourceText, choice.model);
}

export interface CompletionOutput {
  text: string;
  engine: EngineId;
  model: string;
  usage: EngineOutput["usage"];
  /** CLI reports its own cost; gateway costs come from catalog pricing; api is estimated from usage. */
  reportedCostUsd: number | null;
}

/**
 * Shared plain-text completion over the same three engines — for the smaller
 * AI features (block revise, future rewrites) that don't need the extraction
 * pipeline's structured output. Keeps provider plumbing in one place.
 */
export async function completeText(
  system: string,
  user: string,
  choice: EngineChoice,
  maxOutputTokens = 4000,
): Promise<CompletionOutput> {
  if (choice.engine === "gateway") {
    if (!choice.apiKey) throw new ExtractionError("Gateway engine selected but no AI Gateway key resolved.");
    const gateway = createGateway({ apiKey: choice.apiKey });
    const result = await generateText({
      model: gateway(choice.model),
      system,
      prompt: user,
      maxOutputTokens,
    });
    const usage = {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      cacheCreationInputTokens: result.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
      cacheReadInputTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
    };
    return {
      text: result.text,
      engine: "gateway",
      model: choice.model,
      usage,
      reportedCostUsd: await gatewayCostUsd(choice.apiKey, choice.model, usage),
    };
  }

  if (choice.engine === "api") {
    if (!choice.apiKey) throw new ExtractionError("API engine selected but no API key resolved.");
    const client = new Anthropic({ apiKey: choice.apiKey });
    const res = await client.messages.create({
      model: choice.model,
      max_tokens: maxOutputTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = res.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new ExtractionError("The model returned no text.");
    return {
      text: block.text,
      engine: "api",
      model: res.model,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheCreationInputTokens: res.usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: res.usage.cache_read_input_tokens ?? 0,
      },
      reportedCostUsd: null,
    };
  }

  const cli = await runCli(`${system}\n\n${user}`, choice.model, 120_000);
  return {
    text: cli.resultText,
    engine: "cli",
    model: choice.model,
    usage: cli.usage,
    reportedCostUsd: cli.totalCostUsd,
  };
}
