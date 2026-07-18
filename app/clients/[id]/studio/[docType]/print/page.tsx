"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { blocksToHtml, type EditorDoc } from "@/lib/blocks";
import { isDocType, type DocType } from "@/lib/types";

/**
 * Print-ready view of a studio document: browser print dialog -> Save as PDF.
 * Auto-opens the dialog once the content has rendered.
 */
export default function StudioPrintPage() {
  const params = useParams<{ id: string; docType: string }>();
  const docType = (isDocType(params.docType) ? params.docType : "sop") as DocType;
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/clients/${params.id}/studio/${docType}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setHtml(blocksToHtml((await r.json()) as EditorDoc));
      })
      .catch(() => setError("Could not load the document."));
  }, [params.id, docType]);

  useEffect(() => {
    if (html === null) return;
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [html]);

  if (error) return <p className="py-16 text-center text-sm text-red-600">{error}</p>;
  if (html === null) return <p className="py-16 text-center text-sm text-slate-500">Preparing print view…</p>;

  return (
    <div className="mx-auto max-w-3xl bg-white text-[15px] leading-relaxed text-slate-800">
      <style>{`@media print { header, footer, nav { display: none !important; } main { padding: 0 !important; } body { background: white !important; } }`}</style>
      <p className="mb-6 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600 print:hidden">
        Use your browser&apos;s print dialog to save this document as a PDF.
      </p>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
