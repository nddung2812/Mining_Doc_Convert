import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getStorage().getClient(id);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  return NextResponse.json(client);
}
