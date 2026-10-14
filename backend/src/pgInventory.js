/**
 * PostgreSQL inventory service.
 *
 * PostgreSQL is the source of truth for quantity comparisons. A detection
 * update and its audit log entry are committed atomically.
 */
const { pool, query } = require("./db");

async function loadCache() {
  const result = await query("SELECT COUNT(*)::int AS count FROM inventory");
  console.log(`[PG-INV] Verified ${result[0].count} inventory rows`);
}

async function upsertDetection(perProduct) {
  if (!perProduct || typeof perProduct !== "object" || Array.isArray(perProduct)) {
    throw new TypeError("per_product must be an object of product names and quantities");
  }

  const entries = Object.entries(perProduct).map(([className, rawQty]) => {
    const quantity = Number(rawQty);
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new TypeError(`Invalid quantity for ${className}: expected a non-negative integer`);
    }
    return [className, quantity];
  });

  const client = await pool.connect();
  const changed = [];
  const unknown = [];

  try {
    await client.query("BEGIN");

    const products = await client.query(
      "SELECT class_name FROM products WHERE class_name = ANY($1::text[])",
      [entries.map(([className]) => className)]
    );
    const known = new Set(products.rows.map((row) => row.class_name));
    for (const [className] of entries) {
      if (!known.has(className)) unknown.push(className);
    }

    for (const [className, quantity] of entries) {
      if (!known.has(className)) continue;

      const result = await client.query(
        `WITH updated AS (
           UPDATE inventory i
           SET quantity = $1, updated_at = NOW()
           FROM products p
           WHERE p.id = i.product_id
             AND p.class_name = $2
             AND i.quantity IS DISTINCT FROM $1
           RETURNING p.id AS product_id, p.class_name, i.quantity, i.updated_at
         ),
         logged AS (
           INSERT INTO detection_logs (product_id, quantity, detected_at)
           SELECT product_id, quantity, updated_at
           FROM updated
           RETURNING product_id
         )
         SELECT updated.class_name
         FROM updated
         JOIN logged USING (product_id)`,
        [quantity, className]
      );

      if (result.rows.length) {
        changed.push(className);
      }
    }

    const snapshot = await client.query(`
      SELECT
        p.id              AS product_id,
        p.class_id,
        p.class_name,
        p.product_name,
        p.category,
        i.quantity,
        i.updated_at
      FROM inventory i
      JOIN products p ON p.id = i.product_id
      ORDER BY p.class_id
    `);

    await client.query("COMMIT");
    return { changed, unknown, snapshot: snapshot.rows };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getInventorySnapshot() {
  return query(`
    SELECT
      p.id              AS product_id,
      p.class_id,
      p.class_name,
      p.product_name,
      p.category,
      i.quantity,
      i.updated_at
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    ORDER BY p.class_id
  `);
}

async function getProductInventory(className) {
  const rows = await query(
    `SELECT
      p.id AS product_id, p.class_id, p.class_name, p.product_name,
      p.category, i.quantity, i.updated_at
     FROM inventory i
     JOIN products p ON p.id = i.product_id
     WHERE p.class_name = $1`,
    [className]
  );
  return rows[0] || null;
}

async function getDetectionLogs(limit = 100) {
  return query(
    `SELECT
      dl.id, dl.quantity, dl.detected_at,
      p.class_name, p.product_name
     FROM detection_logs dl
     JOIN products p ON p.id = dl.product_id
     ORDER BY dl.detected_at DESC
     LIMIT $1`,
    [limit]
  );
}

module.exports = {
  loadCache,
  upsertDetection,
  getInventorySnapshot,
  getProductInventory,
  getDetectionLogs,
};
