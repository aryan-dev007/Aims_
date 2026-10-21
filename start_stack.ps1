# Start the full monitoring stack on Windows
# Predict Server (Python YOLO) -> http://localhost:5555
# Backend (Express + Socket.IO)  -> http://localhost:4000
# Frontend (Vite)                -> http://localhost:5173
# OpenCV Detector (optional)     -> streams to backend

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Resolve a Python interpreter that actually has ultralytics installed.
# Override with:  $env:PYTHON_BIN = "C:\path\to\python.exe"
$Python = $env:PYTHON_BIN
if (-not $Python) {
  $candidates = @(
    "$env:USERPROFILE\AppData\Local\Python\pythoncore-3.14-64\python.exe",
    "$env:USERPROFILE\anaconda3\python.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) {
      & $c -c "import ultralytics" 2>$null
      if ($LASTEXITCODE -eq 0) { $Python = $c; break }
    }
  }
}
if (-not $Python) {
  Write-Host "[warn] No Python with 'ultralytics' found; falling back to 'python'." -ForegroundColor Yellow
  Write-Host "       Set `$env:PYTHON_BIN to the right interpreter if the model fails to load." -ForegroundColor Yellow
  $Python = "python"
} else {
  Write-Host "[start] Using Python: $Python" -ForegroundColor Cyan
}
$env:PYTHON_BIN = $Python  # backend uses this for its execFile fallback

$OcrPython = $env:INVOICE_OCR_PYTHON
if (-not $OcrPython) {
  $ocrCandidates = @(
    "$env:USERPROFILE\anaconda3\envs\aims-invoice-ocr\python.exe",
    "$env:USERPROFILE\AppData\Local\Python\pythoncore-3.11-64\python.exe",
    "$env:USERPROFILE\AppData\Local\Python\pythoncore-3.12-64\python.exe",
    "$env:USERPROFILE\AppData\Local\Programs\Python\Python311\python.exe",
    "$env:USERPROFILE\AppData\Local\Programs\Python\Python312\python.exe"
  )
  foreach ($candidate in $ocrCandidates) {
    if (Test-Path $candidate) {
      & $candidate -c "import paddleocr, pypdfium2" 2>$null
      if ($LASTEXITCODE -eq 0) { $OcrPython = $candidate; break }
    }
  }
}
if ($OcrPython) {
  Write-Host "[start] Invoice OCR service on http://localhost:5556" -ForegroundColor Cyan
  Start-Process -FilePath $OcrPython -ArgumentList "invoice_ocr_server.py" -WorkingDirectory $Root -WindowStyle Minimized
} else {
  Write-Host "[warn] Invoice OCR is not installed. See invoice_ocr_requirements.txt for setup." -ForegroundColor Yellow
}

Write-Host "[start] Predict Server on http://localhost:5555" -ForegroundColor Cyan
Start-Process -FilePath $Python -ArgumentList "predict_server.py --port 5555" -WorkingDirectory $Root -WindowStyle Minimized

# Wait for model to load (takes ~5-8s on first run)
Write-Host "[start] Waiting for YOLO model to load..." -ForegroundColor Yellow
Start-Sleep -Seconds 8

Write-Host "[start] Backend on http://localhost:4000" -ForegroundColor Cyan
Start-Process -FilePath "node" -ArgumentList "src/server.js" -WorkingDirectory (Join-Path $Root "backend") -WindowStyle Minimized

Start-Sleep -Seconds 2

Write-Host "[start] Frontend on http://localhost:5173" -ForegroundColor Cyan
Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory (Join-Path $Root "frontend") -WindowStyle Minimized

Write-Host ""
Write-Host "  Predict Server: http://localhost:5555  (Persistent YOLO Model)" -ForegroundColor Green
Write-Host "  Backend:        http://localhost:4000  (Express + Socket.IO)" -ForegroundColor Green
Write-Host "  Frontend:       http://localhost:5173  (Vite + React)" -ForegroundColor Green
Write-Host ""
Write-Host "Real-time webcam detection is built into the dashboard:" -ForegroundColor Yellow
Write-Host "  Open http://localhost:5173/live and click 'Start Real-Time Detection'" -ForegroundColor Yellow
Write-Host ""
Write-Host "To also start the OpenCV live detector (external camera feed):" -ForegroundColor Yellow
Write-Host "  python opencv_detect.py --source 0 --api http://localhost:4000" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Or with a demo video:" -ForegroundColor Yellow
Write-Host "  python opencv_detect.py --source runs/demo_shelf.mp4 --loop --api http://localhost:4000" -ForegroundColor Yellow
