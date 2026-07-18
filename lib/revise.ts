import { spawn } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import { generateText } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { ExtractionError, resolveEngine, type EngineKeys } from "./engine";
import type { EditorBlock } from "./blocks";

/**
 * Single-block AI revision for the Content Studio: given one block's data and a
 * plain-language instruction, return the revised block of the same type. Reuses
 * the extraction engine's provider resolution (BYOK Anthropic key, AI Gateway
 * key, or the local Claude CLI).
 */

const DATA_SHAPES: Record<string, string> = {
  header: '{ "text": string, "level": number }',
  paragraph: '{ "text": string }',
  list: '{ "style": "ordered"|"unordered", "items": [{ "content": string, "items"?: [...] }] }',
  table: '{ "withHeadings": boolean, "content": string[][] }',
  quote: '{ "text": string, "caption"?: string }',
};

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

function parseLoose(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new ExtractionError("The model returned no JSON object.");
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new ExtractionError("The model returned malformed JSON.");
  }
}

async function completeViaApi(system: string, user: string, apiKey: string, model: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new ExtractionError("The model returned no text.");
  return block.text;
}

async function completeViaGateway(system: string, user: string, apiKey: string, model: string): Promise<string> {
  const gateway = createGateway({ apiKey });
  const { text } = await generateText({ model: gateway(model), system, prompt: user, maxOutputTokens: 4000 });
  return text;
}

async function completeViaCli(system: string, user: string, model: string): Promise<string> {
  const prompt = `${system}\n\n${user}`;
  return new Promise<string>((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "json", "--model", model], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new ExtractionError("CLI timed out."));
    }, 120_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(new ExtractionError(`Could not launch the claude CLI (${e.message}).`)));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new ExtractionError(`claude CLI exited ${code}: ${err.slice(0, 300)}`));
      try {
        const env = JSON.parse(out) as { result?: string; is_error?: boolean };
        if (env.is_error || typeof env.result !== "string") {
          return reject(new ExtractionError("The CLI reported an error."));
        }
        resolve(env.result);
      } catch {
        reject(new ExtractionError("Could not parse the CLI response."));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export async function reviseBlock(block: EditorBlock, instruction: string, keys: EngineKeys): Promise<EditorBlock> {
  const choice = resolveEngine(keys);
  const system = systemPrompt(block.type);
  const user = userPrompt(block, instruction);

  let raw: string;
  if (choice.engine === "gateway") {
    if (!choice.apiKey) throw new ExtractionError("Gateway engine selected but no AI Gateway key resolved.");
    raw = await completeViaGateway(system, user, choice.apiKey, choice.model);
  } else if (choice.engine === "api") {
    if (!choice.apiKey) throw new ExtractionError("API engine selected but no API key resolved.");
    raw = await completeViaApi(system, user, choice.apiKey, choice.model);
  } else {
    raw = await completeViaCli(system, user, choice.model);
  }

  return { id: block.id, type: block.type, data: parseLoose(raw) };
}
