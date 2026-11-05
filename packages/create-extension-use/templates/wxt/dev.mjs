// Runs the web app dev server and WXT (which opens a browser with the extension) together.
import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["web/serve.mjs", "--watch"], { stdio: "inherit" }),
  spawn("npx", ["wxt"], { stdio: "inherit", shell: process.platform === "win32" }),
];
const stop = () => children.forEach((c) => c.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children) c.on("exit", stop);
