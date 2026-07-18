import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { slugify } from "@/lib/clients";
import { buildSpendUsd } from "@/lib/builds";
import type { ClientRecord } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const storage = getStorage();
  const [clients, builds] = await Promise.all([storage.listClients(), storage.listBuilds()]);
  const spendByClient = new Map<string, number>();
  const buildingByClient = new Map<string, number>();
  for (const build of builds) {
    spendByClient.set(build.clientId, (spendByClient.get(build.clientId) ?? 0) + buildSpendUsd(build));
    if (build.status === "generating") {
      buildingByClient.set(build.clientId, (buildingByClient.get(build.clientId) ?? 0) + 1);
    }
  }
  return NextResponse.json(
    clients.map((c) => ({
      ...c,
      templateSpendUsd: spendByClient.get(c.id) ?? 0,
      buildingCount: buildingByClient.get(c.id) ?? 0,
    })),
  );
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
