// Dev server for the example controller app.
//   http://localhost:5173/          the controller app (framed by the extension, or opened directly)
//   http://127.0.0.1:5174/fixtures/  test pages on a second origin, for the controller to drive
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "dist");
const { id } = JSON.parse(await readFile(join(here, "../basic-extension/dev-key.json"), "utf8"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

function handler(req, res) {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__cookies") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(req.headers.cookie ?? "");
    return;
  }
  const rel = normalize(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)).replace(/^([/\\])+/, "");
  const file = join(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  readFile(file).then(
    (body) => {
      res.writeHead(200, {
        "content-type": types[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
        // Only our own extension may frame the app.
        "content-security-policy": `frame-ancestors 'self' chrome-extension://${id}`,
      });
      res.end(body);
    },
    () => res.writeHead(404).end("not found"),
  );
}

for (const [host, port] of [["localhost", 5173], ["127.0.0.1", 5174]]) {
  createServer(handler).listen(port, host, () => console.log(`serving ${root} on http://${host}:${port}`));
}
