"""
fetch.py
--------
Handles NASA Earthdata authentication and VNP09H1 tile search/download.
"""

import os
import earthaccess
from pathlib import Path
from datetime import datetime, timedelta


# California bounding box (lon_min, lat_min, lon_max, lat_max)
CALIFORNIA_BBOX = (-124.48, 32.53, -114.13, 42.01)


def authenticate():
    """
    Authenticates with NASA Earthdata using environment variables.
    Expects EARTHDATA_USERNAME and EARTHDATA_PASSWORD to be set.
    """
    earthaccess.login(strategy="environment")


def search_tiles(days_back: int = 16) -> list:
    """
    Searches for VNP09H1 v002 tiles covering California
    within the last N days.
    """
    end_date   = datetime.utcnow()
    start_date = end_date - timedelta(days=days_back)

    date_range = (
        start_date.strftime("%Y-%m-%d"),
        end_date.strftime("%Y-%m-%d")
    )

    print(f"Searching VNP09H1 v002: {date_range[0]} to {date_range[1]}")

    granules = earthaccess.search_data(
        short_name="VNP09H1",
        version="002",
        bounding_box=CALIFORNIA_BBOX,
        temporal=date_range,
        count=20
    )

    print(f"Found {len(granules)} granule(s)")
    return granules


def download_tiles(granules: list, data_dir: Path) -> list:
    """
    Downloads HDF5 tiles to data_dir.
    Returns list of local file paths.
    """
    data_dir.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {len(granules)} tile(s) to {data_dir}...")
    local_paths = earthaccess.download(granules, local_path=str(data_dir))
    print(f"Downloaded {len(local_paths)} file(s)")
    return [Path(p) for p in local_paths]
