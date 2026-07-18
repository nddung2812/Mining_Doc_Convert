"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ClientRecord } from "@/lib/types";
import { DOC_TYPE_NAMES, type DocType } from "@/lib/types";

const DOC_TYPES = Object.keys(DOC_TYPE_NAMES) as DocType[];

export default function ClientsHomePage() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientRecord[] | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/clients")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setClients(list as ClientRecord[]))
      .catch(() => setClients([]));
  }, []);

  async function createClient(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    const body = (await res.json()) as { id?: string; error?: string };
    if (res.ok && body.id) {
      router.push(`/clients/${body.id}`);
      return;
    }
    setError(body.error ?? "Could not create the client");
    setBusy(false);
  }

  if (clients === null) {
    return <p className="py-16 text-center text-sm text-slate-500">Loading clients…</p>;
  }

  // First visit: one job on screen — create your first client.
  if (clients.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-3xl font-semibold">Welcome to MDocConvert</h1>
        <p className="mt-3 text-sm text-slate-600">
          Everything starts with a client. Create your first client, then build their branded
          SOP, HMP, RA, and Proposal templates and generate documents with them.
        </p>
        <form onSubmit={createClient} className="mt-8 space-y-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <input
            required
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Client name, e.g. Example Mining Co"
            className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm focus:border-[#1F3A5F] focus:outline-none"
          />
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-left text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-[#1F3A5F] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create client"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="mt-1 text-sm text-slate-600">Pick a client to build their templates and documents.</p>
        </div>
        <form onSubmit={createClient} className="flex gap-2">
          <input
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New client name"
            className="w-56 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#1F3A5F] focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-[#1F3A5F] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Add client
          </button>
        </form>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((client) => {
          const ready = DOC_TYPES.filter((dt) => client.templates[dt]).length;
          return (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-[#1F3A5F] hover:shadow"
            >
              <h2 className="font-semibold text-slate-900">{client.name}</h2>
              <p className="mt-1 text-xs text-slate-500">
                Added {new Date(client.createdAt).toLocaleDateString()}
              </p>
              <p className="mt-3 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                {ready} of {DOC_TYPES.length} templates ready
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
