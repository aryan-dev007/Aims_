/**
 * PostgreSQL inventory service.
 *
 * Handles upserting detection results into PostgreSQL with change-detection
 * logic: a product's quantity is only updated when the new value differs from
 * the current stored value. This prevents frame-by-frame duplicate writes
 * (e.g. seeing Maggi=5 on 100 consecutive frames writes only once).
 *
 * Detection logs are recorded only when a quantity actually changes, providing
 * a clean audit trail.
 */
const { query } = require("./db");

// In-memory cache of the last-written quantities so we can skip
// no-change writes without hitting the DB every frame.
const _quantityCache = new Map(); // class_name -> quantity

/**
 * Load the current inventory from PostgreSQL into the in-memory cache.
 * Called once at startup.
 */
async function loadCache() {
  try {
    const rows = await query(`
      SELECT p.class_name, i.quantity
      FROM inventory i
      JOIN products p ON p.id = i.product_id
    `);
    for (const row of rows) {
      _quantityCache.set(row.class_name, row.quantity);
    }
    console.log(`[PG-INV] Cache loaded with ${_quantityCache.size} products`);
  } catch (err) {
    console.error("[PG-INV] Failed to load cache:", err.message);
  }
}

/**
 * Upsert a detection payload into PostgreSQL.
 *
 * @param {Record<string, number>} perProduct  { "Maggi Noodles": 5, "Lays masala chips": 7, … }
 * @returns {{ changed: string[], snapshot: Array<{class_name, quantity, updated_at}> }}
 */
async function upsertDetection(perProduct) {
  const changed = [];
  const now = new Date();

  for (const [className, rawQty] of Object.entries(perProduct)) {
    const qty = Math.floor(Number(rawQty));
    if (!Number.isFinite(qty) || qty < 0) continue;

    // Skip if the quantity hasn't changed (prevents duplicate writes from
    // seeing the same frame repeatedly).
    const cached = _quantityCache.get(className);
    if (cached !== undefined && cached === qty) continue;

    try {
      // Get the product id for this class_name
      const productRows = await query(
        "SELECT id FROM products WHERE class_name = $1",
        [className]
      );
      if (productRows.length === 0) {
        // Unknown class — skip silently (don't create phantom products)
        continue;
      }
      const productId = productRows[0].id;

      // Update inventory
      await query(
        `UPDATE inventory
         SET quantity = $1, updated_at = $2
         WHERE product_id = $3`,
        [qty, now, productId]
      );

      // Log the change
      await query(
        `INSERT INTO detection_logs (product_id, quantity, detected_at)
         VALUES ($1, $2, $3)`,
        [productId, qty, now]
      );

      _quantityCache.set(className, qty);
      changed.push(className);
    } catch (err) {
      console.error(`[PG-INV] Error upserting ${className}:`, err.message);
    }
  }

  // Return a snapshot of the full current inventory (for broadcasting)
  const snapshot = await getInventorySnapshot();
  return { changed, snapshot };
}

/**
 * Return the full current inventory as an array.
 */
async function getInventorySnapshot() {
  try {
    const rows = await query(`
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
    return rows;
  } catch (err) {
    console.error("[PG-INV] Snapshot query failed:", err.message);
    return [];
  }
}

/**
 * Return a single product's inventory info.
 */
async function getProductInventory(className) {
  try {
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
  } catch (err) {
    console.error("[PG-INV] Product query failed:", err.message);
    return null;
  }
}

/**
 * Return recent detection logs, newest first.
 */
async function getDetectionLogs(limit = 100) {
  try {
    const rows = await query(
      `SELECT
        dl.id, dl.quantity, dl.detected_at,
        p.class_name, p.product_name
       FROM detection_logs dl
       JOIN products p ON p.id = dl.product_id
       ORDER BY dl.detected_at DESC
       LIMIT $1`,
      [limit]
    );
    return rows;
  } catch (err) {
    console.error("[PG-INV] Detection logs query failed:", err.message);
    return [];
  }
}

module.exports = {
  loadCache,
  upsertDetection,
  getInventorySnapshot,
  getProductInventory,
  getDetectionLogs,
};
