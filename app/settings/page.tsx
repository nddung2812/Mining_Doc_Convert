"use client";

import { useState } from "react";

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState(() =>
    typeof window === "undefined" ? "" : (localStorage.getItem("anthropic_api_key") ?? ""),
  );
  const [saved, setSaved] = useState(false);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (apiKey.trim()) localStorage.setItem("anthropic_api_key", apiKey.trim());
    else localStorage.removeItem("anthropic_api_key");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-2 text-sm text-slate-600">
          MDocConvert never stores your key on the server — it stays in this browser and is sent only with your own
          processing requests.
        </p>
      </div>

      <form onSubmit={save} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium">Your Anthropic API key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-…"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-[#1F3A5F] focus:outline-none"
          />
          <p className="mt-1 text-xs text-slate-500">
            Get one at console.anthropic.com → API keys. Usage is billed to your own Anthropic account.
          </p>
        </div>
        <button type="submit" className="rounded-md bg-[#1F3A5F] px-4 py-2 text-sm font-medium text-white">
          {saved ? "Saved ✓" : "Save"}
        </button>
      </form>

      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm shadow-sm">
        <h2 className="font-semibold">How the engine is chosen</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-600">
          <li>A key saved above is always used first (billed to you).</li>
          <li>Otherwise, a server-configured <code className="text-xs">ANTHROPIC_API_KEY</code> is used, if the operator set one.</li>
          <li>
            Running locally with neither, the app falls back to the operator&apos;s Claude Code CLI (covered by their
            Claude subscription). This fallback does not exist on deployed instances — there you must bring your own key.
          </li>
        </ol>
      </div>
    </div>
  );
}
