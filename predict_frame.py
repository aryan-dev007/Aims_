"""
Frame Predictor API Helper for Antigravity Inventory System.
Accepts an image path or base64 string, runs YOLO detection, and outputs JSON with detections, counts, and annotated base64 image.
"""
import sys
import os
import json
import base64
import argparse
import time
from collections import Counter
from pathlib import Path
import cv2
import numpy as np
from ultralytics import YOLO

# Thresholds map
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
    p = argparse.ArgumentParser(description="Predict products from image frame")
    p.add_argument("--model", default="models/best.pt", help="Path to trained YOLO weights")
    p.add_argument("--image", default=None, help="Path to input image file")
    p.add_argument("--base64", default=None, help="Base64 encoded string of input image")
    p.add_argument("--conf", type=float, default=0.30, help="Confidence threshold")
    p.add_argument("--iou", type=float, default=0.45, help="IOU threshold")
    p.add_argument("--imgsz", type=int, default=640, help="Image size")
    return p.parse_args()

def load_image(args):
    raw_input = None
    if args.image:
        raw_input = args.image.strip()
    elif args.base64:
        raw_input = args.base64.strip()
    else:
        stdin_data = sys.stdin.read().strip()
        if stdin_data:
            raw_input = stdin_data

    if not raw_input:
        return None

    # Check if input is a valid file path on disk
    if os.path.exists(raw_input):
        return cv2.imread(raw_input)

    # Otherwise treat as base64 string
    try:
        b64_data = raw_input
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
        return frame
    except Exception as e:
        sys.stderr.write(f"Error decoding image: {e}\n")
        return None

def main():
    args = parse_args()
    frame = load_image(args)

    if frame is None:
        print(json.dumps({"error": "No valid image provided"}))
        sys.exit(1)

    model = YOLO(args.model)
    results = model.predict(
        source=frame,
        conf=args.conf,
        iou=args.iou,
        imgsz=args.imgsz,
        verbose=False
    )[0]

    names = model.names
    detections = []
    counts = Counter()

    for box in results.boxes:
        cls_id = int(box.cls)
        conf = float(box.conf)
        name = names[cls_id]
        counts[name] += 1
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        detections.append({
            "name": name,
            "conf": round(conf, 3),
            "box": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)]
        })

    low_stock = {
        name: {"count": counts[name], "threshold": t, "needed": max(t - counts[name], 0)}
        for name, t in THRESHOLDS.items()
        if counts[name] > 0 and counts[name] < t
    }

    # Generate annotated image
    annotated = results.plot()
    _, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
    b64_annotated = base64.b64encode(buf).decode("ascii")

    output = {
        "ok": True,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "total_units": int(sum(counts.values())),
        "per_product": dict(counts),
        "detections": detections,
        "low_stock": low_stock,
        "alerts": len(low_stock),
        "annotatedFrame": f"data:image/jpeg;base64,{b64_annotated}"
    }

    print(json.dumps(output))

if __name__ == "__main__":
    main()
