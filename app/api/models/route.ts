import { NextRequest, NextResponse } from "next/server";
import { createGateway } from "@ai-sdk/gateway";

export const runtime = "nodejs";

export interface GatewayModelOption {
  id: string; // "vendor/model"
  name: string;
  vendor: string;
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
      .map((m) => ({ id: m.id, name: m.name, vendor: m.id.split("/")[0] }))
      .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
    return NextResponse.json({ models });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not reach the AI Gateway";
    return NextResponse.json({ models: [], error: message.slice(0, 300) }, { status: 502 });
  }
}
