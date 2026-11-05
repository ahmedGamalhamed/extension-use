/**
 * Remote control through a relay, with chrome.* wiring: pairing, the saved
 * device token, alarms that wake the service worker to reconnect.
 */
import { matchAny } from "@extension-use/protocol";
import type { PairingStart, PairingStatus } from "@extension-use/protocol/remote";
import { createRemoteLink, type RemoteLink, type RemoteState } from "./remote-link.js";
import type { Router } from "./router.js";

export interface RemoteConfig {
  /** Action patterns remote controllers may call. Default: every action. Each relay token can narrow this further. */
  grants?: "all" | string[];
  /** Relays the person may pair with (URL patterns). Default: this machine (any port) and any https relay. */
  relays?: string[];
  /** Pre-filled relay URL in the control panel. Default "http://127.0.0.1:7777". */
  defaultRelay?: string;
}

export interface PairingState {
  relay: string;
  pairingId: string;
  code: string;
  expiresAt: number;
  status: "pending" | "denied" | "expired" | "error";
  error?: string;
}

export interface RemoteUiState {
  paired: boolean;
  link?: RemoteState;
  pairing?: PairingState;
  defaultRelay: string;
}

interface Saved {
  relay: string;
  deviceToken: string;
  deviceId: string;
  name: string;
}

const STORAGE_KEY = "extensionUse.remote";
const ALARM = "extension-use-remote";
const DEFAULT_RELAYS = ["http://127.0.0.1:*", "http://localhost:*", "https://*"];

export function setupRemote(router: Router, config: RemoteConfig, onChange: () => void, log: (...a: unknown[]) => void) {
  const grants = config.grants === undefined || config.grants === "all" ? ["*"] : config.grants;
  const relays = config.relays ?? DEFAULT_RELAYS;
  const defaultRelay = config.defaultRelay ?? "http://127.0.0.1:7777";
  let link: RemoteLink | undefined;
  let saved: Saved | undefined;
  let pairing: PairingState | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;

  function startLink(s: Saved) {
    link?.stop();
    link = createRemoteLink({ relay: s.relay, deviceToken: s.deviceToken, router, grants, onState: onChange, log });
    link.start();
  }

  const ready = chrome.storage.local.get(STORAGE_KEY).then((r) => {
    saved = r[STORAGE_KEY] as Saved | undefined;
    if (saved) startLink(saved);
    onChange();
  });

  // A killed service worker loses its socket; the alarm wakes it to reconnect.
  chrome.alarms?.create(ALARM, { periodInMinutes: 1 });
  chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void ready.then(() => link?.poke());
  });

  function normalize(relay: string) {
    const url = new URL(relay);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Use an http(s) relay URL");
    const base = url.origin;
    if (!matchAny(relays, `${base}/`) && !matchAny(relays, base)) throw new Error(`This extension doesn't allow the relay ${base}`);
    return base;
  }

  async function pair(relayInput: string, name: string) {
    stopPolling();
    const relay = normalize(relayInput);
    const res = await fetch(`${relay}/v1/pairings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name || "Browser" }) });
    if (!res.ok) throw new Error(`The relay answered ${res.status}`);
    const start = (await res.json()) as PairingStart;
    pairing = { relay, ...start, status: "pending" };
    onChange();
    poll = setInterval(() => void checkPairing(), 1500);
  }

  async function checkPairing() {
    if (!pairing || pairing.status !== "pending") return stopPolling();
    try {
      const res = await fetch(`${pairing.relay}/v1/pairings/${pairing.pairingId}`);
      const status = (await res.json()) as PairingStatus;
      if (status.status === "approved") {
        saved = { relay: pairing.relay, deviceToken: status.deviceToken, deviceId: status.deviceId, name: status.name };
        await chrome.storage.local.set({ [STORAGE_KEY]: saved });
        pairing = undefined;
        stopPolling();
        startLink(saved);
      } else if (status.status !== "pending") {
        pairing = { ...pairing, status: status.status };
        stopPolling();
      } else if (Date.now() > pairing.expiresAt) {
        pairing = { ...pairing, status: "expired" };
        stopPolling();
      }
    } catch (e) {
      if (pairing) pairing = { ...pairing, status: "error", error: String((e as Error).message ?? e) };
      stopPolling();
    }
    onChange();
  }

  function stopPolling() {
    clearInterval(poll);
    poll = undefined;
  }

  return {
    ready,
    pair,
    cancelPairing() {
      stopPolling();
      pairing = undefined;
      onChange();
    },
    async unpair() {
      link?.stop();
      link = undefined;
      saved = undefined;
      await chrome.storage.local.remove(STORAGE_KEY);
      onChange();
    },
    reconnect() {
      link?.poke();
    },
    state(): RemoteUiState {
      return {
        paired: Boolean(saved),
        ...(link ? { link: link.state } : {}),
        ...(pairing ? { pairing } : {}),
        defaultRelay,
      };
    },
  };
}
