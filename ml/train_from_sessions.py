"""Train a local model from manually labeled AI Coding Buddy sessions.
Labels are assistance-level preferences, not objective measures of struggle.
"""
import argparse
import hashlib
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split

FEATURES = [
    "idle_seconds", "errors", "failed_runs", "deletions", "rapid_edits",
    "stuck_line_seconds", "deletion_bursts", "navigation_bursts", "logic_concerns",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_csv", type=Path)
    parser.add_argument("output_model", type=Path)
    args = parser.parse_args()
    data = pd.read_csv(args.input_csv)
    required = FEATURES + ["manual_level"]
    missing = [name for name in ["manual_level"] if name not in data.columns]
    if missing:
        raise SystemExit("Missing required columns: " + ", ".join(missing))
    for name in FEATURES:
        if name not in data.columns:
            data[name] = 0
    data = data[required].dropna()
    data["manual_level"] = pd.to_numeric(data["manual_level"], errors="coerce")
    data = data[data.manual_level.isin([1, 2, 3])]
    counts = data.manual_level.value_counts()
    if len(data) < 30 or any(counts.get(level, 0) < 5 for level in (1, 2, 3)):
        raise SystemExit("Need at least 30 manually labeled sessions and 5 sessions at each level (1–3).")
    x_train, x_test, y_train, y_test = train_test_split(
        data[FEATURES], data.manual_level.astype(int), test_size=0.25,
        random_state=42, stratify=data.manual_level.astype(int)
    )
    model = RandomForestClassifier(n_estimators=200, class_weight="balanced", random_state=42)
    model.fit(x_train, y_train)
    report = classification_report(y_test, model.predict(x_test), zero_division=0)
    args.output_model.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, args.output_model)
    digest = hashlib.sha256(args.output_model.read_bytes()).hexdigest()
    args.output_model.with_suffix(args.output_model.suffix + ".sha256").write_text(digest + "\n", encoding="ascii")
    print("Trained locally from manually selected assistance levels. These labels are preference proxies, not ground truth.\n")
    print(report)
    print(f"Model saved to {args.output_model}; checksum saved beside it.")


if __name__ == "__main__":
    main()
