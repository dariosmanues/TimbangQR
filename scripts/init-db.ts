import { closeDatabase, dbOne, ensureDatabase } from "../src/lib/db";

async function main() {
  await ensureDatabase();
  const status = await dbOne<{ users: number; vehicles: number; weighings: number }>(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM vehicles) AS vehicles,
      (SELECT COUNT(*)::int FROM weighings) AS weighings
  `);
  console.log("PostgreSQL siap:", status);
}

main()
  .catch((error) => {
    console.error("Inisialisasi PostgreSQL gagal:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
