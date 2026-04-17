"""
sample.py
---------
Flask API for Spectral Glimpse point sampling.

Given a latitude and longitude, reads the pixel value
from each index COG in Cloudflare R2 and returns a JSON
response with all index values and metadata.

Designed to be deployed as a Cloudflare Worker or Cloud Run service.

Environment variables required:
    R2_ACCOUNT_ID         — Cloudflare account ID
    R2_ACCESS_KEY_ID      — R2 access key
    R2_SECRET_ACCESS_KEY  — R2 secret key
    R2_BUCKET_NAME        — R2 bucket name
    R2_PUBLIC_URL         — Public base URL for R2 bucket
                            e.g. https://pub-xxx.r2.dev
"""

import os
import json
import numpy as np
import rasterio
from rasterio.crs import CRS
from flask import Flask, jsonify, request
from flask_cors import CORS
from pathlib import Path

# Import index metadata so descriptions + vis params
# travel with the API response
import sys
sys.path.append(str(Path(__file__).parent.parent))
from pipeline.indices import INDEX_META


app = Flask(__name__)
CORS(app)  # Allow requests from your Cloudflare Pages frontend


# ── HELPERS ──────────────────────────────────────────────────────────────────

def get_r2_cog_url(index_name: str) -> str:
    """
    Builds the public R2 URL for a given index COG.
    e.g. https://pub-xxx.r2.dev/cogs/ndvi_california_cog.tif
    """
    base = os.environ["R2_PUBLIC_URL"].rstrip("/")
    return f"{base}/cogs/{index_name}_california_cog.tif"


def sample_cog(url: str, lat: float, lon: float) -> float | None:
    """
    Reads a single pixel value from a COG at a given lat/lon.
    Uses HTTP range requests so only a tiny portion of the file
    is downloaded — not the whole COG.

    Returns the float value or None if the pixel is NoData.
    """
    with rasterio.open(url) as src:
        # Convert lat/lon to pixel row/col
        row, col = src.index(lon, lat)

        # Read just that one pixel
        window = rasterio.windows.Window(col, row, 1, 1)
        data   = src.read(1, window=window)
        value  = float(data[0][0])

        # Check for nodata
        if src.nodata is not None and value == src.nodata:
            return None
        if np.isnan(value):
            return None

        return round(value, 4)


def interpret(index_name: str, value: float) -> str:
    """
    Returns a plain English interpretation of an index value.
    This is what shows up as the insight text in the sidebar.
    """
    if value is None:
        return "No data available for this location."

    interpretations = {
        "ndvi": [
            (-1.0, 0.0,  "No vegetation — likely water, bare soil, or urban surface."),
            ( 0.0, 0.2,  "Very sparse vegetation or heavily stressed plants."),
            ( 0.2, 0.4,  "Sparse to moderate vegetation — shrubland or dry grassland."),
            ( 0.4, 0.6,  "Moderate vegetation — grassland or agriculture."),
            ( 0.6, 0.8,  "Dense healthy vegetation — forest or irrigated crops."),
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
            (-1.0, -0.5, "High likelihood of severe burn — heavily charred area."),
            (-0.5, -0.25,"Moderate to high burn severity."),
            (-0.25, 0.1, "Low burn severity or recently disturbed ground."),
            ( 0.1, 0.4,  "Sparse or stressed vegetation."),
            ( 0.4, 1.0,  "Healthy unburned vegetation."),
        ],
        "ndmi": [
            (-1.0, -0.2, "Very dry vegetation — high fire risk."),
            (-0.2,  0.0, "Dry to moderately dry vegetation."),
            ( 0.0,  0.2, "Moderate moisture levels."),
            ( 0.2,  0.4, "Moist, well-watered vegetation."),
            ( 0.4,  1.0, "Very high moisture — wetland or irrigated area."),
        ],
        "ndsi": [
            (-1.0,  0.0, "No snow or ice detected."),
            ( 0.0,  0.2, "Possible trace snow or mixed surface."),
            ( 0.2,  0.4, "Patchy snow cover."),
            ( 0.4,  1.0, "Snow or ice covered surface."),
        ],
        "bsi": [
            (-1.0, -0.1, "Dense vegetation — minimal bare soil exposed."),
            (-0.1,  0.0, "Mostly vegetated with some bare patches."),
            ( 0.0,  0.1, "Mixed vegetation and bare soil."),
            ( 0.1,  0.2, "Significant bare soil exposure — degraded or post-fire."),
            ( 0.2,  1.0, "Highly exposed bare soil or urban surface."),
        ],
    }

    thresholds = interpretations.get(index_name, [])
    for low, high, text in thresholds:
        if low <= value < high:
            return text

    return "Value out of expected range."


# ── ROUTES ───────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    """Simple health check so Cloud Run knows the service is up."""
    return jsonify({"status": "ok", "service": "spectral-glimpse-api"})


@app.route("/sample")
def sample():
    """
    Main endpoint. Accepts lat and lon as query parameters.

    Example:
        GET /sample?lat=37.5&lon=-119.5

    Returns JSON with index values, metadata, and interpretations.
    """
    # Validate inputs
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return jsonify({"error": "lat and lon are required numeric parameters"}), 400

    # Basic bounds check for California
    if not (32.5 <= lat <= 42.1 and -124.5 <= lon <= -114.1):
        return jsonify({"error": "Coordinates appear to be outside California"}), 400

    results = {}

    for index_name in INDEX_META.keys():
        url   = get_r2_cog_url(index_name)
        value = sample_cog(url, lat, lon)
        meta  = INDEX_META[index_name]

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
        "lat":     lat,
        "lon":     lon,
        "indices": results
    })


# ── ENTRYPOINT ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Local testing only — gunicorn handles production
    app.run(debug=True, port=8080)
