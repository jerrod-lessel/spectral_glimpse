/* ============================================================
   Spectral Glimpse — map.js
   Leaflet map + sidebar point sampling logic
   ============================================================ */

// ── CONFIG ────────────────────────────────────────────────────
// Swap this for your deployed Cloud Run API URL when live
const API_BASE = "https://spectral-glimpse-api-1087489116508.us-west1.run.app";

// Fallback for local testing — points at localhost
const API_URL = window.location.hostname === "localhost"
  ? "http://localhost:8080"
  : API_BASE;

// Index display config — colors and chart scales match
// the vis params in pipeline/indices.py
const INDEX_CONFIG = {
  ndvi: {
    label: "NDVI",
    color: "#4ade80",
    min: 0.0, max: 0.9,
    what: "Compares how much red light plants absorb versus how much near-infrared they reflect. Healthy vegetation absorbs red for photosynthesis and strongly reflects NIR, the bigger that gap, the greener and healthier the canopy.",
    equation: "(NIR − Red) / (NIR + Red)",
    trend_context: "A declining NDVI trend can signal drought stress, seasonal senescence, post-fire recovery lag, or land cover change. A rising trend often reflects rainfall response, crop growth, or vegetation recovery after disturbance."
  },
  evi2: {
    label: "EVI2",
    color: "#86efac",
    min: -0.1, max: 0.7,
    what: "A refinement of NDVI that reduces atmospheric interference and soil background effects. More reliable than NDVI in dense canopy or hazy conditions, both common in California's Central Valley and coastal fog zones.",
    equation: "2.5 × (NIR − Red) / (NIR + 2.4 × Red + 1)",
    trend_context: "EVI2 trends often track seasonal agricultural cycles in the Central Valley. A divergence between EVI2 and NDVI can suggest changing atmospheric conditions or shifts in canopy density."
  },
  nbr: {
    label: "NBR",
    color: "#fbbf24",
    min: -1.0, max: 1.0,
    what: "Sensitive to the charred carbon and exposed soil that fire leaves behind. Unburned vegetation has high NIR and low SWIR reflectance. Fire flips that relationship, dropping NIR and raising SWIR dramatically.",
    equation: "(NIR − SWIR) / (NIR + SWIR)",
    trend_context: "A sudden NBR drop followed by gradual recovery is the classic post-fire signal. Note: this is single-date NBR while true burn severity mapping requires pre/post delta-NBR (dNBR). Use this as a risk indicator, not a definitive burn map."
  },
  ndmi: {
    label: "NDMI",
    color: "#38bdf8",
    min: -0.3, max: 0.5,
    what: "Tracks liquid water held in vegetation canopy. SWIR wavelengths are absorbed by water, so when vegetation dries out, SWIR reflectance rises and NDMI drops. A reliable early indicator of drought stress and elevated fire weather risk.",
    equation: "(NIR − SWIR) / (NIR + SWIR)",
    trend_context: "NDMI typically drops through California's dry season (June–October) and recovers after winter rains. A trend that fails to recover after the wet season can signal multi-year drought stress accumulating in the landscape."
  },
  ndsi: {
    label: "NDSI",
    color: "#cbd5e1",
    min: -0.5, max: 0.8,
    what: "Snow and ice strongly absorb SWIR wavelengths while reflecting visible light, making the contrast between visible and SWIR a reliable snow detector. Values above 0.4 generally indicate snow-covered ground.",
    equation: "(Red − SWIR) / (Red + SWIR)",
    trend_context: "Sierra Nevada snowpack is California's largest freshwater reservoir. Declining NDSI in winter months or earlier spring melt timing are important climate signals. Note: the standard NDSI uses a Green band rather than Red, since snow is especially bright in green wavelengths. VIIRS VNP09H1 lacks a green I-band so Red is used as a substitute, the index remains a useful snow indicator but may slightly underperform the classic formulation in marginal snow conditions.",
  },
  bsi: {
    label: "BSI",
    color: "#fb923c",
    min: -0.5, max: 0.3,
    what: "Combines SWIR, Red, and NIR to isolate bare mineral soil from vegetated surfaces. Bare soil has high SWIR and Red reflectance but low NIR, the inverse of healthy vegetation. Rises sharply after fire removes ground cover.",
    equation: "((SWIR + Red) − NIR) / ((SWIR + Red) + NIR)",
    trend_context: "A rising BSI trend after a stable period can indicate post-fire soil exposure, drought-driven vegetation loss, or agricultural harvest cycles. Elevated BSI increases erosion and runoff risk, particularly on steep terrain."
  },
};

// ── MOCK MODE — set to false when API is deployed ──────────
const MOCK_MODE = false;

const MOCK_DATA = {
  composite_date: "Mar 30 2026",
  indices: {
    ndvi: { label:"NDVI", value:0.42, interpretation:"Moderate vegetation — grassland or dry shrubland typical of coastal foothills." },
    evi2: { label:"EVI2", value:0.31, interpretation:"Sparse to moderate vegetation cover with reduced atmosphere sensitivity." },
    nbr:  { label:"NBR",  value:0.38, interpretation:"Healthy unburned vegetation. Low single-date burn risk indicator." },
    ndmi: { label:"NDMI", value:0.12, interpretation:"Moderate moisture — vegetation mildly stressed, typical of late dry season." },
    ndsi: { label:"NDSI", value:-0.18,interpretation:"No snow or ice detected at this elevation and location." },
    bsi:  { label:"BSI",  value:0.08, interpretation:"Mixed vegetation and bare soil — moderate ground exposure." },
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
// ── MAP INIT ──────────────────────────────────────────────────
const map = L.map("map", {
  center: [37.5, -119.5],
  zoom: 6,
  zoomControl: true,
  attributionControl: true,
});

// Dark basemap via Stadia Maps (free, no API key needed)
L.tileLayer(
  "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png",
  {
    attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }
).addTo(map);


// ── CLICK MARKER ──────────────────────────────────────────────
// Custom pulsing dot marker for the clicked point
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
function showLoading()  {
  sidebarLoading.style.display = "flex";
  cardsScroll.style.display    = "none";
}
function showCards()    {
  sidebarLoading.style.display = "none";
  cardsScroll.style.display    = "flex";
}
function showError(msg) {
  sidebarLoading.style.display = "none";
  cardsScroll.style.display    = "flex";
  cardsScroll.innerHTML = `<div class="error-msg">${msg}</div>`;
}

function formatCoords(lat, lon) {
  const latDir = lat >= 0 ? "N" : "S";
  const lonDir = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${latDir} · ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}

// Reverse geocode using Nominatim (free, no key needed)
async function reverseGeocode(lat, lon) {
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await resp.json();
    const addr = data.address || {};
    return addr.county || addr.state_district || addr.state || "California";
  } catch {
    return "California";
  }
}


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
    <svg width="${size}" height="${h}"
         viewBox="0 0 ${size} ${h}"
         xmlns="http://www.w3.org/2000/svg">
      <path d="${trackD}" fill="none"
            stroke="rgba(255,255,255,0.07)"
            stroke-width="5" stroke-linecap="round"/>
      <path d="${fillD}" fill="none"
            stroke="${color}"
            stroke-width="5" stroke-linecap="round"/>
      <circle cx="${nx.toFixed(2)}" cy="${ny.toFixed(2)}"
              r="3" fill="${color}"/>
      <text x="${cx}" y="${(cy + 3).toFixed(1)}"
            text-anchor="middle"
            font-size="12" font-weight="500"
            fill="${color}"
            font-family="monospace">
        ${value.toFixed(2)}
      </text>
    </svg>`;
}


// ── SPARKLINE (Chart.js) ──────────────────────────────────────
// Keep track of chart instances so we can destroy before re-render
const chartInstances = {};

function renderSparkline(canvasId, labels, values, color, min, max) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  // Destroy previous instance if it exists
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
          backgroundColor: "rgba(15,17,23,0.9)",
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 0.5,
          titleColor: "#94a3b8",
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
        x: {
          display: false,
          ticks: { display: false },
        },
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


// ── BUILD INDEX CARDS ─────────────────────────────────────────
function buildCards(data) {
  cardsScroll.innerHTML = "";

  // data.indices is keyed by index name
  // data.history is keyed by index name -> array of { date, value }
  Object.entries(data.indices).forEach(([key, idx]) => {
    const cfg     = INDEX_CONFIG[key] || {};
    const color   = cfg.color || "#94a3b8";
    const min     = cfg.min ?? -1;
    const max     = cfg.max ?? 1;
    const canvasId = `spark-${key}`;

    const card = document.createElement("div");
    card.className = "index-card";
    card.innerHTML = `
      <div class="card-name">${idx.label || key.toUpperCase()}</div>
      <div class="card-body">
        <div class="gauge-side">
          ${idx.value !== null
            ? makeGauge(idx.value, min, max, color)
            : `<div style="width:72px;height:52px;display:flex;align-items:center;
                justify-content:center;font-size:10px;color:#334155;">no data</div>`
          }
        </div>
        <div class="spark-side">
          <canvas id="${canvasId}" width="158" height="52"></canvas>
        </div>
      </div>
      <div class="card-interp">${idx.interpretation || ""}</div>
    `;
    cardsScroll.appendChild(card);

    // Render sparkline after card is in DOM
    if (data.history && data.history[key]) {
      const history = data.history[key];
      const labels  = history.map(h => h.date);
      const values  = history.map(h => h.value);
      renderSparkline(canvasId, labels, values, color, min, max);
    }
  });
}


// ── MAIN CLICK HANDLER ────────────────────────────────────────
map.on("click", async function (e) {
  const { lat, lng } = e.latlng;

  // Rough California bounds check
  if (lat < 32.5 || lat > 42.1 || lng < -124.5 || lng > -114.1) {
    return;
  }

  // Place marker + open sidebar in loading state
  placeMarker(e.latlng);
  clickHint.classList.add("hidden");
  showSidebar();
  showLoading();

  // Update coords immediately
  coordsEl.textContent  = formatCoords(lat, lng);
  locationEl.textContent = "Loading...";
  dateEl.textContent    = "";

  // Reverse geocode in parallel with API call
  const [locationName, apiData] = await Promise.all([
    reverseGeocode(lat, lng),
    fetchSample(lat, lng),
  ]);

  locationEl.textContent = locationName;

  if (!apiData) {
    showError("Could not sample this location.<br>Try clicking within California.");
    return;
  }

  // Update date badge
  if (apiData.composite_date) {
    dateEl.textContent = `VIIRS 8-day · ${apiData.composite_date}`;
  }

  buildCards(apiData);
  showCards();
});


// ── API CALL ──────────────────────────────────────────────────
async function fetchSample(lat, lon) {
  if (MOCK_MODE) {
    await new Promise(r => setTimeout(r, 600)); // fake loading delay
    return MOCK_DATA;
  }
  try {
    const resp = await fetch(
      `${API_URL}/sample?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`
    );
    if (!resp.ok) return null;
    return await resp.json();
  } catch (err) {
    console.error("Sample API error:", err);
    return null;
  }
}

// ── MODAL ─────────────────────────────────────────────────────

// Inject modal HTML into the page
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
        <div id="modal-chart-title">2-YEAR HISTORY — 8-DAY COMPOSITES</div>
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

// Store last API data so modal can reference it
let lastApiData = null;

// Override buildCards to store data and attach click handlers
const _origBuildCards = buildCards;
window.buildCards = function(data) {
  lastApiData = data;
  _origBuildCards(data);

  // Attach click handler to each card after they're built
  document.querySelectorAll(".index-card").forEach(card => {
    card.style.cursor = "pointer";
    card.addEventListener("click", () => {
      const key = card.dataset.indexKey;
      if (key && lastApiData) openModal(key, lastApiData);
    });
  });
};

// Update buildCards to stamp data-index-key on each card
// We do this by patching the card creation in buildCards
const _origBuildCardsInner = buildCards;
function buildCards(data) {
  lastApiData = data;
  cardsScroll.innerHTML = "";

  Object.entries(data.indices).forEach(([key, idx]) => {
    const cfg      = INDEX_CONFIG[key] || {};
    const color    = cfg.color || "#94a3b8";
    const min      = cfg.min ?? -1;
    const max      = cfg.max ?? 1;
    const canvasId = `spark-${key}`;

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
            : `<div style="width:72px;height:52px;display:flex;align-items:center;
                justify-content:center;font-size:10px;color:#334155;">no data</div>`
          }
        </div>
        <div class="spark-side">
          <canvas id="${canvasId}" width="158" height="52"></canvas>
        </div>
      </div>
      <div class="card-interp">${idx.interpretation || ""}</div>
    `;
    cardsScroll.appendChild(card);

    card.addEventListener("click", () => {
      if (lastApiData) openModal(key, lastApiData);
    });

    if (data.history && data.history[key]) {
      const history = data.history[key];
      renderSparkline(
        canvasId,
        history.map(h => h.date),
        history.map(h => h.value),
        color, min, max
      );
    }
  });
}


// ── MODAL OPEN ────────────────────────────────────────────────
function openModal(key, data) {
  const idx     = data.indices[key];
  const cfg     = INDEX_CONFIG[key] || {};
  const color   = cfg.color || "#94a3b8";
  const min     = cfg.min ?? -1;
  const max     = cfg.max ?? 1;
  const history = (data.history && data.history[key]) || [];
  const values  = history.map(h => h.value);
  const labels  = history.map(h => h.date);

  // Stats
  const avg     = values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
  const hiVal   = values.length ? Math.max(...values) : null;
  const loVal   = values.length ? Math.min(...values) : null;

  // Trend — compare first third vs last third of history
  let trendClass = "trend-flat";
  let trendLabel = "Stable trend";
  let trendArrow = "→";
  if (values.length >= 6) {
    const third     = Math.floor(values.length / 3);
    const earlyAvg  = values.slice(0, third).reduce((a,b) => a+b,0) / third;
    const recentAvg = values.slice(-third).reduce((a,b) => a+b,0) / third;
    const delta     = recentAvg - earlyAvg;
    const threshold = (max - min) * 0.04;
    if (delta > threshold) {
      trendClass = "trend-up";
      trendLabel = "Increasing over 2 years";
      trendArrow = "↑";
    } else if (delta < -threshold) {
      trendClass = "trend-down";
      trendLabel = "Decreasing over 2 years";
      trendArrow = "↓";
    }
  }

  // Populate modal
  document.getElementById("modal-index-name").textContent =
    key.toUpperCase();
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
     <div style="
       background:#1a1f2e;
       border:0.5px solid rgba(255,255,255,0.07);
       border-radius:8px;
       padding:8px 12px;
       margin-bottom:10px;
       font-family:monospace;
       font-size:11px;
       color:#94a3b8;
     ">
       <span style="color:#475569;font-size:10px;letter-spacing:0.05em;">EQUATION &nbsp;</span>
       ${cfg.equation || ""}
     </div>
     ${cfg.trend_context ? `
     <div style="
       font-size:11px;
       color:#64748b;
       line-height:1.6;
       border-top:0.5px solid rgba(255,255,255,0.05);
       padding-top:10px;
     ">
       <span style="font-size:10px;letter-spacing:0.05em;color:#334155;">TREND CONTEXT &nbsp;</span><br/>
       ${cfg.trend_context}
     </div>` : ""}
   `;

  // Gauges
  document.getElementById("modal-gauge-current").innerHTML =
    idx.value !== null
      ? makeGauge(idx.value, min, max, color, 90)
      : "<div style='color:#334155;font-size:11px;'>no data</div>";

  document.getElementById("modal-gauge-avg").innerHTML =
    avg !== null
      ? makeGauge(parseFloat(avg.toFixed(3)), min, max, color, 90)
      : "<div style='color:#334155;font-size:11px;'>—</div>";

  document.getElementById("modal-gauge-min").innerHTML =
    loVal !== null
      ? makeGauge(parseFloat(loVal.toFixed(3)), min, max, color, 90)
      : "<div style='color:#334155;font-size:11px;'>—</div>";

  document.getElementById("modal-gauge-max").innerHTML =
    hiVal !== null
      ? makeGauge(parseFloat(hiVal.toFixed(3)), min, max, color, 90)
      : "<div style='color:#334155;font-size:11px;'>—</div>";

  // Trend badge
  document.getElementById("modal-trend-wrap").innerHTML =
    `<div class="modal-trend-badge ${trendClass}">
       <span>${trendArrow}</span>
       <span>${trendLabel}</span>
     </div>`;

  // Interpretation
  document.getElementById("modal-interp-text").textContent =
    idx.interpretation || "";

  // Large chart
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
            backgroundColor: "rgba(15,17,23,0.95)",
            borderColor: "rgba(255,255,255,0.1)",
            borderWidth: 0.5,
            titleColor: "#94a3b8",
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
            ticks: {
              color: "#334155",
              font: { size: 9 },
              maxTicksLimit: 8,
              maxRotation: 0,
            },
            grid: {
              color: "rgba(255,255,255,0.03)",
            },
          },
          y: {
            display: true,
            min: min - (max - min) * 0.05,
            max: max + (max - min) * 0.05,
            ticks: {
              color: "#334155",
              font: { size: 9 },
              maxTicksLimit: 5,
            },
            grid: {
              color: "rgba(255,255,255,0.03)",
            },
          },
        },
      },
    });
  }

  // Open overlay
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


// ── TITLE POSITION FIX ────────────────────────────────────────
// Push Leaflet zoom controls down so they don't overlap the title
const zoomControl = document.querySelector(".leaflet-control-zoom");
if (zoomControl) {
  zoomControl.style.marginTop = "88px";
  zoomControl.style.marginLeft = "15px";
}
