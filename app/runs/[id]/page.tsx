import Link from "next/link";
import { notFound } from "next/navigation";
import { getStorage } from "@/lib/storage";
import { rescueStaleRun } from "@/lib/runs";
import { DOC_TYPE_NAMES } from "@/lib/types";
import ApproveForm from "./approve-form";
import ExtractedReview from "./extracted-review";
import GeneratingPoller from "./generating-poller";

export const dynamic = "force-dynamic";

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

const ENGINE_LABELS: Record<string, string> = {
  cli: "Claude CLI (subscription)",
  api: "Claude API",
  gateway: "AI Gateway",
};

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run = await getStorage().getRun(id);
  if (!run) notFound();
  run = await rescueStaleRun(run);

  const amendments = run.amendments ?? [];

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

      {run.status === "generating" && (
        <GeneratingPoller runId={run.id} startedAt={run.generationStartedAt ?? run.createdAt} />
      )}

      {run.status === "complete" && run.approval && (
        <p className="rounded-md border-l-4 border-emerald-600 bg-white px-3 py-2 text-sm text-emerald-900 shadow-sm">
          Approved by <span className="font-semibold">{run.approval.approvedBy}</span> on{" "}
          {new Date(run.approval.at).toLocaleString()}
          {amendments.length > 0 && (
            <> — with {amendments.length} reviewer amendment{amendments.length === 1 ? "" : "s"}</>
          )}
          .
        </p>
      )}

      {run.status === "awaiting_review" && <ApproveForm runId={run.id} amendmentCount={amendments.length} />}

      {run.status === "failed" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Run failed</p>
          <p className="mt-1">{run.error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Chip label="Engine" value={ENGINE_LABELS[run.engine] ?? run.engine} />
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

      {(run.status === "awaiting_review" || run.status === "complete") && run.extracted && (
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

          <ExtractedReview
            runId={run.id}
            editable={run.status === "awaiting_review"}
            document={run.extracted.document}
            fieldConfidence={run.extracted.meta.field_confidence}
            amendedFields={amendments.map((a) => a.field)}
          />

          {amendments.length > 0 && (
            <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <h2 className="font-semibold">Reviewer amendments (audit trail)</h2>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {amendments.map((a, i) => (
                  <li key={i}>
                    <span className="font-medium">{a.field.replaceAll("_", " ")}</span> amended{" "}
                    {new Date(a.at).toLocaleString()} — original value kept in the audit record.
                  </li>
                ))}
              </ul>
            </section>
          )}

          <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <summary className="cursor-pointer font-medium">Raw extracted JSON (audit record)</summary>
            <pre className="mt-3 overflow-x-auto rounded-md bg-slate-50 p-3 text-xs">
              {JSON.stringify({ extracted: run.extracted, amendments }, null, 2)}
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
