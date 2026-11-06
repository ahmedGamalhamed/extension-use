import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { connect } from "@extension-use/client";
import { remote } from "@extension-use/client/remote";
import { createExtensionUseMcpServer, listenForBrowser } from "@extension-use/mcp";
import { createRelay } from "@extension-use/relay";
import { FIXTURE_TARGET, expect, pairThroughControlPanel, test } from "./fixtures.js";

const textOf = (r: unknown) => ((r as { content?: { type: string; text?: string }[] }).content ?? []).map((c) => c.text ?? "").join("\n");

test("an MCP agent reads and drives the real browser through the relay", async ({ context, extensionId, fixture }) => {
  test.setTimeout(60_000);
  const relay = createRelay({ port: 0 });
  const { url } = await relay.listen();
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/control.html`);
  await pairThroughControlPanel(control, relay, url);

  const { server, close } = createExtensionUseMcpServer({ connect: () => connect(remote({ relay: url, token: relay.ownerToken })) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const mcp = new McpClient({ name: "e2e-agent", version: "1.0.0" });
  await mcp.connect(b);
  try {
    const names = (await mcp.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["dom_snapshot", "dom_click", "run_sequence", "capture_screenshot", "tabs_list"]));

    // The default snapshot is the visible part of the page, as text with refs.
    const visible = textOf(await mcp.callTool({ name: "dom_snapshot", arguments: { target: FIXTURE_TARGET } }));
    expect(visible).toContain('heading "Order form" [level=1]');
    expect(visible).not.toContain("Far away button");
    const whole = textOf(await mcp.callTool({ name: "dom_snapshot", arguments: { target: FIXTURE_TARGET, viewportOnly: false } }));
    expect(whole).toContain('button "Far away button"');
    expect(whole.length).toBeGreaterThan(visible.length);

    // Act with refs from the snapshot, several steps in one call.
    const emailRef = /textbox "Email" \[ref=(e\d+)\]/.exec(visible)![1];
    const saveRef = /button "Save draft" \[ref=(e\d+)\]/.exec(visible)![1];
    const seq = await mcp.callTool({
      name: "run_sequence",
      arguments: {
        steps: [
          { action: "dom.fill", input: { locator: { ref: emailRef }, value: "agent@example.com" }, target: FIXTURE_TARGET },
          { action: "dom.click", input: { locator: { ref: saveRef } }, target: FIXTURE_TARGET },
        ],
      },
    });
    expect(JSON.parse(textOf(seq))).toMatchObject({ completed: 2, ok: true });
    await expect(fixture.locator("#email")).toHaveValue("agent@example.com");
    await expect(fixture.locator("#status")).toHaveText("saved:false");

    // Policy still applies to agents.
    const pw = await mcp.callTool({ name: "dom_type", arguments: { locator: { css: "#password" }, text: "x", target: FIXTURE_TARGET } });
    expect(pw.isError).toBe(true);
    expect(textOf(pw)).toMatch(/^BLOCKED_BY_POLICY/);

    // Screenshots come back as images.
    await fixture.bringToFront();
    const tabs = JSON.parse(textOf(await mcp.callTool({ name: "tabs_list", arguments: {} }))) as { tabs: { id: number; url: string }[] };
    const tab = tabs.tabs.find((t) => t.url.includes("/fixtures/form.html"))!;
    await mcp.callTool({ name: "tabs_activate", arguments: { tabId: tab.id } });
    const shot = await mcp.callTool({ name: "capture_screenshot", arguments: { target: FIXTURE_TARGET } });
    expect((shot.content as { type: string; mimeType?: string }[])[0]).toMatchObject({ type: "image", mimeType: "image/png" });
  } finally {
    await mcp.close();
    await close();
    await relay.close();
  }
});

test("an agent connects with only the instructions from the control panel, no relay", async ({ context, extensionId, fixture }) => {
  test.setTimeout(60_000);
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/control.html`);
  await control.getByRole("button", { name: "Connect an agent" }).click();
  const instructions = await control.getByLabel("Instructions for your agent").inputValue();
  const key = /"EXTENSION_USE_AGENT_KEY": "(eu_agent_[\w-]+)"/.exec(instructions)![1]!;

  // What `npx -y @extension-use/mcp` does with that key: listen locally, wait for the browser.
  const local = await listenForBrowser({ key });
  const { server, close } = createExtensionUseMcpServer({ connect: () => connect(local.transport({ label: "e2e-agent", waitMs: 30_000 })) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const mcp = new McpClient({ name: "e2e-agent", version: "1.0.0" });
  await mcp.connect(b);
  try {
    const snap = textOf(await mcp.callTool({ name: "dom_snapshot", arguments: { target: FIXTURE_TARGET } }));
    expect(snap).toContain('heading "Order form" [level=1]');
    const emailRef = /textbox "Email" \[ref=(e\d+)\]/.exec(snap)![1];
    await mcp.callTool({ name: "dom_fill", arguments: { locator: { ref: emailRef }, value: "local@example.com", target: FIXTURE_TARGET } });
    await expect(fixture.locator("#email")).toHaveValue("local@example.com");

    // The panel shows the agent by name, and turning it off disconnects it.
    await expect(control.getByText("Connected: e2e-agent")).toBeVisible();
    await control.getByRole("button", { name: "Turn off" }).click();
    await expect.poll(() => local.connected).toBe(false);
    await expect(control.getByRole("button", { name: "Connect an agent" })).toBeVisible();
  } finally {
    await mcp.close();
    await close();
    await local.close();
  }
});

test("the playground in the control panel runs actions", async ({ context, extensionId, fixture }) => {
  void fixture;
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/control.html`);
  await control.getByLabel("Action").selectOption("page.info");
  await control.getByLabel("Input (JSON)").fill("{}");
  await control.getByLabel("Target tab").fill("http://127.0.0.1:5174/fixtures/*");
  await control.getByRole("button", { name: "Run" }).click();
  await expect(control.getByLabel("Result")).toContainText('"title": "Fixture: form"');

  await control.getByLabel("Action").selectOption("dom.click");
  await control.getByLabel("Input (JSON)").fill('{ "locator": { "css": "#does-not-exist" } }');
  await control.getByRole("button", { name: "Run" }).click();
  await expect(control.getByLabel("Result")).toContainText(/✖ (ELEMENT_NOT_FOUND|TIMEOUT)/, { timeout: 15_000 });
  // Its calls show up in the activity log like any controller's.
  await expect(control.getByText("control-panel").first()).toBeVisible();
});
