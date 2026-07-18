import { beforeEach, describe, expect, it } from "vitest";
import { SESSION_TTL_MS, isValidSession, issueSessionToken } from "@/lib/auth";

describe("session tokens", () => {
  beforeEach(() => {
    process.env.APP_PASSWORD = "correct-horse-battery-staple";
    delete process.env.SESSION_SECRET;
  });

  it("round-trips a freshly issued token", async () => {
    const token = await issueSessionToken();
    expect(await isValidSession(token)).toBe(true);
  });

  it("rejects an expired token", async () => {
    const token = await issueSessionToken(Date.now() - SESSION_TTL_MS - 1000);
    expect(await isValidSession(token)).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const token = await issueSessionToken();
    const [exp, sig] = token.split(".");
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    expect(await isValidSession(`${exp}.${flipped}`)).toBe(false);
  });

  it("rejects a token whose expiry was extended without re-signing", async () => {
    const token = await issueSessionToken();
    const [, sig] = token.split(".");
    expect(await isValidSession(`${Date.now() + 10 * SESSION_TTL_MS}.${sig}`)).toBe(false);
  });

  it("rejects the legacy password-hash cookie format", async () => {
    expect(await isValidSession("ab".repeat(32))).toBe(false);
  });

  it("invalidates every session when the password changes", async () => {
    const token = await issueSessionToken();
    process.env.APP_PASSWORD = "a-new-password";
    expect(await isValidSession(token)).toBe(false);
  });

  it("passes everything when auth is disabled", async () => {
    delete process.env.APP_PASSWORD;
    expect(await isValidSession(undefined)).toBe(true);
  });
});
