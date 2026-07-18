"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  Clock,
  Coins,
  Eye,
  FileDown,
  FilePlus2,
  Pencil,
  Plus,
  Printer,
  Wand2,
  XCircle,
} from "lucide-react";
import type { ClientRecord, DocType, TemplateBuildRecord } from "@/lib/types";
import { DOC_TYPE_NAMES, isDocType } from "@/lib/types";

/** Builds API attaches per-build spend, summed from every design round. */
type BuildWithSpend = TemplateBuildRecord & { spendUsd?: number };

function formatUsd(v: number): string {
  return v > 0 && v < 0.01 ? "<US$0.01" : `US$${v.toFixed(2)}`;
}

interface Preview {
  version: number;
  rationale: string;
  sections: { id: string; title: string; html: string }[];
}

const STATUS_LABEL: Record<TemplateBuildRecord["status"], string> = {
  generating: "building…",
  review: "in review",
  final: "finalised",
  failed: "failed",
};

export default function TemplateVersionsPage() {
  const params = useParams<{ id: string; docType: string }>();
  const clientId = params.id;
  const docType = (isDocType(params.docType) ? params.docType : "sop") as DocType;

  const [client, setClient] = useState<ClientRecord | null>(null);
  const [builds, setBuilds] = useState<BuildWithSpend[] | null>(null);
  const [selected, setSelected] = useState<{ buildId: string; version: number } | null>(null);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function saveRename(buildId: string) {
    const name = renameValue.trim();
    if (!name) return;
    const res = await fetch(`/api/builds/${buildId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      setBuilds((prev) => (prev ? prev.map((b) => (b.id === buildId ? { ...b, name } : b)) : prev));
      setRenamingId(null);
    }
  }

  useEffect(() => {
    void (async () => {
      const [clientRes, buildsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/builds`),
      ]);
      if (clientRes.ok) setClient((await clientRes.json()) as ClientRecord);
      const all = buildsRes.ok ? ((await buildsRes.json()) as BuildWithSpend[]) : [];
      const forType = all.filter((b) => b.docType === docType);
      setBuilds(forType);
      const latest = forType.find((b) => b.iterations.length > 0);
      if (latest) {
        setSelected({ buildId: latest.id, version: latest.iterations[latest.iterations.length - 1].version });
      }
    })();
  }, [clientId, docType]);

  const loadPreview = useCallback(
    async (buildId: string, version: number) => {
      setSelected({ buildId, version });
      setPreviewError(null);
      const key = `${buildId}:${version}`;
      if (previews[key]) return;
      const res = await fetch(`/api/builds/${buildId}/preview?version=${version}`);
      if (res.ok) {
        const preview = (await res.json()) as Preview;
        setPreviews((prev) => ({ ...prev, [key]: preview }));
      } else {
        setPreviewError("Could not load this version's preview.");
      }
    },
    [previews],
  );

  useEffect(() => {
    if (selected) void loadPreview(selected.buildId, selected.version);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.buildId, selected?.version]);

  if (builds === null) {
    return <p className="py-16 text-center text-sm text-slate-500">Loading template history…</p>;
  }

  const clientName = client?.name ?? clientId;
  const current = client?.templates[docType];
  const currentPreview = selected ? previews[`${selected.buildId}:${selected.version}`] : undefined;
  const registeredBuild = current
    ? builds.find((b) => current.filename === `built-${b.id.slice(0, 8)}.docx`)
    : undefined;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/clients/${clientId}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {clientName}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{docType.toUpperCase()} templates</h1>
        <p className="mt-1 text-sm text-slate-600">
          {DOC_TYPE_NAMES[docType]} · {clientName} — every build and every reviewed version.
        </p>
      </div>

      {current ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 border-l-4 border-l-emerald-600 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-slate-800">
            <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-600" />
            <span>
              <span className="font-semibold text-emerald-700">Active template:</span> {current.filename} ·{" "}
              {new Date(current.uploadedAt).toLocaleString()}
              {registeredBuild ? "" : " (uploaded manually — no version history)"}
            </span>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/clients/${clientId}/generate/${docType}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1F3A5F] px-3 py-1.5 text-xs font-medium text-white"
            >
              <FilePlus2 className="h-3.5 w-3.5" /> Generate {docType.toUpperCase()}
            </Link>
            <Link
              href={`/clients/${clientId}/build/${docType}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
            >
              <Plus className="h-3.5 w-3.5" /> Add another template
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          No active template yet — finalise a build below, or{" "}
          <Link href={`/clients/${clientId}/build/${docType}`} className="font-medium text-[#1F3A5F] underline">
            start a build
          </Link>
          .
        </div>
      )}

      {builds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">No builds yet for this document type.</p>
          <Link
            href={`/clients/${clientId}/build/${docType}`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[#1F3A5F] px-4 py-2 text-sm font-medium text-white"
          >
            <Wand2 className="h-4 w-4" /> Build your {docType.toUpperCase()} template
          </Link>
        </div>
      ) : (
        builds.map((build) => {
          const isRegistered = registeredBuild?.id === build.id;
          return (
            <div key={build.id} className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {build.status === "final" ? (
                    <BadgeCheck className="h-4 w-4 text-emerald-600" />
                  ) : build.status === "failed" ? (
                    <XCircle className="h-4 w-4 text-red-500" />
                  ) : (
                    <Clock className="h-4 w-4 text-amber-500" />
                  )}
                  {renamingId === build.id ? (
                    <span className="inline-flex items-center gap-1">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveRename(build.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        maxLength={80}
                        className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-[#1F3A5F] focus:outline-none"
                      />
                      <button
                        onClick={() => void saveRename(build.id)}
                        className="rounded-md bg-[#1F3A5F] p-1.5 text-white"
                        aria-label="Save name"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      {build.name}
                      <button
                        onClick={() => {
                          setRenamingId(build.id);
                          setRenameValue(build.name);
                        }}
                        className="text-slate-400 hover:text-[#1F3A5F]"
                        aria-label="Rename template"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                  <span className="text-xs text-slate-500">
                    {new Date(build.createdAt).toLocaleDateString()} · {STATUS_LABEL[build.status]} · {build.model}
                    {isRegistered && " · default"}
                  </span>
                  {(build.spendUsd ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Coins className="h-3.5 w-3.5" /> {formatUsd(build.spendUsd!)}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {build.status === "review" && (
                    <Link
                      href={`/clients/${clientId}/build/${docType}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#1F3A5F] px-3 py-1.5 text-xs font-medium text-white"
                    >
                      <Eye className="h-3.5 w-3.5" /> Continue review
                    </Link>
                  )}
                  {build.status === "final" && (
                    <>
                      <Link
                        href={`/clients/${clientId}/generate/${docType}?template=${build.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#1F3A5F] px-3 py-1.5 text-xs font-medium text-white"
                      >
                        <FilePlus2 className="h-3.5 w-3.5" /> Generate
                      </Link>
                      <a
                        href={`/api/builds/${build.id}/download`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
                      >
                        <FileDown className="h-3.5 w-3.5" /> Word
                      </a>
                      <a
                        href={`/builds/${build.id}/print`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
                      >
                        <Printer className="h-3.5 w-3.5" /> PDF
                      </a>
                    </>
                  )}
                </div>
              </div>

              {build.error && <p className="px-5 py-3 text-sm text-red-700">{build.error}</p>}

              {build.iterations.length > 0 && (
                <div className="px-5 py-3">
                  <div className="flex flex-wrap gap-2">
                    {build.iterations.map((iteration) => {
                      const isSelected =
                        selected?.buildId === build.id && selected.version === iteration.version;
                      return (
                        <button
                          key={iteration.version}
                          onClick={() => void loadPreview(build.id, iteration.version)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                            isSelected
                              ? "border-[#1F3A5F] bg-[#1F3A5F] text-white"
                              : "border-slate-300 text-slate-700 hover:border-slate-500"
                          }`}
                        >
                          <Eye className="h-3 w-3" />
                          v{iteration.version}
                          <span className={isSelected ? "text-slate-300" : "text-slate-400"}>
                            {new Date(iteration.createdAt).toLocaleDateString()}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {selected?.buildId === build.id && (
                    <div className="mt-4 space-y-4">
                      {(() => {
                        const iteration = build.iterations.find((i) => i.version === selected.version);
                        if (!iteration?.feedback?.length) return null;
                        return (
                          <div className="rounded-md border border-amber-100 bg-amber-50 p-3 text-xs text-amber-900">
                            <p className="font-semibold uppercase tracking-wide">
                              Review feedback on v{iteration.version} (led to v{iteration.version + 1})
                            </p>
                            <ul className="mt-1 space-y-0.5">
                              {iteration.feedback.map((f, i) => (
                                <li key={i}>
                                  <span className="font-medium">[{f.sectionId}]</span> {f.comment}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })()}

                      {previewError && <p className="text-sm text-red-600">{previewError}</p>}
                      {!currentPreview && !previewError && (
                        <p className="text-sm text-slate-500">Loading preview…</p>
                      )}
                      {currentPreview && (
                        <>
                          {currentPreview.rationale && (
                            <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
                              <p className="font-semibold uppercase tracking-wide text-blue-700">
                                Designer&apos;s notes
                              </p>
                              <p className="mt-1">{currentPreview.rationale}</p>
                            </div>
                          )}
                          <div className="max-h-[36rem] space-y-3 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3">
                            {currentPreview.sections.map((s) => (
                              <div key={s.id} className="rounded-md border border-slate-200 bg-white p-4">
                                <div dangerouslySetInnerHTML={{ __html: s.html }} />
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
