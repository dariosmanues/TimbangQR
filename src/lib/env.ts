import fs from "node:fs";
import path from "node:path";

let envLoaded = false;

export function loadEnvIfNeeded() {
  if (process.env.DATABASE_URL?.trim()) return;

  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(path.resolve(process.cwd(), ".env"));
    } catch {}
  }

  if (process.env.DATABASE_URL?.trim()) return;

  const candidatePaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "../../.env"),
    path.resolve(__dirname, "../../../.env"),
    "D:\\project\\TImbangan\\TimbangQR\\.env",
  ];

  for (const envPath of candidatePaths) {
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
          const index = trimmed.indexOf("=");
          const key = trimmed.slice(0, index).trim();
          let val = trimmed.slice(index + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (key && !process.env[key]) {
            process.env[key] = val;
          }
        }
        if (process.env.DATABASE_URL?.trim()) break;
      }
    } catch (error) {
      console.warn("[Env] Gagal membaca path:", envPath, error);
    }
  }
}

// Auto-run when imported
loadEnvIfNeeded();
