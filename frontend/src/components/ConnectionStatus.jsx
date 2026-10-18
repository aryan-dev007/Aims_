import React from 'react';

export default function ConnectionStatus({ connected, detectorOnline }) {
  return (
    <div className="app-status">
      <span className={`dot ${detectorOnline || connected ? 'dot-on' : ''}`} />
      {detectorOnline ? 'Detector active' : connected ? 'Connected' : 'Backend offline'}
    </div>
  );
}
