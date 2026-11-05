/**
 * Where a relay keeps tokens and devices, and the hooks a hosted service uses
 * for accounts, usage and plan limits. The open-source relay ships
 * LocalBackend: one implicit tenant, a JSON file, no limits.
 */
import { Store } from "./store.js";

/** Everything belongs to a tenant (an organization in a hosted relay; "local" otherwise). */
export interface Controller {
  tenant: string;
  /** Token name, shown to the extension as `relay:<name>`. */
  name: string;
  grants: string[];
  /** Can manage tokens, devices and pairings for the tenant. */
  owner: boolean;
}

export interface DeviceInfo {
  tenant: string;
  id: string;
  name: string;
  createdAt: number;
  lastSeen?: number;
}

export type UsageEvent =
  | { kind: "call"; tenant: string; controller: string; device: string; action: string; ok: boolean; code?: string; ms: number; ts: number }
  | { kind: "device.connected" | "device.disconnected"; tenant: string; device: string; ts: number };

export interface RelayBackend {
  authenticateController(token: string): Promise<Controller | undefined>;
  authenticateDevice(token: string): Promise<DeviceInfo | undefined>;

  createDevice(tenant: string, name: string): Promise<{ device: DeviceInfo; token: string }>;
  listDevices(tenant: string): Promise<DeviceInfo[]>;
  removeDevice(tenant: string, id: string): Promise<boolean>;
  touchDevice(tenant: string, id: string): Promise<void>;

  createToken(tenant: string, name: string, grants: string[]): Promise<string>;
  listTokens(tenant: string): Promise<{ name: string; grants: string[]; createdAt: number }[]>;
  revokeToken(tenant: string, name: string): Promise<boolean>;

  /**
   * Called before each call is forwarded. Throw an ExtensionUseError
   * (QUOTA_EXCEEDED, PLAN_REQUIRED, with an upgrade URL in `data`) to refuse it.
   * Keep it fast: it runs on every call.
   */
  checkCall?(controller: Controller, action: string): Promise<void> | void;
  /** Called before a pairing is approved, e.g. to enforce a device limit. */
  checkNewDevice?(tenant: string): Promise<void> | void;
  /** Usage events, for metering. Must not throw or block. Never carries payloads or page content. */
  recordUsage?(event: UsageEvent): void;
}

export const LOCAL_TENANT = "local";

/** The default backend: a single tenant in a JSON file (or memory). */
export class LocalBackend implements RelayBackend {
  readonly store: Store;

  constructor(dataFile?: string) {
    this.store = new Store(dataFile);
  }

  get ownerToken() {
    return this.store.ownerToken;
  }

  async authenticateController(token: string) {
    const c = this.store.controllerFor(token);
    return c ? { tenant: LOCAL_TENANT, ...c } : undefined;
  }

  async authenticateDevice(token: string) {
    const d = this.store.deviceForToken(token);
    return d ? { tenant: LOCAL_TENANT, id: d.id, name: d.name, createdAt: d.createdAt, ...(d.lastSeen ? { lastSeen: d.lastSeen } : {}) } : undefined;
  }

  async createDevice(_tenant: string, name: string) {
    const { device, token } = this.store.addDevice(name);
    return { device: { tenant: LOCAL_TENANT, id: device.id, name: device.name, createdAt: device.createdAt }, token };
  }

  async listDevices() {
    return this.store.listDevices().map((d) => ({ tenant: LOCAL_TENANT, ...d }));
  }

  async removeDevice(_tenant: string, id: string) {
    return this.store.removeDevice(id);
  }

  async touchDevice(_tenant: string, id: string) {
    this.store.touchDevice(id);
  }

  async createToken(_tenant: string, name: string, grants: string[]) {
    return this.store.createToken(name, grants);
  }

  async listTokens() {
    return this.store.listTokens();
  }

  async revokeToken(_tenant: string, name: string) {
    return this.store.revokeToken(name);
  }
}
