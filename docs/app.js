const DATA = "data/";
// Russland wird bei GWIS als ein Laendercode gefuehrt, der auch den
// asiatischen Teil (Sibirien) mit einschliesst und die "Europa"-Summe sonst
// komplett dominieren wuerde (~85% der Gesamtflaeche). Bleibt einzeln
// waehlbar, zaehlt aber nicht in die Europa-Summe.
const EUROPE_SUM_EXCLUDE = new Set(["RUS"]);

let state = {
  scope: "land", // "land" | "europa"
  country: null, // ISO3
  yearFrom: null,
  yearTo: null,
};

let db = {}; // meta, countries, burnt_area, n_fires, burnt_area_avg

async function loadJSON(name) {
  const r = await fetch(DATA + name, { cache: "no-cache" });
  return r.json();
}

function nYearsTotal() {
  return db.meta.year_end - db.meta.year_start + 1;
}

function clampYearRange(from, to) {
  from = Math.max(db.meta.year_start, Math.min(from, db.meta.year_end));
  to = Math.max(db.meta.year_start, Math.min(to, db.meta.year_end));
  if (from > to) [from, to] = [to, from];
  return [from, to];
}

// Wert fuer ein einzelnes Jahr im aktuellen Scope: direkter Landeswert,
// oder Summe aller Laender fuer "Europa" (Flaeche ist additiv, anders als
// Niederschlag, der als Stationsmittel aggregiert wird).
function valueForYear(dataKey, year) {
  const idx = year - db.meta.year_start;
  if (idx < 0 || idx >= nYearsTotal()) return null;
  const table = db[dataKey];
  if (state.scope === "land") {
    if (!state.country) return null;
    const arr = table[state.country];
    return arr ? (arr[idx] ?? null) : null;
  }
  let sum = 0, any = false;
  for (const [iso3, arr] of Object.entries(table)) {
    if (EUROPE_SUM_EXCLUDE.has(iso3)) continue;
    const v = arr[idx];
    if (v !== null && v !== undefined) { sum += v; any = true; }
  }
  return any ? sum : null;
}

function scopeLabel() {
  if (state.scope === "land") return (state.country && db.countries[state.country] && db.countries[state.country].name) || "";
  return "Europa";
}

// Liefert {values, total, coverage} fuer einen geschlossenen Jahresbereich.
function periodSeries(dataKey, fromYear, toYear) {
  const values = [];
  let total = null, validCount = 0;
  for (let y = fromYear; y <= toYear; y++) {
    const v = valueForYear(dataKey, y);
    values.push(v);
    if (v !== null) { total = (total || 0) + v; validCount++; }
  }
  const span = toYear - fromYear + 1;
  return { values, total, coverage: span > 0 ? validCount / span : 0, span };
}

function fmtNum(v) {
  if (v === null || v === undefined || isNaN(v)) return "–";
  return Math.round(v).toLocaleString("de-DE");
}

function fmtPct(v) {
  if (v === null || v === undefined || isNaN(v)) return null;
  return (v >= 0 ? "+" : "−") + Math.abs(Math.round(v)) + " %";
}

let chart;

function render() {
  const statValue = document.getElementById("statValue");
  const statVsAvg = document.getElementById("statVsAvg");
  const statLabel = document.getElementById("statLabel");
  const statSub = document.getElementById("statSub");
  const infoScope = document.getElementById("infoScope");
  const infoRange = document.getElementById("infoRange");

  if (state.scope === "land" && !state.country) {
    statValue.textContent = "–";
    statVsAvg.textContent = "";
    statLabel.textContent = "Keine Auswahl";
    statSub.textContent = "";
    if (chart) chart.destroy();
    return;
  }

  const [from, to] = clampYearRange(state.yearFrom ?? db.meta.year_start, state.yearTo ?? db.meta.year_end);
  const ba = periodSeries("burnt_area", from, to);
  const nf = periodSeries("n_fires", from, to);
  const avgPerYear = valueForYear("burnt_area_avg", to) ?? valueForYear("burnt_area_avg", from);
  const avgTotal = avgPerYear !== null ? avgPerYear * ba.span : null;

  statValue.textContent = fmtNum(ba.total);
  statLabel.textContent = `${scopeLabel()} · ${from === to ? from : `${from}–${to}`}`;
  statSub.textContent = nf.total !== null ? `${fmtNum(nf.total)} Brände registriert` : "";

  if (ba.total !== null && avgTotal) {
    const pct = ((ba.total - avgTotal) / avgTotal) * 100;
    statVsAvg.textContent = `${fmtPct(pct)} ggü. Ø`;
  } else {
    statVsAvg.textContent = "";
  }

  const labels = [];
  for (let y = from; y <= to; y++) labels.push(String(y));

  infoScope.textContent = state.scope === "europa" ? `${db.meta.n_countries - 1} Länder summiert (ohne Russland)` : "1 Land";
  infoRange.textContent = `Datenstand: ${db.meta.year_end} · Quelle: GWIS/EFFIS`;

  drawChart(labels, ba.values, avgPerYear);
}

function drawChart(labels, values, avgPerYear) {
  const ctx = document.getElementById("chart").getContext("2d");
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const gridColor = isDark ? "#2a2c30" : "#eee";
  const barColor = isDark ? "#ff8a4c" : "#c2410c";
  const textColor = isDark ? "#9aa0a6" : "#6b7280";

  const datasets = [{ label: "Verbrannte Fläche", data: values, backgroundColor: barColor, borderRadius: 3, maxBarThickness: 32 }];
  if (avgPerYear !== null && avgPerYear !== undefined) {
    datasets.push({
      type: "line",
      label: "Ø langjähriges Mittel/Jahr",
      data: values.map(() => avgPerYear),
      borderColor: "#e02424",
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
    });
  }

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: avgPerYear !== null, labels: { color: textColor, boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtNum(c.raw)} ha` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor, maxRotation: 0, autoSkip: true } },
        y: { grid: { color: gridColor }, ticks: { color: textColor }, title: { display: true, text: "ha", color: textColor } },
      },
    },
  });
}

// ---------------------------------------------------------------- Vergleich

let compareState = { kind: "year", years: 5, extra: new Set() };
let compareChart;
const MAX_EXTRA = 20;

function clampYears(n) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n)) n = 5;
  return Math.max(1, Math.min(15, n));
}

// offsetUnits 0 = aktuelle Periode, 1 = Vorperiode, 2+ = weiter zurueck,
// jeweils in derselben Einheit (Jahr/Jahrzehnt/N-Jahres-Block).
function periodForOffset(kind, offsetUnits) {
  const lastYear = db.meta.year_end;
  if (kind === "decade") {
    const end = lastYear - offsetUnits * 10;
    return [end - 9, end];
  }
  if (kind === "nyears") {
    const n = clampYears(compareState.years);
    const end = lastYear - offsetUnits * n;
    return [end - n + 1, end];
  }
  const y = lastYear - offsetUnits;
  return [y, y];
}

function compareSeriesLabels() {
  if (compareState.kind === "decade") return ["Letzte 10 Jahre", "Die 10 Jahre davor"];
  if (compareState.kind === "nyears") {
    const n = clampYears(compareState.years);
    return [`Letzte ${n} Jahre`, `Die ${n} Jahre davor`];
  }
  const [cur] = periodForOffset("year", 0);
  const [prior] = periodForOffset("year", 1);
  return [String(cur), String(prior)];
}

function extraUnitLabel() {
  if (compareState.kind === "decade") return "Jahrzehnte";
  if (compareState.kind === "nyears") return `${clampYears(compareState.years)}-Jahres-Zeiträume`;
  return "Jahre";
}

function fmtRangeShort(range) {
  return range[0] === range[1] ? String(range[0]) : `${range[0]}–${range[1]}`;
}

function renderCompare() {
  const elCur = document.getElementById("cmpCurrentValue");
  const elPrior = document.getElementById("cmpPriorValue");
  const elCurLabel = document.getElementById("cmpCurrentLabel");
  const elPriorLabel = document.getElementById("cmpPriorLabel");
  const elDelta = document.getElementById("cmpDelta");

  if (state.scope === "land" && !state.country) {
    elCur.textContent = "–";
    elPrior.textContent = "–";
    elDelta.textContent = "–";
    document.getElementById("cmpCoverageNote").classList.add("hidden");
    document.querySelector("#compareTable thead").replaceChildren();
    document.querySelector("#compareTable tbody").replaceChildren();
    renderExtraPills();
    return;
  }

  const current = periodForOffset(compareState.kind, 0);
  const prior = periodForOffset(compareState.kind, 1);
  const [curLabel, priorLabel] = compareSeriesLabels();
  const curB = periodSeries("burnt_area", current[0], current[1]);
  const priorB = periodSeries("burnt_area", prior[0], prior[1]);
  const minCoverage = Math.min(curB.coverage, priorB.coverage);

  elCur.textContent = fmtNum(curB.total);
  elPrior.textContent = fmtNum(priorB.total);
  elCurLabel.textContent = `${curLabel} · ${fmtRangeShort(current)}`;
  elPriorLabel.textContent = `${priorLabel} · ${fmtRangeShort(prior)}`;

  if (minCoverage < 0.5) {
    elDelta.textContent = "–";
  } else if (curB.total !== null && priorB.total !== null && priorB.total !== 0) {
    const delta = ((curB.total - priorB.total) / priorB.total) * 100;
    elDelta.textContent = fmtPct(delta);
  } else {
    elDelta.textContent = "–";
  }

  const coverageNote = document.getElementById("cmpCoverageNote");
  if (minCoverage < 0.98) {
    const pct = Math.round(minCoverage * 100);
    coverageNote.textContent = minCoverage < 0.5
      ? `Zu wenig Daten für diesen Vergleich (nur ${pct}% Abdeckung) – die GWIS-Daten beginnen erst ${db.meta.year_start}.`
      : `Hinweis: unvollständige Datenabdeckung für diesen Zeitraum (${pct}%) – Vergleich mit Vorsicht interpretieren.`;
    coverageNote.classList.remove("hidden");
  } else {
    coverageNote.classList.add("hidden");
  }

  const extraOffsets = [...compareState.extra].sort((a, b) => a - b).map((k) => k + 1);
  const extraSeries = extraOffsets.map((offset) => {
    const range = periodForOffset(compareState.kind, offset);
    const b = periodSeries("burnt_area", range[0], range[1]);
    return { label: fmtRangeShort(range), values: b.values };
  });

  const bucketCount = Math.max(curB.values.length, priorB.values.length, ...extraSeries.map((s) => s.values.length));

  const series = [
    { label: curLabel, values: curB.values },
    { label: priorLabel, values: priorB.values },
    ...extraSeries,
  ];

  const chartLabels = bucketCount === 1
    ? [curLabel]
    : Array.from({ length: bucketCount }, (_, i) => `Jahr ${i + 1}`);

  const avgValues = averageAcrossSeries(series, bucketCount);
  drawCompareChart(chartLabels, series, avgValues);
  renderCompareTable(chartLabels, series, avgValues);
  renderExtraPills();
}

function colorForOffset(offset, maxOffset, isDark) {
  const c0 = isDark ? [255, 138, 76] : [194, 65, 12];
  const c1 = isDark ? [58, 61, 66] : [223, 227, 232];
  const t = maxOffset > 0 ? Math.min(1, offset / maxOffset) : 0;
  const mix = c0.map((v, i) => Math.round(v + (c1[i] - v) * t));
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
}

function averageAcrossSeries(series, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let sum = 0, count = 0;
    for (const s of series) {
      const v = s.values[i];
      if (v !== null && v !== undefined) { sum += v; count++; }
    }
    out.push(count > 0 ? Math.round(sum / count) : null);
  }
  return out;
}

function renderCompareTable(labels, series, avgValues) {
  const thead = document.querySelector("#compareTable thead");
  const tbody = document.querySelector("#compareTable tbody");

  const headRow = document.createElement("tr");
  headRow.appendChild(el("th", "Zeitraum"));
  series.forEach((s) => headRow.appendChild(el("th", s.label)));
  headRow.appendChild(el("th", "Durchschnitt", "avg-col"));
  thead.replaceChildren(headRow);

  const rows = labels.map((label, i) => {
    const tr = document.createElement("tr");
    tr.appendChild(el("td", label));
    series.forEach((s) => tr.appendChild(el("td", fmtNum(s.values[i]))));
    tr.appendChild(el("td", fmtNum(avgValues[i]), "avg-col"));
    return tr;
  });
  tbody.replaceChildren(...rows);

  if (labels.length > 1) {
    const totalRow = document.createElement("tr");
    totalRow.className = "total-row";
    totalRow.appendChild(el("td", "Summe"));
    series.forEach((s) => {
      const has = s.values.some((v) => v !== null);
      const sum = has ? s.values.reduce((a, b) => a + (b || 0), 0) : null;
      totalRow.appendChild(el("td", fmtNum(sum)));
    });
    const avgHas = avgValues.some((v) => v !== null);
    const avgSum = avgHas ? avgValues.reduce((a, b) => a + (b || 0), 0) : null;
    totalRow.appendChild(el("td", fmtNum(avgSum), "avg-col"));
    tbody.appendChild(totalRow);
  }
}

function el(tag, text, className) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
}

function drawCompareChart(labels, series, avgValues) {
  const ctx = document.getElementById("compareChart").getContext("2d");
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const gridColor = isDark ? "#2a2c30" : "#eee";
  const textColor = isDark ? "#9aa0a6" : "#6b7280";
  const maxOffset = Math.max(1, series.length - 1);

  if (compareChart) compareChart.destroy();
  compareChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        ...series.map((s, i) => ({
          label: s.label,
          data: s.values,
          backgroundColor: colorForOffset(i, maxOffset, isDark),
          borderRadius: 3,
          maxBarThickness: 40,
          order: 1,
        })),
        {
          type: "line",
          label: "Durchschnitt",
          data: avgValues,
          borderColor: "#e02424",
          backgroundColor: "#e02424",
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: "#e02424",
          fill: false,
          tension: 0.2,
          spanGaps: true,
          order: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: textColor, boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtNum(c.raw)} ha` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor, maxRotation: 0, autoSkip: true } },
        y: { grid: { color: gridColor }, ticks: { color: textColor }, title: { display: true, text: "ha", color: textColor } },
      },
    },
  });
}

function renderExtraPills() {
  const label = document.getElementById("cmpExtraLabel");
  label.textContent = `Weitere ${extraUnitLabel()} vergleichen:`;

  const pillsWrap = document.getElementById("cmpExtraPills");
  if (pillsWrap.childElementCount !== MAX_EXTRA) {
    pillsWrap.innerHTML = "";
    for (let k = 1; k <= MAX_EXTRA; k++) {
      const btn = document.createElement("button");
      btn.textContent = "+" + k;
      btn.dataset.k = k;
      btn.addEventListener("click", () => {
        if (compareState.extra.has(k)) compareState.extra.delete(k);
        else compareState.extra.add(k);
        renderCompare();
      });
      pillsWrap.appendChild(btn);
    }
  }
  [...pillsWrap.children].forEach((btn) => {
    btn.classList.toggle("active", compareState.extra.has(Number(btn.dataset.k)));
  });
}

function setupCompareControls() {
  const buttons = document.querySelectorAll(".cmp-ranges button");
  const yearsWrap = document.getElementById("cmpYearsWrap");
  const yearsInput = document.getElementById("cmpYears");
  const extraToggle = document.getElementById("cmpExtraToggle");
  const extraPanel = document.getElementById("cmpExtraPanel");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      compareState.kind = btn.dataset.cmp;
      compareState.extra.clear();
      yearsWrap.classList.toggle("hidden", compareState.kind !== "nyears");
      renderCompare();
    });
  });

  yearsInput.addEventListener("input", () => {
    compareState.years = clampYears(yearsInput.value);
    compareState.extra.clear();
    renderCompare();
  });

  extraToggle.addEventListener("click", () => {
    extraPanel.classList.toggle("hidden");
  });
}

// ------------------------------------------------------------------- Setup

function setupControls() {
  const scopeButtons = document.querySelectorAll("#scopeToggle button");
  const countrySel = document.getElementById("countrySelect");
  const fromInput = document.getElementById("yearFrom");
  const toInput = document.getElementById("yearTo");

  scopeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      scopeButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.scope = btn.dataset.scope;
      countrySel.classList.toggle("hidden", state.scope !== "land");
      render();
      renderCompare();
    });
  });

  countrySel.addEventListener("change", () => { state.country = countrySel.value; render(); renderCompare(); });

  [fromInput, toInput].forEach((input) => {
    input.addEventListener("change", () => {
      state.yearFrom = parseInt(fromInput.value, 10) || db.meta.year_start;
      state.yearTo = parseInt(toInput.value, 10) || db.meta.year_end;
      render();
    });
  });
}

function populateSelects() {
  const countrySel = document.getElementById("countrySelect");
  const names = Object.keys(db.countries).sort((a, b) => db.countries[a].name.localeCompare(db.countries[b].name, "de"));
  names.forEach((iso3) => {
    const opt = document.createElement("option");
    opt.value = iso3;
    opt.textContent = db.countries[iso3].name;
    countrySel.appendChild(opt);
  });
  const preferred = ["DEU", "FRA", "ESP", "ITA", "GRC", "PRT"].find((c) => db.countries[c]);
  state.country = preferred || (countrySel.options[0] ? countrySel.options[0].value : null);
  countrySel.value = state.country;

  document.getElementById("yearFrom").value = db.meta.year_start;
  document.getElementById("yearTo").value = db.meta.year_end;
  document.getElementById("yearFrom").min = db.meta.year_start;
  document.getElementById("yearFrom").max = db.meta.year_end;
  document.getElementById("yearTo").min = db.meta.year_start;
  document.getElementById("yearTo").max = db.meta.year_end;
}

async function init() {
  const [meta, countries, burnt_area, n_fires, burnt_area_avg] = await Promise.all([
    loadJSON("meta.json"),
    loadJSON("countries.json"),
    loadJSON("burnt_area.json"),
    loadJSON("n_fires.json"),
    loadJSON("burnt_area_avg.json"),
  ]);
  db = { meta, countries, burnt_area, n_fires, burnt_area_avg };

  document.getElementById("footerInfo").textContent =
    `Quelle: GWIS/EFFIS (Copernicus Emergency Management Service, EU-Kommission), ${meta.n_countries} Länder · zuletzt aktualisiert ${new Date(meta.generated_at).toLocaleString("de-DE")}`;

  populateSelects();
  setupControls();
  setupCompareControls();
  render();
  renderCompare();
}

init();
