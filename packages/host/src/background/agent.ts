/**
 * "Connect an agent": no relay and no setup beyond pasting instructions.
 *
 * The person turns it on in the control panel and copies the instructions
 * into their coding agent or local model. The instructions start
 * `@extension-use/mcp` with an agent key; that server listens on 127.0.0.1,
 * and this extension dials the known local ports and proves it holds the
 * same key (see AGENT_PATH in @extension-use/protocol/remote).
 *
 * The extension only ever dials 127.0.0.1, so the key is useless to anyone
 * who can't run code on this computer.
 */
import { AGENT_PATH, AGENT_PORTS, isAgentKey, newAgentKey } from "@extension-use/protocol/remote";
import { createRemoteLink, type RemoteLink } from "./remote-link.js";
import type { Router } from "./router.js";

export interface AgentConfig {
  /** Action patterns agents may call. Default: every action. */
  grants?: "all" | string[];
  /** Local ports to dial. Default: AGENT_PORTS (47821–47825). Must match the MCP server's. */
  ports?: readonly number[];
  /** Name of the MCP server in the instructions. Default "browser". */
  serverName?: string;
}

export interface AgentUiState {
  enabled: boolean;
  /** The key and the instructions to paste into an agent (only while enabled). */
  key?: string;
  instructions?: string;
  /** Agents connected right now, by the name their MCP client reported. */
  agents: string[];
}

const STORAGE_KEY = "extensionUse.agent";
const ALARM = "extension-use-agent";

/** The text the person pastes into an agent. */
export function agentInstructions(key: string, opts: { hostName?: string; serverName?: string } = {}): string {
  const name = opts.serverName ?? "browser";
  const config = JSON.stringify(
    { mcpServers: { [name]: { command: "npx", args: ["-y", "@extension-use/mcp"], env: { EXTENSION_USE_AGENT_KEY: key } } } },
    null,
    2,
  );
  return `Connect to my browser${opts.hostName ? ` through the "${opts.hostName}" extension` : ""}. Add this MCP server to your MCP configuration, then use its tools to read and act in my browser:

${config}

For Claude Code, run:
claude mcp add ${name} -e EXTENSION_USE_AGENT_KEY=${key} -- npx -y @extension-use/mcp

The server listens on 127.0.0.1 only, and my browser connects to it by itself within about 30 seconds. If the tools say the browser isn't connected yet, wait a little and try again.
Start with tabs_list or dom_snapshot. It's my real browser, signed in as me: don't close tabs or submit forms I didn't ask for. If a tool says control is paused, stop and ask me.`;
}

export function setupAgent(router: Router, config: AgentConfig, hostName: string | undefined, onChange: () => void, log: (...a: unknown[]) => void) {
  const grants = config.grants === undefined || config.grants === "all" ? ["*"] : config.grants;
  const ports = config.ports ?? AGENT_PORTS;
  let key: string | undefined;
  let links: RemoteLink[] = [];

  function stopLinks() {
    for (const l of links) l.stop();
    links = [];
  }

  function startLinks(k: string) {
    stopLinks();
    links = ports.map((port) => {
      const link = createRemoteLink({
        relay: `http://127.0.0.1:${port}`,
        url: `ws://127.0.0.1:${port}${AGENT_PATH}`,
        agentKey: k,
        transport: "agent",
        router,
        grants,
        // Nobody may be listening yet: keep checking, gently.
        backoff: [2_000, 5_000, 15_000, 30_000],
        onState: onChange,
        log,
      });
      link.start();
      return link;
    });
  }

  const ready = chrome.storage.local.get(STORAGE_KEY).then((r) => {
    const saved = r[STORAGE_KEY] as { key?: string } | undefined;
    if (saved?.key && isAgentKey(saved.key)) {
      key = saved.key;
      startLinks(key);
    }
    onChange();
  });

  // A stopped service worker loses its sockets and timers; the alarm wakes it to look for agents again.
  chrome.alarms?.create(ALARM, { periodInMinutes: 0.5 });
  chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void ready.then(() => links.forEach((l) => l.poke()));
  });

  async function setKey(k: string | undefined) {
    await ready;
    key = k;
    if (k) {
      await chrome.storage.local.set({ [STORAGE_KEY]: { key: k } });
      startLinks(k);
    } else {
      await chrome.storage.local.remove(STORAGE_KEY);
      stopLinks();
    }
    onChange();
  }

  return {
    ready,
    /** Turn on with a new key. Agents holding an older key are disconnected. */
    enable: () => setKey(newAgentKey()),
    disable: () => setKey(undefined),
    state(): AgentUiState {
      const agents = router
        .sessions()
        .filter((s) => s.transport === "agent")
        .map((s) => s.origin.replace(/^agent:/, ""));
      return {
        enabled: Boolean(key),
        ...(key ? { key, instructions: agentInstructions(key, { ...(hostName ? { hostName } : {}), ...(config.serverName ? { serverName: config.serverName } : {}) }) } : {}),
        agents,
      };
    },
  };
}
