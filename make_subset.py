"""Build a class-balanced training subset for local CPU training.

Usage: python make_subset.py --train 2000 --valid 300 --seed 42
"""
import argparse
import random
import shutil
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "grocery.v9i.yolov8"


def sample(split, target, seed):
    rng = random.Random(seed)
    src_img = SRC / split / "images"
    src_lbl = SRC / split / "labels"
    dst = ROOT / "subset" / split
    (dst / "images").mkdir(parents=True, exist_ok=True)
    (dst / "labels").mkdir(parents=True, exist_ok=True)

    by_class = defaultdict(list)
    for lbl in src_lbl.glob("*.txt"):
        cls = int(lbl.read_text().split()[0])
        by_class[cls].append(lbl)

    picked = set()
    per_class = target // max(len(by_class), 1)
    for cls, lbls in by_class.items():
        rng.shuffle(lbls)
        for lbl in lbls[:per_class]:
            picked.add(lbl)
    if len(picked) < target and by_class:
        extra = [l for l in sum(by_class.values(), []) if l not in picked]
        rng.shuffle(extra)
        for lbl in extra[: target - len(picked)]:
            picked.add(lbl)

    for lbl in picked:
        img = src_img / (lbl.stem + ".jpg")
        if not img.exists():
            img = src_img / (lbl.stem + ".jpeg")
        shutil.copy2(lbl, dst / "labels" / lbl.name)
        shutil.copy2(img, dst / "images" / img.name)

    counts = defaultdict(int)
    for lbl in (dst / "labels").glob("*.txt"):
        counts[int(lbl.read_text().split()[0])] += 1
    return len(picked), len(counts), min(counts.values()) if counts else 0


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--train", type=int, default=2000)
    p.add_argument("--valid", type=int, default=300)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    n, nc, mn = sample("train", args.train, args.seed)
    print(f"train: {n} images, {nc} classes, min per class {mn}")
    n2, nc2, mn2 = sample("valid", args.valid, args.seed)
    print(f"valid: {n2} images, {nc2} classes, min per class {mn2}")

    names = [l.split()[-1] for l in (ROOT / "data.yaml").read_text().splitlines() if l.startswith("- ")]
    with open(ROOT / "subset" / "data.yaml", "w") as f:
        f.write(f"train: {ROOT / 'subset' / 'train' / 'images'}\n")
        f.write(f"val: {ROOT / 'subset' / 'valid' / 'images'}\n")
        f.write(f"nc: {len(names)}\n")
        f.write("names:\n")
        for name in names:
            f.write(f"- {name}\n")


if __name__ == "__main__":
    main()