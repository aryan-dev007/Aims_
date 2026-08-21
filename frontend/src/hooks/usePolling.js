import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook that polls an async function at a given interval.
 * Returns { data, loading, error, refetch }.
 */
export function usePolling(fetchFn, intervalMs = 5000) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const fetchRef = useRef(fetchFn);

  // Keep fetchFn ref current without restarting the interval
  useEffect(() => {
    fetchRef.current = fetchFn;
  }, [fetchFn]);

  const refetch = useCallback(async () => {
    try {
      const result = await fetchRef.current();
      if (mountedRef.current) {
        setData(result);
        setError(null);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refetch(); // initial fetch
    const id = setInterval(refetch, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refetch, intervalMs]);

  return { data, loading, error, refetch };
}
