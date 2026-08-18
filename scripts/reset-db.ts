import { closeDatabase, ensureDatabase, getPool } from "../src/lib/db";

async function main() {
  if (process.env.ALLOW_DB_RESET !== "true") {
    throw new Error("Reset diblokir. Jalankan dengan ALLOW_DB_RESET=true hanya untuk database pengujian.");
  }

  const pool = getPool();
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  globalThis.__timbangInitPromise = undefined;
  await ensureDatabase();
  console.log("Database PostgreSQL berhasil di-reset dan di-seed ulang.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
