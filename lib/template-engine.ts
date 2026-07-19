import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { generateObject, jsonSchema } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import type { DocType, EngineId, SectionFeedback, TemplateSpec } from "./types";
import { DOC_TYPE_NAMES } from "./types";
import { ExtractionError, gatewayCostUsd, runCli, type EngineChoice, type EngineOutput } from "./engine";
import {
  applySpecPatch,
  getSpecPatchSchema,
  getSpecSchema,
  guardSpecPatch,
  lintSpec,
  normalizeSpec,
  patchIsEmpty,
  sectionCatalog,
} from "./template-spec";

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
  /** Present on the automatic lint-repair round only. */
  repairNotes?: string[];
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

/** Revision (or repair) rounds return a patch, not a full spec. */
function isRevision(input: DesignInput): boolean {
  return Boolean(input.previousSpec && ((input.feedback?.length ?? 0) > 0 || (input.repairNotes?.length ?? 0) > 0));
}

/**
 * Everything that is identical across every round of a build: doc type, section
 * catalog, materials, brief. Kept byte-stable on purpose — on the Anthropic
 * engine this block carries a cache breakpoint, so revision rounds re-read it
 * from the prompt cache at ~0.1x instead of re-paying the full materials.
 */
function buildStableContent(input: DesignInput): string {
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
  return parts.join("\n");
}

/** The per-round tail: previous spec + feedback (or lint repair notes). */
function buildRevisionContent(input: DesignInput): string | null {
  if (!isRevision(input)) return null;
  const parts: string[] = [];

  if (input.repairNotes?.length) {
    parts.push(
      "## Automated quality repair",
      "The current TemplateSpec (below) failed an automated legibility/compatibility check:",
      ...input.repairNotes.map((n) => `- ${n}`),
    );
  } else {
    parts.push(
      "## Revision round",
      "Reviewer feedback by section:",
      ...(input.feedback ?? []).map((f) => `- [${f.sectionId}] ${f.comment}`),
    );
  }

  parts.push(
    "",
    "Current TemplateSpec (already in force — do NOT restate unchanged fields):",
    "```json",
    JSON.stringify(input.previousSpec, null, 2),
    "```",
    "",
    "Return ONLY a PATCH: a JSON object containing just the fields you are changing, plus a",
    "design_rationale summarising what changed and why. Every field you omit is preserved",
    "exactly as it is — that is the point. If you reorder or retitle sections, return the",
    "complete `sections` array; otherwise omit it.",
  );
  if (input.repairNotes?.length) {
    parts.push("Fix ONLY the listed issues. Keep the overall design intent intact.");
  }
  return parts.join("\n");
}

function outputSchema(input: DesignInput): Record<string, unknown> {
  return isRevision(input) ? getSpecPatchSchema() : (getSpecSchema().schema as Record<string, unknown>);
}

/**
 * Turn whatever the engine returned into a safe, normalized spec. Revisions are
 * patches: guarded against stray retitles, merged onto the previous spec (so
 * uncommented decisions are stable by construction), then normalized.
 */
function specFromRaw(input: DesignInput, raw: unknown): TemplateSpec {
  if (!isRevision(input)) return normalizeSpec(input.docType, raw);
  if (patchIsEmpty(raw)) {
    if (input.repairNotes?.length) return input.previousSpec!; // repair declined — keep the spec, lint notes surface to the reviewer
    throw new ExtractionError("The design model returned no changes for this review — try more specific comments.");
  }
  const allowed = new Set((input.feedback ?? []).map((f) => f.sectionId));
  const patch = guardSpecPatch(raw, input.previousSpec!, allowed);
  return applySpecPatch(input.docType, input.previousSpec!, patch);
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

/**
 * Review rounds are human-paced (someone studies a preview between rounds), so
 * the 5-minute default TTL would routinely miss — the 1h TTL costs a 2x write
 * once and repays every subsequent round at ~0.1x.
 */
const CACHE_1H = { type: "ephemeral", ttl: "1h" } as const;

async function designViaApi(input: DesignInput, apiKey: string, model: string): Promise<SpecEngineOutput> {
  const client = new Anthropic({ apiKey });
  const revisionBlock = buildRevisionContent(input);

  const stream = client.messages.stream({
    model,
    max_tokens: revisionBlock ? 8000 : 16000,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: getDesignPrompt().text, cache_control: CACHE_1H }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildStableContent(input), cache_control: CACHE_1H },
          ...(revisionBlock ? [{ type: "text" as const, text: revisionBlock }] : []),
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: outputSchema(input) } },
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
    spec: specFromRaw(input, parseJsonLoose(textBlock.text)),
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
  const gateway = createGateway({ apiKey });
  const revisionBlock = buildRevisionContent(input);
  const prompt = revisionBlock ? `${buildStableContent(input)}\n\n${revisionBlock}` : buildStableContent(input);

  let object: unknown;
  let usage: NonNullable<EngineOutput["usage"]>;
  try {
    const result = await generateObject({
      model: gateway(model),
      schema: jsonSchema<Record<string, unknown>>(outputSchema(input)),
      system: getDesignPrompt().text,
      prompt,
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
    spec: specFromRaw(input, object),
    engine: "gateway",
    model,
    usage,
    reportedCostUsd: await gatewayCostUsd(apiKey, model, usage),
  };
}

async function designViaCli(input: DesignInput, model: string): Promise<SpecEngineOutput> {
  const revisionBlock = buildRevisionContent(input);
  const prompt = [
    getDesignPrompt().text,
    "",
    `## JSON Schema your output must conform to${revisionBlock ? " (a PATCH — every field optional)" : ""}`,
    "```json",
    JSON.stringify(outputSchema(input), null, 2),
    "```",
    "",
    buildStableContent(input),
    ...(revisionBlock ? ["", revisionBlock] : []),
  ].join("\n");

  const cli = await runCli(prompt, model);
  return {
    spec: specFromRaw(input, parseJsonLoose(cli.resultText)),
    engine: "cli",
    model,
    usage: cli.usage,
    reportedCostUsd: cli.totalCostUsd,
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

export interface CheckedDesignOutput extends SpecEngineOutput {
  /** Lint violations still standing after the repair attempt (ideally empty). */
  lintNotes: string[];
}

function sumUsage(rounds: SpecEngineOutput[]): EngineOutput["usage"] {
  const withUsage = rounds.filter((r) => r.usage);
  if (withUsage.length === 0) return null;
  return withUsage.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.usage!.inputTokens,
      outputTokens: acc.outputTokens + r.usage!.outputTokens,
      cacheCreationInputTokens: acc.cacheCreationInputTokens + r.usage!.cacheCreationInputTokens,
      cacheReadInputTokens: acc.cacheReadInputTokens + r.usage!.cacheReadInputTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  );
}

/**
 * A design round plus the deterministic quality gate: lint the spec, and if it
 * fails (illegible contrast, unavailable fonts) run ONE automatic patch-repair
 * round. Anything still failing is appended to the rationale so the human
 * reviewer sees it — quality floor holds regardless of which model designed it.
 */
export async function runCheckedTemplateDesign(input: DesignInput, choice: EngineChoice): Promise<CheckedDesignOutput> {
  const rounds: SpecEngineOutput[] = [await runTemplateDesign(input, choice)];
  let final = rounds[0];
  let issues = lintSpec(final.spec, input.fontNames);

  if (issues.length > 0) {
    try {
      const repaired = await runTemplateDesign(
        { ...input, previousSpec: final.spec, feedback: undefined, repairNotes: issues },
        choice,
      );
      rounds.push(repaired);
      final = repaired;
      issues = lintSpec(repaired.spec, input.fontNames);
    } catch {
      // Repair is best-effort — the reviewed spec stands, with the notes below.
    }
  }

  const spec =
    issues.length > 0
      ? { ...final.spec, design_rationale: `${final.spec.design_rationale}\n\nAutomated check: ${issues.join(" ")}` }
      : final.spec;

  const reported = rounds.map((r) => r.reportedCostUsd).filter((c): c is number => c != null);
  return {
    spec,
    engine: final.engine,
    model: final.model,
    usage: sumUsage(rounds),
    reportedCostUsd: reported.length > 0 ? reported.reduce((a, b) => a + b, 0) : null,
    lintNotes: issues,
  };
}
