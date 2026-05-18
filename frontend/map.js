/* ============================================================
   Spectral Glimpse — map.js
   VERSION: 2026-05-17.a

   Changes:
   - Zoom/home controls now use HTML buttons (matching Remnant Biome)
   - Basemap selector uses HTML dropdown (matching Remnant Biome)
   - Legal disclaimer toggle added
   - L.control.zoom, L.control.layers, L.control.scale removed
============================================================ */

// ── CONFIG ────────────────────────────────────────────────────
const API_BASE = "https://spectral-glimpse-api-1087489116508.us-west1.run.app";

const API_URL = window.location.hostname === "localhost"
  ? "http://localhost:8080"
  : API_BASE;

const INDEX_CONFIG = {
  ndvi: {
    label: "NDVI",
    color: "#4ade80",
    min: 0.0, max: 0.9,
    what: "Compares how much red light plants absorb versus how much near-infrared they reflect. Healthy vegetation absorbs red for photosynthesis and strongly reflects NIR, the bigger that gap, the greener and healthier the canopy.",
    equation: "(NIR - Red) / (NIR + Red)",
    trend_context: "A declining NDVI trend can signal drought stress, seasonal senescence, post-fire recovery lag, or land cover change. A rising trend often reflects rainfall response, crop growth, or vegetation recovery after disturbance."
  },
  evi2: {
    label: "EVI2",
    color: "#86efac",
    min: -0.1, max: 0.7,
    what: "A refinement of NDVI that reduces atmospheric interference and soil background effects. More reliable than NDVI in dense canopy or hazy conditions, both common in California's Central Valley and coastal fog zones.",
    equation: "2.5 x (NIR - Red) / (NIR + 2.4 x Red + 1)",
    trend_context: "EVI2 trends often track seasonal agricultural cycles in the Central Valley. A divergence between EVI2 and NDVI can suggest changing atmospheric conditions or shifts in canopy density."
  },
  nbr: {
    label: "NBR",
    color: "#fbbf24",
    min: -1.0, max: 1.0,
    what: "Sensitive to the charred carbon and exposed soil that fire leaves behind. Unburned vegetation has high NIR and low SWIR reflectance. Fire flips that relationship, dropping NIR and raising SWIR dramatically.",
    equation: "(NIR - SWIR) / (NIR + SWIR)",
    trend_context: "A sudden NBR drop followed by gradual recovery is the classic post-fire signal. Note: this is single-date NBR while true burn severity mapping requires pre/post delta-NBR (dNBR). Use this as a risk indicator, not a definitive burn map."
  },
  ndmi: {
    label: "NDMI",
    color: "#38bdf8",
    min: -0.3, max: 0.5,
    what: "Tracks liquid water held in vegetation canopy. SWIR wavelengths are absorbed by water, so when vegetation dries out, SWIR reflectance rises and NDMI drops. A reliable early indicator of drought stress and elevated fire weather risk.",
    equation: "(NIR - SWIR) / (NIR + SWIR)",
    trend_context: "NDMI typically drops through California's dry season (June-October) and recovers after winter rains. A trend that fails to recover after the wet season can signal multi-year drought stress accumulating in the landscape."
  },
  ndsi: {
    label: "NDSI",
    color: "#cbd5e1",
    min: -0.5, max: 0.8,
    what: "Snow and ice strongly absorb SWIR wavelengths while reflecting visible light, making the contrast between visible and SWIR a reliable snow detector. Values above 0.4 generally indicate snow-covered ground.",
    equation: "(Red - SWIR) / (Red + SWIR)",
    trend_context: "Sierra Nevada snowpack is California's largest freshwater reservoir. Declining NDSI in winter months or earlier spring melt timing are important climate signals. Note: the standard NDSI uses a Green band rather than Red; VIIRS VNP09H1 lacks a green I-band so Red is used as a substitute.",
  },
  bsi: {
    label: "BSI",
    color: "#fb923c",
    min: -0.5, max: 0.3,
    what: "Combines SWIR, Red, and NIR to isolate bare mineral soil from vegetated surfaces. Bare soil has high SWIR and Red reflectance but low NIR, the inverse of healthy vegetation. Rises sharply after fire removes ground cover.",
    equation: "((SWIR + Red) - NIR) / ((SWIR + Red) + NIR)",
    trend_context: "A rising BSI trend after a stable period can indicate post-fire soil exposure, drought-driven vegetation loss, or agricultural harvest cycles. Elevated BSI increases erosion and runoff risk, particularly on steep terrain."
  },
};

const MOCK_MODE = false;

const MOCK_DATA = {
  composite_date: "Mar 30 2026",
  indices: {
    ndvi: { label:"NDVI", value:0.42, interpretation:"Moderate vegetation - grassland or dry shrubland typical of coastal foothills." },
    evi2: { label:"EVI2", value:0.31, interpretation:"Sparse to moderate vegetation cover with reduced atmosphere sensitivity." },
    nbr:  { label:"NBR",  value:0.38, interpretation:"Healthy unburned vegetation. Low single-date burn risk indicator." },
    ndmi: { label:"NDMI", value:0.12, interpretation:"Moderate moisture - vegetation mildly stressed, typical of late dry season." },
    ndsi: { label:"NDSI", value:-0.18,interpretation:"No snow or ice detected at this elevation and location." },
    bsi:  { label:"BSI",  value:0.08, interpretation:"Mixed vegetation and bare soil - moderate ground exposure." },
  },
  history: {
    ndvi: Array.from({length:92},(_,i)=>({ date:`8-day ${i+1}`, value: 0.42 + (Math.sin(i/8)*0.15) + (Math.random()*0.06-0.03) })),
    evi2: Array.from({length:92},(_,i)=>({ date:`8-day ${i+1}`, value: 0.31 + (Math.sin(i/8)*0.10) + (Math.random()*0.05-0.025) })),
    nbr:  Array.from({length:92},(_,i)=>({ date:`8-day ${i+1}`, value: 0.38 + (Math.sin(i/10)*0.20) + (Math.random()*0.06-0.03) })),
    ndmi: Array.from({length:92},(_,i)=>({ date:`8-day ${i+1}`, value: 0.12 + (Math.sin(i/8)*0.12) + (Math.random()*0.04-0.02) })),
    ndsi: Array.from({length:92},(_,i)=>({ date:`8-day ${i+1}`, value: -0.18 + (Math.sin(i/12)*0.08) + (Math.random()*0.03-0.015) })),
    bsi:  Array.from({length:92},(_,i)=>({ date:`8-day ${i+1}`, value: 0.08 + (Math.sin(i/9)*0.08) + (Math.random()*0.04-0.02) })),
  }
};

const CA_BOUNDARY_URL =
  "https://services.arcgis.com/ue9rwulIoeLEI9bj/arcgis/rest/services/US_StateBoundaries/FeatureServer/0";

const BASEMAP_TILES = {
  "carto-light":    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  "carto-dark":     "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  "esri-satellite": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  "osm":            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
};

// ── MAP INIT ──────────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: "", shadowUrl: "", iconRetinaUrl: "" });

let activeBasemap = "carto-light";

const map = L.map("map", {
  center: [37.5, -119.5],
  zoom: 6,
  zoomControl: false,
  attributionControl: true,
});

L.tileLayer(BASEMAP_TILES["carto-light"], {
  attribution: "© Carto © OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

// ── CALIFORNIA FOCUS MASK ─────────────────────────────────────
function addCaliforniaFocusMask() {
  try {
    const maskPane = map.createPane("caMaskPane");
    maskPane.style.zIndex = 260;
    maskPane.style.pointerEvents = "none";

    const worldRing = [[-90,-180],[-90,180],[90,180],[90,-180],[-90,-180]];
    const statesLayer = L.esri.featureLayer({ url: CA_BOUNDARY_URL });

    statesLayer.query().where("NAME = 'California'").returnGeometry(true).run((err, fc) => {
      if (err || !fc?.features?.length) return;
      const caGeom = fc.features[0].geometry;
      if (!caGeom) return;

      const toLatLngRing = (ring) => ring.map(([lng, lat]) => [lat, lng]);
      const holes = [];

      if (caGeom.type === "Polygon") {
        caGeom.coordinates.forEach((ring) => holes.push(toLatLngRing(ring)));
      } else if (caGeom.type === "MultiPolygon") {
        caGeom.coordinates.forEach((poly) => poly.forEach((ring) => holes.push(toLatLngRing(ring))));
      }

      L.polygon([worldRing, ...holes], {
        pane: "caMaskPane",
        stroke: false,
        fill: true,
        fillColor: "#000",
        fillOpacity: 0.45,
        interactive: false,
      }).addTo(map);
    });
  } catch (e) {
    console.warn("CA mask: failed to initialize:", e);
  }
}

addCaliforniaFocusMask();

// ── ZOOM + HOME CONTROLS (HTML buttons, matching Remnant Biome) ───
document.getElementById("zoom-in").addEventListener("click",  () => map.zoomIn());
document.getElementById("zoom-out").addEventListener("click", () => map.zoomOut());
document.getElementById("home-btn").addEventListener("click", () =>
  map.setView([37.5, -119.5], 6)
);

// ── BASEMAP TOGGLE ────────────────────────────────────────────
document.getElementById("basemap-toggle").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("basemap-dropdown").classList.toggle("hidden");
});

document.querySelectorAll(".basemap-opt").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".basemap-opt").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeBasemap = btn.dataset.basemap;
    // Remove existing tile layer and add new one
    map.eachLayer(layer => {
      if (layer instanceof L.TileLayer) map.removeLayer(layer);
    });
    L.tileLayer(BASEMAP_TILES[activeBasemap], {
      attribution: "© Carto © OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    document.getElementById("basemap-dropdown").classList.add("hidden");
  });
});

document.addEventListener("click", () => {
  document.getElementById("basemap-dropdown")?.classList.add("hidden");
});

// ── ABOUT TOGGLE ──────────────────────────────────────────────
document.getElementById("about-toggle")?.addEventListener("click", function () {
  document.getElementById("about-panel")?.classList.toggle("hidden");
  setTimeout(() => map.invalidateSize(), 50);
});

// ── DISCLAIMER ────────────────────────────────────────────────
document.getElementById("disclaimer-toggle")?.addEventListener("click", () => {
  document.getElementById("disclaimer-panel").classList.toggle("hidden");
  document.getElementById("disclaimer-toggle").classList.toggle("open");
});

// ── CLICK MARKER ──────────────────────────────────────────────
const markerIcon = L.divIcon({
  className: "",
  html: '<div class="click-marker-dot"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

let activeMarker = null;

function placeMarker(latlng) {
  if (activeMarker) map.removeLayer(activeMarker);
  activeMarker = L.marker(latlng, { icon: markerIcon }).addTo(map);
}

// ── SIDEBAR HELPERS ───────────────────────────────────────────
const sidebar        = document.getElementById("sidebar");
const sidebarLoading = document.getElementById("sidebar-loading");
const cardsScroll    = document.getElementById("cards-scroll");
const coordsEl       = document.getElementById("sidebar-coords");
const locationEl     = document.getElementById("sidebar-location");
const dateEl         = document.getElementById("sidebar-date");
const clickHint      = document.getElementById("click-hint");

function showSidebar()  { sidebar.classList.add("open"); }

function showLoading() {
  sidebarLoading.style.display = "flex";
  cardsScroll.style.display    = "none";
}

function showCards() {
  sidebarLoading.style.display = "none";
  cardsScroll.style.display    = "flex";
  document.getElementById("sidebar-footer-actions")?.classList.remove("hidden");
}

function showError(msg) {
  sidebarLoading.style.display = "none";
  cardsScroll.style.display    = "flex";
  cardsScroll.innerHTML = `<div class="error-msg">${msg}</div>`;
}

function formatCoords(lat, lon) {
  const latDir = lat >= 0 ? "N" : "S";
  const lonDir = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${latDir}  ·  ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}

async function reverseGeocode(lat, lon) {
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await resp.json();
    const addr = data.address || {};
    return addr.city || addr.town || addr.village || addr.county || addr.state || "California";
  } catch {
    return "California";
  }
}

// ── SIDEBAR CLOSE BUTTON ──────────────────────────────────────
(function addSidebarCloseButton() {
  const header = document.getElementById("sidebar-header");
  if (!header) return;
  const btn = document.createElement("button");
  btn.id = "sidebar-close";
  btn.setAttribute("aria-label", "Close panel");
  btn.textContent = "\u2715";
  btn.addEventListener("click", () => sidebar.classList.remove("open"));
  header.style.position = "relative";
  header.appendChild(btn);
})();

// ── EXPORT PDF ────────────────────────────────────────────────
document.getElementById("export-pdf-btn")?.addEventListener("click", function () {
  const btn = this;
  btn.disabled = true;
  btn.textContent = "Generating PDF...";

  const lat     = coordsEl?.textContent || "-";
  const name    = locationEl?.textContent || "Location Report";
  const dateStr = dateEl?.textContent || "";
  const generated = new Date().toLocaleString();

  const printEl = document.createElement("div");
  printEl.style.cssText = "font-family:Arial,sans-serif;color:#111;background:#fff;padding:24px;max-width:680px;";
  printEl.innerHTML = `
    <h1 style="margin:0 0 4px;font-size:18px;color:#0c1f2c;">Spectral Glimpse - Spectral Index Report</h1>
    <p style="margin:0 0 2px;font-size:12px;color:#555;">${name}</p>
    <p style="margin:0 0 2px;font-size:11px;color:#888;">${lat}</p>
    ${dateStr ? `<p style="margin:0 0 4px;font-size:11px;color:#888;">${dateStr}</p>` : ""}
    <p style="margin:0 0 16px;font-size:11px;color:#888;">Generated: ${generated}</p>
    <hr style="border:none;border-top:1px solid #ddd;margin-bottom:16px;">
  `;

  if (!lastApiData) {
    btn.disabled = false;
    btn.textContent = "\u2B07 Export PDF Report";
    return;
  }

  const INDEX_ORDER = ["ndvi", "evi2", "nbr", "ndmi", "ndsi", "bsi"];
  const FULL_NAMES = {
    ndvi: "Normalized Difference Vegetation Index",
    evi2: "Enhanced Vegetation Index 2",
    nbr:  "Normalized Burn Ratio",
    ndmi: "Normalized Difference Moisture Index",
    ndsi: "Normalized Difference Snow Index",
    bsi:  "Bare Soil Index",
  };

  INDEX_ORDER.forEach(key => {
    const idx = lastApiData.indices[key];
    if (!idx) return;
    const cfg = INDEX_CONFIG[key] || {};

    const history = (lastApiData.history && lastApiData.history[key]) || [];
    const values  = history.map(h => h.value);
    const avg     = values.length ? (values.reduce((a,b) => a+b,0) / values.length).toFixed(3) : "N/A";
    const hi      = values.length ? Math.max(...values).toFixed(3) : "N/A";
    const lo      = values.length ? Math.min(...values).toFixed(3) : "N/A";

    let trendStr = "Stable";
    if (values.length >= 6) {
      const third     = Math.floor(values.length / 3);
      const earlyAvg  = values.slice(0, third).reduce((a,b)=>a+b,0) / third;
      const recentAvg = values.slice(-third).reduce((a,b)=>a+b,0) / third;
      const delta     = recentAvg - earlyAvg;
      const range     = (cfg.max ?? 1) - (cfg.min ?? -1);
      if (delta > range * 0.04)       trendStr = "Increasing over 2 years";
      else if (delta < -range * 0.04) trendStr = "Decreasing over 2 years";
    }

    const section = document.createElement("div");
    section.style.cssText = "margin-bottom:16px;padding:12px;border:1px solid #ddd;border-radius:6px;background:#f9f9f9;page-break-inside:avoid;";
    section.innerHTML = `
      <div style="font-size:10px;font-weight:600;color:#6a8fa8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">${key.toUpperCase()}</div>
      <div style="font-size:16px;font-weight:600;color:#0c1f2c;margin-bottom:6px;">${FULL_NAMES[key] || idx.label}</div>
      <div style="display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
        <div style="background:#fff;border:1px solid #ddd;border-radius:5px;padding:7px 12px;min-width:80px;text-align:center;">
          <div style="font-size:18px;font-weight:600;color:#0c1f2c;">${idx.value !== null ? idx.value.toFixed(3) : "N/A"}</div>
          <div style="font-size:9px;color:#7a9ab0;text-transform:uppercase;margin-top:2px;">Current</div>
        </div>
        <div style="background:#fff;border:1px solid #ddd;border-radius:5px;padding:7px 12px;min-width:80px;text-align:center;">
          <div style="font-size:18px;font-weight:600;color:#0c1f2c;">${avg}</div>
          <div style="font-size:9px;color:#7a9ab0;text-transform:uppercase;margin-top:2px;">2-yr Avg</div>
        </div>
        <div style="background:#fff;border:1px solid #ddd;border-radius:5px;padding:7px 12px;min-width:80px;text-align:center;">
          <div style="font-size:18px;font-weight:600;color:#0c1f2c;">${lo}</div>
          <div style="font-size:9px;color:#7a9ab0;text-transform:uppercase;margin-top:2px;">2-yr Low</div>
        </div>
        <div style="background:#fff;border:1px solid #ddd;border-radius:5px;padding:7px 12px;min-width:80px;text-align:center;">
          <div style="font-size:18px;font-weight:600;color:#0c1f2c;">${hi}</div>
          <div style="font-size:9px;color:#7a9ab0;text-transform:uppercase;margin-top:2px;">2-yr High</div>
        </div>
        <div style="background:#fff;border:1px solid #ddd;border-radius:5px;padding:7px 12px;min-width:80px;text-align:center;">
          <div style="font-size:13px;font-weight:600;color:#0c1f2c;">${trendStr}</div>
          <div style="font-size:9px;color:#7a9ab0;text-transform:uppercase;margin-top:2px;">Trend</div>
        </div>
      </div>
      ${idx.interpretation ? `<p style="font-size:11px;color:#334155;margin:0 0 8px;font-style:italic;">${idx.interpretation}</p>` : ""}
      ${cfg.what ? `<p style="font-size:11px;color:#555;margin:0 0 6px;line-height:1.5;"><strong>What it measures:</strong> ${cfg.what}</p>` : ""}
      ${cfg.equation ? `<p style="font-size:10px;color:#7a9ab0;font-family:monospace;background:#f0f0f0;padding:4px 8px;border-radius:4px;margin:0 0 6px;"><strong>Equation:</strong> ${cfg.equation}</p>` : ""}
      ${cfg.trend_context ? `<p style="font-size:11px;color:#555;margin:0;line-height:1.5;"><strong>Trend context:</strong> ${cfg.trend_context}</p>` : ""}
    `;
    printEl.appendChild(section);
  });

  const opt = {
    margin:      [10, 10, 10, 10],
    filename:    `spectral-glimpse-report-${Date.now()}.pdf`,
    image:       { type: "jpeg", quality: 0.92 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
    jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
  };

  html2pdf().set(opt).from(printEl).save()
    .finally(() => {
      btn.disabled = false;
      btn.textContent = "\u2B07 Export PDF Report";
    });
});

// ── GAUGE SVG ─────────────────────────────────────────────────
function makeGauge(value, min, max, color, size = 72) {
  const r = size * 0.37;
  const cx = size / 2;
  const cy = size * 0.56;
  const startAngle = -215;
  const endAngle   = 35;
  const totalArc   = endAngle - startAngle;
  const pct        = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const fillArc    = totalArc * pct;

  function polar(angle, radius) {
    const rad = (angle - 90) * Math.PI / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  }

  function arcPath(a1, a2, rr) {
    const [x1, y1] = polar(a1, rr);
    const [x2, y2] = polar(a2, rr);
    const large = (a2 - a1) > 180 ? 1 : 0;
    return `M${x1} ${y1} A${rr} ${rr} 0 ${large} 1 ${x2} ${y2}`;
  }

  const trackD   = arcPath(startAngle, endAngle, r);
  const endFill  = startAngle + Math.max(fillArc, 1);
  const fillD    = arcPath(startAngle, endFill, r);
  const [nx, ny] = polar(startAngle + fillArc, r);
  const h        = size * 0.72;

  return `
    <svg width="${size}" height="${h}" viewBox="0 0 ${size} ${h}" xmlns="http://www.w3.org/2000/svg">
      <path d="${trackD}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="5" stroke-linecap="round"/>
      <path d="${fillD}"  fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>
      <circle cx="${nx.toFixed(2)}" cy="${ny.toFixed(2)}" r="3" fill="${color}"/>
      <text x="${cx}" y="${(cy+3).toFixed(1)}" text-anchor="middle"
            font-size="12" font-weight="500" fill="${color}" font-family="monospace">
        ${value.toFixed(2)}
      </text>
    </svg>`;
}

// ── SPARKLINE ─────────────────────────────────────────────────
const chartInstances = {};

function renderSparkline(canvasId, labels, values, color, min, max) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
    delete chartInstances[canvasId];
  }

  chartInstances[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: color,
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHoverBackgroundColor: color,
        fill: true,
        backgroundColor: hexToRgba(color, 0.08),
        tension: 0.3,
      }],
    },
    options: {
      responsive: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: "rgba(15,30,43,0.9)",
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 0.5,
          titleColor: "#7a9ab0",
          bodyColor: color,
          titleFont: { size: 9 },
          bodyFont: { size: 11, family: "monospace" },
          callbacks: {
            title: (items) => items[0].label,
            label: (item) => item.parsed.y.toFixed(3),
          },
        },
      },
      scales: {
        x: { display: false },
        y: {
          display: false,
          min: min - (max - min) * 0.05,
          max: max + (max - min) * 0.05,
        },
      },
    },
  });
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── STATE ─────────────────────────────────────────────────────
let lastApiData   = null;
let historyLoaded = false;

// ── EXPORT BUTTON STATE ───────────────────────────────────────
function setExportBtn(enabled) {
  const btn = document.getElementById("export-pdf-btn");
  if (!btn) return;
  btn.disabled      = !enabled;
  btn.style.opacity = enabled ? "1" : "0.4";
  btn.style.cursor  = enabled ? "pointer" : "not-allowed";
  btn.title = enabled
    ? "Export PDF report"
    : "Loading 2-year history - export will be available shortly";
}

// ── PROGRESS BAR ──────────────────────────────────────────────
let progressTimer = null;

function startProgressBar() {
  if (progressTimer) clearInterval(progressTimer);
  const fill  = document.getElementById("spark-progress-fill");
  const label = document.getElementById("spark-progress-label");
  if (!fill || !label) return;
  let pct = 0;
  progressTimer = setInterval(() => {
    const remaining = 90 - pct;
    const step = Math.max(0.5, remaining * 0.08);
    pct = Math.min(90, pct + step);
    fill.style.width  = `${pct.toFixed(1)}%`;
    label.textContent = `${Math.floor(pct)}%`;
    if (pct >= 90) clearInterval(progressTimer);
  }, 1000);
}

function completeProgressBar() {
  if (progressTimer) clearInterval(progressTimer);
  const fill  = document.getElementById("spark-progress-fill");
  const label = document.getElementById("spark-progress-label");
  if (!fill || !label) return;
  fill.style.transition = "width 0.3s ease";
  fill.style.width  = "100%";
  label.textContent = "100%";
}

function failProgressBar() {
  if (progressTimer) clearInterval(progressTimer);
  const label = document.getElementById("spark-progress-label");
  if (!label) return;
  label.textContent = "timed out - try clicking again";
  label.style.color = "rgba(251,146,60,0.5)";
}

// ── MAIN CLICK HANDLER ────────────────────────────────────────
map.on("click", async function (e) {
  const { lat, lng } = e.latlng;

  if (lat < 32.5 || lat > 42.1 || lng < -124.5 || lng > -114.1) return;

  placeMarker(e.latlng);
  clickHint.classList.add("hidden");
  showSidebar();
  showLoading();

  coordsEl.textContent   = formatCoords(lat, lng);
  locationEl.textContent = "Loading...";
  dateEl.textContent     = "";

  const [locationName, apiData] = await Promise.all([
    reverseGeocode(lat, lng),
    fetchSample(lat, lng),
  ]);

  locationEl.textContent = locationName;

  if (!apiData) {
    showError("Could not sample this location.<br>Try clicking within California.");
    return;
  }

  if (apiData.composite_date) {
    dateEl.textContent = `VIIRS 8-day · ${apiData.composite_date}`;
  }

  buildCards(apiData);
  showCards();

  historyLoaded = false;
  setExportBtn(false);
  startProgressBar();

  const history = await fetchHistory(lat, lng);

  if (history) {
    Object.entries(history).forEach(([key, entries]) => {
      if (!entries.length) return;
      const cfg      = INDEX_CONFIG[key] || {};
      const color    = cfg.color || "#7a9ab0";
      const min      = cfg.min ?? -1;
      const max      = cfg.max ?? 1;
      const canvasId = `spark-${key}`;

      const card = document.querySelector(`[data-index-key="${key}"] .spark-side`);
      if (card) {
        card.innerHTML = `<canvas id="${canvasId}" width="158" height="52"></canvas>`;
      }

      renderSparkline(
        canvasId,
        entries.map(h => h.date),
        entries.map(h => h.value),
        color, min, max
      );
    });

    if (lastApiData) lastApiData.history = history;
    historyLoaded = true;
    setExportBtn(true);
    completeProgressBar();
  }
});

// ── API CALLS ─────────────────────────────────────────────────
async function fetchSample(lat, lon) {
  if (MOCK_MODE) {
    await new Promise(r => setTimeout(r, 600));
    return MOCK_DATA;
  }
  try {
    const sampleResp = await fetch(
      `${API_URL}/sample?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`
    );
    if (!sampleResp.ok) return null;
    const sampleData = await sampleResp.json();
    sampleData.history = null;
    return sampleData;
  } catch (err) {
    console.error("API error:", err);
    return null;
  }
}

async function fetchHistory(lat, lon) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    const resp = await fetch(
      `${API_URL}/history?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&limit=91`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.history || null;
  } catch (err) {
    if (err.name === "AbortError") {
      failProgressBar();
    }
    console.error("History API error:", err);
    return null;
  }
}

// ── MODAL HTML ────────────────────────────────────────────────
document.body.insertAdjacentHTML("beforeend", `
  <div id="modal-overlay">
    <div id="modal">
      <button id="modal-close">&#x2715;</button>
      <div id="modal-index-name"></div>
      <div id="modal-index-label"></div>
      <div id="modal-description"></div>
      <div class="modal-gauges">
        <div class="modal-gauge-block">
          <div id="modal-gauge-current"></div>
          <div class="modal-gauge-sublabel">current value</div>
        </div>
        <div class="modal-gauge-block">
          <div id="modal-gauge-avg"></div>
          <div class="modal-gauge-sublabel">2-year average</div>
        </div>
        <div class="modal-gauge-block">
          <div id="modal-gauge-min"></div>
          <div class="modal-gauge-sublabel">2-year low</div>
        </div>
        <div class="modal-gauge-block">
          <div id="modal-gauge-max"></div>
          <div class="modal-gauge-sublabel">2-year high</div>
        </div>
      </div>
      <div id="modal-chart-wrap">
        <div id="modal-chart-title">2-YEAR HISTORY - 8-DAY COMPOSITES</div>
        <canvas id="modal-chart" height="140"></canvas>
      </div>
      <div id="modal-trend-wrap" style="margin-bottom:14px;"></div>
      <div id="modal-interpretation">
        <div class="interp-label">CURRENT CONDITIONS</div>
        <div id="modal-interp-text"></div>
      </div>
    </div>
  </div>
`);

// ── BUILD CARDS ───────────────────────────────────────────────
function buildCards(data) {
  lastApiData = data;
  cardsScroll.innerHTML = "";

  const loadMessages = [
    "pulling 2 years of satellite data",
    "free data takes a moment \uD83D\uDEF0\uFE0F",
    "good things come to those who wait",
    "querying the archive...",
    "worth the wait, we promise",
    "just remember, this is still free",
    "man that's a lot of data!",
  ];
  const randomMsg = loadMessages[Math.floor(Math.random() * loadMessages.length)];

  const INDEX_ORDER = ["ndvi", "evi2", "nbr", "ndmi", "ndsi", "bsi"];
  INDEX_ORDER.forEach((key, i) => {
    const idx = data.indices[key];
    if (!idx) return;
    const cfg      = INDEX_CONFIG[key] || {};
    const color    = cfg.color || "#7a9ab0";
    const min      = cfg.min ?? -1;
    const max      = cfg.max ?? 1;
    const canvasId = `spark-${key}`;

    const hasHistory = data.history && data.history[key] && data.history[key].length;

    const sparkHTML = hasHistory
      ? `<canvas id="${canvasId}" width="158" height="52"></canvas>`
      : i === 0
        ? `<div class="spark-skeleton" id="spark-progress-card" style="position:relative;">
             <div style="position:absolute;inset:0;display:flex;align-items:center;
               justify-content:center;font-size:9px;color:rgba(255,255,255,0.3);
               font-family:monospace;white-space:nowrap;overflow:hidden;padding:0 6px 14px;">
               ${randomMsg}
             </div>
             <div class="spark-progress-wrap">
               <div class="spark-progress-track">
                 <div class="spark-progress-fill" id="spark-progress-fill"></div>
               </div>
               <div class="spark-progress-label" id="spark-progress-label">0%</div>
             </div>
           </div>`
        : `<div class="spark-skeleton"></div>`;

    const card = document.createElement("div");
    card.className = "index-card";
    card.dataset.indexKey = key;
    card.style.cursor = "pointer";
    card.innerHTML = `
      <div class="card-name">${idx.label || key.toUpperCase()}</div>
      <div class="card-body">
        <div class="gauge-side">
          ${idx.value !== null
            ? makeGauge(idx.value, min, max, color)
            : `<div style="width:72px;height:52px;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--panel-text-label);">no data</div>`
          }
        </div>
        <div class="spark-side">${sparkHTML}</div>
      </div>
      <div class="card-interp">${idx.interpretation || ""}</div>
    `;
    cardsScroll.appendChild(card);

    card.addEventListener("click", () => {
      if (lastApiData) openModal(key, lastApiData);
    });

    if (hasHistory) {
      renderSparkline(
        canvasId,
        data.history[key].map(h => h.date),
        data.history[key].map(h => h.value),
        color, min, max
      );
    }
  });
}

// ── MODAL OPEN ────────────────────────────────────────────────
function openModal(key, data) {
  const idx     = data.indices[key];
  const cfg     = INDEX_CONFIG[key] || {};
  const color   = cfg.color || "#7a9ab0";
  const min     = cfg.min ?? -1;
  const max     = cfg.max ?? 1;
  const history = (data.history && data.history[key]) || [];
  const values  = history.map(h => h.value);
  const labels  = history.map(h => h.date);

  const avg   = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const hiVal = values.length ? Math.max(...values) : null;
  const loVal = values.length ? Math.min(...values) : null;

  let trendClass = "trend-flat";
  let trendLabel = "Stable trend";
  let trendArrow = "\u2192";
  if (values.length >= 6) {
    const third     = Math.floor(values.length / 3);
    const earlyAvg  = values.slice(0, third).reduce((a,b) => a+b,0) / third;
    const recentAvg = values.slice(-third).reduce((a,b) => a+b,0) / third;
    const delta     = recentAvg - earlyAvg;
    const threshold = (max - min) * 0.04;
    if (delta > threshold)       { trendClass = "trend-up";   trendLabel = "Increasing over 2 years"; trendArrow = "\u2191"; }
    else if (delta < -threshold) { trendClass = "trend-down"; trendLabel = "Decreasing over 2 years"; trendArrow = "\u2193"; }
  }

  document.getElementById("modal-index-name").textContent = key.toUpperCase();

  const FULL_NAMES = {
    ndvi: "Normalized Difference Vegetation Index",
    evi2: "Enhanced Vegetation Index 2",
    nbr:  "Normalized Burn Ratio",
    ndmi: "Normalized Difference Moisture Index",
    ndsi: "Normalized Difference Snow Index",
    bsi:  "Bare Soil Index",
  };
  document.getElementById("modal-index-label").textContent =
    FULL_NAMES[key] || idx.label || key.toUpperCase();

  document.getElementById("modal-description").innerHTML = `
    <div style="margin-bottom:10px;">${cfg.what || idx.description || ""}</div>
    <div style="background:rgba(255,255,255,0.04);border:0.5px solid var(--panel-border);
      border-radius:8px;padding:8px 12px;margin-bottom:10px;
      font-family:monospace;font-size:11px;color:var(--panel-text-muted);">
      <span style="color:var(--panel-text-label);font-size:10px;letter-spacing:0.05em;">EQUATION &nbsp;</span>
      ${cfg.equation || ""}
    </div>
    ${cfg.trend_context ? `
    <div style="font-size:11px;color:var(--panel-text-label);line-height:1.6;
      border-top:0.5px solid var(--panel-border);padding-top:10px;">
      <span style="font-size:10px;letter-spacing:0.05em;color:var(--panel-text-label);">TREND CONTEXT &nbsp;</span><br/>
      ${cfg.trend_context}
    </div>` : ""}
  `;

  document.getElementById("modal-gauge-current").innerHTML =
    idx.value !== null ? makeGauge(idx.value, min, max, color, 90)
    : "<div style='color:var(--panel-text-label);font-size:11px;'>no data</div>";
  document.getElementById("modal-gauge-avg").innerHTML =
    avg !== null ? makeGauge(parseFloat(avg.toFixed(3)), min, max, color, 90)
    : "<div style='color:var(--panel-text-label);font-size:11px;'>-</div>";
  document.getElementById("modal-gauge-min").innerHTML =
    loVal !== null ? makeGauge(parseFloat(loVal.toFixed(3)), min, max, color, 90)
    : "<div style='color:var(--panel-text-label);font-size:11px;'>-</div>";
  document.getElementById("modal-gauge-max").innerHTML =
    hiVal !== null ? makeGauge(parseFloat(hiVal.toFixed(3)), min, max, color, 90)
    : "<div style='color:var(--panel-text-label);font-size:11px;'>-</div>";

  document.getElementById("modal-trend-wrap").innerHTML =
    `<div class="modal-trend-badge ${trendClass}">
       <span>${trendArrow}</span><span>${trendLabel}</span>
     </div>`;

  document.getElementById("modal-interp-text").textContent = idx.interpretation || "";

  const modalCanvas = document.getElementById("modal-chart");
  modalCanvas.width = modalCanvas.parentElement.clientWidth - 28;

  if (chartInstances["modal-chart"]) {
    chartInstances["modal-chart"].destroy();
    delete chartInstances["modal-chart"];
  }

  if (values.length) {
    chartInstances["modal-chart"] = new Chart(modalCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: color,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: color,
          fill: true,
          backgroundColor: hexToRgba(color, 0.08),
          tension: 0.3,
        }],
      },
      options: {
        responsive: false,
        animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: "rgba(15,30,43,0.95)",
            borderColor: "rgba(255,255,255,0.1)",
            borderWidth: 0.5,
            titleColor: "#7a9ab0",
            bodyColor: color,
            titleFont: { size: 10 },
            bodyFont: { size: 12, family: "monospace" },
            callbacks: {
              title: (items) => items[0].label,
              label: (item) => `  ${item.parsed.y.toFixed(3)}`,
            },
          },
        },
        scales: {
          x: {
            display: true,
            ticks: { color: "#4d7a96", font: { size: 9 }, maxTicksLimit: 8, maxRotation: 0 },
            grid:  { color: "rgba(255,255,255,0.03)" },
          },
          y: {
            display: true,
            min: min - (max - min) * 0.05,
            max: max + (max - min) * 0.05,
            ticks: { color: "#4d7a96", font: { size: 9 }, maxTicksLimit: 5 },
            grid:  { color: "rgba(255,255,255,0.03)" },
          },
        },
      },
    });
  }

  document.getElementById("modal-overlay").classList.add("open");
  document.body.style.overflow = "hidden";
}

// ── MODAL CLOSE ───────────────────────────────────────────────
function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
  document.body.style.overflow = "";
}

document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-overlay").addEventListener("click", function(e) {
  if (e.target === this) closeModal();
});
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") closeModal();
});
