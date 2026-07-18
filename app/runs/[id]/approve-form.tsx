"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ApproveForm({ runId }: { runId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/runs/${runId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvedBy: name }),
    });
    if (res.ok) {
      router.refresh();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setError(body.error ?? `Approval failed (${res.status})`);
    setBusy(false);
  }

  return (
    <form onSubmit={approve} className="rounded-lg border border-[#1F3A5F] bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-[#1F3A5F]">Approval gate</p>
      <p className="mt-1 text-sm text-slate-600">
        Review the extracted content above — especially every NOT FOUND, low-confidence field, and warning. Approving
        releases the render and records your name in the audit trail as the reviewer.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name (reviewer of record)"
          className="w-72 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#1F3A5F] focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-md bg-[#1F3A5F] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Rendering…" : "Approve extracted content & render"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}
