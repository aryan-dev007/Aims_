"""
Train a YOLOv8 grocery-stock detection model.

Usage:
  # Full dataset (GPU recommended)
  python train.py --data data.yaml --epochs 25 --imgsz 640 --batch 16 --device 0

  # Quick subset run (CPU)
  python train.py --data subset/data.yaml --epochs 8 --imgsz 640 --batch 16 --device cpu --name local_subset

  # Resume training from a checkpoint
  python train.py --resume runs/detect/local_subset/weights/last.pt
"""
import argparse

from ultralytics import YOLO

DEFAULT_CFG = dict(
    model="yolov8n.pt",
    data="data.yaml",
    epochs=25,
    imgsz=640,
    batch=16,
    device=0,
    workers=4,
    optimizer="AdamW",
    lr0=0.001,
    lrf=0.01,
    momentum=0.9,
    weight_decay=0.0005,
    warmup_epochs=3.0,
    warmup_momentum=0.8,
    warmup_bias_lr=0.1,
    cos_lr=True,
    close_mosaic=10,
    patience=15,
    val=True,
    save=True,
    project="runs/detect",
    name="stock_detector",
    exist_ok=True,
    plots=True,
    seed=42,
)


def parse_args():
    p = argparse.ArgumentParser(description="Train YOLOv8 grocery stock detector")
    p.add_argument("--model", default=DEFAULT_CFG["model"], help="Base weights to start from")
    p.add_argument("--data", default=DEFAULT_CFG["data"], help="Dataset yaml (absolute paths)")
    p.add_argument("--epochs", type=int, default=DEFAULT_CFG["epochs"])
    p.add_argument("--imgsz", type=int, default=DEFAULT_CFG["imgsz"])
    p.add_argument("--batch", type=int, default=DEFAULT_CFG["batch"])
    p.add_argument("--device", default=DEFAULT_CFG["device"], help="cuda device, e.g. 0, or 'cpu'")
    p.add_argument("--workers", type=int, default=DEFAULT_CFG["workers"])
    p.add_argument("--name", default=DEFAULT_CFG["name"], help="Run name (folder under project)")
    p.add_argument("--project", default=DEFAULT_CFG["project"])
    p.add_argument("--resume", default=None, help="Path to a checkpoint to resume from")
    p.add_argument("--optimizer", default=DEFAULT_CFG["optimizer"])
    p.add_argument("--lr0", type=float, default=DEFAULT_CFG["lr0"])
    p.add_argument("--cos_lr", action="store_true", default=DEFAULT_CFG["cos_lr"])
    p.add_argument("--patience", type=int, default=DEFAULT_CFG["patience"])
    p.add_argument("--seed", type=int, default=DEFAULT_CFG["seed"])
    return p.parse_args()


def main():
    args = parse_args()

    if args.resume:
        model = YOLO(args.resume)
        results = model.train(resume=True)
        print("Resumed training. Best weights:")
        print(results.save_dir)
        return

    model = YOLO(args.model)

    results = model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        workers=args.workers,
        optimizer=args.optimizer,
        lr0=args.lr0,
        lrf=DEFAULT_CFG["lrf"],
        momentum=DEFAULT_CFG["momentum"],
        weight_decay=DEFAULT_CFG["weight_decay"],
        warmup_epochs=DEFAULT_CFG["warmup_epochs"],
        warmup_momentum=DEFAULT_CFG["warmup_momentum"],
        warmup_bias_lr=DEFAULT_CFG["warmup_bias_lr"],
        cos_lr=args.cos_lr,
        close_mosaic=DEFAULT_CFG["close_mosaic"],
        patience=args.patience,
        val=DEFAULT_CFG["val"],
        save=DEFAULT_CFG["save"],
        project=args.project,
        name=args.name,
        exist_ok=DEFAULT_CFG["exist_ok"],
        plots=DEFAULT_CFG["plots"],
        seed=args.seed,
    )

    print(f"\nTraining complete. Best model: {results.save_dir}/weights/best.pt")


if __name__ == "__main__":
    main()
