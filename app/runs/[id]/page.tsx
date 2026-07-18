import Link from "next/link";
import { notFound } from "next/navigation";
import { getStorage } from "@/lib/storage";
import { DOC_TYPE_NAMES } from "@/lib/types";

export const dynamic = "force-dynamic";

const LEVEL_STYLES: Record<string, string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-red-100 text-red-800",
};

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function renderValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getStorage().getRun(id);
  if (!run) notFound();

  const confidenceByField = new Map(
    (run.extracted?.meta.field_confidence ?? []).map((f) => [f.field.replace(/^document\./, ""), f]),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {DOC_TYPE_NAMES[run.docType]} — {run.clientName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Run {run.id} · {new Date(run.createdAt).toLocaleString()} · source {run.source.filename} (
            {(run.source.bytes / 1024).toFixed(1)} KB, sha256 {run.source.sha256.slice(0, 12)}…)
          </p>
        </div>
        {run.status === "complete" && (
          <a
            href={`/api/runs/${run.id}/download`}
            className="rounded-md bg-[#1F3A5F] px-4 py-2 text-sm font-medium text-white"
          >
            Download draft .docx
          </a>
        )}
      </div>

      {run.status === "failed" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Run failed</p>
          <p className="mt-1">{run.error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Chip label="Engine" value={run.engine === "cli" ? "Claude CLI (subscription)" : "Claude API"} />
        <Chip label="Model" value={run.model} />
        <Chip
          label="Cost"
          value={run.costUsd == null ? "—" : `US$${run.costUsd.toFixed(4)}${run.engine === "cli" ? " (covered)" : ""}`}
        />
        <Chip
          label="Tokens in / out"
          value={run.usage ? `${run.usage.inputTokens.toLocaleString()} / ${run.usage.outputTokens.toLocaleString()}` : "—"}
        />
        <Chip label="Prompt version" value={run.promptVersion} />
        <Chip label="Schema version" value={run.schemaVersion} />
        <Chip label="Template version" value={run.templateVersion} />
        <Chip label="Downloads" value={String(run.downloads.length)} />
      </div>

      {run.status === "complete" && run.extracted && (
        <>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">
              Review load: {run.confidenceSummary.low} low-confidence · {run.confidenceSummary.medium} medium ·{" "}
              {run.confidenceSummary.notFound} NOT FOUND · {run.confidenceSummary.warnings} warnings
            </p>
            <p className="mt-1">
              This is a draft. Verify every flagged field against the source before it goes anywhere near a client.
            </p>
          </div>

          {run.extracted.meta.warnings.length > 0 && (
            <section className="rounded-lg border border-red-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-red-700">Extraction warnings for the reviewer</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-800">
                {run.extracted.meta.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
              Extracted content with per-field confidence
            </h2>
            <div className="divide-y divide-slate-100">
              {Object.entries(run.extracted.document).map(([field, value]) => {
                const conf = confidenceByField.get(field);
                const isMissing =
                  value === "NOT_FOUND" || (Array.isArray(value) && value.length === 0);
                return (
                  <div key={field} className="grid gap-2 px-4 py-3 sm:grid-cols-[180px_90px_1fr]">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {field.replaceAll("_", " ")}
                    </div>
                    <div>
                      {conf ? (
                        <span
                          title={conf.note || undefined}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_STYLES[conf.level] ?? "bg-slate-100"}`}
                        >
                          {conf.level}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </div>
                    <div className="min-w-0 text-sm">
                      {isMissing ? (
                        <span className="font-semibold text-red-700">
                          {Array.isArray(value) ? "NONE FOUND IN SOURCE" : "NOT FOUND — REVIEW REQUIRED"}
                        </span>
                      ) : typeof value === "string" ? (
                        <p className="whitespace-pre-wrap">{value}</p>
                      ) : (
                        <pre className="overflow-x-auto rounded-md bg-slate-50 p-2 text-xs">{renderValue(value)}</pre>
                      )}
                      {conf?.note && <p className="mt-1 text-xs italic text-slate-500">{conf.note}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <summary className="cursor-pointer font-medium">Raw extracted JSON (audit record)</summary>
            <pre className="mt-3 overflow-x-auto rounded-md bg-slate-50 p-3 text-xs">
              {JSON.stringify(run.extracted, null, 2)}
            </pre>
          </details>
        </>
      )}

      <p className="text-sm">
        <Link href="/runs" className="text-[#1F3A5F] underline">← Back to history</Link>
      </p>
    </div>
  );
}
