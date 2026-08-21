const path = require("path");

module.exports = {
  port: process.env.PORT || 4000,
  // Where detected counts are persisted (JSON file store).
  dataFile: process.env.DATA_FILE || path.join(__dirname, "..", "data", "stock.json"),
  // Reorder buffer multiplier: reorderQty = max(threshold*2 - count, 0)
  reorderBuffer: 2,
  // Per-SKU low-stock thresholds. Unknown SKUs default to 0 (never alert).
  thresholds: {
    CocaCola20Oz: 6,
    Sprite20Oz: 6,
    Fanta20Oz: 6,
    Oreo: 5,
    LaysClassic: 5,
    DoritosNachoCheese: 5,
    // Indian grocery categories
    atta_flour: 3,
    biscuits: 4,
    chips_wafers: 4,
    chocolates: 4,
    coffee: 3,
    cooking_oil: 3,
    dal_pulses: 3,
    juices_packaged_drinks: 4,
    namkeen_snacks: 4,
    noodles_instant_food: 4,
    rice: 3,
    sauces_ketchup: 3,
    soft_drinks: 5,
    spices_masala: 3,
    tea: 3,
  },
};
