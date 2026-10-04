import sys
import json
import joblib
import os
import pandas as pd


def main():

    input_data = sys.stdin.read().strip()

    if not input_data:
        print("1")
        return

    features = json.loads(input_data)

    model_path = os.path.join(
        os.path.dirname(__file__),
        "struggle_model.pkl"
    )

    model = joblib.load(model_path)

    # Use a DataFrame so the feature names match training
    values = pd.DataFrame([{
        "idle_seconds": features["idle_seconds"],
        "errors": features["errors"],
        "failed_runs": features["failed_runs"],
        "deletions": features["deletions"],
        "rapid_edits": features["rapid_edits"]
    }])

    prediction = model.predict(values)[0]

    print(int(prediction))


if __name__ == "__main__":
    main()