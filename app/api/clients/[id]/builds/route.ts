import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isDocType, type BuildMaterialFile, type BuildProvider, type TemplateBuildRecord } from "@/lib/types";
import { getStorage } from "@/lib/storage";
import { ExtractionError, resolveEngine } from "@/lib/engine";
import { runTemplateDesign } from "@/lib/template-engine";
import { designInputFromBuild, sanitizeFilename } from "@/lib/builds";
import { parseLogo } from "@/lib/template-compile";
import { apiSpendTodayUsd, buildApiSpendTodayUsd, dailyCapUsd, estimateCostUsd } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 300;

const PROVIDERS: BuildProvider[] = ["anthropic", "google", "openai"];
const TEXT_EXTENSIONS = /\.(docx|txt|md|markdown)$/i;
const GUIDE_EXTENSIONS = /\.(docx|pdf|txt|md|markdown)$/i;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const builds = (await getStorage().listBuilds()).filter((b) => b.clientId === id);
  return NextResponse.json(builds);
}

/**
 * Start a template build: store the uploaded brand materials, then run the
 * first design round. Synchronous like /api/runs — the wizard stays open.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = getStorage();
  const client = await storage.getClient(id);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

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
    const spent = apiSpendTodayUsd(await storage.listRuns()) + buildApiSpendTodayUsd(await storage.listBuilds());
    const cap = dailyCapUsd();
    if (spent >= cap) {
      return NextResponse.json(
        { error: `Daily API spend cap reached (US$${spent.toFixed(2)} of US$${cap.toFixed(2)}). Try again tomorrow or raise DAILY_COST_CAP_USD.` },
        { status: 429 },
      );
    }
  }

  const buildId = randomUUID();
  const materialFile = async (file: File, prefix: string): Promise<BuildMaterialFile> => {
    const stored = `${prefix}-${sanitizeFilename(file.name)}`;
    await storage.saveBuildFile(buildId, stored, Buffer.from(await file.arrayBuffer()));
    return { filename: stored, bytes: file.size };
  };

  const build: TemplateBuildRecord = {
    id: buildId,
    clientId: client.id,
    clientName: client.name,
    docType,
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
  await storage.saveBuild(build);

  try {
    const output = await runTemplateDesign(await designInputFromBuild(build), choice);
    build.status = "review";
    build.model = output.model;
    build.iterations.push({
      version: 1,
      createdAt: new Date().toISOString(),
      spec: output.spec,
      engine: output.engine,
      model: output.model,
      usage: output.usage,
      costUsd: estimateCostUsd(output),
      feedback: null,
      reviewedAt: null,
    });
    await storage.saveBuild(build);
    return NextResponse.json({ id: buildId, status: build.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Template design failed";
    build.status = "failed";
    build.error = message;
    await storage.saveBuild(build);
    return NextResponse.json(
      { id: buildId, status: "failed", error: message },
      { status: e instanceof ExtractionError ? 502 : 500 },
    );
  }
}
