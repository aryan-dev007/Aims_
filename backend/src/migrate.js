/**
 * Database migration / initialisation script for the AIMS PostgreSQL integration.
 *
 * Creates the `products`, `inventory`, and `detection_logs` tables, required
 * indexes, and seeds the 20 YOLO product classes.
 *
 * Safe to run multiple times — uses IF NOT EXISTS and ON CONFLICT DO NOTHING
 * for idempotency.
 *
 * Usage:
 *   node src/migrate.js
 */
require("dotenv").config();
const { pool, testConnection } = require("./db");

// The 20 YOLO classes from data.yaml. class_id is the YOLO index.
const PRODUCT_CLASSES = [
  { class_id: 0,  class_name: "Coca cola cold drink",     product_name: "Coca Cola Cold Drink",       category: "Beverages" },
  { class_id: 1,  class_name: "Oreo biscuit",             product_name: "Oreo Biscuit",               category: "Biscuits" },
  { class_id: 2,  class_name: "Lipton tea",               product_name: "Lipton Tea",                 category: "Tea & Coffee" },
  { class_id: 3,  class_name: "Lays masala chips",        product_name: "Lays Masala Chips",           category: "Snacks" },
  { class_id: 4,  class_name: "Fanta cold drink",         product_name: "Fanta Cold Drink",            category: "Beverages" },
  { class_id: 5,  class_name: "Soap bar",                 product_name: "Soap Bar",                    category: "Personal Care" },
  { class_id: 6,  class_name: "Colgate Paste",            product_name: "Colgate Paste",               category: "Personal Care" },
  { class_id: 7,  class_name: "Britannia biscuits",       product_name: "Britannia Biscuits",          category: "Biscuits" },
  { class_id: 8,  class_name: "Cadbury chocolate",        product_name: "Cadbury Chocolate",           category: "Chocolates" },
  { class_id: 9,  class_name: "Nescafe coffee",           product_name: "Nescafe Coffee",              category: "Tea & Coffee" },
  { class_id: 10, class_name: "RedLabel Tea",             product_name: "Red Label Tea",               category: "Tea & Coffee" },
  { class_id: 11, class_name: "Maggi Noodles",            product_name: "Maggi Noodles",               category: "Instant Food" },
  { class_id: 12, class_name: "Chings Schezwan Chutney",  product_name: "Chings Schezwan Chutney",     category: "Sauces & Condiments" },
  { class_id: 13, class_name: "Amul Item",                product_name: "Amul Item",                   category: "Dairy" },
  { class_id: 14, class_name: "TajMahal tea",             product_name: "Taj Mahal Tea",               category: "Tea & Coffee" },
  { class_id: 15, class_name: "DrOetker",                 product_name: "Dr. Oetker",                  category: "Baking" },
  { class_id: 16, class_name: "Real juice",               product_name: "Real Juice",                  category: "Beverages" },
  { class_id: 17, class_name: "Bru coffee",               product_name: "Bru Coffee",                  category: "Tea & Coffee" },
  { class_id: 18, class_name: "Parle biscuit",            product_name: "Parle Biscuit",               category: "Biscuits" },
  { class_id: 19, class_name: "Veeba sauce",              product_name: "Veeba Sauce",                 category: "Sauces & Condiments" },
];

const SCHEMA_SQL = `
-- ============================================================
-- AIMS Inventory PostgreSQL Schema
-- ============================================================

-- 1. Products: master list keyed by YOLO class_name
CREATE TABLE IF NOT EXISTS products (
  id            SERIAL PRIMARY KEY,
  class_id      INTEGER NOT NULL,
  class_name    VARCHAR(120) NOT NULL UNIQUE,
  product_name  VARCHAR(200) NOT NULL,
  category      VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_class_name ON products (class_name);

-- 2. Inventory: current quantity per product (1-to-1 with products)
CREATE TABLE IF NOT EXISTS inventory (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL UNIQUE
                REFERENCES products(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_product_id ON inventory (product_id);

-- 3. Detection logs: historical record of quantity changes
CREATE TABLE IF NOT EXISTS detection_logs (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL
                REFERENCES products(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detection_logs_product_id  ON detection_logs (product_id);
CREATE INDEX IF NOT EXISTS idx_detection_logs_detected_at ON detection_logs (detected_at);
`;

async function migrate() {
  console.log("[MIGRATE] Connecting to PostgreSQL…");
  const ok = await testConnection();
  if (!ok) {
    console.error(
      "[MIGRATE] Cannot connect. Make sure PostgreSQL is running and the " +
        "aims_inventory database exists.\n" +
        "  Create it with:  CREATE DATABASE aims_inventory;"
    );
    process.exit(1);
  }

  console.log("[MIGRATE] Creating tables…");
  await pool.query(SCHEMA_SQL);

  console.log("[MIGRATE] Seeding product classes…");
  for (const p of PRODUCT_CLASSES) {
    await pool.query(
      `INSERT INTO products (class_id, class_name, product_name, category)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (class_name) DO NOTHING`,
      [p.class_id, p.class_name, p.product_name, p.category]
    );
  }

  // Ensure every product has an inventory row
  await pool.query(`
    INSERT INTO inventory (product_id, quantity, updated_at)
    SELECT id, 0, NOW()
    FROM products
    WHERE id NOT IN (SELECT product_id FROM inventory)
  `);

  // Verify
  const products = await pool.query("SELECT count(*) AS cnt FROM products");
  const inv = await pool.query("SELECT count(*) AS cnt FROM inventory");
  console.log(`[MIGRATE] Done.  products: ${products.rows[0].cnt}  inventory rows: ${inv.rows[0].cnt}`);

  await pool.end();
}

migrate().catch((err) => {
  console.error("[MIGRATE] Fatal:", err);
  process.exit(1);
});
