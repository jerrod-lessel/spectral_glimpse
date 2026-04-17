"""
cog.py
------
Handles reading VIIRS HDF5 tiles, extracting bands,
and writing Cloud-Optimized GeoTIFFs.
"""

import re
import numpy as np
import h5py
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_bounds
from rasterio.warp import calculate_default_transform, reproject, Resampling
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles
from pathlib import Path


SCALE_FACTOR = 0.0001
FILL_VALUE   = -28672
HDF_BASE     = "/HDFEOS/GRIDS/VIIRS_Grid_500m_L3_2d/Data Fields"
SINU_CRS     = CRS.from_proj4(
    "+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +a=6371007.181 +b=6371007.181 +units=m"
)
WGS84_CRS    = CRS.from_epsg(4326)


def _parse_bbox(meta: str) -> tuple:
    """
    Extracts sinusoidal projection bounding box
    from HDF-EOS5 StructMetadata text blob.
    Returns (west_m, south_m, east_m, north_m).
    """
    ul_x = float(re.search(r"UpperLeftPointMtrs=\((.+?),",   meta).group(1))
    ul_y = float(re.search(r"UpperLeftPointMtrs=\(.+?,(.+?)\)", meta).group(1))
    lr_x = float(re.search(r"LowerRightMtrs=\((.+?),",   meta).group(1))
    lr_y = float(re.search(r"LowerRightMtrs=\(.+?,(.+?)\)", meta).group(1))
    return (ul_x, lr_y, lr_x, ul_y)


def extract_bands(hdf_path: Path) -> dict:
    """
    Opens a VNP09H1 HDF5 file, extracts I1/I2/I3 bands,
    applies fill value mask, and scales to float32 reflectance.

    NOTE: No QA cloud mask applied — the 8-day composite
    already represents NASA's best-pixel selection per location.
    Fill value masking is sufficient here.

    Returns dict with keys: red, nir, swir, bbox, source.
    """
    with h5py.File(hdf_path, "r") as f:
        i1 = f[f"{HDF_BASE}/SurfReflect_I1"][:]
        i2 = f[f"{HDF_BASE}/SurfReflect_I2"][:]
        i3 = f[f"{HDF_BASE}/SurfReflect_I3"][:]
        sm = f["HDFEOS INFORMATION/StructMetadata.0"][()].decode("utf-8")

    bad = (i1 == FILL_VALUE) | (i2 == FILL_VALUE) | (i3 == FILL_VALUE)

    def scale(b):
        a = b.astype(np.float32) * SCALE_FACTOR
        a[bad] = np.nan
        return np.clip(a, 0.0, 1.0)

    return {
        "red":    scale(i1),
        "nir":    scale(i2),
        "swir":   scale(i3),
        "bbox":   _parse_bbox(sm),
        "source": Path(hdf_path).name
    }


def write_cog(array: np.ndarray, bbox_m: tuple,
              index_name: str, tile_name: str,
              output_dir: Path) -> Path:
    """
    Writes a float32 index array as a Cloud-Optimized GeoTIFF
    in WGS84 (EPSG:4326).

    Process:
        1. Write temp GeoTIFF in native VIIRS Sinusoidal projection
        2. Reproject to WGS84
        3. Translate to COG with deflate compression + baked overviews
        4. Clean up temp files
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    parts    = tile_name.split(".")
    date_str = parts[1]
    tile_id  = parts[2]

    tmp1 = output_dir / f"_t1_{index_name}_{tile_id}.tif"
    tmp2 = output_dir / f"_t2_{index_name}_{tile_id}.tif"
    out  = output_dir / f"{index_name}_{tile_id}_{date_str}_cog.tif"

    rows, cols     = array.shape
    w, s, e, n     = bbox_m

    # Write in native sinusoidal projection
    with rasterio.open(
        tmp1, "w", driver="GTiff",
        height=rows, width=cols, count=1, dtype="float32",
        crs=SINU_CRS,
        transform=from_bounds(w, s, e, n, cols, rows),
        nodata=np.nan
    ) as dst:
        dst.write(array, 1)

    # Reproject to WGS84
    t2, w2, h2 = calculate_default_transform(
        SINU_CRS, WGS84_CRS, cols, rows,
        left=w, bottom=s, right=e, top=n
    )
    with rasterio.open(tmp1) as src:
        with rasterio.open(
            tmp2, "w", driver="GTiff",
            height=h2, width=w2, count=1, dtype="float32",
            crs=WGS84_CRS, transform=t2, nodata=np.nan
        ) as dst:
            reproject(
                rasterio.band(src, 1), rasterio.band(dst, 1),
                src_transform=src.transform, src_crs=src.crs,
                dst_transform=t2, dst_crs=WGS84_CRS,
                resampling=Resampling.bilinear
            )

    # Translate to COG
    cog_translate(
        tmp2, out,
        cog_profiles.get("deflate"),
        overview_level=5,
        quiet=True
    )

    tmp1.unlink(missing_ok=True)
    tmp2.unlink(missing_ok=True)

    return out
