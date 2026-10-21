function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function similarity(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function groupIntoRows(detections) {
  const words = detections
    .filter((item) => item && typeof item.text === "string" && item.text.trim())
    .map((item) => {
      const box = Array.isArray(item.box) ? item.box : [];
      const top = Number(box[1]) || 0;
      const bottom = Number(box[3]) || top;
      const left = Number(box[0]) || 0;
      const right = Number(box[2]) || left;
      return {
        text: item.text.trim(),
        confidence: Number(item.confidence) || 0,
        x: (left + right) / 2,
        y: (top + bottom) / 2,
        height: Math.max(1, bottom - top),
      };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const rows = [];
  for (const word of words) {
    const current = rows[rows.length - 1];
    const tolerance = Math.max(8, word.height * 0.65);
    if (current && Math.abs(current.y - word.y) <= tolerance) {
      current.words.push(word);
      current.y = current.words.reduce((sum, part) => sum + part.y, 0) / current.words.length;
    } else {
      rows.push({ y: word.y, words: [word] });
    }
  }
  return rows.map((row) => row.words.sort((a, b) => a.x - b.x));
}

function parseQuantity(value) {
  const match = String(value).replace(/,/g, "").match(/^\d+(?:\.0+)?$/);
  if (!match) return null;
  const quantity = Number(match[0]);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

function parseMoney(value) {
  const cleaned = String(value).replace(/[₹$€£,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function getColumnPosition(header, pattern) {
  const cell = header.find((word) => pattern.test(word.text));
  return cell ? cell.x : null;
}

function getColumnBounds(header, pattern) {
  const cell = header.find((word) => pattern.test(word.text));
  if (!cell) return null;
  const center = cell.x;
  const otherCenters = header
    .filter((word) => word !== cell)
    .map((word) => word.x)
    .sort((a, b) => a - b);
  const previous = otherCenters.filter((x) => x < center).pop();
  const next = otherCenters.find((x) => x > center);
  return {
    left: previous == null ? -Infinity : (previous + center) / 2,
    right: next == null ? Infinity : (next + center) / 2,
  };
}

function parseInvoiceDetections(pages, products) {
  const rows = groupIntoRows((pages || []).flat());
  const joinedText = rows.map((row) => row.map((word) => word.text).join(" ")).join("\n");
  const headerIndex = rows.findIndex((row) =>
    /\b(qty|quantity|units)\b/i.test(row.map((word) => word.text).join(" "))
  );
  let items = [];

  if (headerIndex >= 0) {
    const header = rows[headerIndex];
    const quantityX = getColumnPosition(header, /\b(qty|quantity|units)\b/i);
    const priceX = getColumnPosition(header, /\b(rate|price|unit\s*price)\b/i);
    const descriptionBounds = getColumnBounds(
      header,
      /\b(description|item|product\s*name)\b/i
    );
    for (const row of rows.slice(headerIndex + 1)) {
      const quantityWord = quantityX == null
        ? null
        : row.reduce((best, word) =>
            !best || Math.abs(word.x - quantityX) < Math.abs(best.x - quantityX) ? word : best, null);
      const qty = quantityWord && parseQuantity(quantityWord.text);
      if (!qty) continue;

      const description = row
        .filter((word) =>
          descriptionBounds
            ? word.x >= descriptionBounds.left && word.x < descriptionBounds.right
            : word.x < quantityWord.x
        )
        .map((word) => word.text)
        .join(" ")
        .replace(/^[\d.)\s-]+/, "")
        .trim();
      if (!description) continue;

      let unitPrice = null;
      if (priceX != null) {
        const priceWord = row.reduce((best, word) =>
          !best || Math.abs(word.x - priceX) < Math.abs(best.x - priceX) ? word : best, null);
        unitPrice = priceWord ? parseMoney(priceWord.text) : null;
      }
      items.push({
        description,
        qty,
        unitPrice,
        confidence: Math.min(...row.map((word) => word.confidence)),
      });
    }
  }

  const invoiceNumber = joinedText.match(
    /\b(?:invoice|inv)[ \t]*(?:no\.?|number|#)[ \t]*[:#-]?[ \t]*([A-Z0-9][A-Z0-9./-]{2,})/i
  )?.[1] || joinedText.match(/\bINV[-/][A-Z0-9][A-Z0-9./-]{2,}/i)?.[0] || null;
  const dateText = joinedText.match(
    /\b(?:date|dated)[ \t]*[:#-]?[ \t]*(\d{1,4}[./-]\d{1,2}[./-]\d{1,4}|\d{1,2}[ \t]+[A-Z]{3,9}[ \t]+\d{4})/i
  )?.[1] || joinedText.match(
    /\b(\d{1,2}[ \t]+[A-Z]{3,9}[ \t]+\d{4})\b/i
  )?.[1] || null;
  const invoiceDate = normalizeDate(dateText);
  const productMatches = items.map((item) => {
    const matches = (products || [])
      .map((product) => ({
        sku: product.sku,
        score: similarity(item.description, product.sku),
      }))
      .sort((a, b) => b.score - a.score);
    const best = matches[0] || null;
    const ambiguous = best && matches[1] && best.score - matches[1].score < 0.08;
    return {
      ...item,
      sku: best && best.score >= 0.86 && !ambiguous ? best.sku : "",
      suggestedSku: best ? best.sku : "",
      matchScore: best ? Number(best.score.toFixed(2)) : 0,
      ambiguous: Boolean(ambiguous),
    };
  });

  return {
    invoiceNumber,
    invoiceDate,
    items: productMatches,
  };
}

function normalizeDate(value) {
  if (!value) return null;
  const textualDate = value.match(/^(\d{1,2})\s+([A-Z]{3,9})\s+(\d{4})$/i);
  if (textualDate) {
    const monthNames = [
      "jan", "feb", "mar", "apr", "may", "jun",
      "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    const monthIndex = monthNames.findIndex((month) =>
      month === textualDate[2].toLowerCase().slice(0, 3)
    );
    if (monthIndex < 0) return null;
    const date = new Date(Date.UTC(Number(textualDate[3]), monthIndex, Number(textualDate[1])));
    if (
      date.getUTCFullYear() !== Number(textualDate[3]) ||
      date.getUTCMonth() !== monthIndex ||
      date.getUTCDate() !== Number(textualDate[1])
    ) {
      return null;
    }
    return date.toISOString().slice(0, 10);
  }

  const parts = value.split(/[./-]/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return null;
  let [year, month, day] = parts;
  if (year < 100) {
    [day, month, year] = parts;
    year += year < 70 ? 2000 : 1900;
  } else if (year > 31) {
    [year, month, day] = parts;
  } else {
    [day, month, year] = parts;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

module.exports = { parseInvoiceDetections, similarity };
