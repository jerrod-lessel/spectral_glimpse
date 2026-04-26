# Dockerfile
# ----------
# Builds the Spectral Glimpse pipeline + API as a single container.
# Used for both the scheduled Cloud Run pipeline job
# and the Cloud Run API service.
#
# Build arg MODE controls which entrypoint runs:
#   MODE=pipeline  -> runs main.py (the 8-day batch job)
#   MODE=api       -> runs the Flask point sample API

FROM python:3.11-slim

# Keeps Python from buffering stdout/stderr
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies needed by rasterio
RUN apt-get update && apt-get install -y \
    libgdal-dev \
    gdal-bin \
    python3-gdal \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY pipeline/ ./pipeline/
COPY api/       ./api/
COPY main.py    .

# Build argument to select mode
ARG MODE=api
ENV MODE=${MODE}

# Entrypoint script selects pipeline or API based on MODE
CMD if [ "$MODE" = "pipeline" ]; then \
        python main.py; \
    else \
        gunicorn --bind 0.0.0.0:8080 --workers 2 --timeout 120 api.sample:app; \
    fi

EXPOSE 8080
