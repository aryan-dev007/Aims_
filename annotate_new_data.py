"""
Annotate new grocery datasets and build a unified training dataset.

This script:
1. Maps 15 Indian grocery categories to new class IDs (62-76, appended after
   the existing 62 Roboflow classes)
2. Generates YOLO bbox labels for single-product images in data/data/images/
3. Auto-annotates shelf screenshots using the existing trained model
4. Merges everything with the existing grocery.v9i.yolov8 dataset
5. Creates a unified_dataset/ with train/valid/test splits and data.yaml

Usage:
    python annotate_new_data.py
    python annotate_new_data.py --skip-shelf   # skip shelf screenshot annotation
"""
import argparse
import csv
import random
import shutil
from collections import defaultdict
from pathlib import Path

try:
    from ultralytics import YOLO
    HAS_ULTRALYTICS = True
except ImportError:
    HAS_ULTRALYTICS = False

ROOT = Path(__file__).resolve().parent
ROBOFLOW_DS = ROOT / "grocery.v9i.yolov8"
PRODUCT_IMGS = ROOT / "data" / "data" / "images"
SHELF_IMGS = ROOT / "Grocery snacks images" / "Grocery snacks images"
CSV_PATH = ROOT / "data" / "data" / "metadata" / "final_products.csv"
OUTPUT = ROOT / "unified_dataset"

# ── Existing 62 Roboflow classes (indices 0–61) ──────────────────────────────
ROBOFLOW_NAMES = [
    "BargsBlack20Oz", "BuenoShareSize", "CheetosCrunchy",
    "CheetosCrunchyFlaminHot", "CheetosCrunchyFlaminHotLimon",
    "CheetosCrunchyXXTRAFlaminHot", "CheetosPuffs", "CherryCocaCola20Oz",
    "CherryVanillaCocaCola20Oz", "ChipsAhoy", "ChipsAhoyKingSize",
    "CocaCola16Oz", "CocaCola20Oz", "CocaCola350Ml", "CocaColaSpiced20Oz",
    "CocaColaZero16Oz", "Crunch", "Crush16Oz", "DietCocaCola20Oz",
    "DietCokeCan16Oz", "DoritosCoolRanch", "DoritosNachoCheese",
    "DoritosSpicyNacho", "DrPapPepper1L", "DrPapPepper20Oz",
    "DrPapPepperCan16Oz", "Fanta20Oz", "FantaCan16Oz", "FantaGrape20Oz",
    "FantaZero20Oz", "FunyunsOnionFlavoredRingsFlaminHot", "LaysBarbecue",
    "LaysClassic", "LaysLimon", "LennyLarrysBirthdayCake",
    "LennyLarrysChocolateChips", "LennyLarrysDoubleChocolateChips",
    "LennyLarrysPeanutButter", "LennyLarrysPeanutButterChocolateChips",
    "LennyLarrysSnickerdoodle", "MinuteMaidBlueRaspberry20Oz",
    "MinuteMaidFruitPunch", "MinuteMaidLemonade20Oz",
    "MinuteMaidPinkLemonade", "MountainDew16Oz", "MtnDew16Oz",
    "NerdsShareSize", "Oreo", "OreoDoubleStufKingSize", "OreoKingSize",
    "PaydayShareSize", "SkittlesShareSize", "SourPunchShareSize",
    "Sprite20Oz", "Sprite40Oz", "SpriteCan16Oz", "SpriteCherry20Oz",
    "SpriteTropicalMix20Oz", "SpriteZero20Oz", "VanillaCocaCola20Oz",
    "WhatchamacallitKingSize", "ZeroCocaCola16Oz",
]

# ── 15 new Indian grocery categories (indices 62–76) ─────────────────────────
NEW_CATEGORIES = [
    "atta_flour",          # 62
    "biscuits",            # 63
    "chips_wafers",        # 64
    "chocolates",          # 65
    "coffee",              # 66
    "cooking_oil",         # 67
    "dal_pulses",          # 68
    "juices_packaged_drinks",  # 69
    "namkeen_snacks",      # 70
    "noodles_instant_food", # 71
    "rice",                # 72
    "sauces_ketchup",      # 73
    "soft_drinks",         # 74
    "spices_masala",       # 75
    "tea",                 # 76
]

ALL_NAMES = ROBOFLOW_NAMES + NEW_CATEGORIES
CATEGORY_TO_ID = {cat: i + 62 for i, cat in enumerate(NEW_CATEGORIES)}

SEED = 42
VAL_RATIO = 0.15  # 15% for validation


def copy_roboflow_dataset():
    """Copy existing Roboflow dataset splits into unified_dataset."""
    print("\n── Copying existing Roboflow dataset ──")
    for split in ("train", "valid", "test"):
        src = ROBOFLOW_DS / split
        if not src.exists():
            print(f"  ⚠ Skipping {split} (not found)")
            continue
        for sub in ("images", "labels"):
            src_dir = src / sub
            dst_dir = OUTPUT / split / sub
            dst_dir.mkdir(parents=True, exist_ok=True)
            if not src_dir.exists():
                continue
            files = list(src_dir.iterdir())
            copied = 0
            for f in files:
                if f.is_file():
                    dst = dst_dir / f.name
                    if not dst.exists():
                        shutil.copy2(f, dst)
                        copied += 1
            print(f"  {split}/{sub}: copied {copied} files")


def annotate_product_images():
    """Generate YOLO labels for single-product images using folder→category mapping."""
    print("\n── Annotating single-product images ──")

    # Collect all images by category from folder structure
    all_items = []
    for category_dir in sorted(PRODUCT_IMGS.iterdir()):
        if not category_dir.is_dir() or category_dir.name.startswith("."):
            continue
        cat_name = category_dir.name
        if cat_name not in CATEGORY_TO_ID:
            print(f"  ⚠ Unknown category folder: {cat_name}, skipping")
            continue
        class_id = CATEGORY_TO_ID[cat_name]
        imgs = [f for f in category_dir.iterdir()
                if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
        for img in imgs:
            all_items.append((img, class_id, cat_name))

    print(f"  Found {len(all_items)} product images across {len(NEW_CATEGORIES)} categories")

    # Shuffle and split into train/val
    rng = random.Random(SEED)
    rng.shuffle(all_items)
    n_val = max(1, int(len(all_items) * VAL_RATIO))
    val_items = all_items[:n_val]
    train_items = all_items[n_val:]

    stats = defaultdict(lambda: {"train": 0, "valid": 0})

    for split, items in [("train", train_items), ("valid", val_items)]:
        img_dir = OUTPUT / split / "images"
        lbl_dir = OUTPUT / split / "labels"
        img_dir.mkdir(parents=True, exist_ok=True)
        lbl_dir.mkdir(parents=True, exist_ok=True)

        for img_path, class_id, cat_name in items:
            # Use a unique prefix to avoid name collisions with Roboflow images
            dst_name = f"ind_{cat_name}_{img_path.stem}"
            dst_img = img_dir / f"{dst_name}{img_path.suffix}"
            dst_lbl = lbl_dir / f"{dst_name}.txt"

            shutil.copy2(img_path, dst_img)

            # Full-frame bounding box: class_id cx cy w h
            # Using 0.5 0.5 0.9 0.9 (slightly inset) since products usually
            # don't perfectly fill the entire frame
            with open(dst_lbl, "w") as f:
                f.write(f"{class_id} 0.5 0.5 0.9 0.9\n")

            stats[cat_name][split] += 1

    print("\n  Per-category breakdown:")
    for cat in sorted(stats):
        s = stats[cat]
        print(f"    {cat:30s}  train={s['train']:4d}  valid={s['valid']:3d}")

    total_train = sum(s["train"] for s in stats.values())
    total_val = sum(s["valid"] for s in stats.values())
    print(f"\n  Total: train={total_train}, valid={total_val}")
    return total_train + total_val


def annotate_shelf_screenshots(model_path="models/best.pt"):
    """Auto-annotate shelf screenshots using the existing trained model."""
    print("\n── Auto-annotating shelf screenshots ──")

    if not SHELF_IMGS.exists():
        print("  ⚠ Shelf images directory not found, skipping")
        return 0

    if not HAS_ULTRALYTICS:
        print("  ⚠ ultralytics not installed, skipping shelf annotation")
        return 0

    model_file = ROOT / model_path
    if not model_file.exists():
        print(f"  ⚠ Model not found at {model_file}, skipping shelf annotation")
        return 0

    model = YOLO(str(model_file))

    imgs = [f for f in SHELF_IMGS.iterdir()
            if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
    print(f"  Found {len(imgs)} shelf images")

    if not imgs:
        return 0

    # Split shelf images: 85% train, 15% val
    rng = random.Random(SEED)
    rng.shuffle(imgs)
    n_val = max(1, int(len(imgs) * VAL_RATIO))
    val_imgs = set(f.name for f in imgs[:n_val])

    annotated = 0
    for img_path in imgs:
        split = "valid" if img_path.name in val_imgs else "train"
        img_dir = OUTPUT / split / "images"
        lbl_dir = OUTPUT / split / "labels"
        img_dir.mkdir(parents=True, exist_ok=True)
        lbl_dir.mkdir(parents=True, exist_ok=True)

        # Run inference
        results = model.predict(
            source=str(img_path),
            conf=0.25,
            iou=0.45,
            imgsz=640,
            verbose=False,
        )

        if not results or len(results[0].boxes) == 0:
            continue

        r = results[0]
        h, w = r.orig_shape

        # Write YOLO bbox labels
        dst_name = f"shelf_{img_path.stem}"
        dst_img = img_dir / f"{dst_name}{img_path.suffix}"
        dst_lbl = lbl_dir / f"{dst_name}.txt"

        shutil.copy2(img_path, dst_img)

        with open(dst_lbl, "w") as f:
            for box in r.boxes:
                cls_id = int(box.cls)
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                # Convert to YOLO format: cx cy w h (normalized)
                cx = ((x1 + x2) / 2) / w
                cy = ((y1 + y2) / 2) / h
                bw = (x2 - x1) / w
                bh = (y2 - y1) / h
                conf = float(box.conf)
                f.write(f"{cls_id} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}\n")

        n_det = len(r.boxes)
        annotated += 1

    print(f"  Auto-annotated {annotated}/{len(imgs)} shelf images")
    return annotated


def write_data_yaml():
    """Write the unified data.yaml with all 77 classes."""
    print("\n── Writing unified data.yaml ──")

    yaml_path = OUTPUT / "data.yaml"

    # Use Windows absolute paths
    train_path = str(OUTPUT / "train" / "images").replace("\\", "/")
    val_path = str(OUTPUT / "valid" / "images").replace("\\", "/")
    test_path = str(OUTPUT / "test" / "images").replace("\\", "/")

    lines = [
        f"train: {train_path}",
        f"val: {val_path}",
    ]
    if (OUTPUT / "test" / "images").exists():
        lines.append(f"test: {test_path}")

    lines.append(f"nc: {len(ALL_NAMES)}")
    lines.append("names:")
    for name in ALL_NAMES:
        lines.append(f"  - {name}")

    yaml_path.write_text("\n".join(lines) + "\n")
    print(f"  Written to {yaml_path}")
    print(f"  Total classes: {len(ALL_NAMES)}")


def print_dataset_summary():
    """Print final dataset statistics."""
    print("\n── Unified Dataset Summary ──")
    for split in ("train", "valid", "test"):
        img_dir = OUTPUT / split / "images"
        lbl_dir = OUTPUT / split / "labels"
        if img_dir.exists():
            n_imgs = len(list(img_dir.iterdir()))
            n_lbls = len(list(lbl_dir.iterdir())) if lbl_dir.exists() else 0
            print(f"  {split:6s}: {n_imgs:6d} images, {n_lbls:6d} labels")
        else:
            print(f"  {split:6s}: (not found)")


def main():
    p = argparse.ArgumentParser(description="Build unified grocery dataset")
    p.add_argument("--skip-shelf", action="store_true",
                    help="Skip auto-annotating shelf screenshots")
    p.add_argument("--model", default="models/best.pt",
                    help="Model for shelf annotation")
    args = p.parse_args()

    print("=" * 60)
    print("  UNIFIED GROCERY DATASET BUILDER")
    print("=" * 60)

    # Step 1: Copy existing Roboflow dataset
    copy_roboflow_dataset()

    # Step 2: Annotate single-product images
    annotate_product_images()

    # Step 3: Auto-annotate shelf screenshots
    if not args.skip_shelf:
        annotate_shelf_screenshots(args.model)
    else:
        print("\n── Skipping shelf screenshot annotation ──")

    # Step 4: Write unified data.yaml
    write_data_yaml()

    # Step 5: Summary
    print_dataset_summary()

    print("\n" + "=" * 60)
    print("  DONE! Train with:")
    print(f"  python train.py --data {OUTPUT / 'data.yaml'} --epochs 50 --imgsz 640")
    print("=" * 60)


if __name__ == "__main__":
    main()
