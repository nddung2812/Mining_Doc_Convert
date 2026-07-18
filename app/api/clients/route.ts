import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { slugify } from "@/lib/clients";
import type { ClientRecord } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getStorage().listClients());
}

export async function POST(request: NextRequest) {
  const { name } = (await request.json().catch(() => ({}))) as { name?: string };
  const trimmed = name?.trim();
  if (!trimmed) return NextResponse.json({ error: "Client name is required" }, { status: 400 });

  const id = slugify(trimmed);
  if (!id) return NextResponse.json({ error: "Client name must contain letters or numbers" }, { status: 400 });

  const storage = getStorage();
  if (await storage.getClient(id)) {
    return NextResponse.json({ error: `Client "${trimmed}" already exists` }, { status: 409 });
  }

  const client: ClientRecord = { id, name: trimmed, createdAt: new Date().toISOString(), templates: {} };
  await storage.saveClient(client);
  return NextResponse.json(client);
}
