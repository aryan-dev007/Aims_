import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { getAlerts } from '../../api/client';
import './Sidebar.css';

const NAV_ITEMS = [
  { section: 'Overview' },
  { to: '/',          icon: '📊', label: 'Dashboard' },
  { to: '/live',      icon: '📹', label: 'Live Monitor', showLive: true },
  { section: 'Management' },
  { to: '/inventory', icon: '📦', label: 'Inventory' },
  { to: '/alerts',    icon: '🔔', label: 'Alerts', showBadge: true },
  { to: '/orders',    icon: '📋', label: 'Orders' },
  { to: '/reorder',   icon: '🛒', label: 'Reorder' },
  { section: 'Insights' },
  { to: '/analytics', icon: '📈', label: 'Analytics' },
];

export default function Sidebar({ isOpen, onClose }) {
  const location = useLocation();
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const fetchAlerts = async () => {
      try {
        const alerts = await getAlerts(true);
        if (mounted) setAlertCount(alerts.length);
      } catch { /* silent */ }
    };
    fetchAlerts();
    const id = setInterval(fetchAlerts, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Close sidebar on route change (mobile)
  useEffect(() => { onClose?.(); }, [location.pathname]);

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}

      <button className="sidebar-toggle" onClick={() => onClose?.('toggle')}>
        {isOpen ? '✕' : '☰'}
      </button>

      <aside className={`sidebar${isOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">AS</div>
          <div className="sidebar-brand-text">
            <span>AutoStock</span>
            <span>Inventory AI</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item, i) =>
            item.section ? (
              <div key={i} className="sidebar-section-title">{item.section}</div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              >
                <span className="sidebar-link-icon">{item.icon}</span>
                <span>{item.label}</span>
                {item.showBadge && alertCount > 0 && (
                  <span className="sidebar-link-badge">{alertCount}</span>
                )}
                {item.showLive && (
                  <span className="sidebar-live-tag">LIVE</span>
                )}
              </NavLink>
            )
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-footer-status">
            <span className="sidebar-footer-dot" />
            <span>System Online</span>
          </div>
        </div>
      </aside>
    </>
  );
}
