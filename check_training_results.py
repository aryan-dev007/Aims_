import os
import pandas as pd
from pathlib import Path

def check_results():
    run_dir = Path(r"C:\Users\nikhi\Downloads\AIMS_20_TRAINING\yolov8n_416_baseline")
    results_csv = run_dir / "results.csv"
    
    if not results_csv.exists():
        print(f"❌ Training results not found yet at: {results_csv}")
        print("   The training process is likely still running or has not written the results yet.")
        return
        
    try:
        df = pd.read_csv(results_csv)
    except Exception as e:
        print(f"❌ Error reading results.csv: {e}")
        return
        
    if len(df) == 0:
        print("⚠️ results.csv is currently empty. Training has just started.")
        return
        
    # Clean column names (strip whitespace)
    df.columns = [c.strip() for c in df.columns]
    
    # Try to find metric columns
    map50_col = None
    map95_col = None
    precision_col = None
    recall_col = None
    
    for col in df.columns:
        if 'mAP50(B)' in col:
            map50_col = col
        elif 'mAP50-95(B)' in col:
            map95_col = col
        elif 'precision(B)' in col:
            precision_col = col
        elif 'recall(B)' in col:
            recall_col = col
            
    # Default columns if not found
    map50_col = map50_col or 'metrics/mAP50(B)'
    map95_col = map95_col or 'metrics/mAP50-95(B)'
    precision_col = precision_col or 'metrics/precision(B)'
    recall_col = recall_col or 'metrics/recall(B)'
    
    # Find best epoch based on mAP50-95 if column exists, otherwise last epoch
    if map95_col in df.columns:
        best_row_idx = df[map95_col].idxmax()
    else:
        best_row_idx = len(df) - 1
        
    best_epoch_data = df.iloc[best_row_idx]
    
    print("==================================================")
    print("          YOLOv8 TRAINING REPORT (AIMS_20)")
    print("==================================================")
    print(f"Total Epochs Completed: {len(df)}")
    print(f"Best Epoch (based on mAP50-95): {int(best_epoch_data.get('epoch', best_row_idx + 1))}")
    
    print("\n--- Model Paths ---")
    print(f"Best Model Path: {run_dir / 'weights' / 'best.pt'}")
    print(f"Last Model Path: {run_dir / 'weights' / 'last.pt'}")
    
    print("\n--- Metrics (Best Epoch) ---")
    val_map50 = best_epoch_data.get(map50_col, 'N/A')
    val_map95 = best_epoch_data.get(map95_col, 'N/A')
    val_prec = best_epoch_data.get(precision_col, 'N/A')
    val_rec = best_epoch_data.get(recall_col, 'N/A')
    
    print(f"mAP50:      {f'{val_map50:.4f}' if isinstance(val_map50, float) else val_map50}")
    print(f"mAP50-95:   {f'{val_map95:.4f}' if isinstance(val_map95, float) else val_map95}")
    print(f"Precision:  {f'{val_prec:.4f}' if isinstance(val_prec, float) else val_prec}")
    print(f"Recall:     {f'{val_rec:.4f}' if isinstance(val_rec, float) else val_rec}")
    
    print("\n--- Losses (Best Epoch) ---")
    train_box = best_epoch_data.get('train/box_loss', 'N/A')
    train_cls = best_epoch_data.get('train/cls_loss', 'N/A')
    train_dfl = best_epoch_data.get('train/dfl_loss', 'N/A')
    val_box = best_epoch_data.get('val/box_loss', 'N/A')
    val_cls = best_epoch_data.get('val/cls_loss', 'N/A')
    val_dfl = best_epoch_data.get('val/dfl_loss', 'N/A')
    
    print(f"Train Box Loss: {f'{train_box:.4f}' if isinstance(train_box, float) else train_box}")
    print(f"Train Cls Loss: {f'{train_cls:.4f}' if isinstance(train_cls, float) else train_cls}")
    print(f"Train Dfl Loss: {f'{train_dfl:.4f}' if isinstance(train_dfl, float) else train_dfl}")
    print(f"Val Box Loss:   {f'{val_box:.4f}' if isinstance(val_box, float) else val_box}")
    print(f"Val Cls Loss:   {f'{val_cls:.4f}' if isinstance(val_cls, float) else val_cls}")
    print(f"Val Dfl Loss:   {f'{val_dfl:.4f}' if isinstance(val_dfl, float) else val_dfl}")
    
    print("\n--- File Locations ---")
    print(f"results.csv:      {results_csv}")
    print(f"confusion_matrix: {run_dir / 'confusion_matrix.png'}")
    print(f"results.png:      {run_dir / 'results.png'}")
    print("==================================================")

if __name__ == "__main__":
    check_results()
