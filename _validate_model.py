"""Quick model validation script - tests detection accuracy on validation images."""
import os
from collections import Counter
from ultralytics import YOLO

model = YOLO("models/best.pt")

# Test on validation images
val_img_dir = "unified_dataset/valid/images"
val_lbl_dir = "unified_dataset/valid/labels"
imgs = [f for f in os.listdir(val_img_dir) if f.endswith((".jpg", ".jpeg", ".png"))]

# Sample 20 images from different categories
import random
random.seed(42)
random.shuffle(imgs)
test_imgs = imgs[:20]

total_gt_classes = 0
total_matched = 0
total_false_positives = 0
total_missed = 0

print("=== MODEL VALIDATION TEST (20 random images) ===\n")

for img_name in test_imgs:
    img_path = os.path.join(val_img_dir, img_name)
    results = model.predict(source=img_path, conf=0.15, iou=0.45, imgsz=640, verbose=False)[0]

    det_names = []
    for box in results.boxes:
        cls_id = int(box.cls)
        conf = float(box.conf)
        name = model.names[cls_id]
        det_names.append((name, conf))

    # Ground truth
    lbl_path = os.path.join(val_lbl_dir, os.path.splitext(img_name)[0] + ".txt")
    gt_classes = Counter()
    if os.path.exists(lbl_path):
        with open(lbl_path) as f:
            for line in f:
                parts = line.strip().split()
                if parts:
                    gt_id = int(parts[0])
                    gt_name = model.names.get(gt_id, f"UNK_{gt_id}")
                    gt_classes[gt_name] += 1

    det_classes = Counter([n for n, c in det_names])
    gt_set = set(gt_classes.keys())
    det_set = set(det_classes.keys())
    matched = gt_set & det_set
    missed = gt_set - det_set
    false_pos = det_set - gt_set

    total_gt_classes += len(gt_set)
    total_matched += len(matched)
    total_missed += len(missed)
    total_false_positives += len(false_pos)

    status = "OK" if len(missed) == 0 and len(false_pos) == 0 else "ISSUES"
    print(f"[{status:6s}] {img_name[:55]}")
    print(f"         GT: {dict(gt_classes)}")
    print(f"         DET: {dict(det_classes)}")
    if missed:
        print(f"         MISSED: {missed}")
    if false_pos:
        print(f"         FALSE POS: {false_pos}")
    print()

print("=" * 60)
print(f"Class-level recall: {total_matched}/{total_gt_classes} = {total_matched/max(total_gt_classes,1)*100:.1f}%")
print(f"Missed classes: {total_missed}")
print(f"False positive classes: {total_false_positives}")

# Final model metrics from training
print("\n=== FINAL TRAINING METRICS (epoch 30) ===")
print("mAP50:     0.286  (28.6%)")
print("mAP50-95:  0.268  (26.8%)")
print("Precision: 0.351  (35.1%)")
print("Recall:    0.383  (38.3%)")
