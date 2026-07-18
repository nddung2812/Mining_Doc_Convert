"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const DOC_TYPES = [
  { value: "sop", label: "Standard Operating Procedure (SOP)" },
  { value: "ra", label: "Risk Assessment (RA)" },
  { value: "hmp", label: "Hazard Management Plan (HMP)" },
];

export default function NewRunPage() {
  const router = useRouter();
  const [clientName, setClientName] = useState("");
  const [docType, setDocType] = useState("sop");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(null);

    const form = new FormData();
    form.set("file", file);
    form.set("clientName", clientName);
    form.set("docType", docType);

    const headers: Record<string, string> = {};
    const key = localStorage.getItem("anthropic_api_key");
    if (key) headers["x-anthropic-key"] = key;

    try {
      const res = await fetch("/api/runs", { method: "POST", body: form, headers });
      const body = (await res.json()) as { id?: string; error?: string };
      if (body.id) {
        router.push(`/runs/${body.id}`);
        return;
      }
      setError(body.error ?? `Request failed (${res.status})`);
    } catch {
      setError("Network error — is the server still running?");
    }
    setBusy(false);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">New document run</h1>
      <p className="mt-2 text-sm text-slate-600">
        Upload raw client source content (.docx, .txt, .md). The pipeline extracts it into a structured draft,
        renders the styled document, and flags every gap and low-confidence field for your review.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium">Client</label>
          <input
            required
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="e.g. Example Mining Co"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#1F3A5F] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Document type</label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1F3A5F] focus:outline-none"
          >
            {DOC_TYPES.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">Source content</label>
          <input
            required
            type="file"
            accept=".docx,.txt,.md,.markdown"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
          <p className="mt-1 text-xs text-slate-500">PDF sources: convert to .docx or text first (PDF support is on the roadmap).</p>
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={busy || !file}
          className="rounded-md bg-[#1F3A5F] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Processing… this can take a few minutes" : "Process document"}
        </button>
        {busy && (
          <p className="text-xs text-slate-500">
            Extraction is a single structured model call — leave this page open until it finishes.
          </p>
        )}
      </form>
    </div>
  );
}
