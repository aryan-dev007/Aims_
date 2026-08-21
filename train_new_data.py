"""
Fast training script optimized for CPU / no-GPU machines.

Instead of training on the full 25K+ image dataset, this:
1. Creates a focused dataset with ONLY the new Indian grocery data
   (1,464 product images + 56 shelf screenshots ≈ 1,520 images)
2. Fine-tunes from the EXISTING best.pt weights (transfer learning)
3. Uses smaller imgsz (416) for faster CPU training
4. Trains for 30 epochs — enough for fine-tuning on small focused data

This takes ~1-2 hours on CPU instead of 26+ hours.

Usage:
    python train_new_data.py
    python train_new_data.py --epochs 50 --imgsz 640    # higher quality, slower
"""
import argparse
import random
import shutil
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
UNIFIED = ROOT / "unified_dataset"
FOCUSED = ROOT / "focused_dataset"


def build_focused_dataset():
    """Extract only new data (Indian grocery + shelf images) into a focused dataset."""
    print("── Building focused dataset (new data only) ──")

    FOCUSED.mkdir(exist_ok=True)

    for split in ("train", "valid"):
        src_img = UNIFIED / split / "images"
        src_lbl = UNIFIED / split / "labels"
        dst_img = FOCUSED / split / "images"
        dst_lbl = FOCUSED / split / "labels"
        dst_img.mkdir(parents=True, exist_ok=True)
        dst_lbl.mkdir(parents=True, exist_ok=True)

        copied = 0
        for img in src_img.iterdir():
            if not img.is_file():
                continue
            # Only copy new images (prefixed with ind_ or shelf_)
            if img.stem.startswith("ind_") or img.stem.startswith("shelf_"):
                lbl = src_lbl / f"{img.stem}.txt"
                shutil.copy2(img, dst_img / img.name)
                if lbl.exists():
                    shutil.copy2(lbl, dst_lbl / lbl.name)
                copied += 1

        print(f"  {split}: {copied} images")

    # Also add a sample of existing Roboflow data for stability (prevents
    # catastrophic forgetting during fine-tuning)
    print("\n  Adding 500 random Roboflow samples for stability...")
    rng = random.Random(42)
    existing_imgs = [
        f for f in (UNIFIED / "train" / "images").iterdir()
        if f.is_file() and not f.stem.startswith(("ind_", "shelf_"))
    ]
    rng.shuffle(existing_imgs)
    for img in existing_imgs[:500]:
        lbl = UNIFIED / "train" / "labels" / f"{img.stem}.txt"
        dst_img = FOCUSED / "train" / "images" / img.name
        dst_lbl = FOCUSED / "train" / "labels" / f"{img.stem}.txt"
        if not dst_img.exists():
            shutil.copy2(img, dst_img)
        if lbl.exists() and not dst_lbl.exists():
            shutil.copy2(lbl, dst_lbl)

    # Write data.yaml using the SAME class list as unified_dataset
    # (77 classes) so the model stays compatible
    src_yaml = UNIFIED / "data.yaml"
    dst_yaml = FOCUSED / "data.yaml"

    yaml_lines = src_yaml.read_text().splitlines()
    new_lines = []
    for line in yaml_lines:
        if line.startswith("train:"):
            new_lines.append(f"train: {str(FOCUSED / 'train' / 'images').replace(chr(92), '/')}")
        elif line.startswith("val:"):
            new_lines.append(f"val: {str(FOCUSED / 'valid' / 'images').replace(chr(92), '/')}")
        elif line.startswith("test:"):
            continue  # no test split for focused
        else:
            new_lines.append(line)

    dst_yaml.write_text("\n".join(new_lines) + "\n")

    n_train = len(list((FOCUSED / "train" / "images").iterdir()))
    n_val = len(list((FOCUSED / "valid" / "images").iterdir()))
    print(f"\n  Focused dataset ready: {n_train} train + {n_val} val images")
    return dst_yaml


def resume_training():
    """Resume training from the last checkpoint using YOLO's built-in resume."""
    last_pt = ROOT / "runs" / "detect" / "runs" / "detect" / "new_data_finetune" / "weights" / "last.pt"
    if not last_pt.exists():
        print(f"❌ No checkpoint found at {last_pt}")
        print("   Run without --resume to start fresh training.")
        return

    print(f"\n── Resuming training from {last_pt} ──")
    print("   (will continue from the last completed epoch)\n")
    model = YOLO(str(last_pt))
    results = model.train(resume=True)

    # Copy best weights after completion
    best_pt = Path(results.save_dir) / "weights" / "best.pt"
    if best_pt.exists():
        dst = ROOT / "models" / "best.pt"
        dst.parent.mkdir(exist_ok=True)
        shutil.copy2(best_pt, dst)
        print(f"\n✅ Best weights copied to {dst}")

    print(f"\nTraining complete! Best model: {results.save_dir}/weights/best.pt")
    print("\nNext steps:")
    print("  1. Export: python export.py --imgsz 640")
    print("  2. Test:   python predict.py --source unified_dataset/valid/images")
    print("  3. Run:    python opencv_detect.py --source 0")


def main():
    p = argparse.ArgumentParser(description="Fast fine-tune on new grocery data")
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--imgsz", type=int, default=416,
                   help="416 for speed on CPU, 640 for quality")
    p.add_argument("--batch", type=int, default=8)
    p.add_argument("--base-model", default="models/best.pt",
                   help="Base model to fine-tune from (transfer learning)")
    p.add_argument("--name", default="new_data_finetune")
    p.add_argument("--resume", action="store_true",
                   help="Resume training from last checkpoint")
    args = p.parse_args()

    # If resuming, skip dataset build and use last.pt directly
    if args.resume:
        resume_training()
        return

    # Step 1: Build focused dataset
    data_yaml = build_focused_dataset()

    # Step 2: Load existing model for fine-tuning
    base = ROOT / args.base_model
    if base.exists():
        print(f"\n── Fine-tuning from {base} (transfer learning) ──")
        model = YOLO(str(base))
    else:
        print(f"\n── Base model not found at {base}, training from scratch ──")
        model = YOLO("yolov8n.pt")

    # Step 3: Train
    print(f"\n── Training: {args.epochs} epochs, imgsz={args.imgsz}, batch={args.batch} ──")
    print(f"   Dataset: {data_yaml}")
    print(f"   Estimated time: ~{args.epochs * 3}-{args.epochs * 5} minutes on CPU\n")

    results = model.train(
        data=str(data_yaml),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device="cpu",
        workers=0,
        optimizer="AdamW",
        lr0=0.0005,         # Lower LR for fine-tuning (half of normal)
        lrf=0.01,
        momentum=0.9,
        weight_decay=0.0005,
        warmup_epochs=2.0,
        cos_lr=True,
        close_mosaic=5,
        patience=10,
        freeze=10,           # Freeze first 10 layers for faster fine-tuning
        val=True,
        save=True,
        project="runs/detect",
        name=args.name,
        exist_ok=True,
        plots=True,
        seed=42,
    )

    # Step 4: Copy best weights
    best_pt = Path(results.save_dir) / "weights" / "best.pt"
    if best_pt.exists():
        dst = ROOT / "models" / "best.pt"
        dst.parent.mkdir(exist_ok=True)
        shutil.copy2(best_pt, dst)
        print(f"\n✅ Best weights copied to {dst}")

    print(f"\nTraining complete! Best model: {results.save_dir}/weights/best.pt")
    print("\nNext steps:")
    print("  1. Export: python export.py --imgsz 640")
    print("  2. Test:   python predict.py --source unified_dataset/valid/images")
    print("  3. Run:    python opencv_detect.py --source 0")


if __name__ == "__main__":
    main()
