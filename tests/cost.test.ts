import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "@/lib/cost";

const usage = {
  inputTokens: 1_000_000,
  outputTokens: 100_000,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

describe("estimateCostUsd", () => {
  it("prices api runs from the model table (opus: $5/M in, $25/M out)", () => {
    const cost = estimateCostUsd({ engine: "api", model: "claude-opus-4-8", usage, reportedCostUsd: null });
    expect(cost).toBeCloseTo(5 + 2.5, 6);
  });

  it("passes through the CLI-reported cost", () => {
    expect(estimateCostUsd({ engine: "cli", model: "claude-opus-4-8", usage, reportedCostUsd: 1.23 })).toBe(1.23);
  });

  it("passes through the gateway catalog cost", () => {
    expect(estimateCostUsd({ engine: "gateway", model: "openai/gpt-5.2", usage, reportedCostUsd: 0.5 })).toBe(0.5);
  });

  it("returns null when an api run has no usage", () => {
    expect(estimateCostUsd({ engine: "api", model: "claude-opus-4-8", usage: null, reportedCostUsd: null })).toBeNull();
  });
});
