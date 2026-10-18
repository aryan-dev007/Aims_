import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useSocket } from '../hooks/useSocket';
import KpiCard from '../components/common/KpiCard';
import EmptyState from '../components/common/EmptyState';
import { formatSku } from '../utils/format';
import { predictImage, resetTotals } from '../api/client';

export default function LiveMonitor() {
  const { connected, latestFrame, detectorOnline, detectionLog, latestStock } = useSocket();

  // Camera modes: 'webcam' | 'server' | 'file'
  const [sourceMode, setSourceMode] = useState('webcam');
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [inferenceMs, setInferenceMs] = useState(null);
  const [scanCount, setScanCount] = useState(0);

  // Camera devices state
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  // Continuous scan state
  const [continuousScan, setContinuousScan] = useState(false);
  const continuousScanRef = useRef(false);
  const scanningRef = useRef(false);

  // Local detection result from browser webcam / image scan
  const [localResult, setLocalResult] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  // Get available camera devices
  const getDevices = useCallback(async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        // Enumerate first to see what we have
        const deviceList = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = deviceList.filter((device) => device.kind === 'videoinput');
        setDevices(videoDevices);
        if (videoDevices.length > 0) {
          setSelectedDeviceId((prev) => prev || videoDevices[0].deviceId);
        }
      }
    } catch (err) {
      console.warn('Error listing devices:', err);
    }
  }, []);

  // Initialize and stop camera on unmount
  useEffect(() => {
    // Request permission once to populate labels in enumerateDevices
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: true })
        .then(() => getDevices())
        .catch((err) => console.warn('Webcam permission request failed:', err));
    } else {
      getDevices();
    }

    return () => {
      continuousScanRef.current = false;
      stopWebcam();
    };
  }, [getDevices]);

  // Keep ref in sync with state
  useEffect(() => {
    continuousScanRef.current = continuousScan;
  }, [continuousScan]);

  // Handle source mode toggle
  const handleModeChange = (mode) => {
    setSourceMode(mode);
    setScanError(null);
    if (mode !== 'webcam') {
      stopWebcam();
    }
  };

  // Start HTML5 Webcam
  const startWebcam = async (deviceId = selectedDeviceId) => {
    setScanError(null);
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const videoConstraints = deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' };

        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setIsWebcamActive(true);
      } else {
        setScanError('Webcam access not supported in this browser.');
      }
    } catch (err) {
      console.error('Webcam error:', err);
      setScanError(`Camera Access Error: ${err.message || 'Permission denied or camera in use.'}`);
      setIsWebcamActive(false);
    }
  };

  // Switch camera device on selector change
  const handleDeviceChange = async (e) => {
    const newDeviceId = e.target.value;
    setSelectedDeviceId(newDeviceId);
    if (isWebcamActive) {
      const wasScanning = continuousScanRef.current || continuousScan;
      stopWebcam();
      // Wait briefly for the previous camera track to fully release
      setTimeout(async () => {
        await startWebcam(newDeviceId);
        if (wasScanning) {
          setContinuousScan(true);
          continuousScanRef.current = true;
          runContinuousLoop();
        }
      }, 300);
    }
  };

  // Stop HTML5 Webcam
  const stopWebcam = () => {
    continuousScanRef.current = false;
    setContinuousScan(false);
    scanningRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsWebcamActive(false);
  };

  // Capture current video frame and run detection (returns the result).
  // accumulate=true adds the detected counts to the running scan total.
  const captureAndDetect = useCallback(async (accumulate = false) => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState !== video.HAVE_ENOUGH_DATA) return null;

    // Downscale to max 480px width for much faster transfer & inference
    // (Full HD frames are ~2MB base64; 480px is ~80-120KB)
    const srcW = video.videoWidth || 640;
    const srcH = video.videoHeight || 480;
    const MAX_W = 480;
    const scale = srcW > MAX_W ? MAX_W / srcW : 1;
    canvas.width = Math.round(srcW * scale);
    canvas.height = Math.round(srcH * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Use lower quality for faster transfer during continuous mode
    const quality = continuousScanRef.current ? 0.65 : 0.80;
    const b64Image = canvas.toDataURL('image/jpeg', quality);

    setIsScanning(true);
    setScanError(null);
    const t0 = performance.now();
    try {
      const res = await predictImage(b64Image, 0.45, accumulate);
      const elapsed = Math.round(performance.now() - t0);
      setInferenceMs(elapsed);
      if (res.ok) {
        setLocalResult(res);
        setScanCount((c) => c + 1);
        return res;
      } else {
        setScanError(res.error || 'Failed to detect products.');
        return null;
      }
    } catch (err) {
      console.error('Prediction API call failed:', err);
      setScanError(err.message || 'API error during product detection.');
      return null;
    } finally {
      setIsScanning(false);
    }
  }, []);

  // Continuous scan loop: fire next scan as soon as the current one completes
  const runContinuousLoop = useCallback(async () => {
    if (scanningRef.current) return; // prevent double-entry
    scanningRef.current = true;

    while (continuousScanRef.current) {
      await captureAndDetect();
      // Breathing room between scans (200ms) to keep UI responsive
      await new Promise((r) => setTimeout(r, 200));
    }

    scanningRef.current = false;
  }, [captureAndDetect]);

  // Toggle continuous scanning
  const toggleContinuousScan = useCallback(() => {
    if (continuousScan) {
      // Stop
      continuousScanRef.current = false;
      setContinuousScan(false);
    } else {
      // Start
      setContinuousScan(true);
      continuousScanRef.current = true;
      runContinuousLoop();
    }
  }, [continuousScan, runContinuousLoop]);

  // Start camera + immediately begin continuous scanning
  const startCameraAndScan = async () => {
    await startWebcam(selectedDeviceId);
    // Wait a moment for video to initialize
    setTimeout(() => {
      setContinuousScan(true);
      continuousScanRef.current = true;
      runContinuousLoop();
    }, 500);
  };

  // File upload for image prediction
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const b64 = evt.target.result;
      setIsScanning(true);
      setScanError(null);
      const t0 = performance.now();
      try {
        const res = await predictImage(b64, 0.45);
        setInferenceMs(Math.round(performance.now() - t0));
        if (res.ok) {
          setLocalResult(res);
          setScanCount((c) => c + 1);
        } else {
          setScanError(res.error || 'Detection failed on image');
        }
      } catch (err) {
        setScanError(err.message || 'Error processing uploaded image.');
      } finally {
        setIsScanning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Test Sample Images
  const sampleImages = [
    { label: 'Sample Snacks 1', path: 'subset/valid/images/01_jpg.rf.19ae957b0ae3063a1501bb8c0ad9e04c.jpg' },
    { label: 'Sample Snacks 2', path: 'subset/valid/images/01_jpg.rf.241095a39a5e32aebd1045dea869d3e8.jpg' },
    { label: 'Sample Shelf 3', path: 'subset/valid/images/01_jpg.rf.50b940528bfc36cd2385c4abe4fd5d1a.jpg' }
  ];

  const handleSampleSelect = async (samplePath) => {
    setIsScanning(true);
    setScanError(null);
    const t0 = performance.now();
    try {
      const res = await predictImage(samplePath, 0.45);
      setInferenceMs(Math.round(performance.now() - t0));
      if (res.ok) {
        setLocalResult(res);
        setScanCount((c) => c + 1);
      } else {
        setScanError(res.error || 'Detection failed on sample image');
      }
    } catch (err) {
      setScanError(err.message || 'Error loading sample image.');
    } finally {
      setIsScanning(false);
    }
  };

  // Reset the cumulative running totals (both locally and on the backend)
  const handleResetTotals = async () => {
    setScanError(null);
    try {
      await resetTotals();
    } catch (err) {
      setScanError(err.message || 'Failed to reset totals.');
    }
  };

  // Running scan totals per product (only ever increase). Source of truth is the
  // backend via the stock:update socket event, so the chart grows live on scan.
  const totalsData = useMemo(() => {
    const products = latestStock?.products;
    if (!products) return [];
    return products
      .filter((p) => (p.total || 0) > 0)
      .map((p) => ({ name: formatSku(p.sku).slice(0, 16), total: p.total || 0 }))
      .sort((a, b) => b.total - a.total);
  }, [latestStock]);

  // Active Frame Data calculation
  const activeData = useMemo(() => {
    if (sourceMode === 'server' && latestFrame) {
      return {
        fps: latestFrame.fps || 0,
        counts: latestFrame.counts || {},
        low_stock: latestFrame.low_stock || {},
        timestamp: latestFrame.timestamp,
        frameSrc: `data:image/jpeg;base64,${latestFrame.frame}`,
        source: 'Server OpenCV Detector'
      };
    }
    if (localResult) {
      return {
        fps: inferenceMs ? Math.round(1000 / (inferenceMs / 1000)) / 1000 : 0,
        counts: localResult.per_product || {},
        low_stock: localResult.low_stock || {},
        timestamp: localResult.timestamp,
        frameSrc: localResult.annotatedFrame,
        source: 'Browser Direct Detection'
      };
    }
    return null;
  }, [sourceMode, latestFrame, localResult, inferenceMs]);

  const totalUnits = activeData
    ? Object.values(activeData.counts).reduce((s, c) => s + c, 0)
    : 0;
  const classCount = activeData ? Object.keys(activeData.counts).length : 0;
  const alertCount = activeData ? Object.keys(activeData.low_stock).length : 0;

  // Computed status label
  const statusLabel = continuousScan
    ? '🔴 LIVE Scanning'
    : isWebcamActive
      ? 'Camera Ready'
      : detectorOnline
        ? 'Server Detector Online'
        : 'Camera Standby';

  return (
    <div>
      <div className="page-header">
        <h1>Live Monitor & Camera Detection</h1>
        <p>
          End-to-end real-time product detection & unit counting powered by YOLOv8
          <span className={`live-monitor-status ${continuousScan || isWebcamActive || detectorOnline ? 'online' : 'offline'}`}>
            <span className="live-monitor-status-dot" />
            {statusLabel}
          </span>
        </p>
      </div>

      {/* KPI Strip */}
      <div className="stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
        <KpiCard
          icon="📹"
          label="Camera Mode"
          value={sourceMode === 'webcam' ? 'Browser Webcam' : sourceMode === 'server' ? 'OpenCV Stream' : 'File / Sample'}
          sub={continuousScan ? '🔴 Live Scanning Active' : 'Manual Scan Ready'}
          accent={continuousScan || isWebcamActive || detectorOnline ? 'ok' : 'info'}
          delay={0}
        />
        <KpiCard
          icon="⚡"
          label="Inference Speed"
          value={inferenceMs ? `${inferenceMs}ms` : isScanning ? 'Scanning…' : 'Ready'}
          sub={inferenceMs ? `~${Math.round(1000 / inferenceMs * 10) / 10} FPS effective` : 'YOLOv8 Detection Engine'}
          accent="info"
          delay={60}
        />
        <KpiCard
          icon="🔢"
          label="Products Counted"
          value={totalUnits}
          sub={`${classCount} SKU classes · ${scanCount} scans`}
          accent="ok"
          delay={120}
        />
        <KpiCard
          icon="🔴"
          label="Low Stock Alerts"
          value={alertCount}
          sub="Requires replenishment"
          accent={alertCount > 0 ? 'low' : 'ok'}
          delay={180}
        />
      </div>

      {/* Main Layout: Camera Controls + Feed + Detections */}
      <div className="live-monitor-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Mode Controls Bar */}
          <div className="glass-card" style={{ padding: '14px 20px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Source:</span>
              <button
                className={`filter-pill ${sourceMode === 'webcam' ? 'active' : ''}`}
                onClick={() => handleModeChange('webcam')}
              >
                📷 Web Camera
              </button>
              <button
                className={`filter-pill ${sourceMode === 'server' ? 'active' : ''}`}
                onClick={() => handleModeChange('server')}
              >
                🖥️ OpenCV Stream
              </button>
              <button
                className={`filter-pill ${sourceMode === 'file' ? 'active' : ''}`}
                onClick={() => handleModeChange('file')}
              >
                📁 Image / Samples
              </button>
            </div>

            {sourceMode === 'webcam' && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {devices.length > 0 && (
                  <select
                    value={selectedDeviceId}
                    onChange={handleDeviceChange}
                    className="filter-pill"
                    style={{
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: 'var(--text-primary)',
                      padding: '7px 12px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      outline: 'none',
                      fontSize: '0.8rem',
                      fontFamily: 'inherit',
                      maxHeight: '34px',
                      display: 'inline-flex',
                      alignItems: 'center'
                    }}
                  >
                    {devices.map((device, idx) => (
                      <option key={device.deviceId} value={device.deviceId} style={{ background: '#12131a', color: '#e2e8f0' }}>
                        📷 {device.label || `Camera ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                )}
                {!isWebcamActive ? (
                  <button className="btn btn-primary" onClick={startCameraAndScan}>
                    ▶️ Start Real-Time Detection
                  </button>
                ) : (
                  <>
                    {!continuousScan ? (
                      <>
                        <button className="btn btn-primary" onClick={toggleContinuousScan}>
                          ⚡ Start Continuous Scan
                        </button>
                        <button className="btn btn-ghost" onClick={() => captureAndDetect()} disabled={isScanning}>
                          {isScanning ? '🔍 Scanning…' : '📸 Single Scan'}
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-danger" onClick={toggleContinuousScan}>
                        ⏸️ Pause Scanning
                      </button>
                    )}
                    <button className="btn btn-primary" onClick={() => captureAndDetect(true)} disabled={isScanning}>
                      {isScanning ? '🔍 Scanning…' : '➕ Scan & Add to Total'}
                    </button>
                    <button className="btn btn-ghost" onClick={handleResetTotals} disabled={isScanning}>
                      🔄 Reset Total
                    </button>
                    <button className="btn btn-ghost" onClick={stopWebcam}>
                      ⏹️ Stop
                    </button>
                  </>
                )}
                {continuousScan && inferenceMs && (
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '4px 10px',
                    borderRadius: '12px',
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#ef4444',
                    animation: 'pulse 1.5s ease infinite',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: '#ef4444',
                      boxShadow: '0 0 8px rgba(239,68,68,0.6)',
                    }} />
                    LIVE · {inferenceMs}ms
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Video Feed / Canvas Viewport */}
          <div className="live-feed-container glass-card">
            <div className="live-feed-header">
              <div className="live-feed-title">
                <span className={`live-feed-indicator ${continuousScan || isWebcamActive || detectorOnline || isScanning ? 'active' : ''}`} />
                {sourceMode === 'webcam' ? 'Live Camera Feed' : sourceMode === 'server' ? 'OpenCV Stream' : 'Image Scan Viewport'}
              </div>
              {activeData && (
                <div className="live-feed-meta">
                  {activeData.source} · {activeData.timestamp}
                  {inferenceMs && ` · ${inferenceMs}ms`}
                </div>
              )}
            </div>

            <div className="live-feed-viewport" style={{ minHeight: 420, position: 'relative' }}>
              {/* Hidden Canvas for Webcam capture */}
              <canvas ref={canvasRef} style={{ display: 'none' }} />

              {sourceMode === 'webcam' && (
                <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
                  {/* Always render the video element (hidden during annotated display) */}
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    style={{
                      width: '100%',
                      maxHeight: '520px',
                      objectFit: 'contain',
                      display: isWebcamActive ? 'block' : 'none',
                      // When we have an annotated frame during continuous scan, hide the raw video
                      opacity: (continuousScan && activeData?.frameSrc) ? 0 : 1,
                      position: (continuousScan && activeData?.frameSrc) ? 'absolute' : 'relative',
                    }}
                  />
                  {/* Show annotated frame overlay during continuous scan */}
                  {activeData && activeData.frameSrc && isWebcamActive && (
                    <img
                      src={activeData.frameSrc}
                      alt="Annotated detection feed"
                      className="live-feed-image"
                      style={{
                        maxHeight: '520px',
                        transition: 'opacity 0.15s ease',
                      }}
                    />
                  )}
                  {/* Scanning overlay indicator */}
                  {isScanning && continuousScan && (
                    <div style={{
                      position: 'absolute',
                      top: 12,
                      left: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 10px',
                      borderRadius: '6px',
                      background: 'rgba(0,0,0,0.6)',
                      backdropFilter: 'blur(4px)',
                      color: '#ef4444',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      zIndex: 10,
                    }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#ef4444',
                        animation: 'pulse 0.8s ease infinite',
                      }} />
                      SCANNING…
                    </div>
                  )}
                  {!isWebcamActive && !activeData && (
                    <div className="live-feed-placeholder">
                      <div className="live-feed-placeholder-icon">📷</div>
                      <div className="live-feed-placeholder-title">Web Camera Off</div>
                      <div className="live-feed-placeholder-sub">
                        Click "Start Real-Time Detection" to enable live product scanning.
                        <br />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Camera will start and immediately begin detecting products in real-time.
                        </span>
                      </div>
                      <button className="btn btn-primary" onClick={startCameraAndScan}>
                        ▶️ Start Real-Time Detection
                      </button>
                    </div>
                  )}
                </div>
              )}

              {sourceMode === 'server' && (
                latestFrame ? (
                  <img
                    src={`data:image/jpeg;base64,${latestFrame.frame}`}
                    alt="OpenCV stream feed"
                    className="live-feed-image"
                  />
                ) : (
                  <div className="live-feed-placeholder">
                    <div className="live-feed-placeholder-icon">💻</div>
                    <div className="live-feed-placeholder-title">OpenCV Stream Offline</div>
                    <div className="live-feed-placeholder-sub">
                      Run <code style={{ color: 'var(--color-ok)' }}>python opencv_detect.py --api http://localhost:4000</code> in terminal to stream live OpenCV camera feed.
                    </div>
                  </div>
                )
              )}

              {sourceMode === 'file' && (
                localResult && localResult.annotatedFrame ? (
                  <img
                    src={localResult.annotatedFrame}
                    alt="Analyzed product image"
                    className="live-feed-image"
                  />
                ) : (
                  <div className="live-feed-placeholder">
                    <div className="live-feed-placeholder-icon">🖼️</div>
                    <div className="live-feed-placeholder-title">Upload or Select Sample Image</div>
                    <div className="live-feed-placeholder-sub">
                      Select an image file or click one of the quick test sample buttons below.
                    </div>
                  </div>
                )
              )}
            </div>

            {/* Error banner */}
            {scanError && (
              <div style={{ padding: '10px 20px', background: 'var(--color-low-bg)', borderTop: '1px solid var(--color-low-border)', color: 'var(--color-low)', fontSize: '0.82rem' }}>
                ⚠️ {scanError}
              </div>
            )}
          </div>

          {/* Sample Images & Upload Drawer if file mode */}
          {sourceMode === 'file' && (
            <div className="glass-card" style={{ padding: 20 }}>
              <h4 style={{ fontSize: '0.85rem', marginBottom: 12, color: 'var(--text-secondary)' }}>Quick Test Samples & Custom Upload</h4>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {sampleImages.map((s, idx) => (
                  <button key={idx} className="btn btn-ghost btn-sm" onClick={() => handleSampleSelect(s.path)}>
                    🧪 {s.label}
                  </button>
                ))}
                <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
                  📤 Upload Image
                  <input type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: Detected Products & Alerts */}
        <div className="live-sidebar">
          {/* Detected Products Breakdown */}
          <div className="glass-card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 className="live-sidebar-title" style={{ marginBottom: 0 }}>Detected Products</h3>
              {activeData && (
                <span className="btn btn-sm" style={{ background: 'var(--color-ok-bg)', color: 'var(--color-ok)', fontSize: '0.72rem' }}>
                  {totalUnits} Units Total
                </span>
              )}
            </div>

            {activeData && Object.keys(activeData.counts).length > 0 ? (
              <div className="live-detection-list">
                {Object.entries(activeData.counts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([name, count]) => {
                    const isLow = name in (activeData.low_stock || {});
                    return (
                      <div key={name} className={`live-detection-item ${isLow ? 'low' : ''}`}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: '1rem' }}>📦</span>
                          <span className="live-detection-name">{formatSku(name)}</span>
                        </div>
                        <span className={`live-detection-count ${isLow ? 'text-low' : 'text-ok'}`}>
                          {count}
                        </span>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <EmptyState
                icon="🔍"
                title="No Products Scanned"
                message={
                  isScanning
                    ? 'Scanning image with YOLOv8…'
                    : 'Turn on camera or upload an image to count products.'
                }
              />
            )}
          </div>

          {/* Running Scan Totals (all products) */}
          <div className="glass-card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 className="live-sidebar-title" style={{ marginBottom: 0 }}>Scan Totals · All Products</h3>
              {totalsData.length > 0 && (
                <span className="btn btn-sm" style={{ background: 'var(--color-ok-bg)', color: 'var(--color-ok)', fontSize: '0.72rem' }}>
                  Σ {totalsData.reduce((s, p) => s + p.total, 0)}
                </span>
              )}
            </div>
            {totalsData.length === 0 ? (
              <EmptyState
                icon="📊"
                title="No totals yet"
                message='Point the camera at a product and press "Scan & Add to Total".'
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={totalsData} margin={{ top: 4, right: 4, left: -24, bottom: 48 }}>
                  <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 9 }} angle={-45} textAnchor="end" interval={0} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#0d1117', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#f1f5f9' }}
                  />
                  <Bar dataKey="total" fill="#06d6a0" radius={[4, 4, 0, 0]} name="Total" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Low Stock Warnings */}
          {activeData && Object.keys(activeData.low_stock).length > 0 && (
            <div className="glass-card live-low-stock-card" style={{ padding: 20 }}>
              <h3 className="live-sidebar-title" style={{ color: 'var(--color-low)' }}>
                ⚠️ Low Stock Alerts
              </h3>
              <div className="live-detection-list">
                {Object.entries(activeData.low_stock).map(([name, info]) => (
                  <div key={name} className="live-detection-item low">
                    <div>
                      <div className="live-detection-name">{formatSku(name)}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Need {info.needed} more (threshold: {info.threshold})
                      </div>
                    </div>
                    <span className="live-detection-count text-low">{info.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Detection Activity Log */}
          <div className="glass-card" style={{ padding: 20 }}>
            <h3 className="live-sidebar-title">Real-Time Ingestion Log</h3>
            <div className="live-activity-log">
              {detectionLog.length === 0 ? (
                <div className="text-muted" style={{ fontSize: '0.8rem', textAlign: 'center', padding: 16 }}>
                  No detections logged yet
                </div>
              ) : (
                detectionLog.slice(0, 15).map((entry, i) => (
                  <div key={i} className="live-activity-entry">
                    <div className="live-activity-time">
                      {new Date(entry.timestamp).toLocaleTimeString('en-US', {
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </div>
                    <div className="live-activity-detail">
                      {entry.totalUnits} units · {Object.keys(entry.products).length} classes
                      {entry.alerts > 0 && (
                        <span className="text-low"> · {entry.alerts} alerts</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
