"use client";

import { useEffect, useState } from "react";
import type { ClientRecord, DocType } from "@/lib/types";
import { DOC_TYPE_NAMES } from "@/lib/types";

const DOC_TYPES = Object.keys(DOC_TYPE_NAMES) as DocType[];

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch("/api/clients");
    if (res.ok) setClients((await res.json()) as ClientRecord[]);
  }

  useEffect(() => {
    void fetch("/api/clients")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setClients(list as ClientRecord[]))
      .catch(() => {});
  }, []);

  async function createClient(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    const body = (await res.json()) as { error?: string; name?: string };
    setMessage(res.ok ? { kind: "ok", text: `Client "${body.name}" created.` } : { kind: "error", text: body.error ?? "Failed" });
    if (res.ok) setNewName("");
    await refresh();
    setBusy(false);
  }

  async function uploadTemplate(clientId: string, docType: DocType, file: File) {
    setMessage(null);
    const form = new FormData();
    form.set("file", file);
    form.set("docType", docType);
    const res = await fetch(`/api/clients/${clientId}/template`, { method: "POST", body: form });
    const body = (await res.json()) as { error?: string };
    setMessage(
      res.ok
        ? { kind: "ok", text: `${DOC_TYPE_NAMES[docType]} template validated and saved for ${clientId}.` }
        : { kind: "error", text: body.error ?? "Upload failed" },
    );
    await refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Clients & templates</h1>
        <p className="mt-2 text-sm text-slate-600">
          Each client can carry their own branded template per document type. Take the master template
          (<code className="text-xs">templates/&lt;type&gt;.docx</code>), restyle it in Word with the client&apos;s
          branding — fonts, colours, logo, cover — <span className="font-medium">keeping every {"{tag}"} intact</span>,
          and upload it here. Uploads are dry-run rendered on the spot: a broken tag is rejected with the exact error.
          Doc types without a custom template fall back to the master.
        </p>
      </div>

      {message && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            message.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}

      <form onSubmit={createClient} className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <input
          required
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New client name, e.g. Example Mining Co"
          className="w-80 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#1F3A5F] focus:outline-none"
        />
        <button type="submit" disabled={busy} className="rounded-md bg-[#1F3A5F] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Add client
        </button>
      </form>

      {clients.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No clients yet — add one above. Runs without a registered client use the master templates.
        </p>
      ) : (
        clients.map((client) => (
          <div key={client.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold">{client.name}</h2>
            <p className="text-xs text-slate-500">id: {client.id}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {DOC_TYPES.map((dt) => {
                const entry = client.templates[dt];
                return (
                  <div key={dt} className="rounded-md border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{DOC_TYPE_NAMES[dt]}</span>
                      {entry ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">custom</span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">master</span>
                      )}
                    </div>
                    {entry && (
                      <p className="mt-1 text-xs text-slate-500">
                        {entry.filename} · {new Date(entry.uploadedAt).toLocaleString()}
                      </p>
                    )}
                    <label className="mt-2 block text-xs text-slate-600">
                      {entry ? "Replace template:" : "Upload branded template (.docx):"}
                      <input
                        type="file"
                        accept=".docx"
                        className="mt-1 w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs hover:file:bg-slate-200"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadTemplate(client.id, dt, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
