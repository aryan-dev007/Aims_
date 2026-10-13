const path = require("path");

module.exports = {
  port: process.env.PORT || 4000,
  // Where detected counts are persisted (JSON file store).
  dataFile: process.env.DATA_FILE || path.join(__dirname, "..", "data", "stock.json"),
  // Reorder buffer multiplier: reorderQty = max(threshold*2 - count, 0)
  reorderBuffer: 2,
  // Per-SKU low-stock thresholds. Unknown SKUs default to 0 (never alert).
  thresholds: {
    "Coca cola cold drink": 5,
    "Oreo biscuit": 4,
    "Lipton tea": 3,
    "Lays masala chips": 4,
    "Fanta cold drink": 5,
    "Soap bar": 4,
    "Colgate Paste": 4,
    "Britannia biscuits": 4,
    "Cadbury chocolate": 5,
    "Nescafe coffee": 3,
    "RedLabel Tea": 3,
    "Maggi Noodles": 4,
    "Chings Schezwan Chutney": 3,
    "Amul Item": 4,
    "TajMahal tea": 3,
    "DrOetker": 3,
    "Real juice": 4,
    "Bru coffee": 3,
    "Parle biscuit": 4,
    "Veeba sauce": 3,
  },
};
