import os
import pandas as pd
from datetime import timedelta, datetime

# ============================================================
# CURRENT AIMS-20 TRAINING RUN
# ============================================================

RUN_DIR = r"C:\Users\nikhi\Downloads\AIMS_20_TRAINING\yolov8n_416_baseline"

RESULTS_CSV = os.path.join(
    RUN_DIR,
    "results.csv"
)

TOTAL_EPOCHS = 30


# ============================================================
# HEADER
# ============================================================

print("=" * 80)
print("AIMS-20 YOLOv8n TRAINING STATUS")
print("=" * 80)

print("\nRun:")
print(RUN_DIR)


# ============================================================
# CHECK RESULTS FILE
# ============================================================

if not os.path.exists(RESULTS_CSV):

    print("\nresults.csv has not been created yet.")
    print("Training may still be initializing.")
    print("\nCheck again later.")

    raise SystemExit


# ============================================================
# READ RESULTS
# ============================================================

try:

    df = pd.read_csv(
        RESULTS_CSV
    )

except Exception as e:

    print("\nresults.csv is currently being written.")
    print("Try again in a few seconds.")

    print("\nError:")
    print(e)

    raise SystemExit


if len(df) == 0:

    print("\nNo completed epochs yet.")

    raise SystemExit


# Clean column names

df.columns = [
    c.strip()
    for c in df.columns
]


# ============================================================
# CURRENT EPOCH
# ============================================================

if "epoch" in df.columns:

    current_epoch = int(
        df.iloc[-1]["epoch"]
    ) + 1

else:

    current_epoch = len(df)


progress = (
    current_epoch / TOTAL_EPOCHS
) * 100


print("\n" + "-" * 80)

print(
    f"Epoch: {current_epoch}/{TOTAL_EPOCHS}"
)

print(
    f"Progress: {progress:.1f}%"
)


# ============================================================
# CURRENT METRICS
# ============================================================

print("\nCurrent metrics:")

columns = [
    "train/box_loss",
    "train/cls_loss",
    "train/dfl_loss",
    "val/box_loss",
    "val/cls_loss",
    "val/dfl_loss",
    "metrics/precision(B)",
    "metrics/recall(B)",
    "metrics/mAP50(B)",
    "metrics/mAP50-95(B)"
]

for column in columns:

    if column in df.columns:

        try:

            value = float(
                df.iloc[-1][column]
            )

            print(
                f"{column:<28}: "
                f"{value:.4f}"
            )

        except:

            pass


# ============================================================
# BEST MODEL PERFORMANCE SO FAR
# ============================================================

print("\n" + "-" * 80)
print("BEST PERFORMANCE SO FAR")
print("-" * 80)

map95_column = "metrics/mAP50-95(B)"

if map95_column in df.columns:

    best_index = df[
        map95_column
    ].idxmax()

    best_row = df.loc[
        best_index
    ]

    if "epoch" in df.columns:

        best_epoch = int(
            best_row["epoch"]
        ) + 1

    else:

        best_epoch = best_index + 1


    print(
        f"Best epoch: "
        f"{best_epoch}"
    )

    print(
        f"Best mAP50-95: "
        f"{float(best_row[map95_column]):.4f}"
    )


    if "metrics/mAP50(B)" in df.columns:

        print(
            f"Best mAP50: "
            f"{float(best_row['metrics/mAP50(B)']):.4f}"
        )


    if "metrics/precision(B)" in df.columns:

        print(
            f"Precision: "
            f"{float(best_row['metrics/precision(B)']):.4f}"
        )


    if "metrics/recall(B)" in df.columns:

        print(
            f"Recall: "
            f"{float(best_row['metrics/recall(B)']):.4f}"
        )


# ============================================================
# MODEL FILES
# ============================================================

print("\n" + "-" * 80)
print("MODEL FILES")
print("-" * 80)

weights_dir = os.path.join(
    RUN_DIR,
    "weights"
)

best_pt = os.path.join(
    weights_dir,
    "best.pt"
)

last_pt = os.path.join(
    weights_dir,
    "last.pt"
)


print(
    f"best.pt: "
    f"{'AVAILABLE' if os.path.exists(best_pt) else 'not yet'}"
)

print(
    f"last.pt: "
    f"{'AVAILABLE' if os.path.exists(last_pt) else 'not yet'}"
)


# ============================================================
# LAST RESULTS UPDATE
# ============================================================

try:

    timestamp = os.path.getmtime(
        RESULTS_CSV
    )

    last_update = datetime.fromtimestamp(
        timestamp
    )

    print(
        "\nresults.csv last updated:"
    )

    print(
        last_update.strftime(
            "%Y-%m-%d %H:%M:%S"
        )
    )

except:

    pass


# ============================================================
# STATUS
# ============================================================

print("\n" + "=" * 80)

if current_epoch >= TOTAL_EPOCHS:

    print(
        "STATUS: TRAINING COMPLETE"
    )

else:

    print(
        "STATUS: TRAINING IN PROGRESS"
    )

print("=" * 80)