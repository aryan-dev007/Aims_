import React, { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Layout/Sidebar';
import TopBar from './components/Layout/TopBar';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Alerts from './pages/Alerts';
import Orders from './pages/Orders';
import Reorder from './pages/Reorder';
import Analytics from './pages/Analytics';
import LiveMonitor from './pages/LiveMonitor';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleSidebarClose = (action) => {
    if (action === 'toggle') {
      setSidebarOpen((open) => !open);
    } else {
      setSidebarOpen(false);
    }
  };

  return (
    <BrowserRouter>
      <div className="app-layout">
        <Sidebar isOpen={sidebarOpen} onClose={handleSidebarClose} />
        <div className="main-area">
          <TopBar />
          <main className="page-content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/live" element={<LiveMonitor />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/reorder" element={<Reorder />} />
              <Route path="/analytics" element={<Analytics />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
