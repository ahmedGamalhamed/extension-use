// Your web app, in plain JavaScript. Inside the side panel it talks to the
// extension through the frame transport; in a normal tab, the page transport.
import { connect, ExtensionUseError, frame, page } from "./vendor/extension-use-client.js";

const EXTENSION_ID = "{{extensionId}}";
const inFrame = window.parent !== window;

const status = document.querySelector("#status");
const output = document.querySelector("#output");

const show = (value) => {
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

async function run(fn) {
  try {
    show(await fn());
  } catch (err) {
    show(err instanceof ExtensionUseError ? `${err.code}: ${err.message}` : String(err));
  }
}

let ext;
try {
  ext = await connect(inFrame ? frame({ hostOrigins: [`chrome-extension://${EXTENSION_ID}`] }) : page({ extensionId: EXTENSION_ID }));
  status.textContent = `Connected (${inFrame ? "side panel" : "tab"}) · ${ext.capabilities.length} actions`;
} catch (err) {
  status.textContent = `Not connected: ${err.message}`;
  throw err;
}

document.querySelector("#snapshot").addEventListener("click", () =>
  run(async () => (await ext.dom.snapshot({ format: "text", interactiveOnly: true })).text),
);
document.querySelector("#highlight").addEventListener("click", () =>
  run(() => ext.overlay.highlight({ locator: { role: "link" }, all: true, durationMs: 3000 })),
);
document.querySelector("#pick").addEventListener("click", () =>
  run(async () => {
    const picked = await ext.picker.start({ prompt: "Click any element" });
    await ext.overlay.highlight({ locator: { ref: picked.ref }, label: picked.locator.css, durationMs: 3000 });
    return picked.locator;
  }),
);
