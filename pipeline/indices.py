"""
indices.py
----------
Computes spectral indices from scaled VIIRS reflectance bands.
All outputs are float32 with NaN where data is masked.
"""

import numpy as np


def compute_indices(bands: dict) -> dict:
    """
    Takes a bands dict with keys: red, nir, swir
    Returns a dict of named index arrays.

    Indices:
        NDVI  - vegetation greenness
        EVI2  - enhanced vegetation, less atmosphere sensitivity
        NBR   - burn ratio, single date risk indicator
        NDMI  - vegetation moisture content
        NDSI  - snow and ice
        BSI   - bare soil / post-fire ground exposure
    """
    r = bands["red"]
    n = bands["nir"]
    s = bands["swir"]

    def nd(a, b):
        with np.errstate(divide="ignore", invalid="ignore"):
            v = (a - b) / (a + b)
        return np.where(np.isfinite(v), v, np.nan).astype(np.float32)

    def safe(v):
        return np.where(np.isfinite(v), v, np.nan).astype(np.float32)

    with np.errstate(divide="ignore", invalid="ignore"):
        evi2 = 2.5 * (n - r) / (n + 2.4 * r + 1.0)
        bsi  = ((s + r) - n) / ((s + r) + n)

    return {
        "ndvi": nd(n, r),
        "evi2": safe(evi2),
        "nbr":  nd(n, s),
        "ndmi": nd(n, s),
        "ndsi": nd(r, s),
        "bsi":  safe(bsi),
    }


# Visualization hints for the frontend
# These travel with the data so the UI never needs to hardcode them
INDEX_META = {
    "ndvi": {
        "label": "NDVI",
        "description": "Vegetation greenness — higher values indicate healthier, denser vegetation.",
        "vis_min": 0.0,
        "vis_max": 0.9,
        "palette": ["FFFFFF","CE7E45","DF923D","F1B555","FCD163",
                    "99B718","74A901","66A000","529400","3E8601",
                    "207401","056201","004C00","023B01","012E01","011301"],
        "units": "index [-1 to 1]"
    },
    "evi2": {
        "label": "EVI2",
        "description": "Enhanced Vegetation Index — similar to NDVI but less sensitive to atmospheric noise.",
        "vis_min": -0.1,
        "vis_max": 0.7,
        "palette": ["FFFFFF","f5f5b0","c8e370","8dc653","4da832","1a7a1a","004d00"],
        "units": "index [-1 to 1]"
    },
    "nbr": {
        "label": "NBR",
        "description": "Normalized Burn Ratio — indicates burn severity. NOTE: single-date only, not delta-NBR. Use as a risk indicator, not a definitive burn map.",
        "vis_min": -1.0,
        "vis_max": 1.0,
        "palette": ["7a0000","e60000","ff8c00","ffd700","ffffcc","aec57b","006400"],
        "units": "index [-1 to 1]"
    },
    "ndmi": {
        "label": "NDMI",
        "description": "Normalized Difference Moisture Index — measures canopy water content. Higher values indicate wetter vegetation.",
        "vis_min": -0.3,
        "vis_max": 0.5,
        "palette": ["8c510a","d8b365","f6e8c3","f5f5f5","c7eae5","5ab4ac","01665e"],
        "units": "index [-1 to 1]"
    },
    "ndsi": {
        "label": "NDSI",
        "description": "Normalized Difference Snow Index — detects snow and ice. Values above 0.4 generally indicate snow cover.",
        "vis_min": -0.5,
        "vis_max": 0.8,
        "palette": ["1a1a1a","4d4d4d","999999","cccccc","ffffff"],
        "units": "index [-1 to 1]"
    },
    "bsi": {
        "label": "BSI",
        "description": "Bare Soil Index — indicates exposed soil or urban surfaces. Rises sharply after fire removes vegetation cover.",
        "vis_min": -0.5,
        "vis_max": 0.3,
        "palette": ["1a9641","a6d96a","ffffbf","fdae61","d7191c"],
        "units": "index [-1 to 1]"
    },
}
