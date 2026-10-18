import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStockTotals } from '../hooks/useStockTotals';
import { usePolling } from '../hooks/usePolling';
import TotalsChart from '../components/TotalsChart';
import ConnectionStatus from '../components/ConnectionStatus';
import { predictImage, getAlerts } from '../api/client';
import { formatSku } from '../utils/format';

export default function StockScanner() {
  const { setTotals, chartData, totalUnits, connected, detectorOnline } = useStockTotals();
  const { data: alerts } = usePolling(getAlerts, 5000);
  const lowStock = (alerts || []).length;

  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lastDetected, setLastDetected] = useState(null);
  const [inferenceMs, setInferenceMs] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const startCamera = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraOn(true);
    } catch (err) {
      setError('Could not access camera: ' + (err.message || 'permission denied'));
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraOn(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const applyResult = useCallback(
    (res) => {
      if (!res || !res.ok) {
        setError((res && res.error) || 'Detection failed');
        return;
      }
      const detected = res.per_product || {};
      setLastDetected(detected);
      if (res.total && res.total.totals) {
        setTotals({ ...res.total.totals });
      }
      const found = Object.values(detected).reduce((s, c) => s + c, 0);
      setMessage(found > 0 ? `Added ${found} item(s) to the total` : 'No products detected — try again');
    },
    [setTotals]
  );

  const scanAndAdd = useCallback(async () => {
    setError('');
    setMessage('');
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      setError('Camera is still starting…');
      return;
    }
    const canvas = canvasRef.current;
    const MAX_W = 480;
    const scale = video.videoWidth > MAX_W ? MAX_W / video.videoWidth : 1;
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', 0.8);

    setIsScanning(true);
    const t0 = performance.now();
    try {
      const res = await predictImage(image, 0.45, true);
      setInferenceMs(Math.round(performance.now() - t0));
      applyResult(res);
    } catch (err) {
      setError(err.message || 'API error during detection');
    } finally {
      setIsScanning(false);
    }
  }, [applyResult]);

  const handleUpload = useCallback(
    (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      setError('');
      setMessage('');
      const reader = new FileReader();
      reader.onload = async (evt) => {
        setIsScanning(true);
        try {
          const res = await predictImage(evt.target.result, 0.45, true);
          applyResult(res);
        } catch (err) {
          setError(err.message || 'API error during detection');
        } finally {
          setIsScanning(false);
        }
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    },
    [applyResult]
  );

  return (
    <>
      <div className="page-status-row">
        <ConnectionStatus connected={connected} detectorOnline={detectorOnline} />
      </div>

      <section className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon stat-icon-blue">📦</div>
          <div>
            <div className="stat-value">{totalUnits}</div>
            <div className="stat-label">Total scanned</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-violet">🏷️</div>
          <div>
            <div className="stat-value">{chartData.length}</div>
            <div className="stat-label">Products tracked</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-red">⚠️</div>
          <div>
            <div className="stat-value">{lowStock}</div>
            <div className="stat-label">Low-stock alerts</div>
          </div>
        </div>
      </section>

      <main className="app-main">
        <section className="card camera-card">
          <div className="camera-box">
            <video
              ref={videoRef}
              playsInline
              muted
              className="camera-video"
              style={{ display: isCameraOn ? 'block' : 'none' }}
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            {!isCameraOn && (
              <div className="camera-empty">
                <div className="camera-empty-icon">📷</div>
                <p>Camera is off</p>
                <button className="btn btn-primary" onClick={startCamera}>
                  Start Camera
                </button>
              </div>
            )}
          </div>

          <div className="controls">
            {isCameraOn && (
              <>
                <button className="btn btn-primary" onClick={scanAndAdd} disabled={isScanning}>
                  {isScanning ? 'Scanning…' : '🔍 Scan & Add'}
                </button>
                <button className="btn btn-secondary" onClick={stopCamera} disabled={isScanning}>
                  Stop
                </button>
              </>
            )}
            <label className="btn btn-secondary">
              Upload image
              <input type="file" accept="image/*" hidden onChange={handleUpload} />
            </label>
          </div>

          {error && <p className="note note-error">{error}</p>}
          {!error && message && <p className="note note-ok">{message}</p>}
          {inferenceMs != null && <p className="muted small">Last scan: {inferenceMs} ms</p>}
        </section>

        <section className="side">
          <div className="card total-card">
            <div className="total-label">Total scanned</div>
            <div className="total-value">{totalUnits}</div>
            <div className="total-sub">
              {chartData.length} product{chartData.length === 1 ? '' : 's'}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">Products</div>
              <span className="count-chip">{chartData.length}</span>
            </div>
            <TotalsChart data={chartData} />
          </div>

          {lastDetected && Object.keys(lastDetected).length > 0 && (
            <div className="card">
              <div className="card-title">Last scan detected</div>
              <ul className="detect-list">
                {Object.entries(lastDetected)
                  .sort((a, b) => b[1] - a[1])
                  .map(([sku, count]) => (
                    <li key={sku}>
                      <span>{formatSku(sku)}</span>
                      <b>{count}</b>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
