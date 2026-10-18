import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

export default function TotalsChart({ data, height = 320, emptyText }) {
  if (!data || data.length === 0) {
    return (
      <div className="chart-empty">
        {emptyText || 'No scans yet — press “Scan & Add”.'}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 60 }}>
        <defs>
          <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#eef1f4" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: '#64748b', fontSize: 11 }}
          angle={-40}
          textAnchor="end"
          interval={0}
        />
        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: 'rgba(99,102,241,0.08)' }}
          contentStyle={{
            background: '#fff',
            border: '1px solid #e6e8f0',
            borderRadius: 12,
            fontSize: 12,
            boxShadow: '0 10px 26px rgba(15,23,42,0.12)',
          }}
        />
        <Bar dataKey="total" fill="url(#barFill)" radius={[8, 8, 0, 0]} maxBarSize={46} name="Total" />
      </BarChart>
    </ResponsiveContainer>
  );
}
