import os
import sys
import yaml
import time
import threading
import psutil
import torch
from pathlib import Path
from ultralytics import YOLO

# Global list to store CPU usage samples
cpu_samples = []
stop_cpu_monitor = threading.Event()

def monitor_cpu(pid, interval=5):
    """Monitor CPU utilization of the training process and the system."""
    try:
        proc = psutil.Process(pid)
    except Exception as e:
        print(f"Error initializing process monitor: {e}")
        return
        
    while not stop_cpu_monitor.is_set():
        try:
            # Get process CPU percent (can be > 100% on multi-core systems)
            proc_cpu = proc.cpu_percent(interval=None)
            # Get system-wide CPU percent
            sys_cpu = psutil.cpu_percent(interval=None)
            cpu_samples.append((time.time(), proc_cpu, sys_cpu))
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            break
        time.sleep(interval)

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
        if not full_img_path.exists():
            print(f"❌ Error: Image folder for split '{split_name}' does not exist: {full_img_path}")
            return False
            
        # Check corresponding labels folder
        if 'images' in full_img_path.name:
            full_lbl_path = Path(str(full_img_path).replace('images', 'labels'))
        else:
            full_lbl_path = full_img_path.parent / 'labels'
            
        if not full_lbl_path.exists():
            print(f"❌ Error: Label folder for split '{split_name}' does not exist: {full_lbl_path}")
            return False
            
        print(f"✅ Split '{split_name}' folder verified: {full_img_path} and {full_lbl_path}")
        
    # 3. Check for missing images or labels and that they can be loaded
    print("\nScanning dataset for consistency...")
    for split_name, split_path in splits.items():
        img_dir = (dataset_path / split_path).resolve()
        if 'images' in img_dir.name:
            lbl_dir = Path(str(img_dir).replace('images', 'labels'))
        else:
            lbl_dir = img_dir.parent / 'labels'
            
        img_files = list(img_dir.glob("*"))
        img_files = [f for f in img_files if f.suffix.lower() in ('.jpg', '.jpeg', '.png', '.bmp', '.webp')]
        lbl_files = list(lbl_dir.glob("*.txt"))
        
        print(f"  - Split '{split_name}': Found {len(img_files)} images and {len(lbl_files)} label files.")
        
        if len(img_files) == 0:
            print(f"❌ Error: Split '{split_name}' has 0 images.")
            return False
            
        missing_labels = []
        for img_f in img_files:
            lbl_f = lbl_dir / f"{img_f.stem}.txt"
            if not lbl_f.exists():
                missing_labels.append(img_f.name)
                
        if missing_labels:
            print(f"❌ Error: {len(missing_labels)} images in split '{split_name}' are missing label files!")
            return False
            
    print("✅ All splits verified. No missing images or labels.")
    print("=== DATASET VERIFICATION SUCCESSFUL ===\n")
    return True

def train_model():
    yaml_path = r"C:\Users\nikhi\Downloads\AIMS_20_CLEAN\data.yaml"
    output_dir = r"C:\Users\nikhi\Downloads\AIMS_20_TRAINING"
    name = "yolov8n_416_baseline"
    
    # 1. Verify dataset first
    if not verify_dataset(yaml_path):
        print("❌ Dataset verification failed! Aborting training.")
        sys.exit(1)
        
    # 2. Check device
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Training device selected: {device.upper()}")
    
    # 3. Load a completely fresh pretrained YOLOv8n model
    print("Loading fresh pretrained yolov8n.pt weights...")
    model = YOLO("yolov8n.pt")
    
    # Determine batch size: handle batch=-1 CPU fallback
    batch_size = -1
    if device == "cpu":
        print("⚠️ CPU detected. AutoBatch (batch=-1) requires GPU in Ultralytics.")
        print("Setting batch size to 32 as a safe baseline for CPU training.")
        batch_size = 32
        
    # Create output training directory
    os.makedirs(output_dir, exist_ok=True)
    
    # 4. Start CPU Monitoring thread
    pid = os.getpid()
    monitor_thread = threading.Thread(target=monitor_cpu, args=(pid, 5), daemon=True)
    monitor_thread.start()
    
    print("\nStarting YOLOv8n training run:")
    print(f"  - Dataset: {yaml_path}")
    print(f"  - Epochs: 30")
    print(f"  - Image size: 416")
    print(f"  - Batch size: {batch_size}")
    print(f"  - Patience: 10")
    print(f"  - Save directory: {os.path.join(output_dir, name)}")
    print(f"  - Device: {device}")
    
    start_time = time.time()
    
    try:
        results = model.train(
            data=yaml_path,
            epochs=30,
            imgsz=416,
            batch=batch_size,
            patience=10,
            device=device,
            project=output_dir,
            name=name,
            exist_ok=True,
            plots=True,
            val=True
        )
        success = True
    except Exception as e:
        print(f"❌ Training failed: {e}")
        success = False
        
    end_time = time.time()
    
    # Stop CPU monitoring
    stop_cpu_monitor.set()
    monitor_thread.join(timeout=2)
    
    total_time_seconds = end_time - start_time
    total_time_minutes = total_time_seconds / 60.0
    
    if success:
        print("\n=== TRAINING COMPLETED SUCCESSFULLY ===")
        print(f"Total Training Time: {total_time_minutes:.2f} minutes ({total_time_seconds:.2f} seconds)")
        
        # Analyze CPU utilization
        if cpu_samples:
            proc_cpus = [s[1] for s in cpu_samples if s[1] > 0]
            sys_cpus = [s[2] for s in cpu_samples]
            
            avg_sys_cpu = sum(sys_cpus) / len(sys_cpus) if sys_cpus else 0
            max_sys_cpu = max(sys_cpus) if sys_cpus else 0
            
            print(f"Average System CPU Utilization: {avg_sys_cpu:.2f}%")
            print(f"Maximum System CPU Utilization: {max_sys_cpu:.2f}%")
            
            if avg_sys_cpu > 70:
                print("CPU Utilization: REMAINS HIGH throughout the training run (Average > 70%).")
            else:
                print("CPU Utilization: Moderate/Low (Average <= 70%).")
        else:
            print("CPU Utilization: Data not available.")
            
        # Locate files
        run_path = Path(output_dir) / name
        print("\n--- RESULTS REPORT ---")
        print(f"Best Weights Path: {run_path / 'weights' / 'best.pt'}")
        print(f"Last Weights Path: {run_path / 'weights' / 'last.pt'}")
        print(f"results.csv Path:  {run_path / 'results.csv'}")
        print(f"confusion_matrix:  {run_path / 'confusion_matrix.png'}")
        print(f"results.png Path:  {run_path / 'results.png'}")
        
        # Parse metrics from results.csv
        csv_path = run_path / 'results.csv'
        if csv_path.exists():
            try:
                df = pd.read_csv(csv_path)
                df.columns = [c.strip() for c in df.columns]
                
                # Find metrics
                map50_col = next((c for c in df.columns if 'mAP50(B)' in c), 'metrics/mAP50(B)')
                map95_col = next((c for c in df.columns if 'mAP50-95(B)' in c), 'metrics/mAP50-95(B)')
                prec_col = next((c for c in df.columns if 'precision(B)' in c), 'metrics/precision(B)')
                rec_col = next((c for c in df.columns if 'recall(B)' in c), 'metrics/recall(B)')
                
                # Get best epoch row
                if map95_col in df.columns:
                    best_idx = df[map95_col].idxmax()
                    best_row = df.iloc[best_idx]
                    print("\n--- METRICS FROM BEST EPOCH ---")
                    print(f"Precision:  {best_row.get(prec_col, 'N/A')}")
                    print(f"Recall:     {best_row.get(rec_col, 'N/A')}")
                    print(f"mAP50:      {best_row.get(map50_col, 'N/A')}")
                    print(f"mAP50-95:   {best_row.get(map95_col, 'N/A')}")
            except Exception as ex:
                print(f"Could not parse results.csv metrics programmatically: {ex}")
    else:
        sys.exit(1)

if __name__ == "__main__":
    # Ensure pandas is installed as it is used for reporting
    try:
        import pandas as pd
    except ImportError:
        print("Installing pandas for CSV parsing...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pandas"])
    train_model()
