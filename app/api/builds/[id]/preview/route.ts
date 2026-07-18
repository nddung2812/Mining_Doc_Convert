import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { renderPreviewSections } from "@/lib/template-preview";

export const runtime = "nodejs";

/** Per-section HTML preview of one iteration (default: the latest). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const build = await getStorage().getBuild(id);
  if (!build) return NextResponse.json({ error: "Build not found" }, { status: 404 });
  if (build.iterations.length === 0) {
    return NextResponse.json({ error: "No template generated yet" }, { status: 409 });
  }

  const versionParam = Number(request.nextUrl.searchParams.get("version"));
  const iteration =
    Number.isInteger(versionParam) && versionParam >= 1 && versionParam <= build.iterations.length
      ? build.iterations[versionParam - 1]
      : build.iterations[build.iterations.length - 1];

  const logoUrl = build.materials.logo ? `/api/builds/${build.id}/logo` : null;
  return NextResponse.json({
    version: iteration.version,
    rationale: iteration.spec.design_rationale,
    sections: renderPreviewSections(build.docType, iteration.spec, build.clientName, logoUrl),
  });
}
