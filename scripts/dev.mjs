import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const nextCli = path.join(rootDir, "node_modules", "next", "dist", "bin", "next");
const serialBridge = path.join(rootDir, "serial-agent", "server.mjs");

function startNodeScript(script, args = []) {
  return spawn(process.execPath, [script, ...args], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
    windowsHide: false,
  });
}

// Jalankan file JavaScript langsung dengan node.exe. Jangan spawn npm.cmd,
// karena .cmd tidak dapat dieksekusi langsung tanpa shell pada Windows modern.
const children = [
  startNodeScript(nextCli, ["dev"]),
  startNodeScript(serialBridge),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill(process.platform === "win32" ? undefined : "SIGTERM");
    }
  }

  setTimeout(() => process.exit(code), 300).unref();
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!stopping && typeof code === "number" && code !== 0) stop(code);
  });

  child.on("error", (error) => {
    console.error("Gagal menjalankan proses aplikasi:", error);
    stop(1);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
