// Your web app. Inside the side panel it talks to the extension through the
// frame transport; opened in a normal tab it uses the page transport.
import { connect, ExtensionUseError, type Client } from "@extension-use/client";
import { frame } from "@extension-use/client/frame";
import { page } from "@extension-use/client/page";

const EXTENSION_ID = "{{extensionId}}";
const inFrame = window.parent !== window;

const status = document.querySelector<HTMLElement>("#status")!;
const output = document.querySelector<HTMLElement>("#output")!;

const show = (value: unknown) => {
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

async function run(fn: () => Promise<unknown>) {
  try {
    show(await fn());
  } catch (err) {
    show(err instanceof ExtensionUseError ? `${err.code}: ${err.message}` : String(err));
  }
}

let ext: Client;
try {
  ext = await connect(inFrame ? frame({ hostOrigins: [`chrome-extension://${EXTENSION_ID}`] }) : page({ extensionId: EXTENSION_ID }));
  status.textContent = `Connected (${inFrame ? "side panel" : "tab"}) · ${ext.capabilities.length} actions`;
} catch (err) {
  status.textContent = `Not connected: ${(err as Error).message}`;
  throw err;
}

document.querySelector("#snapshot")!.addEventListener("click", () =>
  run(async () => (await ext.dom.snapshot({ format: "text", interactiveOnly: true })).text),
);
document.querySelector("#highlight")!.addEventListener("click", () =>
  run(() => ext.overlay.highlight({ locator: { role: "link" }, all: true, durationMs: 3000 })),
);
document.querySelector("#pick")!.addEventListener("click", () =>
  run(async () => {
    const picked = await ext.picker.start({ prompt: "Click any element" });
    await ext.overlay.highlight({ locator: { ref: picked.ref }, label: picked.locator.css, durationMs: 3000 });
    return picked.locator;
  }),
);
