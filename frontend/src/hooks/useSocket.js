import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:4000';

/**
 * Custom hook that connects to the Socket.IO backend for real-time updates.
 * Returns { latestStock, latestFrame, detectorOnline, connected, detectionLog }
 */
export function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [latestStock, setLatestStock] = useState(null);
  const [latestFrame, setLatestFrame] = useState(null);
  const [detectorOnline, setDetectorOnline] = useState(false);
  const [detectionLog, setDetectionLog] = useState([]);
  const lastFrameTime = useRef(0);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[WS] Connected to backend');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('[WS] Disconnected from backend');
      setConnected(false);
      setDetectorOnline(false);
    });

    socket.on('stock:update', (data) => {
      setLatestStock(data);
      setDetectorOnline(true);

      // Add to detection log (keep last 50 entries)
      setDetectionLog((prev) => {
        const entry = {
          timestamp: data.timestamp,
          totalUnits: data.total_units || 0,
          products: data.per_product || {},
          alerts: data.alerts || 0,
        };
        const next = [entry, ...prev].slice(0, 50);
        return next;
      });
    });

    socket.on('frame:update', (data) => {
      setLatestFrame(data);
      setDetectorOnline(true);
      lastFrameTime.current = Date.now();
    });

    socket.on('alert:acked', () => {
      // The polling hooks will pick up the update
    });

    // Check if detector went offline (no frames for 10s)
    const statusCheck = setInterval(() => {
      if (lastFrameTime.current > 0 && Date.now() - lastFrameTime.current > 10000) {
        setDetectorOnline(false);
      }
    }, 5000);

    return () => {
      clearInterval(statusCheck);
      socket.disconnect();
    };
  }, []);

  return { connected, latestStock, latestFrame, detectorOnline, detectionLog };
}
