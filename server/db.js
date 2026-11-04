import pg from "pg";
export function createDatabase(config) {
  const { schema, ...options } = config;
  const pool = new pg.Pool({
    ...options,
    max: 8,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 7000,
    query_timeout: 15000,
    options: `-c search_path=${schema},pg_catalog -c default_transaction_read_only=on -c timezone=UTC`,
    application_name: "cashpay-admin-readonly",
  });
  pool.on("error", (error) =>
    console.error("[database]", error.code || "unavailable"),
  );
  return pool;
}
export async function readSnapshot(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL lock_timeout='3s'");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
export async function optionalSection(client, work) {
  await client.query("SAVEPOINT optional_section");
  try {
    const rows = await work();
    await client.query("RELEASE SAVEPOINT optional_section");
    return { available: true, rows };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT optional_section");
    await client.query("RELEASE SAVEPOINT optional_section");
    if (!["42P01", "42703"].includes(error.code)) throw error;
    return {
      available: false,
      rows: [],
      error: "Schéma de ce service indisponible.",
      code: error.code,
    };
  }
}
