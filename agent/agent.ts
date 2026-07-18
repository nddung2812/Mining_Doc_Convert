import { defineAgent } from "eve";

/**
 * Eve runtime for the doc factory (Phase 2 shell around the proven pipeline).
 * Model calls route through Vercel AI Gateway — no raw Anthropic key in app
 * code. NOTE: this is the *conversation* model that orchestrates tool calls;
 * extraction itself happens inside tools/extract.ts as one structured call
 * (see agent/instructions.md — deliberately not agentic).
 */
export default defineAgent({
  model: "anthropic/claude-opus-4-8",
});
