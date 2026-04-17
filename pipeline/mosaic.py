"""
mosaic.py
---------
Merges per-tile COGs into a single statewide raster,
clips to the California boundary, and writes final COGs.
"""

import requests
import numpy as np
import rasterio
import geopandas as gpd
from rasterio.merge import merge
from rasterio.mask import mask as rio_mask
from rasterio.crs import CRS
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles
from shapely.geometry import mapping
from pathlib import Path


CA_BOUNDARY_URL = (
    "https://services.arcgis.com/ue9rwulIoeLEI9bj/arcgis/rest/services"
    "/US_StateBoundaries/FeatureServer/0/query"
    "?where=NAME+%3D+%27California%27"
    "&outFields=NAME"
    "&outSR=4326"
    "&f=geojson"
)


def fetch_california_boundary() -> list:
    """
    Fetches the California state boundary from ArcGIS Living Atlas.
    Returns a list of geometries in rasterio-compatible format.
    """
    print("Fetching California boundary...")
    resp = requests.get(CA_BOUNDARY_URL, timeout=30)
    resp.raise_for_status()
    ca = gpd.GeoDataFrame.from_features(
        resp.json()["features"], crs="EPSG:4326"
    )
    print("Got California boundary")
    return [mapping(ca.geometry.iloc[0])]


def mosaic_and_clip(
    tile_dir: Path,
    output_dir: Path,
    ca_geom: list,
    index_names: list
) -> dict:
    """
    For each index, mosaics all per-tile COGs and clips
    to the California boundary.

    Returns dict of { index_name: Path } for the final COGs.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    final_cogs = {}

    for index_name in index_names:
        tile_paths = sorted(tile_dir.glob(f"{index_name}_*_cog.tif"))

        if not tile_paths:
            print(f"  [{index_name.upper()}] no tiles found, skipping")
            continue

        print(f"  [{index_name.upper()}] mosaicking {len(tile_paths)} tile(s)...")

        # Open and mosaic
        src_files = [rasterio.open(p) for p in tile_paths]
        mosaic_arr, mosaic_transform = merge(src_files, method="first")
        for s in src_files:
            s.close()

        # Write mosaic temp file
        tmp_mosaic = output_dir / f"_tmp_mosaic_{index_name}.tif"
        with rasterio.open(
            tmp_mosaic, "w", driver="GTiff",
            height=mosaic_arr.shape[1],
            width=mosaic_arr.shape[2],
            count=1, dtype="float32",
            crs=CRS.from_epsg(4326),
            transform=mosaic_transform,
            nodata=float("nan")
        ) as dst:
            dst.write(mosaic_arr[0], 1)

        # Clip to California
        tmp_clip = output_dir / f"_tmp_clip_{index_name}.tif"
        with rasterio.open(tmp_mosaic) as src:
            clipped, clipped_transform = rio_mask(
                src, ca_geom,
                crop=True,
                nodata=float("nan")
            )
            clipped_meta = src.meta.copy()
            clipped_meta.update({
                "height":    clipped.shape[1],
                "width":     clipped.shape[2],
                "transform": clipped_transform,
            })

        with rasterio.open(tmp_clip, "w", **clipped_meta) as dst:
            dst.write(clipped[0], 1)

        # Write final COG
        final_path = output_dir / f"{index_name}_california_cog.tif"
        cog_translate(
            tmp_clip, final_path,
            cog_profiles.get("deflate"),
            overview_level=5,
            quiet=True
        )

        tmp_mosaic.unlink(missing_ok=True)
        tmp_clip.unlink(missing_ok=True)

        size_mb = final_path.stat().st_size / 1_048_576
        print(f"  [{index_name.upper()}] -> {final_path.name} ({size_mb:.1f} MB)")
        final_cogs[index_name] = final_path

    return final_cogs


INDEX_NAMES = ["ndvi", "evi2", "nbr", "ndmi", "ndsi", "bsi"]
