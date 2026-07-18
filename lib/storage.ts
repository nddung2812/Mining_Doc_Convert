import fs from "fs";
import path from "path";
import type { ClientRecord, RunRecord, TemplateBuildRecord } from "./types";

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
  saveBuild(build: TemplateBuildRecord): Promise<void>;
  getBuild(id: string): Promise<TemplateBuildRecord | null>;
  listBuilds(): Promise<TemplateBuildRecord[]>;
  saveBuildFile(buildId: string, name: string, data: Buffer): Promise<void>;
  getBuildFile(buildId: string, name: string): Promise<Buffer | null>;
  /** Remove a client record and every file under it (templates, materials, studio docs). */
  deleteClient(id: string): Promise<void>;
  /** Remove a build record and its material/template files. */
  deleteBuild(id: string): Promise<void>;
  /** App-wide state files (e.g. the daily spend ledger), not tied to a record. */
  saveStateFile(name: string, data: Buffer): Promise<void>;
  getStateFile(name: string): Promise<Buffer | null>;
}

const DATA_DIR = path.join(process.cwd(), "data", "runs");
const CLIENTS_DIR = path.join(process.cwd(), "data", "clients");
const BUILDS_DIR = path.join(process.cwd(), "data", "builds");
const STATE_DIR = path.join(process.cwd(), "data", "state");

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

  private buildDir(buildId: string): string {
    if (!/^[a-z0-9-]+$/.test(buildId)) throw new Error("Invalid build id");
    return path.join(BUILDS_DIR, buildId);
  }

  async saveBuild(build: TemplateBuildRecord): Promise<void> {
    const dir = this.buildDir(build.id);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, "build.json"), JSON.stringify(build, null, 2));
  }

  async getBuild(id: string): Promise<TemplateBuildRecord | null> {
    try {
      const raw = await fs.promises.readFile(path.join(this.buildDir(id), "build.json"), "utf8");
      return JSON.parse(raw) as TemplateBuildRecord;
    } catch {
      return null;
    }
  }

  async listBuilds(): Promise<TemplateBuildRecord[]> {
    let ids: string[];
    try {
      ids = await fs.promises.readdir(BUILDS_DIR);
    } catch {
      return [];
    }
    const builds = await Promise.all(ids.map((id) => this.getBuild(id)));
    return builds
      .filter((b): b is TemplateBuildRecord => b !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveBuildFile(buildId: string, name: string, data: Buffer): Promise<void> {
    const dir = this.buildDir(buildId);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, path.basename(name)), data);
  }

  async getBuildFile(buildId: string, name: string): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(path.join(this.buildDir(buildId), path.basename(name)));
    } catch {
      return null;
    }
  }

  async deleteClient(id: string): Promise<void> {
    await fs.promises.rm(this.clientDir(id), { recursive: true, force: true });
  }

  async deleteBuild(id: string): Promise<void> {
    await fs.promises.rm(this.buildDir(id), { recursive: true, force: true });
  }

  async saveStateFile(name: string, data: Buffer): Promise<void> {
    await fs.promises.mkdir(STATE_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(STATE_DIR, path.basename(name)), data);
  }

  async getStateFile(name: string): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(path.join(STATE_DIR, path.basename(name)));
    } catch {
      return null;
    }
  }
}

const BLOB_PREFIX = "mdocconvert/runs";
const BLOB_CLIENT_PREFIX = "mdocconvert/clients";
const BLOB_BUILD_PREFIX = "mdocconvert/builds";
const BLOB_STATE_PREFIX = "mdocconvert/state";

/**
 * Everything here is client compliance content, so blobs are stored PRIVATE:
 * no public URL, every read authorized through the SDK with the store
 * credential. Blobs written by pre-private versions of the app stay public
 * until overwritten — rewrite or delete them when upgrading a real deployment.
 */
class BlobStorage implements Storage {
  private async blob() {
    return import("@vercel/blob");
  }

  private async write(pathname: string, data: Buffer | string, contentType?: string): Promise<void> {
    const { put } = await this.blob();
    await put(pathname, data, {
      access: "private",
      ...(contentType ? { contentType } : {}),
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  /** `useCache: false` because records are overwritten in place and a stale
   *  CDN copy would corrupt the run/build state machines. */
  private async read(pathname: string): Promise<Buffer | null> {
    const { get } = await this.blob();
    try {
      const result = await get(pathname, { access: "private", useCache: false });
      if (!result || !result.stream) return null;
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    } catch {
      return null;
    }
  }

  private async readJson<T>(pathname: string): Promise<T | null> {
    const buf = await this.read(pathname);
    if (!buf) return null;
    try {
      return JSON.parse(buf.toString("utf8")) as T;
    } catch {
      return null;
    }
  }

  private async listJson<T>(prefix: string, filename: string): Promise<T[]> {
    const { list } = await this.blob();
    const { blobs } = await list({ prefix: `${prefix}/` });
    const records = await Promise.all(
      blobs.filter((b) => b.pathname.endsWith(`/${filename}`)).map((b) => this.readJson<T>(b.pathname)),
    );
    return records.filter((r): r is Awaited<T> => r !== null);
  }

  async saveRun(run: RunRecord): Promise<void> {
    await this.write(`${BLOB_PREFIX}/${run.id}/run.json`, JSON.stringify(run), "application/json");
  }

  async getRun(id: string): Promise<RunRecord | null> {
    return this.readJson<RunRecord>(`${BLOB_PREFIX}/${id}/run.json`);
  }

  async listRuns(): Promise<RunRecord[]> {
    const runs = await this.listJson<RunRecord>(BLOB_PREFIX, "run.json");
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveFile(runId: string, name: string, data: Buffer): Promise<void> {
    await this.write(`${BLOB_PREFIX}/${runId}/${name}`, data);
  }

  async getFile(runId: string, name: string): Promise<Buffer | null> {
    return this.read(`${BLOB_PREFIX}/${runId}/${name}`);
  }

  async saveClient(client: ClientRecord): Promise<void> {
    await this.write(`${BLOB_CLIENT_PREFIX}/${client.id}/client.json`, JSON.stringify(client), "application/json");
  }

  async getClient(id: string): Promise<ClientRecord | null> {
    return this.readJson<ClientRecord>(`${BLOB_CLIENT_PREFIX}/${id}/client.json`);
  }

  async listClients(): Promise<ClientRecord[]> {
    const clients = await this.listJson<ClientRecord>(BLOB_CLIENT_PREFIX, "client.json");
    return clients.sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveClientFile(clientId: string, name: string, data: Buffer): Promise<void> {
    await this.write(`${BLOB_CLIENT_PREFIX}/${clientId}/${name}`, data);
  }

  async getClientFile(clientId: string, name: string): Promise<Buffer | null> {
    return this.read(`${BLOB_CLIENT_PREFIX}/${clientId}/${name}`);
  }

  async saveBuild(build: TemplateBuildRecord): Promise<void> {
    await this.write(`${BLOB_BUILD_PREFIX}/${build.id}/build.json`, JSON.stringify(build), "application/json");
  }

  async getBuild(id: string): Promise<TemplateBuildRecord | null> {
    return this.readJson<TemplateBuildRecord>(`${BLOB_BUILD_PREFIX}/${id}/build.json`);
  }

  async listBuilds(): Promise<TemplateBuildRecord[]> {
    const builds = await this.listJson<TemplateBuildRecord>(BLOB_BUILD_PREFIX, "build.json");
    return builds.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveBuildFile(buildId: string, name: string, data: Buffer): Promise<void> {
    await this.write(`${BLOB_BUILD_PREFIX}/${buildId}/${name}`, data);
  }

  async getBuildFile(buildId: string, name: string): Promise<Buffer | null> {
    return this.read(`${BLOB_BUILD_PREFIX}/${buildId}/${name}`);
  }

  private async deletePrefix(prefix: string): Promise<void> {
    const { list, del } = await this.blob();
    const { blobs } = await list({ prefix });
    if (blobs.length > 0) await del(blobs.map((b) => b.url));
  }

  async deleteClient(id: string): Promise<void> {
    await this.deletePrefix(`${BLOB_CLIENT_PREFIX}/${id}/`);
  }

  async deleteBuild(id: string): Promise<void> {
    await this.deletePrefix(`${BLOB_BUILD_PREFIX}/${id}/`);
  }

  async saveStateFile(name: string, data: Buffer): Promise<void> {
    await this.write(`${BLOB_STATE_PREFIX}/${name}`, data);
  }

  async getStateFile(name: string): Promise<Buffer | null> {
    return this.read(`${BLOB_STATE_PREFIX}/${name}`);
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
