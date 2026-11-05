#!/usr/bin/env node
/**
 * npx @extension-use/relay                      start a local relay on 127.0.0.1:7777
 * npx @extension-use/relay token create <name> [--grants dom.snapshot,tabs.*]
 * npx @extension-use/relay token list | token revoke <name>
 * npx @extension-use/relay devices | unpair <deviceId>
 * npx @extension-use/relay approve <code>
 * npx @extension-use/relay owner-token
 *
 * Options: --port 7777 --host 127.0.0.1 --data ~/.extension-use/relay.json --no-prompt
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { createRelay, RELAY_VERSION } from "./server.js";
import { Store } from "./store.js";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1]!.startsWith("--") && !["--no-prompt"].includes(argv[i - 1]!)));
const [command = "serve", sub, arg] = positional;

const port = Number(flag("port") ?? process.env.EXTENSION_USE_RELAY_PORT ?? 7777);
const host = flag("host") ?? "127.0.0.1";
const dataFile = flag("data") ?? process.env.EXTENSION_USE_RELAY_DATA ?? join(homedir(), ".extension-use", "relay.json");
const base = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;

async function running(): Promise<boolean> {
  try {
    const r = await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

async function api(method: string, path: string, body?: unknown) {
  const owner = new Store(dataFile).ownerToken;
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${owner}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await r.json()) as { ok?: boolean; error?: { message: string } };
  if (!r.ok) throw new Error(json.error?.message ?? `HTTP ${r.status}`);
  return json;
}

/** Print rows with readable dates. */
function table(rows: unknown) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return console.log("(none)");
  console.table(list.map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" && /At$|^lastSeen$/.test(k) ? new Date(v).toLocaleString() : v]))));
}

function die(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function serve() {
  const interactive = process.stdin.isTTY && !argv.includes("--no-prompt");
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  let asking = Promise.resolve();

  const relay = createRelay({
    port,
    host,
    dataFile,
    log: (line) => console.log(`· ${line}`),
    onPairingRequest(p) {
      if (!rl) {
        console.log(`  approve with: npx @extension-use/relay approve ${p.code}`);
        return;
      }
      // Ask one question at a time.
      asking = asking.then(async () => {
        const answer = (await rl.question(`  "${p.name}" wants to pair. Does the extension show code ${p.code}? Approve? [y/N] `)).trim().toLowerCase();
        try {
          if (answer === "y" || answer === "yes") {
            const { deviceId } = await relay.approve(p.code);
            console.log(`  ✔ paired as ${deviceId}`);
          } else {
            relay.deny(p.code);
            console.log("  ✖ denied");
          }
        } catch (e) {
          console.log(`  ${(e as Error).message}`);
        }
      });
    },
  });

  const { url } = await relay.listen().catch((e: Error) => die(`Could not listen on ${host}:${port}: ${e.message}`));
  console.log(`Extension-use relay ${RELAY_VERSION} on ${url}
  data:        ${dataFile}
  owner token: ${relay.ownerToken}
               (full access: keep it secret; create narrower tokens with "token create")

In your extension's control panel, choose "Connect to relay" and use ${url}.
Then call it, for example:
  curl -H "Authorization: Bearer <token>" -H "content-type: application/json" \\
       -d '{"action":"page.info"}' ${url}/v1/devices/default/calls
`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.log("⚠ Listening beyond this machine. Put it behind HTTPS (a reverse proxy) before exposing it.\n");
  }
  const stop = async () => {
    rl?.close();
    await relay.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function main() {
  switch (command) {
    case "serve":
      return serve();
    case "owner-token":
      return console.log(new Store(dataFile).ownerToken);
    case "token": {
      const live = await running();
      if (sub === "create") {
        if (!arg) die("Usage: token create <name> [--grants a,b]");
        const grants = (flag("grants") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
        const token = live ? ((await api("POST", "/v1/tokens", { name: arg, grants })) as { token: string }).token : new Store(dataFile).createToken(arg, grants);
        console.log(`Token "${arg}" (${grants.join(", ")}):\n${token}\nIt is shown only once.`);
      } else if (sub === "list") {
        table(live ? await api("GET", "/v1/tokens") : new Store(dataFile).listTokens());
      } else if (sub === "revoke") {
        if (!arg) die("Usage: token revoke <name>");
        if (live) await api("DELETE", `/v1/tokens/${encodeURIComponent(arg)}`);
        else if (!new Store(dataFile).revokeToken(arg)) die(`No token "${arg}"`);
        console.log(`Revoked "${arg}"`);
      } else die("Usage: token create|list|revoke");
      return;
    }
    case "devices":
      return table((await running()) ? await api("GET", "/v1/devices") : new Store(dataFile).listDevices());
    case "unpair": {
      if (!sub) die("Usage: unpair <deviceId>");
      if (await running()) await api("DELETE", `/v1/devices/${encodeURIComponent(sub)}`);
      else if (!new Store(dataFile).removeDevice(sub)) die(`No device "${sub}"`);
      return console.log(`Unpaired ${sub}`);
    }
    case "approve": {
      if (!sub) die("Usage: approve <code>");
      if (!(await running())) die(`No relay running on ${base}`);
      const r = (await api("POST", "/v1/pairings/approve", { code: sub })) as { deviceId?: string };
      return console.log(`Paired as ${r.deviceId}`);
    }
    case "help":
    case "--help":
      return console.log("Commands: serve (default), token create|list|revoke, devices, unpair <id>, approve <code>, owner-token");
    default:
      die(`Unknown command "${command}". Try --help.`);
  }
}

main().catch((e: Error) => die(e.message));
