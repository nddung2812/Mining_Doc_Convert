"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Shown while a run's extraction is generating in the background: polls the
 * run API and refreshes the (server-rendered) page when the status changes.
 */
export default function GeneratingPoller({ runId, startedAt }: { runId: string; startedAt: string }) {
  const router = useRouter();
  const [elapsedS, setElapsedS] = useState(() => Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000)));

  useEffect(() => {
    const tick = setInterval(() => {
      setElapsedS(Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000)));
    }, 1000);
    return () => clearInterval(tick);
  }, [startedAt]);

  useEffect(() => {
    let cancelled = false;
    const poll = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
          if (!res.ok) return;
          const run = (await res.json()) as { status?: string };
          if (!cancelled && run.status && run.status !== "generating") router.refresh();
        } catch {
          /* transient network error — keep polling */
        }
      })();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [runId, router]);

  const minutes = Math.floor(elapsedS / 60);
  const seconds = elapsedS % 60;

  return (
    <div className="rounded-lg border border-[#1F3A5F]/30 bg-white p-5 shadow-sm">
      <p className="inline-flex items-center gap-2 text-sm font-semibold text-[#1F3A5F]">
        <RefreshCw className="h-4 w-4 animate-spin" /> Extracting the source content…
      </p>
      <p className="mt-1 text-sm text-slate-600">
        One structured model call, typically a few minutes. This page updates itself — you can also navigate away
        and come back via History.
      </p>
      <p className="mt-2 text-xs text-slate-400">
        Running for {minutes > 0 ? `${minutes} min ` : ""}
        {seconds}s
      </p>
    </div>
  );
}
