import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSocket } from './useSocket';
import { usePolling } from './usePolling';
import { getStock, adjustTotal, resetTotals } from '../api/client';
import { formatSku } from '../utils/format';

/**
 * Shared source of truth for the running scan totals.
 * Combines the live websocket (stock:update) with a polling fallback and
 * exposes the derived chart/manage data plus adjust/reset actions.
 */
export function useStockTotals() {
  const { latestStock, connected, detectorOnline } = useSocket();
  const { data: polledStock } = usePolling(getStock, 5000);
  const [totals, setTotals] = useState({});

  // Keep running totals in sync with live socket + polling data.
  useEffect(() => {
    const source = latestStock?.products || polledStock;
    if (!source) return;
    const map = {};
    source.forEach((p) => {
      if (p.total) map[p.sku] = p.total;
    });
    setTotals(map);
  }, [latestStock, polledStock]);

  const chartData = useMemo(
    () =>
      Object.entries(totals)
        .map(([sku, total]) => ({ name: formatSku(sku).slice(0, 16), total }))
        .filter((p) => p.total > 0)
        .sort((a, b) => b.total - a.total),
    [totals]
  );

  const manageData = useMemo(
    () =>
      Object.entries(totals)
        .map(([sku, total]) => ({ sku, name: formatSku(sku), total }))
        .filter((p) => p.total > 0)
        .sort((a, b) => b.total - a.total),
    [totals]
  );

  const totalUnits = chartData.reduce((s, p) => s + p.total, 0);

  const adjust = useCallback(async (sku, delta) => {
    const result = await adjustTotal(sku, delta);
    setTotals((prev) => {
      const next = { ...prev };
      const value = result.total;
      if (value === 0) delete next[sku];
      else next[sku] = value;
      return next;
    });
  }, []);

  const reset = useCallback(async () => {
    await resetTotals();
    setTotals({});
  }, []);

  return {
    totals,
    setTotals,
    chartData,
    manageData,
    totalUnits,
    connected,
    detectorOnline,
    adjust,
    reset,
  };
}
