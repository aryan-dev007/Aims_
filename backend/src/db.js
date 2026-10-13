/**
 * PostgreSQL connection pool and query helper.
 *
 * Uses the `pg` driver with a connection pool. All credentials come from
 * environment variables (loaded via dotenv in server.js).
 */
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: parseInt(process.env.PGPORT, 10) || 5432,
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "aims_inventory",
  max: 10,             // max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log pool errors so they don't crash the process
pool.on("error", (err) => {
  console.error("[PG POOL] Unexpected error on idle client:", err.message);
});

/**
 * Convenience wrapper: returns rows from a parameterized query.
 * @param {string} text  SQL with $1, $2 … placeholders
 * @param {any[]}  params
 */
async function query(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

/**
 * Test the connection and return true/false.
 */
async function testConnection() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (err) {
    console.error("[PG] Connection test failed:", err.message);
    return false;
  }
}

module.exports = { pool, query, testConnection };
