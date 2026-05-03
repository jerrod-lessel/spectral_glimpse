"""
Spectral Glimpse — main.py
VERSION: 2026-05-03.a
-------
Entrypoint for the Spectral Glimpse pipeline.
Runs the full pipeline:
  1. Authenticate with NASA Earthdata
  2. Search and download VIIRS VNP09H1 tiles
  3. Extract bands and compute indices
  4. Write per-tile COGs
  5. Mosaic and clip to California
  6. Upload final COGs to Cloudflare R2

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


# ── R2 UPLOAD ────────────────────────────────────────────────────────────────
def upload_to_r2(local_path: Path, r2_key: str):
    """
    Uploads a file to Cloudflare R2 using boto3's S3-compatible API.
    Credentials are read from environment variables.
    """
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto"
    )

    bucket = os.environ["R2_BUCKET_NAME"]

    print(f"  Uploading {local_path.name} to R2...")
    s3.upload_file(
        str(local_path),
        bucket,
        r2_key,
        ExtraArgs={"ContentType": "image/tiff"}
    )
    print(f"  Uploaded -> r2://{bucket}/{r2_key}")


# ── MAIN ─────────────────────────────────────────────────────────────────────
def update_manifest(final_cogs: dict, composite_date: str, date_label: str):
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto"
    )
    bucket = os.environ["R2_BUCKET_NAME"]

    try:
        resp     = s3.get_object(Bucket=bucket, Key="manifest.json")
        manifest = json.loads(resp["Body"].read().decode("utf-8"))
    except Exception:
        manifest = []

    entry = {
        "date":       composite_date,
        "date_label": date_label,
        "indices": {
            name: f"cogs/{name}_california_{composite_date}_cog.tif"
            for name in final_cogs.keys()
        }
    }

    manifest.append(entry)
    manifest = manifest[-92:]

    s3.put_object(
        Bucket=bucket,
        Key="manifest.json",
        Body=json.dumps(manifest, indent=2).encode("utf-8"),
        ContentType="application/json"
    )
    print("  Manifest updated")


def run():
    from datetime import datetime

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

    print("\nStep 4: Processing tiles...")
    for hdf_path in hdf_files:
        print(f"\n  {hdf_path.name}")
        bands   = extract_bands(hdf_path)
        indices = compute_indices(bands)
        for index_name, array in indices.items():
            write_cog(
                array=array,
                bbox_m=bands["bbox"],
                index_name=index_name,
                tile_name=bands["source"],
                output_dir=TILE_DIR
            )
            print(f"    wrote {index_name.upper()} COG")

    print("\nStep 5: Mosaicking and clipping to California...")
    ca_geom    = fetch_california_boundary()
    final_cogs = mosaic_and_clip(TILE_DIR, OUTPUT_DIR, ca_geom, INDEX_NAMES)

    # Extract acquisition date from the first HDF5 filename
    # Format: VNP09H1.AYYYYDDD.hXXvYY... where AYYYYDDD is acquisition year+julian day
    def get_acquisition_date(hdf_files):
        try:
            name = hdf_files[0].name  # e.g. VNP09H1.A2026089.h08v04...
            part = name.split(".")[1]  # A2026089
            year = int(part[1:5])
            jday = int(part[5:8])
            from datetime import date
            d = date(year, 1, 1) + __import__('datetime').timedelta(days=jday - 1)
            return d.strftime("%Y%m%d"), d.strftime("%b %d %Y")
        except Exception:
            return datetime.utcnow().strftime("%Y%m%d"), datetime.utcnow().strftime("%b %d %Y")
    
    composite_date, date_label = get_acquisition_date(hdf_files)

    dated_cogs = {}
    for index_name, cog_path in final_cogs.items():
        dated_name = OUTPUT_DIR / f"{index_name}_california_{composite_date}_cog.tif"
        cog_path.rename(dated_name)
        dated_cogs[index_name] = dated_name

    print("\nStep 6: Uploading to Cloudflare R2...")
    for index_name, cog_path in dated_cogs.items():
        r2_key = f"cogs/{index_name}_california_{composite_date}_cog.tif"
        upload_to_r2(cog_path, r2_key)

    print("\nStep 7: Updating manifest...")
    update_manifest(dated_cogs, composite_date, date_label)

    print("\n" + "=" * 55)
    print("  Pipeline complete!")
    print("=" * 55)


if __name__ == "__main__":
    run()
