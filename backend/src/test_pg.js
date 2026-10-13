/**
 * Integration test script for the PostgreSQL inventory system.
 *
 * Verifies:
 * 1. PostgreSQL connectivity
 * 2. Table existence and structure
 * 3. Product seeding
 * 4. Inventory upsert with change-detection (no duplicate writes)
 * 5. Quantity updates
 * 6. Detection log integrity
 *
 * Usage:
 *   node src/test_pg.js
 */
require("dotenv").config();
const { pool, query, testConnection } = require("./db");
const pgInv = require("./pgInventory");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

async function run() {
  console.log("\n=== AIMS PostgreSQL Integration Tests ===\n");

  // 1. Connection
  console.log("1. Testing PostgreSQL connection…");
  const ok = await testConnection();
  assert(ok, "PostgreSQL connection successful");
  if (!ok) {
    console.error("Cannot continue — PostgreSQL is unreachable.");
    process.exit(1);
  }

  // 2. Tables exist
  console.log("\n2. Verifying tables…");
  const tables = await query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('products', 'inventory', 'detection_logs')
     ORDER BY table_name`
  );
  const tableNames = tables.map((r) => r.table_name);
  assert(tableNames.includes("products"), "products table exists");
  assert(tableNames.includes("inventory"), "inventory table exists");
  assert(tableNames.includes("detection_logs"), "detection_logs table exists");

  // 3. Products seeded
  console.log("\n3. Verifying product seeding…");
  const products = await query("SELECT * FROM products ORDER BY class_id");
  assert(products.length === 20, `Products count = ${products.length} (expected 20)`);
  assert(
    products.some((p) => p.class_name === "Maggi Noodles"),
    "Maggi Noodles product exists"
  );

  // 4. Inventory rows
  console.log("\n4. Verifying inventory rows…");
  const inv = await query("SELECT * FROM inventory");
  assert(inv.length === 20, `Inventory rows = ${inv.length} (expected 20)`);

  // 5. Load cache
  console.log("\n5. Loading inventory cache…");
  await pgInv.loadCache();
  assert(true, "Cache loaded without error");

  // 6. Simulate detection — first write
  console.log("\n6. Simulating detection results…");
  const detection1 = {
    "Maggi Noodles": 5,
    "Lays masala chips": 7,
    "Parle biscuit": 3,
  };
  const result1 = await pgInv.upsertDetection(detection1);
  assert(result1.changed.length === 3, `First write changed ${result1.changed.length} products (expected 3)`);

  // Verify quantities in DB
  const maggi1 = await pgInv.getProductInventory("Maggi Noodles");
  assert(maggi1 && maggi1.quantity === 5, `Maggi quantity = ${maggi1?.quantity} (expected 5)`);
  const lays1 = await pgInv.getProductInventory("Lays masala chips");
  assert(lays1 && lays1.quantity === 7, `Lays quantity = ${lays1?.quantity} (expected 7)`);

  // 7. Duplicate detection — should NOT change anything
  console.log("\n7. Sending same detection again (should be no-op)…");
  const result2 = await pgInv.upsertDetection(detection1);
  assert(
    result2.changed.length === 0,
    `Duplicate write changed ${result2.changed.length} products (expected 0)`
  );

  // 8. Quantity change
  console.log("\n8. Changing Maggi quantity from 5 to 4…");
  const detection3 = { "Maggi Noodles": 4 };
  const result3 = await pgInv.upsertDetection(detection3);
  assert(result3.changed.includes("Maggi Noodles"), "Maggi was flagged as changed");
  const maggi3 = await pgInv.getProductInventory("Maggi Noodles");
  assert(maggi3 && maggi3.quantity === 4, `Maggi quantity = ${maggi3?.quantity} (expected 4)`);

  // 9. Detection logs should have entries only for actual changes
  console.log("\n9. Verifying detection logs…");
  const logs = await pgInv.getDetectionLogs(20);
  const maggiLogs = logs.filter((l) => l.class_name === "Maggi Noodles");
  assert(
    maggiLogs.length === 2,
    `Maggi detection log entries = ${maggiLogs.length} (expected 2: initial + change)`
  );

  // 10. Full snapshot
  console.log("\n10. Verifying full inventory snapshot…");
  const snapshot = await pgInv.getInventorySnapshot();
  assert(snapshot.length === 20, `Snapshot rows = ${snapshot.length} (expected 20)`);
  const maggiRow = snapshot.find((r) => r.class_name === "Maggi Noodles");
  assert(maggiRow && maggiRow.quantity === 4, `Snapshot: Maggi = ${maggiRow?.quantity} (expected 4)`);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  // Clean up test data: reset quantities back to 0
  console.log("Cleaning up test data…");
  await query("UPDATE inventory SET quantity = 0, updated_at = NOW()");
  await query("DELETE FROM detection_logs");
  console.log("Done. Quantities reset to 0, detection logs cleared.\n");

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
