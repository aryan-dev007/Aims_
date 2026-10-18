import React from 'react';
import { BrowserRouter, NavLink, Routes, Route } from 'react-router-dom';
import StockScanner from './pages/StockScanner';
import ManageProducts from './pages/ManageProducts';
import Alerts from './pages/Alerts';
import Invoices from './pages/Invoices';
import { usePolling } from './hooks/usePolling';
import { getAlerts } from './api/client';

function BrandMark() {
  return (
    <span className="brand-logo" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 7V5a2 2 0 0 1 2-2h2" />
        <path d="M17 3h2a2 2 0 0 1 2 2v2" />
        <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
        <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
        <path d="M8 12h8" />
        <path d="M12 8v8" />
      </svg>
    </span>
  );
}

export default function App() {
  const { data: activeAlerts } = usePolling(getAlerts, 5000);
  const alertCount = (activeAlerts || []).length;

  return (
    <BrowserRouter>
      <div className="app">
        <header className="app-header">
          <div className="brand">
            <BrandMark />
            <div>
              <h1 className="app-title">Stock Scanner</h1>
              <p className="app-subtitle">Vision-based inventory monitoring</p>
            </div>
          </div>

          <nav className="main-nav">
            <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              Scanner
            </NavLink>
            <NavLink to="/manage" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              Manage Products
            </NavLink>
            <NavLink to="/invoices" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              Invoices
            </NavLink>
            <NavLink to="/alerts" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              Alerts
              {alertCount > 0 && <span className="nav-badge">{alertCount}</span>}
            </NavLink>
          </nav>
        </header>

        <Routes>
          <Route path="/" element={<StockScanner />} />
          <Route path="/manage" element={<ManageProducts />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/alerts" element={<Alerts />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
