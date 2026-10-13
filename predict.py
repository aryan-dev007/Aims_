"""
Run inference with a trained YOLO model on an image, video, folder, or webcam.
Saves annotated output and prints per-class detection counts.

Usage:
  python predict.py --model runs/detect/local_subset/weights/best.pt --source test/01.jpg
  python predict.py --model runs/detect/local_subset/weights/best.pt --source grocery.v9i.yolov8/test/images
  python predict.py --model runs/detect/local_subset/weights/best.pt --source 0 --conf 0.35
"""
import argparse
from collections import Counter
from pathlib import Path

from ultralytics import YOLO

def parse_args():
    p = argparse.ArgumentParser(description="Run YOLO detection and print stock counts")
    p.add_argument("--model", default="models/best.pt")
    p.add_argument("--source", default="0", help="image path, folder, video, URL, or camera index (0)")
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--iou", type=float, default=0.45)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--project", default="runs/predict")
    p.add_argument("--name", default="inference")
    return p.parse_args()

def main():
    args = parse_args()
    model = YOLO(args.model)
    names = model.names

    results = model.predict(
        source=args.source,
        conf=args.conf,
        iou=args.iou,
        imgsz=args.imgsz,
        project=args.project,
        name=args.name,
        save=True,
        save_txt=True,
        stream=True,
    )

    totals = Counter()
    frame = 0
    for r in results:
        frame += 1
        per_frame = Counter(names[int(box.cls)] for box in r.boxes)
        totals.update(per_frame)
        print(f"Frame {frame}: {dict(per_frame)}")

    print(f"\nProcessed {frame} frames. Cumulative stock counts:")
    for name, count in sorted(totals.items()):
        print(f"  {name}: {count}")

    out_dir = Path(args.project) / args.name
    print(f"\nAnnotated output saved to: {out_dir}")


if __name__ == "__main__":
    main()