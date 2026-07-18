"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientRecord, DocType, TemplateBuildRecord } from "@/lib/types";
import { DOC_TYPE_NAMES, MAX_REVIEW_ROUNDS, isDocType } from "@/lib/types";

type BuildWithRounds = TemplateBuildRecord & { roundsUsed: number; roundsLeft: number };

interface PreviewSection {
  id: string;
  title: string;
  html: string;
}

interface Preview {
  version: number;
  rationale: string;
  sections: PreviewSection[];
}

interface GatewayModelOption {
  id: string;
  name: string;
  vendor: string;
}

type Stage = "loading" | "form" | "building" | "review" | "final" | "failed";

const BUILDING_MESSAGES = [
  "Reading your brief…",
  "Studying the reference documents…",
  "Reading the style guide…",
  "Analysing layout, typography, and colour…",
  "Composing the template design…",
  "Rendering the preview…",
  "Still working — careful layout analysis takes a few minutes…",
];

function keyHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const anthropic = localStorage.getItem("anthropic_api_key");
  if (anthropic) headers["x-anthropic-key"] = anthropic;
  const gateway = localStorage.getItem("ai_gateway_key");
  if (gateway) headers["x-gateway-key"] = gateway;
  return headers;
}

/** Best model this vendor offers in the gateway catalog. */
function flagship(models: GatewayModelOption[], vendor: string, prefer: RegExp): GatewayModelOption | null {
  const list = models.filter((m) => m.vendor === vendor);
  if (list.length === 0) return null;
  const preferred = list.filter((m) => prefer.test(m.id));
  const pool = preferred.length ? preferred : list;
  return [...pool].sort((a, b) => b.id.localeCompare(a.id))[0];
}

export default function BuildWizardPage() {
  const params = useParams<{ id: string; docType: string }>();
  const clientId = params.id;
  const docType = (isDocType(params.docType) ? params.docType : "sop") as DocType;

  const [client, setClient] = useState<ClientRecord | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [build, setBuild] = useState<BuildWithRounds | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [logo, setLogo] = useState<File | null>(null);
  const [fonts, setFonts] = useState<File[]>([]);
  const [styleGuides, setStyleGuides] = useState<File[]>([]);
  const [references, setReferences] = useState<File[]>([]);
  const [brief, setBrief] = useState("");
  const [provider, setProvider] = useState<"anthropic" | "google" | "openai">("anthropic");
  const [gatewayModels, setGatewayModels] = useState<GatewayModelOption[]>([]);

  // Review state
  const [comments, setComments] = useState<Record<string, string>>({});
  const [openComment, setOpenComment] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  // Building animation
  const [buildingMessage, setBuildingMessage] = useState(BUILDING_MESSAGES[0]);
  const messageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const googleModel = useMemo(() => flagship(gatewayModels, "google", /pro/i), [gatewayModels]);
  const openaiModel = useMemo(() => flagship(gatewayModels, "openai", /gpt/i), [gatewayModels]);

  const startBuildingAnimation = useCallback(() => {
    setStage("building");
    let i = 0;
    setBuildingMessage(BUILDING_MESSAGES[0]);
    if (messageTimer.current) clearInterval(messageTimer.current);
    messageTimer.current = setInterval(() => {
      i = Math.min(i + 1, BUILDING_MESSAGES.length - 1);
      setBuildingMessage(BUILDING_MESSAGES[i]);
    }, 9000);
  }, []);

  const stopBuildingAnimation = useCallback(() => {
    if (messageTimer.current) clearInterval(messageTimer.current);
    messageTimer.current = null;
  }, []);

  const loadBuild = useCallback(
    async (buildId: string): Promise<BuildWithRounds | null> => {
      const res = await fetch(`/api/builds/${buildId}`);
      if (!res.ok) return null;
      const record = (await res.json()) as BuildWithRounds;
      setBuild(record);
      if (record.status === "review" || record.status === "final") {
        const previewRes = await fetch(`/api/builds/${buildId}/preview`);
        if (previewRes.ok) setPreview((await previewRes.json()) as Preview);
      }
      return record;
    },
    [],
  );

  // Resume the latest in-flight or finished build for this doc type, else show the form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [clientRes, buildsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/builds`),
      ]);
      if (cancelled) return;
      if (clientRes.ok) setClient((await clientRes.json()) as ClientRecord);
      const builds = buildsRes.ok ? ((await buildsRes.json()) as TemplateBuildRecord[]) : [];
      const resumable = builds.find(
        (b) => b.docType === docType && (b.status === "review" || b.status === "generating" || b.status === "final"),
      );
      if (resumable) {
        const record = await loadBuild(resumable.id);
        if (cancelled || !record) return;
        if (record.status === "generating") startBuildingAnimation();
        else setStage(record.status === "final" ? "final" : "review");
      } else {
        setStage("form");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, docType, loadBuild, startBuildingAnimation]);

  // A build started in another tab: poll until it leaves "generating".
  useEffect(() => {
    if (stage !== "building" || !build || build.status !== "generating") return;
    const timer = setInterval(async () => {
      const record = await loadBuild(build.id);
      if (record && record.status !== "generating") {
        stopBuildingAnimation();
        setStage(record.status === "review" ? "review" : record.status === "final" ? "final" : "failed");
        setError(record.error);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [stage, build, loadBuild, stopBuildingAnimation]);

  useEffect(() => {
    const gatewayKey = localStorage.getItem("ai_gateway_key");
    const headers: Record<string, string> = gatewayKey ? { "x-gateway-key": gatewayKey } : {};
    void fetch("/api/models", { headers })
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((body: { models: GatewayModelOption[] }) => setGatewayModels(body.models ?? []))
      .catch(() => {});
  }, []);

  async function startBuild(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (references.length < 1) {
      setError("Upload at least one example document showing how you want the outcome to look.");
      return;
    }
    const form = new FormData();
    form.set("docType", docType);
    form.set("brief", brief);
    form.set("provider", provider);
    form.set("model", provider === "google" ? (googleModel?.id ?? "") : provider === "openai" ? (openaiModel?.id ?? "") : "");
    if (logo) form.set("logo", logo);
    for (const f of fonts) form.append("font", f);
    for (const f of styleGuides) form.append("styleGuide", f);
    for (const f of references.slice(0, 3)) form.append("reference", f);

    startBuildingAnimation();
    try {
      const res = await fetch(`/api/clients/${clientId}/builds`, { method: "POST", body: form, headers: keyHeaders() });
      const body = (await res.json()) as { id?: string; error?: string };
      stopBuildingAnimation();
      if (res.ok && body.id) {
        const record = await loadBuild(body.id);
        setStage(record?.status === "review" ? "review" : "failed");
        setComments({});
        setOpenComment({});
        window.scrollTo({ top: 0 });
      } else {
        setError(body.error ?? `Request failed (${res.status})`);
        setStage(body.id ? "failed" : "form");
      }
    } catch {
      stopBuildingAnimation();
      setError("Network error — is the server still running?");
      setStage("form");
    }
  }

  async function submitReview() {
    if (!build || submitting) return;
    const list = Object.entries(comments)
      .map(([sectionId, comment]) => ({ sectionId, comment: comment.trim() }))
      .filter((c) => c.comment);
    if (list.length === 0) {
      setError("Add at least one section comment — or build the final if it already looks right.");
      return;
    }
    setSubmitting(true);
    setError(null);
    startBuildingAnimation();
    try {
      const res = await fetch(`/api/builds/${build.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...keyHeaders() },
        body: JSON.stringify({ comments: list }),
      });
      const body = (await res.json()) as { error?: string };
      stopBuildingAnimation();
      if (res.ok) {
        await loadBuild(build.id);
        setComments({});
        setOpenComment({});
        setStage("review");
        window.scrollTo({ top: 0 });
      } else {
        setError(body.error ?? `Review failed (${res.status})`);
        setStage("review");
      }
    } catch {
      stopBuildingAnimation();
      setError("Network error — the revision may still be running. Reload in a minute.");
      setStage("review");
    }
    setSubmitting(false);
  }

  async function finalize() {
    if (!build || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/builds/${build.id}/finalize`, { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (res.ok) {
        await loadBuild(build.id);
        setStage("final");
        window.scrollTo({ top: 0 });
      } else {
        setError(body.error ?? `Finalize failed (${res.status})`);
      }
    } catch {
      setError("Network error — is the server still running?");
    }
    setSubmitting(false);
  }

  const commentCount = Object.values(comments).filter((c) => c.trim()).length;
  const clientName = client?.name ?? clientId;

  const header = (
    <div>
      <Link href={`/clients/${clientId}`} className="text-xs font-medium text-slate-500 hover:text-slate-900">
        ← {clientName}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">
        Build your {docType.toUpperCase()} template
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        {DOC_TYPE_NAMES[docType]} · {clientName}
      </p>
    </div>
  );

  if (stage === "loading") {
    return <p className="py-16 text-center text-sm text-slate-500">Loading…</p>;
  }

  if (stage === "building") {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[#1F3A5F]" />
        <h1 className="mt-6 text-xl font-semibold">Building your {docType.toUpperCase()} template</h1>
        <p className="mt-3 text-sm text-slate-600">{buildingMessage}</p>
        <p className="mt-6 text-xs text-slate-400">
          This can take a few minutes — the model analyses your materials carefully. Leave this tab open.
        </p>
      </div>
    );
  }

  if (stage === "failed") {
    return (
      <div className="space-y-6">
        {header}
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <p className="font-medium">The build failed.</p>
          <p className="mt-1">{error ?? build?.error ?? "Unknown error"}</p>
        </div>
        <button
          onClick={() => {
            setBuild(null);
            setError(null);
            setStage("form");
          }}
          className="rounded-md bg-[#1F3A5F] px-4 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  if (stage === "final" && build) {
    return (
      <div className="space-y-6">
        {header}
        <div className="rounded-lg border border-green-200 bg-green-50 p-6">
          <h2 className="text-lg font-semibold text-green-900">Template finalised ✓</h2>
          <p className="mt-2 text-sm text-green-800">
            This is now {clientName}&apos;s {docType.toUpperCase()} template — every {docType.toUpperCase()} you
            generate for them renders with it.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={`/api/builds/${build.id}/download`}
              className="rounded-md bg-[#1F3A5F] px-4 py-2 text-sm font-medium text-white"
            >
              Download Word (.docx)
            </a>
            <a
              href={`/builds/${build.id}/print`}
              target="_blank"
              rel="noopener"
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
            >
              Download PDF (print view)
            </a>
            <Link
              href={`/runs/new?client=${clientId}&docType=${docType}`}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
            >
              Generate a document with it →
            </Link>
          </div>
          <p className="mt-3 text-xs text-green-700">
            The PDF option opens a print view — use your browser&apos;s &quot;Save as PDF&quot;.
          </p>
        </div>
        {preview && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Final template (v{preview.version})</h2>
            {preview.sections.map((s) => (
              <div key={s.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div dangerouslySetInnerHTML={{ __html: s.html }} />
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => {
            setBuild(null);
            setPreview(null);
            setStage("form");
          }}
          className="text-sm font-medium text-slate-500 underline hover:text-slate-900"
        >
          Start a fresh build (replaces this template when finalised)
        </button>
      </div>
    );
  }

  if (stage === "review" && build && preview) {
    const roundsLeft = build.roundsLeft;
    return (
      <div className="space-y-6 pb-28">
        {header}
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-[#1F3A5F] px-3 py-1 text-xs font-medium text-white">
            Draft v{preview.version}
          </span>
          <span className="text-sm text-slate-600">
            {roundsLeft > 0
              ? `${roundsLeft} review round${roundsLeft === 1 ? "" : "s"} left (of ${MAX_REVIEW_ROUNDS})`
              : "All review rounds used — build the final when ready"}
          </span>
        </div>

        {preview.rationale && (
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Designer&apos;s notes</p>
            <p className="mt-1">{preview.rationale}</p>
          </div>
        )}

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <p className="text-sm text-slate-600">
          Review each section below. The content is sample text — you are reviewing layout, colours, and typography
          only. Add a comment on any section you want changed, then submit the review.
        </p>

        <div className="space-y-4">
          {preview.sections.map((section) => (
            <div key={section.id} className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{section.title}</span>
                <button
                  onClick={() => setOpenComment((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                  disabled={roundsLeft === 0}
                  className={`text-xs font-medium ${
                    comments[section.id]?.trim()
                      ? "text-amber-700"
                      : "text-[#1F3A5F] hover:underline disabled:text-slate-300"
                  }`}
                >
                  {comments[section.id]?.trim() ? "✎ Comment added" : openComment[section.id] ? "Hide comment" : "+ Add comment"}
                </button>
              </div>
              <div className="p-5">
                <div dangerouslySetInnerHTML={{ __html: section.html }} />
              </div>
              {openComment[section.id] && roundsLeft > 0 && (
                <div className="border-t border-slate-100 px-5 py-3">
                  <textarea
                    value={comments[section.id] ?? ""}
                    onChange={(e) => setComments((prev) => ({ ...prev, [section.id]: e.target.value }))}
                    placeholder={`What should change about “${section.title}”? e.g. “Use the darker blue from our logo here” or “Make this heading smaller”.`}
                    rows={2}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#1F3A5F] focus:outline-none"
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6">
            <span className="text-xs text-slate-500">
              {roundsLeft > 0
                ? commentCount > 0
                  ? `${commentCount} section comment${commentCount === 1 ? "" : "s"} ready to submit`
                  : "No comments yet — add comments to request changes, or build the final"
                : "Review limit reached"}
            </span>
            <div className="flex gap-3">
              {roundsLeft > 0 && (
                <button
                  onClick={() => void submitReview()}
                  disabled={submitting || commentCount === 0}
                  className="rounded-md border border-[#1F3A5F] px-4 py-2 text-sm font-medium text-[#1F3A5F] disabled:opacity-40"
                >
                  Submit review ({roundsLeft} left)
                </button>
              )}
              <button
                onClick={() => void finalize()}
                disabled={submitting}
                className="rounded-md bg-[#1F3A5F] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Looks good — build the final
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // stage === "form"
  return (
    <div className="space-y-6">
      {header}
      <form onSubmit={startBuild} className="space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">1. Brand materials <span className="font-normal text-slate-400">(all optional)</span></h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium">Logo</label>
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.svg"
                onChange={(e) => setLogo(e.target.files?.[0] ?? null)}
                className="mt-1 w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1.5 file:text-xs hover:file:bg-slate-200"
              />
              <p className="mt-1 text-xs text-slate-500">.png, .jpg, or .svg — goes on the cover.</p>
            </div>
            <div>
              <label className="block text-sm font-medium">Fonts</label>
              <input
                type="file"
                multiple
                accept=".ttf,.otf,.woff,.woff2"
                onChange={(e) => setFonts(Array.from(e.target.files ?? []))}
                className="mt-1 w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1.5 file:text-xs hover:file:bg-slate-200"
              />
              <p className="mt-1 text-xs text-slate-500">Font names guide the design (fonts can&apos;t be embedded in .docx).</p>
            </div>
            <div>
              <label className="block text-sm font-medium">Style guides</label>
              <input
                type="file"
                multiple
                accept=".docx,.pdf,.txt,.md,.markdown"
                onChange={(e) => setStyleGuides(Array.from(e.target.files ?? []))}
                className="mt-1 w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1.5 file:text-xs hover:file:bg-slate-200"
              />
              <p className="mt-1 text-xs text-slate-500">.docx, .pdf, .txt, or .md — brand colours, voice, rules.</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">2. Perfect examples <span className="font-normal text-red-500">*</span></h2>
          <p className="mt-1 text-sm text-slate-600">
            Upload 1–3 documents that show how you want the outcome to look. One great example is enough.
          </p>
          <input
            type="file"
            multiple
            accept=".docx,.txt,.md,.markdown"
            onChange={(e) => setReferences(Array.from(e.target.files ?? []).slice(0, 3))}
            className="mt-3 w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
          {references.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">{references.map((f) => f.name).join(" · ")}</p>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">3. How should the template look? <span className="font-normal text-red-500">*</span></h2>
          <textarea
            required
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={4}
            placeholder="In your own words — e.g. “Clean and modern. Use our navy and safety-orange brand colours, logo top-left on the cover, bold section headings, and generous spacing like the attached example.”"
            className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#1F3A5F] focus:outline-none"
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">4. Design engine</h2>
          <p className="mt-1 text-sm text-slate-600">Each provider deploys its best model for the job.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {(
              [
                { key: "anthropic", vendor: "Anthropic", model: "Claude Opus 4.8", available: true },
                { key: "google", vendor: "Google", model: googleModel?.name ?? null, available: Boolean(googleModel) },
                { key: "openai", vendor: "OpenAI", model: openaiModel?.name ?? null, available: Boolean(openaiModel) },
              ] as const
            ).map((option) => (
              <button
                key={option.key}
                type="button"
                disabled={!option.available}
                onClick={() => setProvider(option.key)}
                className={`rounded-lg border p-4 text-left text-sm transition ${
                  provider === option.key
                    ? "border-[#1F3A5F] bg-[#1F3A5F]/5 ring-1 ring-[#1F3A5F]"
                    : "border-slate-200 hover:border-slate-400"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="block font-medium">{option.vendor}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {option.model ?? "Add an AI Gateway key in Settings"}
                </span>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={references.length === 0 || !brief.trim()}
          className="rounded-md bg-[#1F3A5F] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Build my template
        </button>
        <p className="text-xs text-slate-500">
          You&apos;ll get a preview to review — up to {MAX_REVIEW_ROUNDS} revision rounds before the final.
        </p>
      </form>
    </div>
  );
}
