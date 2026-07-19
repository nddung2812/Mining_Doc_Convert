import { randomUUID } from "crypto";
import { NextRequest, NextResponse, after } from "next/server";
import {
  isDocType,
  type BuildMaterialFile,
  type BuildProvider,
  type ClientRecord,
  type TemplateBuildRecord,
} from "@/lib/types";
import { getStorage, type Storage } from "@/lib/storage";
import { resolveEngine } from "@/lib/engine";
import { runCheckedTemplateDesign } from "@/lib/template-engine";
import { specFromBrandKit } from "@/lib/brand";
import { buildSpendUsd, designInputFromBuild, expectedRoundMs, rescueStaleBuild, sanitizeFilename } from "@/lib/builds";
import { parseLogo } from "@/lib/template-compile";
import { estimateCostUsd } from "@/lib/cost";
import { capReachedMessage, dailyCapStatus, recordSpend } from "@/lib/ledger";

export const runtime = "nodejs";
export const maxDuration = 300;

const PROVIDERS: BuildProvider[] = ["anthropic", "google", "openai"];
const TEXT_EXTENSIONS = /\.(docx|txt|md|markdown)$/i;
const GUIDE_EXTENSIONS = /\.(docx|pdf|txt|md|markdown)$/i;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const all = await getStorage().listBuilds();
  const builds = await Promise.all(
    all.filter((b) => b.clientId === id).map((b) => rescueStaleBuild(b)),
  );
  return NextResponse.json(
    builds.map((b) => ({
      ...b,
      // Builds predating template naming get a readable fallback.
      name: b.name || `${b.docType.toUpperCase()} template`,
      spendUsd: buildSpendUsd(b),
      expectedDurationMs: expectedRoundMs(all, b.model),
    })),
  );
}

/**
 * Brand-kit derivation: a complete, review-ready template built deterministically
 * from the client's existing brand — zero model calls, zero cost, instant. The
 * build lands in "review" so the normal preview/feedback/finalize flow applies.
 */
async function createFromBrandKit(request: NextRequest, client: ClientRecord, storage: Storage) {
  const body = (await request.json().catch(() => ({}))) as { mode?: string; docType?: string; name?: string };
  if (body.mode !== "brand") return NextResponse.json({ error: "Unknown build mode" }, { status: 400 });
  if (!body.docType || !isDocType(body.docType)) return NextResponse.json({ error: "Invalid doc type" }, { status: 400 });
  const docType = body.docType;
  const kit = client.brandKit;
  if (!kit) {
    return NextResponse.json(
      { error: "This client has no brand kit yet — finalise one AI-designed template first." },
      { status: 400 },
    );
  }

  const buildId = randomUUID();
  const createdAt = new Date().toISOString();

  // The kit references the logo inside its source build — copy it so this
  // build compiles (and survives) independently of the source build.
  let logo: BuildMaterialFile | null = null;
  if (kit.logoFilename) {
    const buffer = await storage.getBuildFile(kit.derivedFrom.buildId, kit.logoFilename);
    if (buffer) {
      await storage.saveBuildFile(buildId, kit.logoFilename, buffer);
      logo = { filename: kit.logoFilename, bytes: buffer.length };
    }
  }

  const spec = specFromBrandKit(docType, kit, client.name, logo !== null);
  const priorForType = (await storage.listBuilds()).filter(
    (b) => b.clientId === client.id && b.docType === docType,
  ).length;

  const build: TemplateBuildRecord = {
    id: buildId,
    clientId: client.id,
    clientName: client.name,
    docType,
    name:
      String(body.name ?? "").trim().slice(0, 80) ||
      `${docType.toUpperCase()} template ${priorForType + 1} (brand kit)`,
    createdAt,
    updatedAt: createdAt,
    status: "review",
    generationStartedAt: null,
    brief: `Derived from the client's brand kit (their finalised ${kit.derivedFrom.docType.toUpperCase()} template). Keep future revisions consistent with that brand.`,
    provider: "anthropic",
    model: "", // review rounds (if any) resolve the default engine/model
    materials: { logo, fonts: [], styleGuides: [], references: [] },
    iterations: [
      {
        version: 1,
        createdAt,
        durationMs: 0,
        spec,
        engine: "derived",
        model: "brand-kit",
        usage: null,
        costUsd: null,
        feedback: null,
        reviewedAt: null,
      },
    ],
    final: null,
    error: null,
  };
  await storage.saveBuild(build);
  return NextResponse.json({ id: buildId, status: "review" });
}

/**
 * Start a template build: store the uploaded brand materials, then run the
 * first design round. Synchronous like /api/runs — the wizard stays open.
 * A JSON body with mode:"brand" instead derives the template from the client's
 * brand kit deterministically (no AI round).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = getStorage();
  const client = await storage.getClient(id);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    return createFromBrandKit(request, client, storage);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const docTypeRaw = String(form.get("docType") ?? "");
  if (!isDocType(docTypeRaw)) return NextResponse.json({ error: "Invalid doc type" }, { status: 400 });
  const docType = docTypeRaw;

  const provider = String(form.get("provider") ?? "anthropic") as BuildProvider;
  if (!PROVIDERS.includes(provider)) return NextResponse.json({ error: "Invalid provider" }, { status: 400 });

  const brief = String(form.get("brief") ?? "").trim().slice(0, 4000);
  if (!brief) {
    return NextResponse.json({ error: "Tell us how you want the template to look — the brief is required." }, { status: 400 });
  }

  const references = form.getAll("reference").filter((f): f is File => f instanceof File && f.size > 0);
  if (references.length < 1 || references.length > 3) {
    return NextResponse.json(
      { error: "Upload 1–3 example documents showing how you want the outcome to look." },
      { status: 400 },
    );
  }
  for (const ref of references) {
    if (!TEXT_EXTENSIONS.test(ref.name)) {
      return NextResponse.json(
        { error: `Example document "${ref.name}" must be .docx, .txt, or .md.` },
        { status: 400 },
      );
    }
  }

  const styleGuides = form.getAll("styleGuide").filter((f): f is File => f instanceof File && f.size > 0);
  for (const guide of styleGuides) {
    if (!GUIDE_EXTENSIONS.test(guide.name)) {
      return NextResponse.json(
        { error: `Style guide "${guide.name}" must be .docx, .pdf, .txt, or .md.` },
        { status: 400 },
      );
    }
  }

  const fonts = form.getAll("font").filter((f): f is File => f instanceof File && f.size > 0);
  const logoFile = form.get("logo");
  let logoBuffer: Buffer | null = null;
  if (logoFile instanceof File && logoFile.size > 0) {
    logoBuffer = Buffer.from(await logoFile.arrayBuffer());
    if (!parseLogo(logoFile.name, logoBuffer)) {
      return NextResponse.json({ error: "Logo must be a readable .png, .jpg, or .svg image." }, { status: 400 });
    }
  }

  // Engine + daily-cap guardrails, same rules as document runs.
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

  const buildId = randomUUID();
  const materialFile = async (file: File, prefix: string): Promise<BuildMaterialFile> => {
    const stored = `${prefix}-${sanitizeFilename(file.name)}`;
    await storage.saveBuildFile(buildId, stored, Buffer.from(await file.arrayBuffer()));
    return { filename: stored, bytes: file.size };
  };

  const priorForType = (await storage.listBuilds()).filter(
    (b) => b.clientId === client.id && b.docType === docType,
  ).length;
  const name =
    String(form.get("name") ?? "").trim().slice(0, 80) || `${docType.toUpperCase()} template ${priorForType + 1}`;

  const build: TemplateBuildRecord = {
    id: buildId,
    clientId: client.id,
    clientName: client.name,
    docType,
    name,
    createdAt: new Date().toISOString(),
    status: "generating",
    brief,
    provider,
    model: choice.model,
    materials: {
      logo: null,
      fonts: await Promise.all(fonts.map((f, i) => materialFile(f, `font-${i}`))),
      styleGuides: await Promise.all(styleGuides.map((f, i) => materialFile(f, `styleguide-${i}`))),
      references: await Promise.all(references.map((f, i) => materialFile(f, `reference-${i}`))),
    },
    iterations: [],
    final: null,
    error: null,
  };
  if (logoFile instanceof File && logoBuffer) {
    const stored = `logo-${sanitizeFilename(logoFile.name)}`;
    await storage.saveBuildFile(buildId, stored, logoBuffer);
    build.materials.logo = { filename: stored, bytes: logoBuffer.length };
  }
  build.generationStartedAt = build.createdAt;
  build.updatedAt = build.createdAt;
  await storage.saveBuild(build);

  // The design round runs after the response — the user can navigate away and
  // track progress from the client workspace; the wizard polls build status.
  after(async () => {
    const started = Date.now();
    try {
      const output = await runCheckedTemplateDesign(await designInputFromBuild(build), choice);
      const costUsd = estimateCostUsd(output);
      await recordSpend(output.engine, costUsd);
      build.status = "review";
      build.model = output.model;
      build.iterations.push({
        version: 1,
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        spec: output.spec,
        engine: output.engine,
        model: output.model,
        usage: output.usage,
        costUsd,
        feedback: null,
        reviewedAt: null,
      });
    } catch (e) {
      build.status = "failed";
      build.error = e instanceof Error ? e.message : "Template design failed";
    }
    build.generationStartedAt = null;
    build.updatedAt = new Date().toISOString();
    await storage.saveBuild(build);
  });

  return NextResponse.json({
    id: buildId,
    status: build.status,
    expectedDurationMs: expectedRoundMs(await storage.listBuilds(), choice.model),
  });
}
