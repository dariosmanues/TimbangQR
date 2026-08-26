import { Pool, type QueryResultRow } from "pg";

declare global {
  var __timbangPreviewPool: Pool | undefined;
}

export function isVercelPreview() {
  return (process.env.VERCEL_ENV || "").trim().toLowerCase() === "preview";
}

function isSslEnabled() {
  const value = (process.env.DATABASE_SSL || "false").trim().toLowerCase();
  return ["1", "true", "yes", "require"].includes(value);
}

function getPreviewPool() {
  if (globalThis.__timbangPreviewPool) return globalThis.__timbangPreviewPool;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL belum tersedia untuk Vercel Preview.");
  }

  globalThis.__timbangPreviewPool = new Pool({
    connectionString,
    ssl: isSslEnabled() ? { rejectUnauthorized: false } : undefined,
    max: 2,
    idleTimeoutMillis: 15_000,
    connectionTimeoutMillis: 10_000,
    application_name: "timbangqr-preview-readonly",
  });
  return globalThis.__timbangPreviewPool;
}

export async function previewDbQuery<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
  if (!/^\s*SELECT\b/i.test(sql)) {
    throw new Error("Preview database hanya mengizinkan SELECT.");
  }
  const result = await getPreviewPool().query<T>(sql, params);
  return result.rows;
}

export async function previewDbOne<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
  const rows = await previewDbQuery<T>(sql, params);
  return rows[0] ?? null;
}
