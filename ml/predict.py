import sys
import json
import joblib
import os
import hashlib
import pandas as pd


def main():

    input_data = sys.stdin.read().strip()

    if not input_data:
        print("1")
        return

    features = json.loads(input_data)

    model_path = os.environ.get("CODING_BUDDY_MODEL_PATH") or os.path.join(
        os.path.dirname(__file__), "struggle_model.pkl"
    )
    if os.environ.get("CODING_BUDDY_MODEL_PATH"):
        checksum_path = model_path + ".sha256"
        try:
            expected = open(checksum_path, encoding="ascii").read().strip()
            actual = hashlib.sha256(open(model_path, "rb").read()).hexdigest()
        except OSError as error:
            raise SystemExit("Custom model or checksum file is unavailable: " + str(error))
        if not expected or actual != expected:
            raise SystemExit("Custom model checksum did not match; restore the bundled model in Settings.")

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
