import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isDocType, type RunRecord } from "@/lib/types";
import { getDocTypeAssets } from "@/lib/doctypes";
import { extractSourceText } from "@/lib/source";
import { ExtractionError, resolveEngine, runExtraction } from "@/lib/engine";
import { NOT_FOUND_SENTINEL } from "@/lib/render";
import { getStorage } from "@/lib/storage";
import { apiSpendTodayUsd, buildApiSpendTodayUsd, dailyCapUsd, estimateCostUsd } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const runs = await getStorage().listRuns();
  // History list: strip the heavy extracted payload.
  return NextResponse.json(runs.map(({ extracted: _e, ...rest }) => rest));
}

function countNotFound(value: unknown): number {
  if (typeof value === "string") return value === NOT_FOUND_SENTINEL ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countNotFound(v), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce((n: number, v) => n + countNotFound(v), 0);
  }
  return 0;
}

export async function POST(request: NextRequest) {
  const storage = getStorage();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  let clientName = String(form.get("clientName") ?? "").trim();
  const clientIdRaw = String(form.get("clientId") ?? "").trim();
  const docTypeRaw = String(form.get("docType") ?? "");

  if (!(file instanceof File)) return NextResponse.json({ error: "Missing source file" }, { status: 400 });
  if (!isDocType(docTypeRaw)) return NextResponse.json({ error: "Invalid doc type" }, { status: 400 });
  const docType = docTypeRaw;

  // A registered client links the run to their custom templates.
  let clientId: string | null = null;
  if (clientIdRaw) {
    const client = await storage.getClient(clientIdRaw);
    if (!client) return NextResponse.json({ error: "Unknown client" }, { status: 400 });
    clientId = client.id;
    clientName = client.name;
  }
  if (!clientName) return NextResponse.json({ error: "Missing client name" }, { status: 400 });

  // An explicit template choice must be a finalized build of this client+type.
  let templateBuildId: string | null = null;
  const templateBuildIdRaw = String(form.get("templateBuildId") ?? "").trim();
  if (templateBuildIdRaw) {
    const build = await storage.getBuild(templateBuildIdRaw);
    if (!build || build.status !== "final" || build.clientId !== clientId || build.docType !== docType) {
      return NextResponse.json({ error: "Chosen template is not a finalised template for this client and doc type" }, { status: 400 });
    }
    templateBuildId = build.id;
  }

  // Cost guardrail: block new paid-engine runs once today's spend hits the cap.
  let choice;
  try {
    choice = resolveEngine({
      anthropicKey: request.headers.get("x-anthropic-key"),
      gatewayKey: request.headers.get("x-gateway-key"),
      model: String(form.get("model") ?? ""),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Engine error" }, { status: 400 });
  }
  if (choice.engine !== "cli") {
    const spent = apiSpendTodayUsd(await storage.listRuns()) + buildApiSpendTodayUsd(await storage.listBuilds());
    const cap = dailyCapUsd();
    if (spent >= cap) {
      return NextResponse.json(
        { error: `Daily API spend cap reached (US$${spent.toFixed(2)} of US$${cap.toFixed(2)}). Try again tomorrow or raise DAILY_COST_CAP_USD.` },
        { status: 429 },
      );
    }
  }

  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  let sourceText: string;
  try {
    sourceText = await extractSourceText(file.name, sourceBuffer);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unreadable source" }, { status: 400 });
  }

  const assets = getDocTypeAssets(docType);
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  const base: RunRecord = {
    id,
    createdAt,
    status: "failed",
    approval: null,
    clientId,
    clientName,
    docType,
    templateBuildId,
    source: {
      filename: file.name,
      bytes: sourceBuffer.length,
      sha256: createHash("sha256").update(sourceBuffer).digest("hex"),
    },
    promptVersion: assets.promptVersion,
    schemaVersion: assets.schemaVersion,
    templateVersion: assets.templateVersion,
    engine: choice.engine,
    model: choice.model,
    usage: null,
    costUsd: null,
    extracted: null,
    validation: { valid: false, errors: [] },
    confidenceSummary: { high: 0, medium: 0, low: 0, notFound: 0, warnings: 0 },
    error: null,
    downloads: [],
  };

  await storage.saveFile(id, `source-${file.name.replace(/[^\w.\-]+/g, "_")}`, sourceBuffer);

  try {
    const output = await runExtraction(docType, clientName, sourceText, choice);

    // Approval gate: extraction is done, but rendering waits for a named
    // reviewer to approve the extracted content (POST /api/runs/[id]/approve).
    const levels = output.extracted.meta.field_confidence;
    const run: RunRecord = {
      ...base,
      status: "awaiting_review",
      engine: output.engine,
      model: output.model,
      usage: output.usage,
      costUsd: estimateCostUsd(output),
      extracted: output.extracted,
      validation: { valid: true, errors: [] },
      confidenceSummary: {
        high: levels.filter((f) => f.level === "high").length,
        medium: levels.filter((f) => f.level === "medium").length,
        low: levels.filter((f) => f.level === "low").length,
        notFound: countNotFound(output.extracted.document),
        warnings: output.extracted.meta.warnings.length,
      },
    };
    await storage.saveRun(run);
    return NextResponse.json({ id, status: run.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Extraction failed";
    await storage.saveRun({
      ...base,
      error: message,
      validation: { valid: false, errors: e instanceof ExtractionError ? [message] : [] },
    });
    return NextResponse.json({ id, status: "failed", error: message }, { status: 502 });
  }
}
