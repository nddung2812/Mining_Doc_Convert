import { NextRequest, NextResponse } from "next/server";
import { createGateway } from "@ai-sdk/gateway";

export const runtime = "nodejs";

export type ModelTier = "flagship" | "balanced" | "fast";

export interface GatewayModelOption {
  id: string; // "vendor/model"
  name: string;
  vendor: string;
  tier: ModelTier;
  /** USD per token; null when the catalog doesn't publish pricing for this model. */
  inputPrice: number | null;
  outputPrice: number | null;
}

/**
 * Naming-convention heuristic, not a benchmarked quality score — the gateway
 * catalog doesn't publish a quality metric. "fast" is checked first so e.g.
 * "gemini-2.5-flash-lite" doesn't also match a broader "pro"/flagship rule.
 */
function classifyTier(id: string, name: string): ModelTier {
  const s = `${id} ${name}`.toLowerCase();
  if (/\b(haiku|mini|nano|lite|small|8b)\b/.test(s)) return "fast";
  if (/\b(opus|ultra|pro|o1|o3)\b|grok-4\b|gpt-5(\.\d+)?\b/.test(s)) return "flagship";
  return "balanced";
}

/**
 * Lists the language models available through the caller's Vercel AI Gateway
 * key (or the server's AI_GATEWAY_API_KEY). Powers the model picker; with no
 * gateway key at all, the picker only offers the Anthropic-direct default.
 */
export async function GET(request: NextRequest) {
  const key = request.headers.get("x-gateway-key") || process.env.AI_GATEWAY_API_KEY;
  if (!key) return NextResponse.json({ models: [] });

  try {
    const catalog = await createGateway({ apiKey: key }).getAvailableModels();
    const models: GatewayModelOption[] = catalog.models
      .filter((m) => (m.modelType ?? "language") === "language")
      .map((m) => ({
        id: m.id,
        name: m.name,
        vendor: m.id.split("/")[0],
        tier: classifyTier(m.id, m.name),
        inputPrice: m.pricing?.input != null ? Number(m.pricing.input) : null,
        outputPrice: m.pricing?.output != null ? Number(m.pricing.output) : null,
      }))
      .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
    return NextResponse.json({ models });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not reach the AI Gateway";
    return NextResponse.json({ models: [], error: message.slice(0, 300) }, { status: 502 });
  }
}
