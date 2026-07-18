import Link from "next/link";
import { listRunsRescued } from "@/lib/runs";
import { DOC_TYPE_NAMES } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await listRunsRescued();

  return (
    <div>
      <h1 className="text-2xl font-semibold">Run history</h1>
      <p className="mt-2 text-sm text-slate-600">
        Full audit trail per run: source hash, prompt/schema/template versions, model, engine, token usage, and downloads.
      </p>

      {runs.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No documents yet. <Link href="/" className="text-[#1F3A5F] underline">Pick a client</Link> and generate one
          from their workspace.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Review load</th>
                <th className="px-4 py-3">Engine</th>
                <th className="px-4 py-3">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link href={`/runs/${run.id}`} className="font-medium text-[#1F3A5F] underline">
                      {new Date(run.createdAt).toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{run.clientName}</td>
                  <td className="px-4 py-3">{DOC_TYPE_NAMES[run.docType]}</td>
                  <td className="px-4 py-3">
                    {run.status === "complete" ? (
                      <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white">approved</span>
                    ) : run.status === "awaiting_review" ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">awaiting review</span>
                    ) : run.status === "generating" ? (
                      <span className="rounded-full bg-[#1F3A5F]/10 px-2 py-0.5 text-xs font-medium text-[#1F3A5F]">extracting…</span>
                    ) : (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">failed</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600">
                    {run.status === "awaiting_review" || run.status === "complete"
                      ? `${run.confidenceSummary.low} low-conf · ${run.confidenceSummary.notFound} missing · ${run.confidenceSummary.warnings} warnings`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">{run.engine === "cli" ? "CLI (subscription)" : "API"}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs">
                    {run.costUsd == null ? "—" : `US$${run.costUsd.toFixed(4)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
