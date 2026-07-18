"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { ClientRecord } from "@/lib/types";

const DOC_TYPES = [
  { value: "sop", label: "Standard Operating Procedure (SOP)" },
  { value: "ra", label: "Risk Assessment (RA)" },
  { value: "hmp", label: "Hazard Management Plan (HMP)" },
  { value: "proposal", label: "Client Proposal" },
];

const DEFAULT_MODEL_OPTION = ""; // empty -> server default (Anthropic direct / local CLI)

interface GatewayModelOption {
  id: string;
  name: string;
  vendor: string;
}

function NewRunForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [clientName, setClientName] = useState("");
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [docType, setDocType] = useState(() => {
    const preset = searchParams.get("docType");
    return preset && DOC_TYPES.some((d) => d.value === preset) ? preset : "sop";
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gatewayModels, setGatewayModels] = useState<GatewayModelOption[]>([]);
  const [model, setModel] = useState(() =>
    typeof window === "undefined" ? DEFAULT_MODEL_OPTION : (localStorage.getItem("preferred_model") ?? DEFAULT_MODEL_OPTION),
  );

  const presetClientId = searchParams.get("client");

  useEffect(() => {
    void fetch("/api/clients")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        const all = list as ClientRecord[];
        setClients(all);
        if (presetClientId) {
          const preset = all.find((c) => c.id === presetClientId);
          if (preset) setClientName(preset.name);
        }
      })
      .catch(() => {});
    const gatewayKey = localStorage.getItem("ai_gateway_key");
    const headers: Record<string, string> = gatewayKey ? { "x-gateway-key": gatewayKey } : {};
    void fetch("/api/models", { headers })
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((body: { models: GatewayModelOption[] }) => setGatewayModels(body.models ?? []))
      .catch(() => {});
  }, [presetClientId]);

  const vendors = [...new Set(gatewayModels.map((m) => m.vendor))];

  function selectModel(value: string) {
    setModel(value);
    if (value) localStorage.setItem("preferred_model", value);
    else localStorage.removeItem("preferred_model");
  }

  const matchedClient = clients.find((c) => c.name.toLowerCase() === clientName.trim().toLowerCase());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(null);

    const form = new FormData();
    form.set("file", file);
    form.set("clientName", clientName);
    if (matchedClient) form.set("clientId", matchedClient.id);
    form.set("docType", docType);
    if (model) form.set("model", model);

    const headers: Record<string, string> = {};
    const key = localStorage.getItem("anthropic_api_key");
    if (key) headers["x-anthropic-key"] = key;
    const gatewayKey = localStorage.getItem("ai_gateway_key");
    if (gatewayKey) headers["x-gateway-key"] = gatewayKey;

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
      <h1 className="text-2xl font-semibold">New document</h1>
      <p className="mt-2 text-sm text-slate-600">
        Upload raw client source content (.docx, .pdf, .txt, .md). The pipeline extracts it into a structured draft,
        renders it with the client&apos;s template, and flags every gap and low-confidence field for your review.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium">Client</label>
          <input
            required
            list="client-list"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="e.g. Example Mining Co"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#1F3A5F] focus:outline-none"
          />
          <datalist id="client-list">
            {clients.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <p className="mt-1 text-xs text-slate-500">
            {matchedClient
              ? matchedClient.templates[docType as keyof typeof matchedClient.templates]
                ? `Registered client — their custom ${docType.toUpperCase()} template will be used.`
                : `Registered client — no custom ${docType.toUpperCase()} template yet, master will be used. You can build one from their client page.`
              : "Unregistered name — master template. Create the client on the Clients page to build their branded template."}
          </p>
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
          <label className="block text-sm font-medium">Model</label>
          <select
            value={model}
            onChange={(e) => selectModel(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1F3A5F] focus:outline-none"
          >
            <option value={DEFAULT_MODEL_OPTION}>Claude Opus 4.8 — default (Anthropic direct / local CLI)</option>
            {vendors.map((vendor) => (
              <optgroup key={vendor} label={`${vendor} (via AI Gateway)`}>
                {gatewayModels
                  .filter((m) => m.vendor === vendor)
                  .map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
              </optgroup>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {vendors.length > 0
              ? "Vendor models run through your Vercel AI Gateway key. The extraction quality gate (golden test) was validated on Claude — re-validate before trusting another model in production."
              : "Add a Vercel AI Gateway key in Settings to unlock other vendors' models (OpenAI, Google, xAI, …)."}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium">Source content</label>
          <input
            required
            type="file"
            accept=".docx,.pdf,.txt,.md,.markdown"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
          <p className="mt-1 text-xs text-slate-500">.docx, .pdf, .txt, or .md — scanned/image-only PDFs won&apos;t extract.</p>
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

export default function NewRunPage() {
  return (
    <Suspense>
      <NewRunForm />
    </Suspense>
  );
}
