"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BadgeCheck, Coins, Columns2, FilePlus2, Layers, Pencil, Wand2 } from "lucide-react";
import type { ClientRecord, TemplateBuildRecord } from "@/lib/types";
import { DOC_TYPE_NAMES, MAX_REVIEW_ROUNDS, type DocType } from "@/lib/types";

const DOC_TYPES = Object.keys(DOC_TYPE_NAMES) as DocType[];
const SHORT: Record<DocType, string> = { sop: "SOP", ra: "RA", hmp: "HMP", proposal: "Proposal" };

/** Builds API attaches per-build spend and the duration-history estimate. */
type BuildWithSpend = TemplateBuildRecord & { spendUsd?: number; expectedDurationMs?: number };

function remainingLabel(build: BuildWithSpend): string {
  if (!build.generationStartedAt || !build.expectedDurationMs) return "";
  const remaining = build.expectedDurationMs - (Date.now() - Date.parse(build.generationStartedAt));
  if (remaining > 90_000) return ` · ~${Math.round(remaining / 60_000)} min left`;
  if (remaining > 5_000) return ` · ~${Math.round(remaining / 1000)}s left`;
  return " · nearly there";
}

function formatUsd(v: number): string {
  return v > 0 && v < 0.01 ? "<US$0.01" : `US$${v.toFixed(2)}`;
}

export default function ClientWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [builds, setBuilds] = useState<BuildWithSpend[]>([]);

  const refresh = useCallback(async () => {
    const [clientRes, buildsRes] = await Promise.all([
      fetch(`/api/clients/${id}`),
      fetch(`/api/clients/${id}/builds`),
    ]);
    if (clientRes.ok) setClient((await clientRes.json()) as ClientRecord);
    else setNotFound(true);
    if (buildsRes.ok) setBuilds((await buildsRes.json()) as BuildWithSpend[]);
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the cards live while a template build runs in the background.
  const anyBuilding = builds.some((b) => b.status === "generating");
  useEffect(() => {
    if (!anyBuilding) return;
    const timer = setInterval(() => void refresh(), 8000);
    return () => clearInterval(timer);
  }, [anyBuilding, refresh]);

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
        <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-3.5 w-3.5" /> All clients
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{client.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Pick a document type. Get its template ready once, then create as many documents as you need with it.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {DOC_TYPES.map((dt) => {
          const template = client.templates[dt];
          const forType = builds.filter((b) => b.docType === dt);
          const active = forType.find((b) => b.status === "review" || b.status === "generating");
          const roundsUsed = active ? Math.max(0, active.iterations.length - 1) : 0;
          const spend = forType.reduce((sum, b) => sum + (b.spendUsd ?? 0), 0);
          const readyCount = Math.max(forType.filter((b) => b.status === "final").length, template ? 1 : 0);
          const isReady = readyCount > 0;
          const hasTemplates = Boolean(template) || forType.length > 0;

          // One bright primary action per card, decided by state.
          const primary = active
            ? { href: `/clients/${id}/build/${dt}`, label: "Continue", icon: ArrowRight }
            : isReady
              ? { href: `/clients/${id}/generate/${dt}`, label: `New ${SHORT[dt]} document`, icon: FilePlus2 }
              : { href: `/clients/${id}/build/${dt}`, label: `Build ${SHORT[dt]} template`, icon: Wand2 };
          const PrimaryIcon = primary.icon;

          return (
            <div key={dt} className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{SHORT[dt]}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{DOC_TYPE_NAMES[dt]}</p>
                </div>
                {active ? (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                    {active.status === "generating"
                      ? `Building…${remainingLabel(active)}`
                      : `In review · round ${roundsUsed} of ${MAX_REVIEW_ROUNDS}`}
                  </span>
                ) : isReady ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-700 px-2.5 py-0.5 text-xs font-medium text-white">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    Template ready
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">Not built yet</span>
                )}
              </div>

              <Link
                href={primary.href}
                className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-[#1F3A5F] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#16304f]"
              >
                <PrimaryIcon className="h-4 w-4" /> {primary.label}
              </Link>

              {/* Quiet secondary actions — never compete with the primary. */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-medium text-slate-500">
                <Link
                  href={`/clients/${id}/studio/${dt}`}
                  className="inline-flex items-center gap-1 text-[#1F3A5F] hover:text-[#16304f]"
                >
                  <Columns2 className="h-3.5 w-3.5" /> Content studio
                </Link>
                {active && isReady && (
                  <Link href={`/clients/${id}/generate/${dt}`} className="inline-flex items-center gap-1 hover:text-slate-900">
                    <FilePlus2 className="h-3.5 w-3.5" /> New document
                  </Link>
                )}
                {isReady && !active && (
                  <Link href={`/clients/${id}/build/${dt}`} className="inline-flex items-center gap-1 hover:text-slate-900">
                    <Pencil className="h-3.5 w-3.5" /> Edit or add a template
                  </Link>
                )}
                {hasTemplates && (
                  <Link href={`/clients/${id}/templates/${dt}`} className="inline-flex items-center gap-1 hover:text-slate-900">
                    <Layers className="h-3.5 w-3.5" /> View templates
                  </Link>
                )}
              </div>

              {(template || spend > 0) && (
                <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  {template && (
                    <span>
                      {template.filename} · {new Date(template.uploadedAt).toLocaleString()}
                    </span>
                  )}
                  {spend > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Coins className="h-3.5 w-3.5" /> {formatUsd(spend)} est. spend so far
                    </span>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
