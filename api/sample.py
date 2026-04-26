"""
sample.py
---------
Flask API for Spectral Glimpse point sampling.

Endpoints:
    GET /health
        Simple health check.

    GET /sample?lat=&lon=
        Returns current index values for a lat/lon point.

    GET /history?lat=&lon=&index=
        Returns 2-year time series for a single index at a lat/lon point.

Environment variables required:
    R2_ACCOUNT_ID         -- Cloudflare account ID
    R2_ACCESS_KEY_ID      -- R2 access key
    R2_SECRET_ACCESS_KEY  -- R2 secret key
    R2_BUCKET_NAME        -- R2 bucket name
    R2_PUBLIC_URL         -- Public base URL for R2 bucket
"""

import os
import json
import numpy as np
import rasterio
import boto3
from botocore.exceptions import ClientError
from flask import Flask, jsonify, request
from flask_cors import CORS
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).parent.parent))
from pipeline.indices import INDEX_META

app = Flask(__name__)
CORS(app)


# ── R2 HELPERS ────────────────────────────────────────────────────────────────

def get_s3_client():
    """
    Returns a boto3 S3 client pointed at Cloudflare R2.
    Credentials read from environment variables.
    """
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto"
    )


def get_manifest() -> list:
    """
    Fetches the manifest.json from R2.
    The manifest is a list of available COG entries, each with:
        { "date": "2026-03-30", "date_label": "Mar 30 2026",
          "indices": { "ndvi": "cogs/ndvi_california_cog_A2026089.tif", ... } }
    Returns empty list if manifest doesn't exist yet.
    """
    try:
        s3 = get_s3_client()
        resp = s3.get_object(
            Bucket=os.environ["R2_BUCKET_NAME"],
            Key="manifest.json"
        )
        return json.loads(resp["Body"].read().decode("utf-8"))
    except ClientError:
        return []


def get_r2_cog_url(r2_key: str) -> str:
    """
    Builds the public R2 URL for a given R2 key.
    """
    base = os.environ["R2_PUBLIC_URL"].rstrip("/")
    return f"{base}/{r2_key}"

def sample_cog(url: str, lat: float, lon: float) -> float | None:
    try:
        vsicurl_url = f"/vsicurl/{url}"
        with rasterio.open(vsicurl_url) as src:
            row, col = src.index(lon, lat)
            if row < 0 or col < 0 or row >= src.height or col >= src.width:
                return None
            window = rasterio.windows.Window(col, row, 1, 1)
            data   = src.read(1, window=window, masked=False)
            value  = float(data[0][0])
            if np.isnan(value):
                return None
            return round(value, 4)
    except Exception:
        return None

def interpret(index_name: str, value: float) -> str:
    """
    Returns a plain English interpretation of an index value.
    """
    if value is None:
        return "No data available for this location."

    interpretations = {
        "ndvi": [
            (-1.0, 0.0,  "No vegetation detected. Likely water, bare soil, or urban surface."),
            ( 0.0, 0.2,  "Very sparse vegetation or heavily stressed plants."),
            ( 0.2, 0.4,  "Sparse to moderate vegetation. Shrubland or dry grassland."),
            ( 0.4, 0.6,  "Moderate vegetation. Grassland or agriculture."),
            ( 0.6, 0.8,  "Dense healthy vegetation. Forest or irrigated crops."),
            ( 0.8, 1.0,  "Very dense, highly productive vegetation."),
        ],
        "evi2": [
            (-1.0, 0.1,  "No vegetation or highly degraded surface."),
            ( 0.1, 0.3,  "Sparse vegetation with significant bare ground."),
            ( 0.3, 0.5,  "Moderate vegetation cover."),
            ( 0.5, 0.7,  "Dense healthy vegetation."),
            ( 0.7, 1.0,  "Very dense productive vegetation."),
        ],
        "nbr": [
            (-1.0, -0.5, "High likelihood of severe burn. Heavily charred area."),
            (-0.5, -0.25,"Moderate to high burn severity."),
            (-0.25, 0.1, "Low burn severity or recently disturbed ground."),
            ( 0.1, 0.4,  "Sparse or stressed vegetation."),
            ( 0.4, 1.0,  "Healthy unburned vegetation."),
        ],
        "ndmi": [
            (-1.0, -0.2, "Very dry vegetation. Elevated fire risk."),
            (-0.2,  0.0, "Dry to moderately dry vegetation."),
            ( 0.0,  0.2, "Moderate moisture levels."),
            ( 0.2,  0.4, "Moist, well-watered vegetation."),
            ( 0.4,  1.0, "Very high moisture. Wetland or irrigated area."),
        ],
        "ndsi": [
            (-1.0,  0.0, "No snow or ice detected."),
            ( 0.0,  0.2, "Possible trace snow or mixed surface."),
            ( 0.2,  0.4, "Patchy snow cover."),
            ( 0.4,  1.0, "Snow or ice covered surface."),
        ],
        "bsi": [
            (-1.0, -0.1, "Dense vegetation. Minimal bare soil exposed."),
            (-0.1,  0.0, "Mostly vegetated with some bare patches."),
            ( 0.0,  0.1, "Mixed vegetation and bare soil."),
            ( 0.1,  0.2, "Significant bare soil exposure. Degraded or post-fire."),
            ( 0.2,  1.0, "Highly exposed bare soil or urban surface."),
        ],
    }

    for low, high, text in interpretations.get(index_name, []):
        if low <= value < high:
            return text
    return "Value out of expected range."


# ── ROUTES ────────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"status": "ok", "service": "spectral-glimpse-api"})


@app.route("/sample")
def sample():
    """
    Returns current index values for a lat/lon point.

    GET /sample?lat=37.5&lon=-119.5

    Response:
    {
        "lat": 37.5,
        "lon": -119.5,
        "composite_date": "Mar 30 2026",
        "indices": {
            "ndvi": {
                "value": 0.42,
                "label": "NDVI",
                "description": "...",
                "interpretation": "...",
                "vis_min": 0.0,
                "vis_max": 0.9,
                "palette": [...],
                "units": "index [-1 to 1]"
            },
            ...
        }
    }
    """
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return jsonify({"error": "lat and lon are required numeric parameters"}), 400

    if not (32.5 <= lat <= 42.1 and -124.5 <= lon <= -114.1):
        return jsonify({"error": "Coordinates appear to be outside California"}), 400

    # Get most recent entry from manifest
    manifest = get_manifest()
    if not manifest:
        return jsonify({"error": "No data available yet. Pipeline has not run."}), 503

    latest   = manifest[-1]
    results  = {}

    for index_name, meta in INDEX_META.items():
        r2_key = latest["indices"].get(index_name)
        value  = sample_cog(get_r2_cog_url(r2_key), lat, lon) if r2_key else None

        results[index_name] = {
            "value":          value,
            "label":          meta["label"],
            "description":    meta["description"],
            "interpretation": interpret(index_name, value),
            "vis_min":        meta["vis_min"],
            "vis_max":        meta["vis_max"],
            "palette":        meta["palette"],
            "units":          meta["units"],
        }

    return jsonify({
        "lat":            lat,
        "lon":            lon,
        "composite_date": latest.get("date_label", ""),
        "indices":        results
    })

@app.route("/history")
def history():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return jsonify({"error": "lat and lon are required numeric parameters"}), 400

    if not (32.5 <= lat <= 42.1 and -124.5 <= lon <= -114.1):
        return jsonify({"error": "Coordinates appear to be outside California"}), 400

    manifest = get_manifest()
    if not manifest:
        return jsonify({"error": "No data available yet."}), 503

    from concurrent.futures import ThreadPoolExecutor, as_completed

    history = {name: [] for name in INDEX_META.keys()}

    def sample_entry(entry, index_name):
        r2_key = entry["indices"].get(index_name)
        if not r2_key:
            return None
        value = sample_cog(get_r2_cog_url(r2_key), lat, lon)
        if value is None:
            return None
        return {
            "index_name": index_name,
            "date":       entry.get("date_label", entry.get("date", "")),
            "value":      value
        }

    # Build list of all tasks
    tasks = [
        (entry, index_name)
        for entry in manifest
        for index_name in INDEX_META.keys()
    ]

    # Run concurrently with up to 20 threads
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {
            executor.submit(sample_entry, entry, index_name): (entry, index_name)
            for entry, index_name in tasks
        }
        for future in as_completed(futures):
            result = future.result()
            if result:
                history[result["index_name"]].append({
                    "date":  result["date"],
                    "value": result["value"]
                })

    # Sort each index by date
    for index_name in history:
        history[index_name].sort(key=lambda x: x["date"])

    return jsonify({
        "lat":     lat,
        "lon":     lon,
        "history": history
    })

# ── ENTRYPOINT ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=True, port=8080)
