"""
Generate a synthetic "live shelf" demo video from dataset shelf photos.

OpenCV pans across each image (a slow left-to-right scan) to simulate a camera
sweeping a store shelf, writes the frames to an .mp4 that can be fed to
`opencv_detect.py --source runs/demo_shelf.mp4` for real live detection.

Usage:
  python make_demo_video.py --images grocery.v9i.yolov8/valid/images --n 6 --out runs/demo_shelf.mp4
"""
import argparse
from pathlib import Path

import cv2
import numpy as np

from opencv_detect import letterbox


def parse_args():
    p = argparse.ArgumentParser(description="Make a demo shelf-scan video")
    p.add_argument("--images", default="grocery.v9i.yolov8/valid/images")
    p.add_argument("--n", type=int, default=6, help="number of shelf photos to scan")
    p.add_argument("--out", default="runs/demo_shelf.mp4")
    p.add_argument("--w", type=int, default=1280, help="output width")
    p.add_argument("--fps", type=float, default=24.0)
    p.add_argument("--seconds", type=float, default=4.0, help="scan duration per photo")
    return p.parse_args()


def make_scan_frame(base, crop_w, offset, out_w, out_h):
    """Return one frame of a left->right pan across `base` (already letterboxed)."""
    bw = base.shape[1]
    start = int((bw - crop_w) * offset)
    crop = base[:, start:start + crop_w]
    return cv2.resize(crop, (out_w, out_h), interpolation=cv2.INTER_LINEAR)


def main():
    args = parse_args()
    images = sorted(Path(args.images).glob("*.jpg"))[: args.n]
    if not images:
        raise SystemExit(f"No images in {args.images}")
    print(f"Using {len(images)} shelf photos")

    out_h = int(args.w * 3 / 4)
    writer = cv2.VideoWriter(
        args.out, cv2.VideoWriter_fourcc(*"mp4v"), args.fps, (args.w, out_h)
    )
    if not writer.isOpened():
        raise SystemExit(f"Cannot write {args.out}")

    n_frames_per = int(args.fps * args.seconds)
    for img in images:
        frame = cv2.imread(str(img))
        if frame is None:
            continue
        base, _, _, _ = letterbox(frame, args.w)  # pad to width so panning is smooth
        crop_w = base.shape[1] // 3  # show ~1/3 of the shelf at a time
        for i in range(n_frames_per):
            offset = i / max(n_frames_per - 1, 1)
            scan = make_scan_frame(base, crop_w, offset, args.w, out_h)
            writer.write(scan)
        print(f"  scanned {img.name}")
    writer.release()
    print(f"Demo video -> {args.out} ({n_frames_per * len(images)} frames @ {args.fps} fps)")


if __name__ == "__main__":
    main()
