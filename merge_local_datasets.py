"""
Merge local datasets:
1. local_dataset_to_merge (YOLO dataset with train/valid/test splits and data.yaml)
2. New_dataset_with_metadats (folders of raw images structured by category)

Outputs:
- Merged images/labels in unified_dataset/
- Updated unified_dataset/data.yaml
- Updated configurations in predict_server.py, predict_frame.py, and backend/src/config.js
"""
import os
import sys
import shutil
import random
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parent
UNIFIED = ROOT / "unified_dataset"
LOCAL1_DIR = ROOT / "local_dataset_to_merge"
LOCAL2_DIR = ROOT / "New_dataset_with_metadats" / "amit_data" / "data"

VAL_RATIO = 0.15  # 15% validation split for new raw images
SEED = 42

def get_existing_names():
    yaml_path = UNIFIED / "data.yaml"
    if not yaml_path.exists():
        yaml_path = ROOT / "data.yaml"
    
    if not yaml_path.exists():
        print("[ERROR] Could not find data.yaml in unified_dataset/ or root folder.")
        sys.exit(1)
        
    with open(yaml_path, "r") as f:
        data = yaml.safe_load(f)
    return data.get("names", []), yaml_path

def update_file_thresholds(file_path, new_classes):
    """Programmatically insert new class thresholds into a python or JS config file."""
    if not file_path.exists():
        print(f"  [WARNING] File not found, skipping update: {file_path}")
        return

    content = file_path.read_text(encoding="utf-8")
    modified = False
    
    if file_path.suffix == ".py":
        signature = "# Indian grocery categories"
        if signature in content:
            lines = content.splitlines()
            for i, line in enumerate(lines):
                if signature in line:
                    # Insert new categories below it
                    new_lines = [f"    \"{cls}\": 4," for cls in new_classes if f"\"{cls}\"" not in content]
                    if new_lines:
                        lines[i+1:i+1] = new_lines
                        content = "\n".join(lines) + "\n"
                        modified = True
                    break
    elif file_path.suffix == ".js":
        signature = "// Indian grocery categories"
        if signature in content:
            lines = content.splitlines()
            for i, line in enumerate(lines):
                if signature in line:
                    new_lines = [f"    {cls}: 4," for cls in new_classes if f"{cls}:" not in content]
                    if new_lines:
                        lines[i+1:i+1] = new_lines
                        content = "\n".join(lines) + "\n"
                        modified = True
                    break

    if modified:
        file_path.write_text(content, encoding="utf-8")
        print(f"  [SUCCESS] Updated thresholds in {file_path.name}")
    else:
        print(f"  [INFO] No threshold updates needed or signature not found in {file_path.name}")

def main():
    print("=" * 60)
    print("      LOCAL DATASET MERGER")
    print("=" * 60)

    # 1. Load existing classes
    existing_names, existing_yaml_path = get_existing_names()
    print(f"Loaded {len(existing_names)} existing classes.")

    # We will map brand names from dataset 1 and category names from dataset 2
    new_classes_to_add = []
    
    # --- PART A: Process local_dataset_to_merge ---
    print("\n--- Processing Part 1: local_dataset_to_merge ---")
    if not LOCAL1_DIR.exists():
        print(f"Directory {LOCAL1_DIR} does not exist.")
        sys.exit(1)
        
    local1_yaml_path = LOCAL1_DIR / "data.yaml"
    if not local1_yaml_path.exists():
        print(f"Missing {local1_yaml_path}")
        sys.exit(1)
        
    with open(local1_yaml_path, "r") as f:
        local1_cfg = yaml.safe_load(f)
    local1_names = local1_cfg.get("names", [])
    if isinstance(local1_names, dict):
        local1_names = [local1_names[k] for k in sorted(local1_names.keys())]

    print(f"Found {len(local1_names)} classes in local_dataset_to_merge.")
    
    # Map class IDs for local1
    local1_mapping = {}
    existing_normalized = {name.lower().replace(" ", "").replace("_", "-"): i for i, name in enumerate(existing_names)}
    
    for idx, name in enumerate(local1_names):
        norm_name = name.lower().replace(" ", "").replace("_", "-")
        if norm_name in existing_normalized:
            match_idx = existing_normalized[norm_name]
            local1_mapping[idx] = match_idx
            print(f"  Match: '{name}' -> existing ID {match_idx}")
        else:
            clean_name = name.replace(" ", "")
            new_id = len(existing_names) + len(new_classes_to_add)
            local1_mapping[idx] = new_id
            new_classes_to_add.append(clean_name)
            print(f"  New Class: '{name}' -> will be added as '{clean_name}' (ID {new_id})")

    # Copy files for local1
    local1_copied = 0
    for split in ("train", "valid", "test"):
        src_img_dir = LOCAL1_DIR / split / "images"
        src_lbl_dir = LOCAL1_DIR / split / "labels"
        
        dst_img_dir = UNIFIED / split / "images"
        dst_lbl_dir = UNIFIED / split / "labels"
        
        if not src_img_dir.exists():
            continue
            
        dst_img_dir.mkdir(parents=True, exist_ok=True)
        dst_lbl_dir.mkdir(parents=True, exist_ok=True)
        
        for img_path in src_img_dir.iterdir():
            if not img_path.is_file() or img_path.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
                continue
                
            # Prefix with 'ind_local1_' so the fine-tuning script picks it up
            dst_name = f"ind_local1_{img_path.name}"
            shutil.copy2(img_path, dst_img_dir / dst_name)
            
            lbl_path = src_lbl_dir / f"{img_path.stem}.txt"
            dst_lbl_path = dst_lbl_dir / f"ind_local1_{img_path.stem}.txt"
            
            if lbl_path.exists():
                lines = lbl_path.read_text().splitlines()
                new_lines = []
                for line in lines:
                    parts = line.strip().split()
                    if not parts:
                        continue
                    old_cls = int(parts[0])
                    new_cls = local1_mapping.get(old_cls, old_cls)
                    new_lines.append(f"{new_cls} " + " ".join(parts[1:]))
                dst_lbl_path.write_text("\n".join(new_lines) + "\n")
            
            local1_copied += 1
            
    print(f"Copied {local1_copied} images/labels from local_dataset_to_merge.")

    # --- PART B: Process New_dataset_with_metadats ---
    print("\n--- Processing Part 2: New_dataset_with_metadats ---")
    if not LOCAL2_DIR.exists():
        print(f"Directory {LOCAL2_DIR} does not exist.")
        sys.exit(1)
        
    local2_img_dir = LOCAL2_DIR / "images"
    if not local2_img_dir.exists():
        print(f"Missing images directory in New_dataset_with_metadats: {local2_img_dir}")
        sys.exit(1)
        
    # Categories are subfolders in local2_img_dir
    local2_categories = sorted([d.name for d in local2_img_dir.iterdir() if d.is_dir() and not d.name.startswith(".")])
    print(f"Found {len(local2_categories)} category folders: {local2_categories}")
    
    local2_mapping = {}
    for cat in local2_categories:
        norm_cat = cat.lower().replace(" ", "").replace("_", "-")
        # Check if already exists in existing_names or is already added by local1
        all_current_names = existing_names + new_classes_to_add
        all_current_normalized = {n.lower().replace(" ", "").replace("_", "-"): i for i, n in enumerate(all_current_names)}
        
        if norm_cat in all_current_normalized:
            match_idx = all_current_normalized[norm_cat]
            local2_mapping[cat] = match_idx
            print(f"  Match: Category '{cat}' -> existing ID {match_idx}")
        else:
            clean_name = cat.replace(" ", "")
            new_id = len(existing_names) + len(new_classes_to_add)
            local2_mapping[cat] = new_id
            new_classes_to_add.append(clean_name)
            print(f"  New Category: '{cat}' -> will be added as '{clean_name}' (ID {new_id})")

    # Process and split category single-product images (generate full frame bounding boxes)
    local2_copied = 0
    rng = random.Random(SEED)
    
    for cat in local2_categories:
        class_id = local2_mapping[cat]
        cat_folder = local2_img_dir / cat
        imgs = sorted([f for f in cat_folder.iterdir() if f.is_file() and f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")])
        
        rng.shuffle(imgs)
        n_val = max(1, int(len(imgs) * VAL_RATIO))
        val_imgs = set(f.name for f in imgs[:n_val])
        
        for img_path in imgs:
            split = "valid" if img_path.name in val_imgs else "train"
            dst_img_dir = UNIFIED / split / "images"
            dst_lbl_dir = UNIFIED / split / "labels"
            
            dst_img_dir.mkdir(parents=True, exist_ok=True)
            dst_lbl_dir.mkdir(parents=True, exist_ok=True)
            
            dst_name = f"ind_local2_{cat}_{img_path.name}"
            shutil.copy2(img_path, dst_img_dir / dst_name)
            
            # Write a full-frame YOLO label: class_id cx cy w h
            dst_lbl_path = dst_lbl_dir / f"ind_local2_{cat}_{img_path.stem}.txt"
            with open(dst_lbl_path, "w") as f:
                f.write(f"{class_id} 0.5 0.5 0.9 0.9\n")
                
            local2_copied += 1
            
    print(f"Copied {local2_copied} images and generated full-frame labels from New_dataset_with_metadats.")

    # --- PART C: Save updated data.yaml ---
    print("\n--- Updating data.yaml ---")
    all_names = existing_names + new_classes_to_add
    
    train_path = str(UNIFIED / "train" / "images").replace("\\", "/")
    val_path = str(UNIFIED / "valid" / "images").replace("\\", "/")
    test_path = str(UNIFIED / "test" / "images").replace("\\", "/")

    yaml_lines = [
        f"train: {train_path}",
        f"val: {val_path}",
        f"test: {test_path}",
        f"nc: {len(all_names)}",
        "names:"
    ]
    for name in all_names:
        yaml_lines.append(f"  - {name}")

    existing_yaml_path.write_text("\n".join(yaml_lines) + "\n")
    print(f"  [SUCCESS] Updated {existing_yaml_path} with {len(all_names)} total classes.")

    # --- PART D: Update threshold files ---
    if new_classes_to_add:
        print("\n--- Updating System Configs and Thresholds ---")
        update_file_thresholds(ROOT / "predict_server.py", new_classes_to_add)
        update_file_thresholds(ROOT / "predict_frame.py", new_classes_to_add)
        update_file_thresholds(ROOT / "backend" / "src" / "config.js", new_classes_to_add)

    print("\n" + "=" * 60)
    print("  MERGE COMPLETE!")
    print(f"  Added {local1_copied} labeled items from local_dataset_to_merge.")
    print(f"  Added {local2_copied} items from New_dataset_with_metadats.")
    print(f"  Total classes now: {len(all_names)} (added {len(new_classes_to_add)} classes)")
    print("=" * 60)

if __name__ == "__main__":
    main()
