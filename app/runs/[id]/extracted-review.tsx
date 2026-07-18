"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";

const LEVEL_STYLES: Record<string, string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-red-100 text-red-800",
};

export interface FieldConfidence {
  field: string;
  level: "high" | "medium" | "low";
  note: string;
  quote?: string;
}

interface Props {
  runId: string;
  editable: boolean;
  document: Record<string, unknown>;
  fieldConfidence: FieldConfidence[];
  amendedFields: string[];
}

function FieldEditor({
  runId,
  field,
  value,
  onDone,
}: {
  runId: string;
  field: string;
  value: unknown;
  onDone: () => void;
}) {
  const router = useRouter();
  const isString = typeof value === "string";
  const [draft, setDraft] = useState(isString ? (value as string) : JSON.stringify(value, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    let parsed: unknown = draft;
    if (!isString) {
      try {
        parsed = JSON.parse(draft);
      } catch {
        setError("Not valid JSON — fix the syntax and try again.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/amend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value: parsed }),
      });
      if (res.ok) {
        onDone();
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Amendment failed (${res.status})`);
    } catch {
      setError("Network error — is the server running?");
    }
    setBusy(false);
  }

  return (
    <div className="mt-1">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={isString ? Math.min(10, Math.max(2, draft.split("\n").length)) : Math.min(16, draft.split("\n").length + 1)}
        className={`w-full rounded-md border border-[#1F3A5F]/40 px-3 py-2 text-sm focus:border-[#1F3A5F] focus:outline-none ${isString ? "" : "font-mono text-xs"}`}
      />
      {!isString && (
        <p className="mt-1 text-xs text-slate-400">Structured field — edit as JSON; the doc-type schema still applies.</p>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md bg-[#1F3A5F] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" /> {busy ? "Saving…" : "Save amendment"}
        </button>
        <button
          onClick={onDone}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600"
        >
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The per-field review table. While a run awaits review the reviewer can amend
 * any field in place — corrections go through schema validation server-side
 * and land in the audit trail instead of forcing a whole new run.
 */
export default function ExtractedReview({ runId, editable, document, fieldConfidence, amendedFields }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const confidenceByField = new Map(fieldConfidence.map((f) => [f.field.replace(/^document\./, ""), f]));
  const amended = new Set(amendedFields);

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
        Extracted content with per-field confidence
        {editable && <span className="ml-2 font-normal text-slate-400">— click a field to correct it before approving</span>}
      </h2>
      <div className="divide-y divide-slate-100">
        {Object.entries(document).map(([field, value]) => {
          const conf = confidenceByField.get(field);
          const isMissing = value === "NOT_FOUND" || (Array.isArray(value) && value.length === 0);
          const isEditing = editing === field;
          return (
            <div key={field} className="grid gap-2 px-4 py-3 sm:grid-cols-[180px_90px_1fr]">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {field.replaceAll("_", " ")}
                {amended.has(field) && (
                  <span className="mt-1 block w-fit rounded-full bg-[#1F3A5F] px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-white">
                    amended
                  </span>
                )}
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
                {isEditing ? (
                  <FieldEditor runId={runId} field={field} value={value} onDone={() => setEditing(null)} />
                ) : (
                  <>
                    {isMissing ? (
                      <span className="font-semibold text-red-700">
                        {Array.isArray(value) ? "NONE FOUND IN SOURCE" : "NOT FOUND — REVIEW REQUIRED"}
                      </span>
                    ) : typeof value === "string" ? (
                      <p className="whitespace-pre-wrap">{value}</p>
                    ) : (
                      <pre className="overflow-x-auto rounded-md bg-slate-50 p-2 text-xs">
                        {JSON.stringify(value, null, 2)}
                      </pre>
                    )}
                    {conf?.quote && (
                      <p className="mt-1 border-l-2 border-slate-200 pl-2 text-xs text-slate-500">
                        source: “{conf.quote}”
                      </p>
                    )}
                    {conf?.note && <p className="mt-1 text-xs italic text-slate-500">{conf.note}</p>}
                    {editable && (
                      <button
                        onClick={() => setEditing(field)}
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[#1F3A5F] hover:underline"
                      >
                        <Pencil className="h-3 w-3" /> Amend
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
