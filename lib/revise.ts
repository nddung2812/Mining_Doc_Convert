import { z } from "zod";
import { ExtractionError, completeText, parseJsonLoose, resolveEngine, type EngineKeys } from "./engine";
import { estimateCostUsd } from "./cost";
import type { EngineId } from "./types";
import type { EditorBlock } from "./blocks";

/**
 * Single-block AI revision for the Content Studio: given one block's data and a
 * plain-language instruction, return the revised block of the same type. Reuses
 * the extraction engine's provider resolution (BYOK Anthropic key, AI Gateway
 * key, or the local Claude CLI) via the shared completeText primitive.
 */

const DATA_SHAPES: Record<string, string> = {
  header: '{ "text": string, "level": number }',
  paragraph: '{ "text": string }',
  list: '{ "style": "ordered"|"unordered", "items": [{ "content": string, "items"?: [...] }] }',
  table: '{ "withHeadings": boolean, "content": string[][] }',
  quote: '{ "text": string, "caption"?: string }',
};

interface ListItemShape {
  content: string;
  items?: ListItemShape[];
}

const listItemSchema: z.ZodType<ListItemShape> = z.lazy(() =>
  z.object({
    content: z.string(),
    items: z.array(listItemSchema).optional(),
  }),
);

/** The model's revised data must round-trip into the editor — validate the
 *  shape per block type before it can corrupt the saved document. */
const BLOCK_DATA_SCHEMAS: Record<string, z.ZodType<Record<string, unknown>>> = {
  header: z.object({ text: z.string(), level: z.coerce.number().int().min(1).max(6) }),
  paragraph: z.object({ text: z.string() }),
  list: z.object({ style: z.enum(["ordered", "unordered"]), items: z.array(listItemSchema) }),
  table: z.object({ withHeadings: z.boolean(), content: z.array(z.array(z.string())) }),
  quote: z.object({ text: z.string(), caption: z.string().optional() }),
};

function validateBlockData(blockType: string, data: Record<string, unknown>): Record<string, unknown> {
  const schema = BLOCK_DATA_SCHEMAS[blockType];
  if (!schema) return data; // unknown block type: pass through, the editor owns it
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ExtractionError(
      `The model returned an unexpected shape for a ${blockType} block — try rephrasing the instruction.`,
    );
  }
  return parsed.data;
}

function systemPrompt(blockType: string): string {
  const shape = DATA_SHAPES[blockType] ?? "the exact JSON shape it was given";
  return [
    "You are a precise editor working on ONE block of a business/compliance document",
    "(risk assessments, SOPs, hazard management plans, proposals).",
    "You receive a single block's `data` as JSON plus an instruction.",
    `Return ONLY a JSON object — the revised \`data\` for a block of the same type, keeping the exact shape ${shape}.`,
    "Inline emphasis may use <b>, <i>, or <u> tags. Do not wrap the JSON in prose or code fences.",
    "Preserve the original meaning unless the instruction says otherwise; never invent facts, dates, or figures.",
  ].join(" ");
}

function userPrompt(block: EditorBlock, instruction: string): string {
  return [
    `Block type: ${block.type}`,
    `Instruction: ${instruction}`,
    "Current data:",
    JSON.stringify(block.data ?? {}),
  ].join("\n");
}

export interface ReviseOutput {
  block: EditorBlock;
  engine: EngineId;
  model: string;
  costUsd: number | null;
}

export async function reviseBlock(block: EditorBlock, instruction: string, keys: EngineKeys): Promise<ReviseOutput> {
  const choice = resolveEngine(keys);
  const completion = await completeText(systemPrompt(block.type), userPrompt(block, instruction), choice, {
    effort: "low", // one-block mechanical edit — low effort is plenty and faster
  });

  const raw = parseJsonLoose(completion.text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ExtractionError("The model returned no JSON object.");
  }
  const data = validateBlockData(block.type, raw as Record<string, unknown>);

  return {
    block: { id: block.id, type: block.type, data },
    engine: completion.engine,
    model: completion.model,
    costUsd: estimateCostUsd(completion),
  };
}

/** One call revises many blocks — the model returns ONLY the blocks it changed. */
function multiBlockSystemPrompt(): string {
  const shapes = Object.entries(DATA_SHAPES)
    .map(([type, shape]) => `${type}: ${shape}`)
    .join("; ");
  return [
    "You are a precise editor working on a business/compliance document",
    "(risk assessments, SOPs, hazard management plans, proposals).",
    "You receive the document as an array of blocks (each with id, type, data) plus one instruction.",
    "Apply the instruction across the document.",
    'Return ONLY a JSON object of the form { "blocks": [{ "id": string, "type": string, "data": {...} }] }',
    "containing ONLY the blocks you changed — omitted blocks stay exactly as they are.",
    `Keep each block's id and type, and keep data in the exact shape for its type (${shapes}).`,
    "Inline emphasis may use <b>, <i>, or <u> tags. Do not wrap the JSON in prose or code fences.",
    "Preserve the original meaning unless the instruction says otherwise; never invent facts, dates, or figures.",
  ].join(" ");
}

export interface ReviseManyOutput {
  /** The changed blocks only, validated — apply each by id. */
  blocks: EditorBlock[];
  engine: EngineId;
  model: string;
  costUsd: number | null;
}

export async function reviseBlocks(
  blocks: EditorBlock[],
  instruction: string,
  keys: EngineKeys,
): Promise<ReviseManyOutput> {
  const addressable = blocks.filter((b): b is EditorBlock & { id: string } => Boolean(b.id));
  if (addressable.length === 0) throw new ExtractionError("No editable blocks to revise.");

  const choice = resolveEngine(keys);
  const user = [
    `Instruction: ${instruction}`,
    "Document blocks:",
    JSON.stringify(addressable.map((b) => ({ id: b.id, type: b.type, data: b.data ?? {} }))),
  ].join("\n");
  const completion = await completeText(multiBlockSystemPrompt(), user, choice, {
    maxOutputTokens: Math.min(16000, 1500 + addressable.length * 700),
    effort: "low",
  });

  const raw = parseJsonLoose(completion.text) as { blocks?: unknown };
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.blocks)) {
    throw new ExtractionError("The model returned no block list.");
  }

  // Every returned block must map onto a submitted one; type comes from the
  // original (the model may not convert block types), data is shape-validated.
  const byId = new Map(addressable.map((b) => [b.id, b]));
  const changed: EditorBlock[] = [];
  for (const entry of raw.blocks as { id?: unknown; data?: unknown }[]) {
    const original = byId.get(String(entry?.id ?? ""));
    if (!original) continue; // hallucinated id — drop it
    if (!entry?.data || typeof entry.data !== "object" || Array.isArray(entry.data)) continue;
    changed.push({
      id: original.id,
      type: original.type,
      data: validateBlockData(original.type, entry.data as Record<string, unknown>),
    });
  }
  if (changed.length === 0) {
    throw new ExtractionError("The model changed nothing — try a more specific instruction.");
  }

  return { blocks: changed, engine: completion.engine, model: completion.model, costUsd: estimateCostUsd(completion) };
}
