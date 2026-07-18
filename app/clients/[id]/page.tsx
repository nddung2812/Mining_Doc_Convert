"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ClientRecord, RunRecord, TemplateBuildRecord } from "@/lib/types";
import { DOC_TYPE_NAMES, MAX_REVIEW_ROUNDS, type DocType } from "@/lib/types";

const DOC_TYPES = Object.keys(DOC_TYPE_NAMES) as DocType[];
const SHORT: Record<DocType, string> = { sop: "SOP", ra: "RA", hmp: "HMP", proposal: "Proposal" };

export default function ClientWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [builds, setBuilds] = useState<TemplateBuildRecord[]>([]);
  const [runs, setRuns] = useState<Omit<RunRecord, "extracted">[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [clientRes, buildsRes, runsRes] = await Promise.all([
      fetch(`/api/clients/${id}`),
      fetch(`/api/clients/${id}/builds`),
      fetch("/api/runs"),
    ]);
    if (clientRes.ok) setClient((await clientRes.json()) as ClientRecord);
    else setNotFound(true);
    if (buildsRes.ok) setBuilds((await buildsRes.json()) as TemplateBuildRecord[]);
    if (runsRes.ok) {
      const all = (await runsRes.json()) as Omit<RunRecord, "extracted">[];
      setRuns(all.filter((r) => r.clientId === id));
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function uploadTemplate(docType: DocType, file: File) {
    setMessage(null);
    const form = new FormData();
    form.set("file", file);
    form.set("docType", docType);
    const res = await fetch(`/api/clients/${id}/template`, { method: "POST", body: form });
    const body = (await res.json()) as { error?: string };
    setMessage(
      res.ok
        ? { kind: "ok", text: `${DOC_TYPE_NAMES[docType]} template validated and saved.` }
        : { kind: "error", text: body.error ?? "Upload failed" },
    );
    await refresh();
  }

  if (notFound) {
    return (
      <div className="py-16 text-center text-sm text-slate-600">
        Client not found. <Link href="/" className="font-medium text-[#1F3A5F] underline">Back to clients</Link>
      </div>
    );
  }
  if (!client) {
    return <p className="py-16 text-center text-sm text-slate-500">Loading client…</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-xs font-medium text-slate-500 hover:text-slate-900">← All clients</Link>
        <h1 className="mt-1 text-2xl font-semibold">{client.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Build a branded template for each document type, then generate documents with it.
        </p>
      </div>

      {message && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            message.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {DOC_TYPES.map((dt) => {
          const template = client.templates[dt];
          const forType = builds.filter((b) => b.docType === dt);
          const active = forType.find((b) => b.status === "review" || b.status === "generating");
          const roundsUsed = active ? Math.max(0, active.iterations.length - 1) : 0;

          return (
            <div key={dt} className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">Build your {SHORT[dt]}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{DOC_TYPE_NAMES[dt]}</p>
                </div>
                {template ? (
                  <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                    Template ready
                  </span>
                ) : active ? (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                    {active.status === "generating" ? "Building…" : `In review · round ${roundsUsed} of ${MAX_REVIEW_ROUNDS}`}
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">Not built yet</span>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 pt-1">
                {active ? (
                  <Link
                    href={`/clients/${id}/build/${dt}`}
                    className="rounded-md bg-[#1F3A5F] px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Continue build →
                  </Link>
                ) : template ? (
                  <>
                    <Link
                      href={`/runs/new?client=${id}&docType=${dt}`}
                      className="rounded-md bg-[#1F3A5F] px-3 py-1.5 text-xs font-medium text-white"
                    >
                      New {SHORT[dt]} document
                    </Link>
                    <Link
                      href={`/clients/${id}/build/${dt}`}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
                    >
                      Rebuild template
                    </Link>
                  </>
                ) : (
                  <Link
                    href={`/clients/${id}/build/${dt}`}
                    className="rounded-md bg-[#1F3A5F] px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Build template →
                  </Link>
                )}
              </div>
              {template && (
                <p className="mt-2 text-xs text-slate-500">
                  {template.filename} · {new Date(template.uploadedAt).toLocaleString()}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <h2 className="text-lg font-semibold">Recent documents</h2>
        {runs.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            No documents yet — build a template above, then create a document with it.
          </p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            {runs.slice(0, 10).map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm last:border-b-0 hover:bg-slate-50"
              >
                <span className="font-medium">{DOC_TYPE_NAMES[run.docType]}</span>
                <span className="text-xs text-slate-500">
                  {new Date(run.createdAt).toLocaleString()} ·{" "}
                  {run.status === "awaiting_review" ? "awaiting review" : run.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <details className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">
          Advanced: upload a hand-made template (.docx)
        </summary>
        <p className="mt-2 text-xs text-slate-500">
          Restyle a master template (<code>templates/&lt;type&gt;.docx</code>) in Word keeping every {"{tag}"} intact.
          Uploads are dry-run validated; a broken tag is rejected with the exact error. This replaces any built template.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {DOC_TYPES.map((dt) => (
            <label key={dt} className="block rounded-md border border-slate-200 p-3 text-xs text-slate-600">
              <span className="font-medium">{DOC_TYPE_NAMES[dt]}</span>
              <input
                type="file"
                accept=".docx"
                className="mt-1 w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs hover:file:bg-slate-200"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadTemplate(dt, f);
                  e.target.value = "";
                }}
              />
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
