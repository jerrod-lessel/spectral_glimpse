"""
Spectral Glimpse — main.py
VERSION: 2026-05-13.a
-------
Entrypoint for the Spectral Glimpse pipeline.
Runs the full pipeline:
  1. Authenticate with NASA Earthdata
  2. Search and download VIIRS VNP09H1 tiles
  3. Extract bands and compute indices
  4. Write per-tile COGs
  5. Mosaic and clip to California
  6. Upload final COGs to Cloudflare R2
  7. Write one manifest entry per unique acquisition date

Designed to run as a Cloud Run job on a schedule (every 8 days).
Credentials are passed as environment variables — never hardcoded.

Environment variables required:
    EARTHDATA_USERNAME    — NASA Earthdata username
    EARTHDATA_PASSWORD    — NASA Earthdata password
    R2_ACCOUNT_ID         — Cloudflare account ID
    R2_ACCESS_KEY_ID      — R2 access key
    R2_SECRET_ACCESS_KEY  — R2 secret key
    R2_BUCKET_NAME        — R2 bucket name
"""

import os
import boto3
import json
from pathlib import Path
from datetime import date, timedelta
from pipeline.fetch import authenticate, search_tiles, download_tiles
from pipeline.cog import extract_bands, write_cog
from pipeline.indices import compute_indices
from pipeline.mosaic import fetch_california_boundary, mosaic_and_clip, INDEX_NAMES


# ── PATHS ────────────────────────────────────────────────────────────────────
DATA_DIR   = Path("/tmp/data/raw")
TILE_DIR   = Path("/tmp/data/tiles")
OUTPUT_DIR = Path("/tmp/data/mosaic")

for d in [DATA_DIR, TILE_DIR, OUTPUT_DIR]:
    d.mkdir(parents=True, exist_ok=True)


# ── R2 CLIENT ────────────────────────────────────────────────────────────────
def get_r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto"
    )


# ── R2 UPLOAD ────────────────────────────────────────────────────────────────
def upload_to_r2(local_path: Path, r2_key: str):
    s3     = get_r2_client()
    bucket = os.environ["R2_BUCKET_NAME"]
    print(f"  Uploading {local_path.name} to R2...")
    s3.upload_file(
        str(local_path),
        bucket,
        r2_key,
        ExtraArgs={"ContentType": "image/tiff"}
    )
    print(f"  Uploaded -> r2://{bucket}/{r2_key}")


# ── DATE EXTRACTION ───────────────────────────────────────────────────────────
def group_files_by_date(hdf_files: list) -> dict:
    """
    Groups HDF5 files by their acquisition date extracted from the filename.
    Format: VNP09H1.AYYYYDDD.hXXvYY...
    Returns a dict like: { "20260501": [Path, Path, ...], "20260423": [...] }
    Prints a warning and skips any file whose date cannot be parsed.
    """
    groups = {}
    for f in hdf_files:
        try:
            part = f.name.split(".")[1]   # e.g. A2026121
            year = int(part[1:5])
            jday = int(part[5:8])
            d    = date(year, 1, 1) + timedelta(days=jday - 1)
            key  = d.strftime("%Y%m%d")
            if key not in groups:
                groups[key] = []
            groups[key].append(f)
        except Exception as e:
            print(f"  ⚠️  Could not parse date from {f.name}: {e} — skipping")
    return groups


# ── MANIFEST UPDATE ───────────────────────────────────────────────────────────
def update_manifest(composite_date: str, date_label: str, index_names: list):
    s3     = get_r2_client()
    bucket = os.environ["R2_BUCKET_NAME"]

    try:
        resp     = s3.get_object(Bucket=bucket, Key="manifest.json")
        manifest = json.loads(resp["Body"].read().decode("utf-8"))
    except Exception:
        manifest = []

    # Don't add a duplicate entry if this date already exists
    existing_dates = [e["date"] for e in manifest]
    if composite_date in existing_dates:
        print(f"  ℹ️  {composite_date} already in manifest — skipping duplicate")
        return

    entry = {
        "date":       composite_date,
        "date_label": date_label,
        "indices": {
            name: f"cogs/{name}_california_{composite_date}_cog.tif"
            for name in index_names
        }
    }

    manifest.append(entry)
    manifest.sort(key=lambda e: e["date"])  # keep chronological order
    manifest = manifest[-92:]               # rolling 2-year window

    s3.put_object(
        Bucket=bucket,
        Key="manifest.json",
        Body=json.dumps(manifest, indent=2).encode("utf-8"),
        ContentType="application/json"
    )
    print(f"  Manifest updated — {composite_date} added")


# ── PROCESS ONE DATE ──────────────────────────────────────────────────────────
def process_date(composite_date: str, hdf_files_for_date: list, ca_geom):
    """
    Runs steps 4-7 for a single acquisition date:
    processes tiles, mosaics, uploads COGs, updates manifest.
    """
    d          = date(int(composite_date[:4]), int(composite_date[4:6]), int(composite_date[6:8]))
    date_label = d.strftime("%b %d %Y")

    print(f"\n  --- Processing date: {composite_date} ({len(hdf_files_for_date)} tiles) ---")

    # Per-tile COGs into a temp subfolder for this date
    tile_subdir = TILE_DIR / composite_date
    tile_subdir.mkdir(parents=True, exist_ok=True)

    for hdf_path in hdf_files_for_date:
        print(f"\n    {hdf_path.name}")
        bands   = extract_bands(hdf_path)
        indices = compute_indices(bands)
        for index_name, array in indices.items():
            write_cog(
                array=array,
                bbox_m=bands["bbox"],
                index_name=index_name,
                tile_name=bands["source"],
                output_dir=tile_subdir
            )
            print(f"      wrote {index_name.upper()} COG")

    # Mosaic and clip
    out_subdir = OUTPUT_DIR / composite_date
    out_subdir.mkdir(parents=True, exist_ok=True)
    final_cogs = mosaic_and_clip(tile_subdir, out_subdir, ca_geom, INDEX_NAMES)

    # Rename with date and upload
    print(f"\n    Uploading COGs for {composite_date}...")
    for index_name, cog_path in final_cogs.items():
        dated_name = out_subdir / f"{index_name}_california_{composite_date}_cog.tif"
        cog_path.rename(dated_name)
        r2_key = f"cogs/{index_name}_california_{composite_date}_cog.tif"
        upload_to_r2(dated_name, r2_key)

    # Update manifest
    update_manifest(composite_date, date_label, list(final_cogs.keys()))


# ── MAIN ─────────────────────────────────────────────────────────────────────
def run():
    print("=" * 55)
    print("  Spectral Glimpse -- VIIRS Pipeline")
    print("=" * 55 + "\n")

    print("Step 1: Authenticating...")
    authenticate()
    print("  Authenticated\n")

    print("Step 2: Searching for tiles...")
    granules = search_tiles(days_back=16)
    if not granules:
        print("  No granules found. Exiting.")
        return

    print("\nStep 3: Downloading tiles...")
    hdf_files = download_tiles(granules, DATA_DIR)

    # Group downloaded files by acquisition date
    date_groups = group_files_by_date(hdf_files)
    print(f"\n  Found {len(date_groups)} unique acquisition date(s): {sorted(date_groups.keys())}")

    print("\nStep 4: Fetching California boundary...")
    ca_geom = fetch_california_boundary()
    print("  Got California boundary")

    print("\nSteps 5-7: Processing each acquisition date...")
    for composite_date in sorted(date_groups.keys()):
        process_date(composite_date, date_groups[composite_date], ca_geom)

    print("\n" + "=" * 55)
    print("  Pipeline complete!")
    print("=" * 55)


if __name__ == "__main__":
    run()
