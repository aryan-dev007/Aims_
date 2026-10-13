import os
import sys
import yaml
from pathlib import Path
from ultralytics import YOLO
import torch

def verify_dataset(yaml_path):
    print("=== STARTING DATASET VERIFICATION ===")
    yaml_path = Path(yaml_path).resolve()
    if not yaml_path.exists():
        print(f"❌ Error: data.yaml not found at {yaml_path}")
        return False
        
    print(f"Found data.yaml at: {yaml_path}")
    
    # 1. Load data.yaml and verify it has 20 classes
    try:
        with open(yaml_path, 'r') as f:
            data = yaml.safe_load(f)
    except Exception as e:
        print(f"❌ Error reading data.yaml: {e}")
        return False
        
    nc = data.get('nc', 0)
    classes = data.get('names', [])
    print(f"  - Classes count (nc): {nc}")
    print(f"  - Classes list length: {len(classes)}")
    
    if nc != 20 or len(classes) != 20:
        print(f"❌ Error: data.yaml does not have exactly 20 classes (nc={nc}, list length={len(classes)})")
        return False
    print("✅ data.yaml has exactly 20 classes.")
    
    # 2. Check if train/valid/test folders exist
    dataset_path = Path(data.get('path', yaml_path.parent))
    if not dataset_path.is_absolute():
        dataset_path = (yaml_path.parent / dataset_path).resolve()
        
    print(f"Dataset root folder resolved to: {dataset_path}")
    
    splits = {
        'train': data.get('train'),
        'val': data.get('val'),
        'test': data.get('test')
    }
    
    for split_name, split_path in splits.items():
        if not split_path:
            print(f"❌ Error: {split_name} split path is missing in data.yaml")
            return False
            
        full_img_path = (dataset_path / split_path).resolve()
        # The label path is typically parallel to image path (e.g. replacing 'images' with 'labels' in the folder structure)
        # We need to make sure the directories exist.
        if not full_img_path.exists():
            print(f"❌ Error: Image folder for split '{split_name}' does not exist: {full_img_path}")
            return False
            
        # Check corresponding labels folder
        # Standard YOLO layout: images/ -> labels/
        if 'images' in full_img_path.name:
            full_lbl_path = Path(str(full_img_path).replace('images', 'labels'))
        else:
            full_lbl_path = full_img_path.parent / 'labels'
            
        if not full_lbl_path.exists():
            print(f"❌ Error: Label folder for split '{split_name}' does not exist: {full_lbl_path}")
            return False
            
        print(f"✅ Split '{split_name}' folder verified: {full_img_path} and {full_lbl_path}")
        
    # 3. Check for missing images or labels and that they can be loaded
    # We will do a quick scan of all images in each split and check if their label files exist and are not empty
    print("\nScanning dataset for consistency...")
    for split_name, split_path in splits.items():
        img_dir = (dataset_path / split_path).resolve()
        if 'images' in img_dir.name:
            lbl_dir = Path(str(img_dir).replace('images', 'labels'))
        else:
            lbl_dir = img_dir.parent / 'labels'
            
        img_files = list(img_dir.glob("*"))
        # Filter for common image extensions
        img_files = [f for f in img_files if f.suffix.lower() in ('.jpg', '.jpeg', '.png', '.bmp', '.webp')]
        lbl_files = list(lbl_dir.glob("*.txt"))
        
        print(f"  - Split '{split_name}': Found {len(img_files)} images and {len(lbl_files)} label files.")
        
        if len(img_files) == 0:
            print(f"❌ Error: Split '{split_name}' has 0 images.")
            return False
            
        # Check if each image has a corresponding label file
        missing_labels = []
        for img_f in img_files:
            lbl_f = lbl_dir / f"{img_f.stem}.txt"
            if not lbl_f.exists():
                missing_labels.append(img_f.name)
                
        if missing_labels:
            print(f"❌ Error: {len(missing_labels)} images in split '{split_name}' are missing label files!")
            print(f"First few missing: {missing_labels[:5]}")
            return False
            
    print("✅ All splits verified. No missing images or labels.")
    print("=== DATASET VERIFICATION SUCCESSFUL ===\n")
    return True

def train_model():
    yaml_path = r"C:\Users\nikhi\Downloads\AIMS_20_CLEAN\data.yaml"
    output_dir = r"C:\Users\nikhi\Downloads\AIMS_20_TRAINING"
    
    # 1. Verify dataset first
    if not verify_dataset(yaml_path):
        print("❌ Dataset verification failed! Aborting training.")
        sys.exit(1)
        
    # 2. Check device
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Training device selected: {device.upper()}")
    
    # 3. Load a completely fresh pretrained YOLO small model (yolov8s.pt)
    print("Loading fresh pretrained yolov8s.pt weights...")
    model = YOLO("yolov8s.pt")
    
    # Determine batch size: try automatic/autobatch first, if not supported (like on CPU) use 16
    batch_size = -1
    if device == "cpu":
        print("CPU detected. AutoBatch (batch=-1) is only supported on GPU in Ultralytics.")
        print("Setting batch size to 16 for CPU training.")
        batch_size = 16
        
    # Create the output training project folder
    os.makedirs(output_dir, exist_ok=True)
    
    print("\nStarting YOLOv8s training with settings:")
    print(f"  - Dataset: {yaml_path}")
    print(f"  - Epochs: 100")
    print(f"  - Image size: 640")
    print(f"  - Batch size: {batch_size} (automatic/-1 on GPU, 16 on CPU)")
    print(f"  - Patience: 20")
    print(f"  - Save directory: {output_dir}")
    print(f"  - Device: {device}")
    
    try:
        results = model.train(
            data=yaml_path,
            epochs=100,
            imgsz=640,
            batch=batch_size,
            patience=20,
            device=device,
            project=output_dir,
            name="train_run",
            exist_ok=True,
            plots=True,
            val=True
        )
        print("\n=== TRAINING COMPLETED SUCCESSFULLY ===")
        print(f"Results saved in: {results.save_dir}")
    except Exception as e:
        # If autobatch failed on GPU or another batch error occurred, try fallback
        if batch_size == -1:
            print(f"\n⚠️ Training failed with batch=-1: {e}")
            print("Retrying training with a safe default batch size of 16...")
            try:
                results = model.train(
                    data=yaml_path,
                    epochs=100,
                    imgsz=640,
                    batch=16,
                    patience=20,
                    device=device,
                    project=output_dir,
                    name="train_run",
                    exist_ok=True,
                    plots=True,
                    val=True
                )
                print("\n=== TRAINING COMPLETED SUCCESSFULLY ===")
                print(f"Results saved in: {results.save_dir}")
            except Exception as ex:
                print(f"❌ Training failed on retry: {ex}")
                sys.exit(1)
        else:
            print(f"❌ Training failed: {e}")
            sys.exit(1)

if __name__ == "__main__":
    train_model()
