import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface TokenRecord {
  name: string;
  hash: string;
  /** Action patterns this token may call, e.g. ["*"] or ["dom.snapshot", "tabs.*"]. */
  grants: string[];
  createdAt: number;
}

export interface DeviceRecord {
  id: string;
  name: string;
  hash: string;
  createdAt: number;
  lastSeen?: number;
}

interface Data {
  version: 1;
  /** Kept in clear so `extension-use-relay` can show it again; the data file is private to the user. */
  ownerToken: string;
  tokens: TokenRecord[];
  devices: DeviceRecord[];
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = (prefix: string) => `${prefix}_${randomBytes(24).toString("base64url")}`;
export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString("hex")}`;

/** A tiny JSON-file store (or in memory when `file` is undefined). Single process only. */
export class Store {
  private data: Data;

  constructor(private readonly file?: string) {
    this.data = this.load();
  }

  private load(): Data {
    if (this.file) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Data;
        if (parsed.version === 1) return parsed;
      } catch {
        /* first run */
      }
    }
    const fresh: Data = { version: 1, ownerToken: newToken("eu_own"), tokens: [], devices: [] };
    this.data = fresh;
    this.save();
    return fresh;
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  get ownerToken() {
    return this.data.ownerToken;
  }

  /** Resolve a controller token: the owner token has every grant. */
  controllerFor(token: string): { name: string; grants: string[]; owner: boolean } | undefined {
    if (token === this.data.ownerToken) return { name: "owner", grants: ["*"], owner: true };
    const hash = hashToken(token);
    const t = this.data.tokens.find((x) => x.hash === hash);
    return t ? { name: t.name, grants: t.grants, owner: false } : undefined;
  }

  createToken(name: string, grants: string[]): string {
    if (!/^[\w.-]{1,64}$/.test(name)) throw new Error("Token names use letters, digits, '.', '_' and '-' (max 64)");
    if (name === "owner" || this.data.tokens.some((t) => t.name === name)) throw new Error(`A token named "${name}" already exists`);
    const token = newToken("eu_ctl");
    this.data.tokens.push({ name, hash: hashToken(token), grants: grants.length ? grants : ["*"], createdAt: Date.now() });
    this.save();
    return token;
  }

  listTokens() {
    return this.data.tokens.map(({ name, grants, createdAt }) => ({ name, grants, createdAt }));
  }

  revokeToken(name: string): boolean {
    const before = this.data.tokens.length;
    this.data.tokens = this.data.tokens.filter((t) => t.name !== name);
    this.save();
    return this.data.tokens.length < before;
  }

  addDevice(name: string): { device: DeviceRecord; token: string } {
    const token = newToken("eu_dev");
    const device: DeviceRecord = { id: newId("dev"), name, hash: hashToken(token), createdAt: Date.now() };
    this.data.devices.push(device);
    this.save();
    return { device, token };
  }

  deviceForToken(token: string): DeviceRecord | undefined {
    const hash = hashToken(token);
    return this.data.devices.find((d) => d.hash === hash);
  }

  listDevices() {
    return this.data.devices.map(({ id, name, createdAt, lastSeen }) => ({ id, name, createdAt, ...(lastSeen ? { lastSeen } : {}) }));
  }

  touchDevice(id: string) {
    const d = this.data.devices.find((x) => x.id === id);
    if (d) {
      d.lastSeen = Date.now();
      this.save();
    }
  }

  removeDevice(id: string): boolean {
    const before = this.data.devices.length;
    this.data.devices = this.data.devices.filter((d) => d.id !== id);
    this.save();
    return this.data.devices.length < before;
  }
}
