import os
import random
import joblib
import pandas as pd

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix


# ---------------------------------------------------------
# Configuration
# ---------------------------------------------------------

random.seed(42)

NUM_SAMPLES_PER_LEVEL = 500

FEATURES = [
    "idle_seconds",
    "errors",
    "failed_runs",
    "deletions",
    "rapid_edits"
]


# ---------------------------------------------------------
# Generate prototype behavioral dataset
# ---------------------------------------------------------

def generate_level_samples(level, count):

    rows = []

    for _ in range(count):

        if level == 1:
            # Low struggle
            idle_seconds = random.randint(0, 25)
            errors = random.randint(0, 1)
            failed_runs = random.randint(0, 1)
            deletions = random.randint(0, 4)
            rapid_edits = random.randint(0, 4)

        elif level == 2:
            # Moderate struggle
            idle_seconds = random.randint(15, 60)
            errors = random.randint(1, 4)
            failed_runs = random.randint(1, 3)
            deletions = random.randint(3, 10)
            rapid_edits = random.randint(2, 8)

        else:
            # High struggle
            idle_seconds = random.randint(40, 120)
            errors = random.randint(3, 10)
            failed_runs = random.randint(2, 8)
            deletions = random.randint(7, 20)
            rapid_edits = random.randint(5, 15)

        rows.append({
            "idle_seconds": idle_seconds,
            "errors": errors,
            "failed_runs": failed_runs,
            "deletions": deletions,
            "rapid_edits": rapid_edits,
            "struggle_level": level
        })

    return rows


# ---------------------------------------------------------
# Create dataset
# ---------------------------------------------------------

data = []

data.extend(
    generate_level_samples(
        level=1,
        count=NUM_SAMPLES_PER_LEVEL
    )
)

data.extend(
    generate_level_samples(
        level=2,
        count=NUM_SAMPLES_PER_LEVEL
    )
)

data.extend(
    generate_level_samples(
        level=3,
        count=NUM_SAMPLES_PER_LEVEL
    )
)


df = pd.DataFrame(data)

# Shuffle the dataset
df = df.sample(
    frac=1,
    random_state=42
).reset_index(drop=True)


# ---------------------------------------------------------
# Save training dataset
# ---------------------------------------------------------

script_directory = os.path.dirname(
    os.path.abspath(__file__)
)

dataset_path = os.path.join(
    script_directory,
    "training_data.csv"
)

df.to_csv(
    dataset_path,
    index=False
)

print()
print("Dataset created:")
print(dataset_path)

print()
print("Dataset size:")
print(len(df))

print()
print("Class distribution:")
print(df["struggle_level"].value_counts().sort_index())


# ---------------------------------------------------------
# Prepare training data
# ---------------------------------------------------------

X = df[FEATURES]

y = df["struggle_level"]


X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.20,
    random_state=42,
    stratify=y
)


# ---------------------------------------------------------
# Train Random Forest
# ---------------------------------------------------------

model = RandomForestClassifier(
    n_estimators=200,
    max_depth=8,
    min_samples_split=5,
    random_state=42,
    class_weight="balanced"
)

model.fit(
    X_train,
    y_train
)


# ---------------------------------------------------------
# Evaluate
# ---------------------------------------------------------

predictions = model.predict(X_test)

print()
print("Classification Report:")
print(
    classification_report(
        y_test,
        predictions,
        digits=4
    )
)

print("Confusion Matrix:")
print(
    confusion_matrix(
        y_test,
        predictions
    )
)


# ---------------------------------------------------------
# Feature importance
# ---------------------------------------------------------

importance = pd.DataFrame({
    "feature": FEATURES,
    "importance": model.feature_importances_
})

importance = importance.sort_values(
    "importance",
    ascending=False
)

print()
print("Feature Importance:")
print(importance.to_string(index=False))


# ---------------------------------------------------------
# Save model
# ---------------------------------------------------------

model_path = os.path.join(
    script_directory,
    "struggle_model.pkl"
)

joblib.dump(
    model,
    model_path
)

print()
print("Model saved:")
print(model_path)

print()
print("Training complete.")