# Spectral Glimpse
### *Because sometimes you don't need the whole spectrum, just a peek.*

A lightweight remote sensing platform that delivers on-demand spectral
index values for any point in California. Click anywhere on the map,
get instant insights about vegetation health, fire risk, moisture
conditions, snow cover, and bare soil exposure — powered by NASA VIIRS
satellite data updated every 8 days.

---

## What It Does

Spectral Glimpse pulls NASA VIIRS VNP09H1 8-day surface reflectance
composites, computes six spectral indices across California, and serves
them as Cloud-Optimized GeoTIFFs. A point-click interface lets users
sample any location and get plain-English interpretations of what the
satellite is seeing.

| Index | What it measures |
|---|---|
| NDVI  | Vegetation greenness |
| EVI2  | Enhanced vegetation — less atmosphere sensitivity than NDVI |
| NBR   | Burn ratio — single-date fire risk indicator |
| NDMI  | Vegetation moisture content |
| NDSI  | Snow and ice — useful for Sierra Nevada snowpack |
| BSI   | Bare soil exposure — elevated after fire or disturbance |

---

## Architecture
NASA Earthdata (VIIRS VNP09H1)
↓
Cloud Run Pipeline Job (runs every 8 days)

Downloads HDF5 tiles for California
Computes 6 spectral indices
Mosaics + clips to state boundary
Writes Cloud-Optimized GeoTIFFs
↓
Cloudflare R2 (COG storage, near-zero egress cost)
↓
Cloud Run API (/sample?lat=&lon=)
HTTP range requests — reads single pixels from COGs
Returns index values + plain-English interpretations
↓
Cloudflare Pages (frontend)
Leaflet map
Click → API call → sidebar with values + insights
---

## Tech Stack

- **Data:** NASA VIIRS VNP09H1 v002 via earthaccess
- **Processing:** Python, rasterio, rio-cogeo, numpy, geopandas
- **Storage:** Cloudflare R2 (Cloud-Optimized GeoTIFF)
- **API:** Flask + gunicorn on Cloud Run
- **Frontend:** Leaflet, vanilla JS
- **Hosting:** Cloudflare Pages
- **Automation:** Cloud Run Jobs + Cloud Scheduler

---

## Project Structure
spectral-glimpse/
pipeline/
fetch.py      # NASA Earthdata auth + tile search/download
indices.py    # Spectral index computation + vis metadata
cog.py        # Band extraction + COG writing
mosaic.py     # Tile merging + California clip
api/
sample.py     # Point sampling API (Flask)
frontend/
index.html    # Map UI
map.js        # Leaflet + sidebar logic
style.css     # Styles
Dockerfile        # Pipeline + API container
requirements.txt  # Python dependencies
main.py           # Pipeline entrypoint
---

## Environment Variables

Never hardcoded. Set these in Cloud Run and Cloudflare:

| Variable | Used by | Description |
|---|---|---|
| `EARTHDATA_USERNAME` | Pipeline | NASA Earthdata username |
| `EARTHDATA_PASSWORD` | Pipeline | NASA Earthdata password |
| `R2_ACCOUNT_ID` | Pipeline + API | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Pipeline + API | R2 access key |
| `R2_SECRET_ACCESS_KEY` | Pipeline + API | R2 secret key |
| `R2_BUCKET_NAME` | Pipeline + API | R2 bucket name |
| `R2_PUBLIC_URL` | API | Public base URL for R2 |

---

## Data Notes

- **Product:** VIIRS VNP09H1 v002 — 8-day best-pixel composite, 500m resolution
- **Update cadence:** Every 8 days, automated via Cloud Scheduler
- **Coverage:** California statewide
- **Archive:** Rolling 3-month window
- **NBR note:** Single-date NBR is a risk indicator only.
  True burn severity mapping requires pre/post delta-NBR.

---

## Part of LGeo

Spectral Glimpse is part of the
[Lessel Geospatial](https://www.lesselgeospatial.com/) project portfolio.
