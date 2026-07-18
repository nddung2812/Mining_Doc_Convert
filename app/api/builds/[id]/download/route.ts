import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = getStorage();
  const build = await storage.getBuild(id);
  if (!build) return NextResponse.json({ error: "Build not found" }, { status: 404 });
  if (build.status !== "final" || !build.final) {
    return NextResponse.json({ error: "Build the final template first" }, { status: 409 });
  }

  const buffer = await storage.getBuildFile(build.id, build.final.templateFilename);
  if (!buffer) return NextResponse.json({ error: "Final template file missing" }, { status: 404 });

  const filename = `${build.clientId}-${build.docType}-template.docx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
