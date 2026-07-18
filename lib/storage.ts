import fs from "fs";
import path from "path";
import type { ClientRecord, RunRecord } from "./types";

export interface Storage {
  saveRun(run: RunRecord): Promise<void>;
  getRun(id: string): Promise<RunRecord | null>;
  listRuns(): Promise<RunRecord[]>;
  saveFile(runId: string, name: string, data: Buffer): Promise<void>;
  getFile(runId: string, name: string): Promise<Buffer | null>;
  saveClient(client: ClientRecord): Promise<void>;
  getClient(id: string): Promise<ClientRecord | null>;
  listClients(): Promise<ClientRecord[]>;
  saveClientFile(clientId: string, name: string, data: Buffer): Promise<void>;
  getClientFile(clientId: string, name: string): Promise<Buffer | null>;
}

const DATA_DIR = path.join(process.cwd(), "data", "runs");
const CLIENTS_DIR = path.join(process.cwd(), "data", "clients");

class LocalStorage implements Storage {
  private dir(runId: string): string {
    // Run IDs are generated server-side, but never trust them in a path.
    if (!/^[a-z0-9-]+$/.test(runId)) throw new Error("Invalid run id");
    return path.join(DATA_DIR, runId);
  }

  async saveRun(run: RunRecord): Promise<void> {
    const dir = this.dir(run.id);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, "run.json"), JSON.stringify(run, null, 2));
  }

  async getRun(id: string): Promise<RunRecord | null> {
    try {
      const raw = await fs.promises.readFile(path.join(this.dir(id), "run.json"), "utf8");
      return JSON.parse(raw) as RunRecord;
    } catch {
      return null;
    }
  }

  async listRuns(): Promise<RunRecord[]> {
    let ids: string[];
    try {
      ids = await fs.promises.readdir(DATA_DIR);
    } catch {
      return [];
    }
    const runs = await Promise.all(ids.map((id) => this.getRun(id)));
    return runs
      .filter((r): r is RunRecord => r !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveFile(runId: string, name: string, data: Buffer): Promise<void> {
    const dir = this.dir(runId);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, path.basename(name)), data);
  }

  async getFile(runId: string, name: string): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(path.join(this.dir(runId), path.basename(name)));
    } catch {
      return null;
    }
  }

  private clientDir(clientId: string): string {
    if (!/^[a-z0-9-]+$/.test(clientId)) throw new Error("Invalid client id");
    return path.join(CLIENTS_DIR, clientId);
  }

  async saveClient(client: ClientRecord): Promise<void> {
    const dir = this.clientDir(client.id);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, "client.json"), JSON.stringify(client, null, 2));
  }

  async getClient(id: string): Promise<ClientRecord | null> {
    try {
      const raw = await fs.promises.readFile(path.join(this.clientDir(id), "client.json"), "utf8");
      return JSON.parse(raw) as ClientRecord;
    } catch {
      return null;
    }
  }

  async listClients(): Promise<ClientRecord[]> {
    let ids: string[];
    try {
      ids = await fs.promises.readdir(CLIENTS_DIR);
    } catch {
      return [];
    }
    const clients = await Promise.all(ids.map((id) => this.getClient(id)));
    return clients.filter((c): c is ClientRecord => c !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveClientFile(clientId: string, name: string, data: Buffer): Promise<void> {
    const dir = this.clientDir(clientId);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, path.basename(name)), data);
  }

  async getClientFile(clientId: string, name: string): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(path.join(this.clientDir(clientId), path.basename(name)));
    } catch {
      return null;
    }
  }
}

const BLOB_PREFIX = "mdocconvert/runs";
const BLOB_CLIENT_PREFIX = "mdocconvert/clients";

class BlobStorage implements Storage {
  private async blob() {
    return import("@vercel/blob");
  }

  async saveRun(run: RunRecord): Promise<void> {
    const { put } = await this.blob();
    await put(`${BLOB_PREFIX}/${run.id}/run.json`, JSON.stringify(run), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const { head } = await this.blob();
    try {
      const meta = await head(`${BLOB_PREFIX}/${id}/run.json`);
      const res = await fetch(meta.url, { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as RunRecord;
    } catch {
      return null;
    }
  }

  async listRuns(): Promise<RunRecord[]> {
    const { list } = await this.blob();
    const { blobs } = await list({ prefix: `${BLOB_PREFIX}/` });
    const runBlobs = blobs.filter((b) => b.pathname.endsWith("/run.json"));
    const runs = await Promise.all(
      runBlobs.map(async (b) => {
        try {
          const res = await fetch(b.url, { cache: "no-store" });
          return res.ok ? ((await res.json()) as RunRecord) : null;
        } catch {
          return null;
        }
      }),
    );
    return runs
      .filter((r): r is RunRecord => r !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveFile(runId: string, name: string, data: Buffer): Promise<void> {
    const { put } = await this.blob();
    await put(`${BLOB_PREFIX}/${runId}/${name}`, data, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async getFile(runId: string, name: string): Promise<Buffer | null> {
    const { head } = await this.blob();
    try {
      const meta = await head(`${BLOB_PREFIX}/${runId}/${name}`);
      const res = await fetch(meta.url, { cache: "no-store" });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  async saveClient(client: ClientRecord): Promise<void> {
    const { put } = await this.blob();
    await put(`${BLOB_CLIENT_PREFIX}/${client.id}/client.json`, JSON.stringify(client), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async getClient(id: string): Promise<ClientRecord | null> {
    const { head } = await this.blob();
    try {
      const meta = await head(`${BLOB_CLIENT_PREFIX}/${id}/client.json`);
      const res = await fetch(meta.url, { cache: "no-store" });
      return res.ok ? ((await res.json()) as ClientRecord) : null;
    } catch {
      return null;
    }
  }

  async listClients(): Promise<ClientRecord[]> {
    const { list } = await this.blob();
    const { blobs } = await list({ prefix: `${BLOB_CLIENT_PREFIX}/` });
    const clients = await Promise.all(
      blobs
        .filter((b) => b.pathname.endsWith("/client.json"))
        .map(async (b) => {
          try {
            const res = await fetch(b.url, { cache: "no-store" });
            return res.ok ? ((await res.json()) as ClientRecord) : null;
          } catch {
            return null;
          }
        }),
    );
    return clients.filter((c): c is ClientRecord => c !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveClientFile(clientId: string, name: string, data: Buffer): Promise<void> {
    const { put } = await this.blob();
    await put(`${BLOB_CLIENT_PREFIX}/${clientId}/${name}`, data, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async getClientFile(clientId: string, name: string): Promise<Buffer | null> {
    const { head } = await this.blob();
    try {
      const meta = await head(`${BLOB_CLIENT_PREFIX}/${clientId}/${name}`);
      const res = await fetch(meta.url, { cache: "no-store" });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
}

let instance: Storage | null = null;

export function getStorage(): Storage {
  if (!instance) {
    // BLOB_READ_WRITE_TOKEN is the legacy static credential; a store connected
    // via the newer "Connect Project" flow instead sets BLOB_STORE_ID and the
    // SDK resolves auth from the runtime-injected VERCEL_OIDC_TOKEN.
    const blobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
    instance = blobConfigured ? new BlobStorage() : new LocalStorage();
  }
  return instance;
}
