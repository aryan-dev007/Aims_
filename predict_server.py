"""
Persistent YOLO prediction server.

Keeps the model loaded in memory and serves predictions via HTTP.
This eliminates the 3-5 second cold-start penalty of spawning a new
Python process for every frame.

Supports both OpenCV DNN (for ultra-fast ONNX inference on ARM64/CPU) and
standard PyTorch/Ultralytics (for .pt models).
"""
import argparse
import base64
import json
import sys
import time
import os
from collections import Counter
from http.server import HTTPServer, BaseHTTPRequestHandler
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
import yaml

# ── Thresholds (same as backend/config.js) ─────────────────────────
THRESHOLDS = {
    "CocaCola20Oz": 6,
    "Sprite20Oz": 6,
    "Fanta20Oz": 6,
    "Oreo": 5,
    "LaysClassic": 5,
    "DoritosNachoCheese": 5,
    # Indian grocery categories
    "atta_flour": 3,
    "biscuits": 4,
    "chips_wafers": 4,
    "chocolates": 4,
    "coffee": 3,
    "cooking_oil": 3,
    "dal_pulses": 3,
    "juices_packaged_drinks": 4,
    "namkeen_snacks": 4,
    "noodles_instant_food": 4,
    "rice": 3,
    "sauces_ketchup": 3,
    "soft_drinks": 5,
    "spices_masala": 3,
    "tea": 3,
}


def parse_args():
    p = argparse.ArgumentParser(description="Persistent YOLO prediction server")
    p.add_argument("--model", default="models/best.onnx", help="Path to YOLO weights (.pt or .onnx)")
    p.add_argument("--port", type=int, default=5555)
    p.add_argument("--conf", type=float, default=0.30)
    p.add_argument("--iou", type=float, default=0.45)
    p.add_argument("--imgsz", type=int, default=640)
    return p.parse_args()


# ── Globals (set once at startup) ──────────────────────────────────
MODEL = None
NAMES = {}
IS_ONNX = False
ARGS = None


def load_onnx_names(yaml_path):
    try:
        with open(yaml_path, "r") as f:
            data = yaml.safe_load(f)
        names = data.get("names") or []
        if isinstance(names, list):
            return {i: str(n) for i, n in enumerate(names)}
        elif isinstance(names, dict):
            return {int(k): str(v) for k, v in names.items()}
    except Exception as e:
        sys.stderr.write(f"Warning: Could not load class names from {yaml_path}: {e}\n")
    return {}


def letterbox(img, size):
    """Resize keeping aspect ratio and pad to `size` (YOLO-style)."""
    h, w = img.shape[:2]
    r = min(size / h, size / w)
    new_w, new_h = int(round(w * r)), int(round(h * r))
    resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    top = (size - new_h) // 2
    bottom = size - new_h - top
    left = (size - new_w) // 2
    right = size - new_w - left
    padded = cv2.copyMakeBorder(
        resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114)
    )
    return padded, r, left, top


def decode_predictions(outputs, names, conf_threshold, iou_threshold, size, r, left, top):
    """Decode YOLOv8 [1, 4+nc, num_anchors] output into filtered detections."""
    boxes, scores, class_ids = [], [], []
    preds = outputs.transpose(0, 2, 1)[0]  # [num_anchors, 4+nc]
    for row in preds:
        cx, cy, w, h = row[:4]
        score_row = row[4:]
        cls_id = int(np.argmax(score_row))
        conf = float(score_row[cls_id])
        if conf < conf_threshold:
            continue
        x1 = (cx - w / 2 - left) / r
        y1 = (cy - h / 2 - top) / r
        x2 = (cx + w / 2 - left) / r
        y2 = (cy + h / 2 - top) / r
        boxes.append([x1, y1, x2 - x1, y2 - y1])  # x, y, w, h
        scores.append(conf)
        class_ids.append(cls_id)

    if not boxes:
        return []

    keep = cv2.dnn.NMSBoxes(boxes, scores, conf_threshold, iou_threshold)
    if isinstance(keep, tuple):
        keep = keep[0]
    keep = np.asarray(keep).flatten()

    detections = []
    for i in keep:
        x1, y1, w, h = boxes[i]
        detections.append({
            "class_id": class_ids[i],
            "name": names.get(class_ids[i], f"class_{class_ids[i]}"),
            "conf": scores[i],
            "box": [float(x1), float(y1), float(x1 + w), float(y1 + h)],
        })
    return detections


def predict(image_b64: str, conf: float = 0.30):
    """Run YOLO on a base64-encoded image, return JSON-serialisable dict."""
    global MODEL, NAMES, IS_ONNX, ARGS

    b64_data = image_b64
    if "," in b64_data:
        b64_data = b64_data.split(",", 1)[1]

    # Robust base64 parsing (strip whitespace, handle URL-safe and space replacing)
    b64_data = b64_data.strip().replace(" ", "+").replace("-", "+").replace("_", "/")
    padding = len(b64_data) % 4
    if padding:
        b64_data += "=" * (4 - padding)

    img_bytes = base64.b64decode(b64_data)
    nparr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if frame is None:
        return {"ok": False, "error": "Could not decode image"}

    counts = Counter()
    detections = []

    if IS_ONNX:
        # Run OpenCV DNN Inference (extremely optimized on ARM64)
        padded, r, left, top = letterbox(frame, ARGS.imgsz)
        blob = cv2.dnn.blobFromImage(padded, 1 / 255.0, (ARGS.imgsz, ARGS.imgsz), swapRB=True, crop=False)
        MODEL.setInput(blob)
        outputs = MODEL.forward()
        
        raw_detections = decode_predictions(outputs, NAMES, conf, ARGS.iou, ARGS.imgsz, r, left, top)
        
        # Format the detections and count classes
        for d in raw_detections:
            name = d["name"]
            counts[name] += 1
            x1, y1, x2, y2 = d["box"]
            detections.append({
                "name": name,
                "conf": round(d["conf"], 3),
                "box": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
            })
            
        # Draw on-image annotations manually
        annotated = frame.copy()
        for d in raw_detections:
            x1, y1, x2, y2 = [int(v) for v in d["box"]]
            label = f"{d['name']} {d['conf']:.2f}"
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (34, 211, 153), 2)
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(annotated, (x1, y1 - th - 6), (x1 + tw + 4, y1), (34, 211, 153), -1)
            cv2.putText(annotated, label, (x1 + 2, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX,
                        0.5, (2, 6, 23), 1, cv2.LINE_AA)
                        
        _, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 75])
        b64_annotated = base64.b64encode(buf).decode("ascii")
    else:
        # Run standard PyTorch/Ultralytics Inference
        results = MODEL.predict(
            source=frame,
            conf=conf,
            iou=ARGS.iou,
            imgsz=ARGS.imgsz,
            verbose=False,
        )[0]

        for box in results.boxes:
            cls_id = int(box.cls)
            c = float(box.conf)
            name = NAMES[cls_id]
            counts[name] += 1
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append({
                "name": name,
                "conf": round(c, 3),
                "box": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
            })
        annotated = results.plot()
        _, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 75])
        b64_annotated = base64.b64encode(buf).decode("ascii")

    low_stock = {
        name: {"count": counts[name], "threshold": t, "needed": max(t - counts[name], 0)}
        for name, t in THRESHOLDS.items()
        if counts[name] > 0 and counts[name] < t
    }

    return {
        "ok": True,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "total_units": int(sum(counts.values())),
        "per_product": dict(counts),
        "detections": detections,
        "low_stock": low_stock,
        "alerts": len(low_stock),
        "annotatedFrame": f"data:image/jpeg;base64,{b64_annotated}",
    }


class PredictHandler(BaseHTTPRequestHandler):
    """Handle POST /predict with JSON body { image, conf }."""

    def do_POST(self):
        if self.path != "/predict":
            self.send_error(404)
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._respond(400, {"error": "Invalid JSON"})
            return

        image = data.get("image")
        if not image:
            self._respond(400, {"error": "Missing 'image' field"})
            return

        conf = float(data.get("conf", 0.30))

        t0 = time.time()
        result = predict(image, conf)
        elapsed = time.time() - t0
        result["inference_ms"] = round(elapsed * 1000)

        self._respond(200, result)

    def do_GET(self):
        """Health check."""
        if self.path == "/health":
            self._respond(200, {"status": "ok", "model": ARGS.model, "backend": "onnx" if IS_ONNX else "pytorch"})
        else:
            self.send_error(404)

    def _respond(self, code, obj):
        payload = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        """CORS preflight."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, fmt, *args):
        if "POST /predict" in str(args):
            sys.stderr.write(f"[predict-server] {args[0]}\n")


def main():
    global MODEL, NAMES, IS_ONNX, ARGS
    ARGS = parse_args()

    IS_ONNX = ARGS.model.endswith(".onnx")

    if IS_ONNX:
        print(f"[predict-server] Loading ONNX model via OpenCV DNN: {ARGS.model} …")
        MODEL = cv2.dnn.readNetFromONNX(ARGS.model)
        # Find yaml for class names
        yaml_paths = [
            "unified_dataset/data.yaml",
            "data.yaml",
            "focused_dataset/data.yaml"
        ]
        for p in yaml_paths:
            if Path(p).exists():
                NAMES = load_onnx_names(p)
                print(f"[predict-server] Loaded {len(NAMES)} class names from {p}")
                break
        if not NAMES:
            raise RuntimeError("Could not find any data.yaml to load class names for ONNX model")
    else:
        print(f"[predict-server] Loading PyTorch model via Ultralytics: {ARGS.model} …")
        from ultralytics import YOLO
        MODEL = YOLO(ARGS.model)
        NAMES = MODEL.names
        print(f"[predict-server] Loaded {len(NAMES)} class names from PyTorch model")

        # Warm up
        dummy = np.zeros((64, 64, 3), dtype=np.uint8)
        MODEL.predict(source=dummy, conf=0.5, verbose=False)

    print(f"[predict-server] Model loaded and warmed up.")

    server = HTTPServer(("0.0.0.0", ARGS.port), PredictHandler)
    print(f"[predict-server] Listening on http://0.0.0.0:{ARGS.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[predict-server] Shutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
