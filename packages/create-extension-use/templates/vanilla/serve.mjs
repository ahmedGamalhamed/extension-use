// Serves web/ on {{controllerUrl}} with no dependencies.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve("web");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const file = join(root, normalize(decodeURIComponent(path === "/" ? "/index.html" : path)));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
      // Only your extension may frame the app.
      "content-security-policy": "frame-ancestors 'self' chrome-extension://{{extensionId}}",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen({{port}}, "{{controllerHost}}", () => console.log("web app: {{controllerUrl}}\nLoad ./extension in chrome://extensions (Developer mode → Load unpacked)."));
