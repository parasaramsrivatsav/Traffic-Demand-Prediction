import os
import json
import pandas as pd
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, r2_score

# Geohash decoding helper to avoid dependency on pygeohash
def decode_geohash(geohash):
    base32 = '0123456789bcdefghjkmnpqrstuvwxyz'
    bits = [16, 8, 4, 2, 1]
    is_even = True
    lat_min, lat_max = -90.0, 90.0
    lon_min, lon_max = -180.0, 180.0
    
    if not isinstance(geohash, str):
        return np.nan, np.nan
        
    for char in geohash.lower():
        val = base32.find(char)
        if val == -1:
            continue
        for bit in bits:
            if is_even:
                lon_mid = (lon_min + lon_max) / 2.0
                if val & bit:
                    lon_min = lon_mid
                else:
                    lon_max = lon_mid
            else:
                lat_mid = (lat_min + lat_max) / 2.0
                if val & bit:
                    lat_min = lat_mid
                else:
                    lat_max = lat_mid
            is_even = not is_even
            
    lat = (lat_min + lat_max) / 2.0
    lon = (lon_min + lon_max) / 2.0
    return lat, lon

def main():
    print("Starting lightweight model preparation...")
    
    # Load dataset
    dataset_dir = os.path.join("..", "e88186124ec611f1", "dataset")
    train_path = os.path.join(dataset_dir, "train.csv")
    test_path = os.path.join(dataset_dir, "test.csv")
    
    if not os.path.exists(train_path):
        # Fallback if run from workspace root
        dataset_dir = os.path.join("e88186124ec611f1", "dataset")
        train_path = os.path.join(dataset_dir, "train.csv")
        test_path = os.path.join(dataset_dir, "test.csv")
        
    print(f"Loading training data from {train_path}...")
    train = pd.read_csv(train_path)
    test = pd.read_csv(test_path)
    
    # Preprocessing missing values
    print("Preprocessing missing values...")
    train["RoadType"] = train["RoadType"].fillna("Unknown")
    train["Weather"] = train["Weather"].fillna("Unknown")
    
    temp_median = float(train["Temperature"].median())
    train["Temperature"] = train["Temperature"].fillna(temp_median)
    
    # Time features
    print("Extracting time features...")
    train["hour"] = train["timestamp"].str.split(":").str[0].astype(int)
    train["minute"] = train["timestamp"].str.split(":").str[1].astype(int)
    train["time_slot"] = train["hour"] * 4 + train["minute"] // 15
    rush_hours = [7, 8, 9, 17, 18, 19]
    train["rush_hour"] = train["hour"].isin(rush_hours).astype(int)
    
    # Spatial features
    print("Decoding geohashes...")
    coords = train["geohash"].apply(lambda g: pd.Series(decode_geohash(g)))
    train["lat"] = coords[0]
    train["lon"] = coords[1]
    
    train["lat_lon_product"] = train["lat"] * train["lon"]
    train["lat_squared"] = train["lat"] ** 2
    train["lon_squared"] = train["lon"] ** 2
    
    # Latitude/Longitude bounds for Leaflet Map centering
    min_lat = float(train["lat"].min())
    max_lat = float(train["lat"].max())
    min_lon = float(train["lon"].min())
    max_lon = float(train["lon"].max())
    center_lat = (min_lat + max_lat) / 2.0
    center_lon = (min_lon + max_lon) / 2.0
    
    print(f"Spatial Bounds - Lat: [{min_lat:.4f}, {max_lat:.4f}], Lon: [{min_lon:.4f}, {max_lon:.4f}]")
    print(f"Center Map on - Lat: {center_lat:.4f}, Lon: {center_lon:.4f}")
    
    # Compute Target Encodings (Categorical mean mapping)
    print("Computing target encodings...")
    cat_cols = ["geohash", "RoadType", "LargeVehicles", "Landmarks", "Weather"]
    target_encodings = {}
    global_mean = float(train["demand"].mean())
    
    for col in cat_cols:
        # Group by category, calculate mean demand, and convert to dictionary
        means = train.groupby(col)["demand"].mean().to_dict()
        target_encodings[col] = {str(k): float(v) for k, v in means.items()}
        # Apply encoding to train set
        train[f"{col}_te"] = train[col].map(means).fillna(global_mean)
        
    # Define modeling features
    feature_cols = [
        "geohash_te",
        "RoadType_te",
        "LargeVehicles_te",
        "Landmarks_te",
        "Weather_te",
        "day",
        "NumberofLanes",
        "Temperature",
        "hour",
        "minute",
        "time_slot",
        "rush_hour",
        "lat",
        "lon",
        "lat_lon_product",
        "lat_squared",
        "lon_squared"
    ]
    
    X = train[feature_cols]
    y = train["demand"]
    
    # Fit Ridge Regression model
    print("Fitting Ridge regression model...")
    model = Ridge(alpha=1.0)
    model.fit(X, y)
    
    # Evaluate
    predictions = model.predict(X)
    mae = mean_absolute_error(y, predictions)
    r2 = r2_score(y, predictions)
    print(f"Lightweight Ridge Model - MAE: {mae:.5f}, R2 Score: {r2:.5f}")
    
    # Structure weights JSON
    weights = {
        "global_mean": global_mean,
        "temperature_median": temp_median,
        "target_encodings": target_encodings,
        "features": feature_cols,
        "coefficients": {feat: float(coef) for feat, coef in zip(feature_cols, model.coef_)},
        "intercept": float(model.intercept_),
        "map_meta": {
            "min_lat": min_lat,
            "max_lat": max_lat,
            "min_lon": min_lon,
            "max_lon": max_lon,
            "center_lat": center_lat,
            "center_lon": center_lon
        },
        "model_performance": {
            "mae": mae,
            "r2": r2,
            "ensemble_mae_reference": 0.02168,
            "ensemble_r2_reference": 0.9515
        }
    }
    
    # Save to file
    out_path = "model_weights.json"
    print(f"Exporting model weights to {out_path}...")
    with open(out_path, "w") as f:
        json.dump(weights, f, indent=2)
        
    print("Lightweight model preparation complete!")

if __name__ == "__main__":
    main()
