const XLSX_FILE = "workdata.xlsx";
const DATE_COL = 1;   // column B (A = 0, B = 1, C = 2 ...)

// Sheets to use. Names must match the tabs in Excel exactly.
// Leave the list empty ([]) to use every sheet.
const SHEETS = ["出演综艺", "转樱", "广播", "樱坂频道", "官方抖音"];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let entries = [];              // {key, sheet, cells[]}
let sheetInfo = {};            // sheet name -> headers[] (without the date column)
let activeSheets = new Set();
let year = null;
let selectedDay = null;

/* ---------- Date parsing (strict): YYYYMMDD or YYYY-MM-DD ---------- */
const pad = n => String(n).padStart(2, "0");
const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function toKey(v) {
    const s = String(v ?? "").trim();
    const m = s.match(/^(\d{4})(\d{2})(\d{2})$/) ||
        s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return fmt(y, mo, d);
}

/* ---------- Read the chosen sheets and merge ---------- */
function readWorkbook(buf) {
    const wb = XLSX.read(buf, { type: "array" });
    entries = []; sheetInfo = {}; let skipped = 0;

    const wanted = SHEETS.length ? SHEETS : wb.SheetNames;
    const missing = wanted.filter(n => !wb.Sheets[n]);

    wanted.filter(n => wb.Sheets[n]).forEach(name => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" });
        if (rows.length < 2) return;
        const headers = rows[0].map((h, i) => String(h).trim() || `COL ${i + 1}`);
        sheetInfo[name] = headers.filter((_, i) => i !== DATE_COL);

        rows.slice(1).forEach(r => {
            if (r.every(c => String(c).trim() === "")) return;
            const key = toKey(r[DATE_COL]);
            if (!key) { skipped++; return; }
            entries.push({ key, sheet: name, cells: r.filter((_, i) => i !== DATE_COL) });
        });
    });

    activeSheets = new Set(Object.keys(sheetInfo));
    const years = [...new Set(entries.map(e => +e.key.slice(0, 4)))].sort((a, b) => b - a);
    year = years[0] || new Date().getFullYear();

    const warn = [
        skipped ? `${skipped} ROWS SKIPPED (BAD DATE)` : "",
        missing.length ? `SHEET NOT FOUND: ${missing.join(", ")}` : ""
    ].filter(Boolean).join(" · ");

    $("j-status").textContent = warn;
    $("j-status").style.display = warn ? "block" : "none";


    $("j-year").innerHTML = (years.length ? years : [year]).map(y => `<option>${y}</option>`).join("");
    $("j-controls").style.display = "block";
    buildSheetChips();
    selectedDay = null;
    render();
}

/* ---------- Sheet filter chips ---------- */
function buildSheetChips() {
    $("j-sheets").innerHTML = "";
    Object.keys(sheetInfo).forEach(name => {
        const b = document.createElement("button");
        b.className = "chip on"; b.textContent = name;
        b.onclick = () => {
            activeSheets.has(name) ? activeSheets.delete(name) : activeSheets.add(name);
            b.classList.toggle("on");
            render();
        };
        $("j-sheets").appendChild(b);
    });
}

/* ---------- Heatmap ---------- */
const visible = () => entries.filter(e => activeSheets.has(e.sheet));
const level = n => n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4;

function renderHeat() {
    const counts = {};
    visible().forEach(e => { counts[e.key] = (counts[e.key] || 0) + 1; });

    const heat = $("heat"), months = $("heat-months");
    heat.innerHTML = ""; months.innerHTML = "";

    const first = new Date(year, 0, 1);
    const offset = first.getDay();                 // blank cells before Jan 1 (Sunday start)
    for (let i = 0; i < offset; i++) heat.appendChild(document.createElement("span"));

    const daysInYear = Math.round((new Date(year, 11, 31) - first) / 864e5) + 1;
    let lastMonth = -1;

    for (let i = 0; i < daysInYear; i++) {
        const d = new Date(year, 0, 1 + i);
        const key = fmt(year, d.getMonth() + 1, d.getDate());
        const n = counts[key] || 0;

        const cell = document.createElement("button");
        cell.className = `day lv${level(n)}` + (key === selectedDay ? " sel" : "");
        cell.title = `${key} · ${n} ENTR${n === 1 ? "Y" : "IES"}`;
        cell.onclick = () => { selectedDay = key; render(); };
        heat.appendChild(cell);

        if (d.getMonth() !== lastMonth) {            // month label above its first column
            lastMonth = d.getMonth();
            const lab = document.createElement("span");
            lab.textContent = d.toLocaleString("en", { month: "short" }).toUpperCase();
            lab.style.gridColumn = Math.floor((offset + i) / 7) + 1;
            months.appendChild(lab);
        }
    }
    $("heat-box").style.display = "block";
}

/* ---------- Tables (one per sheet, since headers differ) ---------- */
function renderDetail() {
    const inYear = visible().filter(e => e.key.startsWith(year + "-"));
    const list = selectedDay ? inYear.filter(e => e.key === selectedDay) : inYear;

    $("detail-title").textContent = selectedDay
        ? `${selectedDay} · ${list.length} ENTR${list.length === 1 ? "Y" : "IES"}`
        : `${year} · ${list.length} ENTRIES`;
    $("show-all").style.display = selectedDay ? "inline-block" : "none";

    if (!list.length) {
        $("detail").innerHTML = "<p>NOTHING HERE YET.</p>";
    } else {
        let html = "";
        Object.keys(sheetInfo).forEach(name => {
            const rows = list.filter(e => e.sheet === name).sort((a, b) => a.key.localeCompare(b.key));
            if (!rows.length) return;
            html += `<h3>${esc(name)}</h3><div class="tbl-wrap"><table class="jt"><thead><tr><th>DATE</th>` +
                sheetInfo[name].map(h => `<th>${esc(h)}</th>`).join("") +
                `</tr></thead><tbody>` +
                rows.map(r => `<tr><td>${r.key}</td>${r.cells.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") +
                `</tbody></table></div>`;
        });
        $("detail").innerHTML = html;
    }
    $("detail-box").style.display = "block";
}

function render() { renderHeat(); renderDetail(); syncArrows(); }

$("j-year").onchange = e => { year = +e.target.value; selectedDay = null; render(); };
$("show-all").onclick = () => { selectedDay = null; render(); };

/* ---------- TV arrows: scroll the heatmap sideways ---------- */
const heatScroll = $("heat-scroll");
const arrowLeft = $("tv-left");
const arrowRight = $("tv-right");

function syncArrows() {                       // dim an arrow when it can't move
    arrowLeft.disabled  = heatScroll.scrollLeft <= 0;
    arrowRight.disabled = heatScroll.scrollLeft + heatScroll.clientWidth >= heatScroll.scrollWidth - 1;
}

function scrollHeat(dir) {
    const step = Math.max(120, heatScroll.clientWidth * 0.7);
    heatScroll.scrollBy({ left: dir * step, behavior: "smooth" });
}

arrowLeft.addEventListener("click", () => scrollHeat(-1));
arrowRight.addEventListener("click", () => scrollHeat(1));
heatScroll.addEventListener("scroll", syncArrows);
window.addEventListener("resize", syncArrows);
syncArrows();

/* ---------- Loading ---------- */
fetch(XLSX_FILE)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(readWorkbook)
    .catch(() => {
        $("j-status").textContent = "JOURNAL NOT FOUND. CHECK journal.xlsx.";
    });
