"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Columns2, FilePlus2, Layers, Upload, Wand2 } from "lucide-react";
import type { ClientRecord, DocType, TemplateBuildRecord } from "@/lib/types";
import { DOC_TYPE_NAMES, isDocType } from "@/lib/types";

const DEFAULT_MODEL_OPTION = ""; // empty -> server default (Anthropic direct / local CLI)

type ModelTier = "flagship" | "balanced" | "fast";

const TIER_LABEL: Record<ModelTier, string> = {
  flagship: "Flagship",
  balanced: "Balanced",
  fast: "Fast & cheap",
};

// Rough per-run baseline (prompt + schema + a mid-sized source doc, no cache
// hit; observed extraction runs land in the 10k-20k output range) — used only
// to turn per-token catalog pricing into a ballpark $/doc figure.
const TYPICAL_INPUT_TOKENS = 25_000;
const TYPICAL_OUTPUT_TOKENS = 12_000;

interface GatewayModelOption {
  id: string;
  name: string;
  vendor: string;
  tier: ModelTier;
  inputPrice: number | null;
  outputPrice: number | null;
}

function estimatePerDocUsd(m: GatewayModelOption): number | null {
  if (m.inputPrice == null || m.outputPrice == null) return null;
  return m.inputPrice * TYPICAL_INPUT_TOKENS + m.outputPrice * TYPICAL_OUTPUT_TOKENS;
}

function formatUsd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

type BuildWithSpend = TemplateBuildRecord & { spendUsd?: number };

function GenerateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ id: string; docType: string }>();
  const clientId = params.id;
  const docType = (isDocType(params.docType) ? params.docType : "sop") as DocType;

  const [client, setClient] = useState<ClientRecord | null>(null);
  const [templates, setTemplates] = useState<BuildWithSpend[] | null>(null);
  const [templateBuildId, setTemplateBuildId] = useState<string>(searchParams.get("template") ?? "");
  const [sourceType, setSourceType] = useState<"file" | "studio">("file");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gatewayModels, setGatewayModels] = useState<GatewayModelOption[]>([]);
  const [model, setModel] = useState(() =>
    typeof window === "undefined" ? DEFAULT_MODEL_OPTION : (localStorage.getItem("preferred_model") ?? DEFAULT_MODEL_OPTION),
  );

  useEffect(() => {
    void (async () => {
      const [clientRes, buildsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/builds`),
      ]);
      if (clientRes.ok) setClient((await clientRes.json()) as ClientRecord);
      const builds = buildsRes.ok ? ((await buildsRes.json()) as BuildWithSpend[]) : [];
      const finalized = builds.filter((b) => b.docType === docType && b.status === "final");
      setTemplates(finalized);
      // Newest finalized template is the default unless the URL preselects one.
      setTemplateBuildId((current) =>
        current && finalized.some((b) => b.id === current) ? current : (finalized[0]?.id ?? ""),
      );
    })();
    const gatewayKey = localStorage.getItem("ai_gateway_key");
    const headers: Record<string, string> = gatewayKey ? { "x-gateway-key": gatewayKey } : {};
    void fetch("/api/models", { headers })
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((body: { models: GatewayModelOption[] }) => setGatewayModels(body.models ?? []))
      .catch(() => {});
  }, [clientId, docType]);

  const vendors = useMemo(() => [...new Set(gatewayModels.map((m) => m.vendor))], [gatewayModels]);

  function selectModel(value: string) {
    setModel(value);
    if (value) localStorage.setItem("preferred_model", value);
    else localStorage.removeItem("preferred_model");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !client) return;
    if (sourceType === "file" && files.length === 0) return;
    setBusy(true);
    setError(null);

    const form = new FormData();
    if (sourceType === "studio") form.set("sourceType", "studio");
    else for (const f of files) form.append("file", f);
    form.set("clientName", client.name);
    form.set("clientId", client.id);
    form.set("docType", docType);
    if (templateBuildId) form.set("templateBuildId", templateBuildId);
    if (model) form.set("model", model);

    const headers: Record<string, string> = {};
    const key = localStorage.getItem("anthropic_api_key");
    if (key) headers["x-anthropic-key"] = key;
    const gatewayKey = localStorage.getItem("ai_gateway_key");
    if (gatewayKey) headers["x-gateway-key"] = gatewayKey;

    try {
      const res = await fetch("/api/runs", { method: "POST", body: form, headers });
      const body = (await res.json()) as { id?: string; ids?: string[]; error?: string };
      if (body.ids && body.ids.length > 0) {
        // Bulk batch accepted — History tracks every run in it.
        router.push(`/runs/${body.ids[0]}`);
        return;
      }
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

  const clientName = client?.name ?? clientId;
  const manualTemplate = client?.templates[docType];

  if (templates === null) {
    return <p className="py-16 text-center text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="max-w-2xl">
      <Link
        href={`/clients/${clientId}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {clientName}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Generate a {docType.toUpperCase()}</h1>
      <p className="mt-2 text-sm text-slate-600">
        {DOC_TYPE_NAMES[docType]} · {clientName}. Upload raw source content (.docx, .pdf, .txt, .md) — the
        pipeline extracts it into a structured draft, renders it with the chosen template, and flags every gap
        and low-confidence field for your review.
      </p>

      {templates.length === 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No finalised template for this document type yet —{" "}
          {manualTemplate
            ? `the manually uploaded "${manualTemplate.filename}" will be used.`
            : "the generic master template will be used."}{" "}
          <Link href={`/clients/${clientId}/build/${docType}`} className="inline-flex items-center gap-1 font-medium underline">
            <Wand2 className="h-3.5 w-3.5" /> Build a branded one first
          </Link>
        </div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {templates.length > 0 && (
          <div>
            <label className="block text-sm font-medium">Template</label>
            <select
              value={templateBuildId}
              onChange={(e) => setTemplateBuildId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1F3A5F] focus:outline-none"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — finalised {t.final ? new Date(t.final.finalizedAt).toLocaleDateString() : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              <Link href={`/clients/${clientId}/templates/${docType}`} className="inline-flex items-center gap-1 underline">
                <Layers className="h-3 w-3" /> Manage templates
              </Link>{" "}
              — add another or rename from the templates page.
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium">Model</label>
          <select
            value={model}
            onChange={(e) => selectModel(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1F3A5F] focus:outline-none"
          >
            <option value={DEFAULT_MODEL_OPTION}>Claude Opus 4.8 — Flagship · default (Anthropic direct / local CLI)</option>
            {vendors.map((vendor) => (
              <optgroup key={vendor} label={`${vendor} (via AI Gateway)`}>
                {gatewayModels
                  .filter((m) => m.vendor === vendor)
                  .map((m) => {
                    const perDoc = estimatePerDocUsd(m);
                    const suffix = perDoc != null ? ` · ~${formatUsd(perDoc)}/doc` : "";
                    return (
                      <option key={m.id} value={m.id}>
                        {m.name} — {TIER_LABEL[m.tier]}{suffix}
                      </option>
                    );
                  })}
              </optgroup>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {vendors.length > 0
              ? "Vendor models run through your Vercel AI Gateway key. The extraction quality gate (golden test) was validated on Claude — re-validate before trusting another model in production."
              : "Add a Vercel AI Gateway key in Settings to unlock other vendors' models (OpenAI, Google, xAI, …)."}
          </p>
          {vendors.length > 0 && (
            <p className="mt-1 text-xs text-slate-400">
              Tier is a naming-convention guess (Flagship/Balanced/Fast &amp; cheap), not a benchmarked quality score.
              $/doc is a rough estimate — live catalog pricing × a typical run (~25k input, ~12k output tokens) — your
              actual cost depends on the source document&apos;s size and will vary.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium">Source content</label>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setSourceType("file")}
              className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-left text-sm ${
                sourceType === "file" ? "border-[#1F3A5F] bg-[#1F3A5F]/[0.04] font-medium" : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
              }`}
            >
              <Upload className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Upload a file
                <span className="block text-xs font-normal text-slate-500">.docx, .pdf, .txt, or .md</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSourceType("studio")}
              className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-left text-sm ${
                sourceType === "studio" ? "border-[#1F3A5F] bg-[#1F3A5F]/[0.04] font-medium" : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
              }`}
            >
              <Columns2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Content Studio document
                <span className="block text-xs font-normal text-slate-500">Use this client&apos;s {docType.toUpperCase()} studio doc</span>
              </span>
            </button>
          </div>
          {sourceType === "file" ? (
            <>
              <input
                type="file"
                multiple
                accept=".docx,.pdf,.txt,.md,.markdown"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                className="mt-2 w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
              />
              <p className="mt-1 text-xs text-slate-500">
                Scanned/image-only PDFs won&apos;t extract. Select several files to queue them as a batch.
              </p>
              {files.length > 1 && (
                <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  <span className="font-semibold">{files.length} files → cost-saving batch:</span> processed
                  together through the Anthropic Batch API at <span className="font-semibold">50% of standard
                  token prices</span>, results typically within the hour. Needs a Claude model with an Anthropic
                  API key (gateway models and the local CLI can&apos;t batch).
                </div>
              )}
            </>
          ) : (
            <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              The saved studio document becomes the run&apos;s source (and its exact JSON is stored in the audit
              trail).{" "}
              <Link href={`/clients/${clientId}/studio/${docType}`} className="font-medium text-[#1F3A5F] underline">
                Open the Content Studio
              </Link>{" "}
              to review it first.
            </p>
          )}
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={busy || (sourceType === "file" && files.length === 0)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#1F3A5F] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          <FilePlus2 className="h-4 w-4" />{" "}
          {busy ? "Starting…" : files.length > 1 ? `Queue ${files.length} documents (batch)` : "Generate document"}
        </button>
        {busy && (
          <p className="text-xs text-slate-500">
            Extraction runs in the background — you&apos;ll land on the run page, which tracks progress live.
          </p>
        )}
      </form>
    </div>
  );
}

export default function GeneratePage() {
  return (
    <Suspense>
      <GenerateForm />
    </Suspense>
  );
}
