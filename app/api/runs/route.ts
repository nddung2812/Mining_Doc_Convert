import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse, after } from "next/server";
import { isDocType, type RunRecord } from "@/lib/types";
import { getDocTypeAssets } from "@/lib/doctypes";
import { extractSourceText } from "@/lib/source";
import { ExtractionError, resolveEngine, runExtraction } from "@/lib/engine";
import { getStorage } from "@/lib/storage";
import { estimateCostUsd } from "@/lib/cost";
import { capReachedMessage, dailyCapStatus, recordSpend } from "@/lib/ledger";
import { confidenceSummary, listRunsRescued } from "@/lib/runs";
import { blocksToText, type EditorDoc } from "@/lib/blocks";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const runs = await listRunsRescued();
  // History list: strip the heavy extracted payload (undefined drops in JSON).
  return NextResponse.json(runs.map((run) => ({ ...run, extracted: undefined })));
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
  const sourceType = String(form.get("sourceType") ?? "file");

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

  // Source content: an uploaded file, or the client's Content Studio document.
  let sourceBuffer: Buffer;
  let sourceFilename: string;
  let sourceText: string;
  if (sourceType === "studio") {
    if (!clientId) {
      return NextResponse.json({ error: "Studio documents belong to a registered client" }, { status: 400 });
    }
    const studioFile = `studio-${docType}.json`;
    const buf = await storage.getClientFile(clientId, studioFile);
    if (!buf) {
      return NextResponse.json(
        { error: "No studio document for this document type yet — open the Content Studio and write one first." },
        { status: 400 },
      );
    }
    let doc: EditorDoc;
    try {
      doc = JSON.parse(buf.toString("utf8")) as EditorDoc;
    } catch {
      return NextResponse.json({ error: "The saved studio document is unreadable" }, { status: 400 });
    }
    sourceText = blocksToText(doc);
    if (!sourceText.trim()) {
      return NextResponse.json({ error: "The studio document is empty — add some content first." }, { status: 400 });
    }
    // Audit trail: the exact studio JSON is the run's stored source.
    sourceBuffer = buf;
    sourceFilename = studioFile;
  } else {
    if (!(file instanceof File)) return NextResponse.json({ error: "Missing source file" }, { status: 400 });
    sourceBuffer = Buffer.from(await file.arrayBuffer());
    sourceFilename = file.name;
    try {
      sourceText = await extractSourceText(file.name, sourceBuffer);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Unreadable source" }, { status: 400 });
    }
  }

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
    const cap = await dailyCapStatus();
    if (cap.overCap) return NextResponse.json({ error: capReachedMessage(cap) }, { status: 429 });
  }

  const assets = getDocTypeAssets(docType);
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  const run: RunRecord = {
    id,
    createdAt,
    status: "generating",
    generationStartedAt: createdAt,
    updatedAt: createdAt,
    approval: null,
    clientId,
    clientName,
    docType,
    templateBuildId,
    source: {
      filename: sourceFilename,
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

  await storage.saveFile(id, `source-${sourceFilename.replace(/[^\w.\-]+/g, "_")}`, sourceBuffer);
  await storage.saveRun(run);

  // Extraction runs after the response — the run page polls while generating,
  // and rescueStaleRun self-heals if this worker dies mid-run.
  after(async () => {
    try {
      const output = await runExtraction(docType, clientName, sourceText, choice);
      const costUsd = estimateCostUsd(output);
      await recordSpend(output.engine, costUsd);

      // Approval gate: extraction is done, but rendering waits for a named
      // reviewer to approve the extracted content (POST /api/runs/[id]/approve).
      run.status = "awaiting_review";
      run.engine = output.engine;
      run.model = output.model;
      run.usage = output.usage;
      run.costUsd = costUsd;
      run.extracted = output.extracted;
      run.validation = { valid: true, errors: [] };
      run.confidenceSummary = confidenceSummary(output.extracted);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Extraction failed";
      run.status = "failed";
      run.error = message;
      run.validation = { valid: false, errors: e instanceof ExtractionError ? [message] : [] };
    }
    run.generationStartedAt = null;
    run.updatedAt = new Date().toISOString();
    await storage.saveRun(run);
  });

  return NextResponse.json({ id, status: run.status });
}
