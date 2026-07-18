"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface Preview {
  version: number;
  sections: { id: string; title: string; html: string }[];
}

/**
 * Print-ready view of the final template: browser print dialog -> Save as PDF.
 * Auto-opens the dialog once the preview has rendered.
 */
export default function BuildPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/builds/${id}/preview`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setPreview((await r.json()) as Preview);
      })
      .catch(() => setError("Could not load the template preview."));
  }, [id]);

  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [preview]);

  if (error) return <p className="py-16 text-center text-sm text-red-600">{error}</p>;
  if (!preview) return <p className="py-16 text-center text-sm text-slate-500">Preparing print view…</p>;

  return (
    <div className="mx-auto max-w-3xl bg-white">
      <style>{`@media print { header, footer, nav { display: none !important; } main { padding: 0 !important; } body { background: white !important; } }`}</style>
      <p className="mb-6 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600 print:hidden">
        Use your browser&apos;s print dialog to save this as a PDF. Content shown is sample text — the template
        itself carries no client content.
      </p>
      {preview.sections.map((s) => (
        <div key={s.id} className="mb-6">
          <div dangerouslySetInnerHTML={{ __html: s.html }} />
        </div>
      ))}
    </div>
  );
}
