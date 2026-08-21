import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './TopBar.css';

const PAGE_NAMES = {
  '/': 'Dashboard',
  '/live': 'Live Monitor',
  '/inventory': 'Inventory',
  '/alerts': 'Alerts',
  '/orders': 'Orders',
  '/reorder': 'Reorder',
  '/analytics': 'Analytics',
};

export default function TopBar() {
  const location = useLocation();
  const [time, setTime] = useState(new Date());
  const [detectorOnline, setDetectorOnline] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Poll detector status
  useEffect(() => {
    const checkDetector = async () => {
      try {
        const res = await fetch('/api/detector/status');
        const data = await res.json();
        setDetectorOnline(data.online);
      } catch {
        setDetectorOnline(false);
      }
    };
    checkDetector();
    const id = setInterval(checkDetector, 5000);
    return () => clearInterval(id);
  }, []);

  const pageName = PAGE_NAMES[location.pathname] || 'Dashboard';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-breadcrumb">
          <span>AutoStock / </span> {pageName}
        </div>
      </div>
      <div className="topbar-right">
        <div className={`topbar-detector-status ${detectorOnline ? 'online' : 'offline'}`}>
          <span className="topbar-detector-dot" />
          {detectorOnline ? 'Detector Active' : 'Detector Offline'}
        </div>
        <div className="topbar-live-indicator">
          <span className="topbar-live-dot" />
          LIVE
        </div>
        <div className="topbar-time">
          {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      </div>
    </header>
  );
}
