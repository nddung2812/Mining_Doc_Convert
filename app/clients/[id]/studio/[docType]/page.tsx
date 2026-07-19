"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Columns2, FileDown, Printer, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { blocksToHtml, type EditorDoc } from "@/lib/blocks";
import { DOC_TYPE_NAMES, isDocType, type DocType } from "@/lib/types";
import BlockEditor, { type StudioEditorApi } from "./block-editor";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type AiState = "idle" | "working" | "error";

/** BYOK keys are held client-side (Settings) and forwarded per request. */
function keyHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const anthropic = localStorage.getItem("anthropic_api_key");
  if (anthropic) headers["x-anthropic-key"] = anthropic;
  const gateway = localStorage.getItem("ai_gateway_key");
  if (gateway) headers["x-gateway-key"] = gateway;
  const model = localStorage.getItem("preferred_model");
  if (model) headers["x-model"] = model;
  return headers;
}

function SaveBadge({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Saving…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <Check className="h-3.5 w-3.5" /> All changes saved
      </span>
    );
  }
  if (state === "dirty") return <span className="text-xs font-medium text-amber-700">Unsaved changes…</span>;
  if (state === "error") {
    return (
      <button onClick={onRetry} className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 hover:underline">
        <XCircle className="h-3.5 w-3.5" /> Save failed — retry
      </button>
    );
  }
  return null;
}

export default function StudioPage() {
  const params = useParams<{ id: string; docType: string }>();
  const clientId = params.id;
  const docType = (isDocType(params.docType) ? params.docType : "sop") as DocType;

  const [doc, setDoc] = useState<EditorDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const latestDoc = useRef<EditorDoc | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editorApi = useRef<StudioEditorApi | null>(null);
  const [instruction, setInstruction] = useState("");
  const [aiScope, setAiScope] = useState<"block" | "doc">("block");
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiError, setAiError] = useState<string | null>(null);

  // Load the saved (or freshly seeded) document once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/studio/${docType}`);
        if (!res.ok) throw new Error(`Could not load the studio (${res.status})`);
        const loaded = (await res.json()) as EditorDoc;
        if (!cancelled) {
          latestDoc.current = loaded;
          setDoc(loaded);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load the studio");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, docType]);

  const save = useCallback(async () => {
    const payload = latestDoc.current;
    if (!payload) return;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/clients/${clientId}/studio/${docType}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSaveState(res.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }, [clientId, docType]);

  const handleChange = useCallback(
    (next: EditorDoc) => {
      latestDoc.current = next;
      setDoc(next); // drives the live preview; the editor ignores the prop change
      setSaveState("dirty");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(), 1200);
    },
    [save],
  );

  // Flush a pending save when leaving the studio.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        void save();
      }
    };
  }, [save]);

  const revise = useCallback(async () => {
    const api = editorApi.current;
    const text = instruction.trim();
    if (!api || !text) return;

    // Scope: the focused block, or every block in the document (one AI call —
    // the response carries only the blocks that changed).
    let payload: Record<string, unknown>;
    if (aiScope === "doc") {
      const blocks = (latestDoc.current?.blocks ?? []).filter((b) => b.id);
      if (blocks.length === 0) {
        setAiState("error");
        setAiError("The document is empty — write something first.");
        return;
      }
      payload = { blocks, instruction: text };
    } else {
      const block = await api.getCurrentBlock();
      if (!block || !block.id) {
        setAiState("error");
        setAiError("Click into a block first, then describe the change.");
        return;
      }
      payload = { block, instruction: text };
    }

    setAiState("working");
    setAiError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/studio/${docType}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...keyHeaders() },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as {
        block?: { id?: string; data: Record<string, unknown> };
        blocks?: { id?: string; data: Record<string, unknown> }[];
        error?: string;
      };
      if (res.ok && body.blocks) {
        await api.updateBlocks(
          body.blocks.filter((b): b is { id: string; data: Record<string, unknown> } => Boolean(b.id)),
        );
        setInstruction("");
        setAiState("idle");
      } else if (res.ok && body.block && typeof payload.block === "object") {
        await api.updateBlock((payload.block as { id: string }).id, body.block.data);
        setInstruction("");
        setAiState("idle");
      } else {
        setAiState("error");
        setAiError(body.error ?? "Revision failed");
      }
    } catch {
      setAiState("error");
      setAiError("Network error — is the server running?");
    }
  }, [clientId, docType, instruction, aiScope]);

  const previewHtml = useMemo(() => (doc ? blocksToHtml(doc) : ""), [doc]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href={`/clients/${clientId}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to client
          </Link>
          <h1 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold">
            <Columns2 className="h-5 w-5 text-[#1F3A5F]" /> {docType.toUpperCase()} content studio
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {DOC_TYPE_NAMES[docType]} — edit the blocks on the right; the branded preview updates live.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <SaveBadge state={saveState} onRetry={save} />
          <div className="flex gap-2">
            <a
              href={`/api/clients/${clientId}/studio/${docType}/download`}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1F3A5F] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16304f]"
            >
              <FileDown className="h-3.5 w-3.5" /> Download Word
            </a>
            <a
              href={`/clients/${clientId}/studio/${docType}/print`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
            >
              <Printer className="h-3.5 w-3.5" /> Print / PDF
            </a>
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{loadError}</div>
      ) : !doc ? (
        <p className="py-16 text-center text-sm text-slate-500">Loading studio…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="order-2 space-y-4 lg:order-1">
            <div>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Edit blocks</h2>
              <div className="rounded-lg border border-slate-200 bg-white py-3 shadow-sm">
                <BlockEditor initial={doc} onChange={handleChange} apiRef={editorApi} />
              </div>
            </div>

            <div className="rounded-lg border border-[#1F3A5F]/25 bg-[#1F3A5F]/[0.03] p-4">
              <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1F3A5F]">
                <Sparkles className="h-4 w-4" /> Ask AI to revise
              </h2>
              <div className="mt-2 inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs font-medium">
                <button
                  onClick={() => setAiScope("block")}
                  className={`rounded px-2.5 py-1 ${aiScope === "block" ? "bg-[#1F3A5F] text-white" : "text-slate-600 hover:text-slate-900"}`}
                >
                  Selected block
                </button>
                <button
                  onClick={() => setAiScope("doc")}
                  className={`rounded px-2.5 py-1 ${aiScope === "doc" ? "bg-[#1F3A5F] text-white" : "text-slate-600 hover:text-slate-900"}`}
                >
                  Whole document
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {aiScope === "block"
                  ? "Click into a block in the editor, describe the change, and AI rewrites just that block."
                  : "One AI call across every block — only the blocks that change are touched."}
              </p>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={2}
                placeholder={
                  aiScope === "block"
                    ? "e.g. “Tighten this to three sentences” or “Add a column for residual risk owner”."
                    : "e.g. “Formalise the tone throughout” or “Rename ‘workers’ to ‘personnel’ everywhere”."
                }
                className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#1F3A5F] focus:outline-none"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                {aiState === "error" ? (
                  <span className="text-xs text-red-600">{aiError}</span>
                ) : (
                  <span className="text-xs text-slate-400">
                    {aiScope === "block"
                      ? "The revised block replaces the one you selected."
                      : "Changed blocks are replaced in place; the rest stay untouched."}
                  </span>
                )}
                <button
                  onClick={() => void revise()}
                  disabled={aiState === "working" || !instruction.trim()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#1F3A5F] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {aiState === "working" ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Rewriting…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />{" "}
                      {aiScope === "block" ? "Rewrite selected block" : "Rewrite document"}
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>

          <section className="order-1 lg:order-2">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Live document</h2>
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div
                className="p-8 text-[15px] leading-relaxed text-slate-800"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
