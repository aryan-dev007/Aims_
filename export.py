"""
Export a trained model to ONNX / OpenVINO for fast CPU serving
(used by the Node.js backend and edge deployment).

Usage:
  python export.py --model runs/detect/local_subset/weights/best.pt --format onnx
"""
import argparse

from ultralytics import YOLO


def parse_args():
    p = argparse.ArgumentParser(description="Export YOLO model")
    p.add_argument("--model", default="models/best.pt")
    p.add_argument("--format", default="onnx", help="onnx | openvino | engine | tflite")
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--half", action="store_true", help="FP16 (GPU formats only)")
    return p.parse_args()


def main():
    args = parse_args()
    model = YOLO(args.model)
    path = model.export(
        format=args.format,
        imgsz=args.imgsz,
        half=args.half,
        simplify=True,
        dynamic=False,
    )
    print(f"Exported model -> {path}")


if __name__ == "__main__":
    main()
