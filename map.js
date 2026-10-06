const CSV_FILE = "Matsuri_1stPB.csv";
const CACHE_KEY = "sakura-geocache-v1";

const map = L.map("map").setView([22.3193, 114.1694], 11); // starting view: Hong Kong
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
}).addTo(map);

const statusEl = document.getElementById("map-status");
const filterEl = document.getElementById("tag-filter");
const exportBtn = document.getElementById("export-btn");
const pickBtn = document.getElementById("csv-pick");
const fileInput = document.getElementById("csv-file");

let places = [];        // {row, marker}
let activeTags = new Set();
const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");

/* ---------- CSV parser (handles quotes, commas, line breaks) ---------- */
function parseCSV(text) {
    text = text.replace(/^\uFEFF/, "");
    const rows = []; let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') q = false;
            else field += c;
        } else if (c === '"') q = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(field); field = "";
            if (row.some(v => v.trim() !== "")) rows.push(row);
            row = [];
        } else field += c;
    }
    row.push(field);
    if (row.some(v => v.trim() !== "")) rows.push(row);

    const head = rows.shift().map(h => h.trim());
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}

/* ---------- Coordinates ---------- */
function coordsFromRow(r) {
    const lat = parseFloat(r.Lat), lng = parseFloat(r.Lng);
    if (!isNaN(lat) && !isNaN(lng)) return [lat, lng];
    const u = r.URL || "";
    const m = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
        u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ||
        u.match(/[?&](?:q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function geocode(title) {
    if (cache[title]) return cache[title];
    try {
        const res = await fetch(
            "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(title)
        );
        const data = await res.json();
        await sleep(1100); // Nominatim allows ~1 request per second
        if (data[0]) {
            cache[title] = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
            return cache[title];
        }
    } catch (e) { console.warn("Geocode failed:", title, e); }
    return null;
}

/* ---------- Markers ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const pinIcon = L.divIcon({
    className: "pin", html: "<div class='pin-dot'></div>",
    iconSize: [24, 28], iconAnchor: [12, 28], popupAnchor: [0, -28]
});

const tagsOf = r => (r.Tags || "").split(/[,;|]/).map(t => t.trim()).filter(Boolean);

function popupHTML(r) {
    let h = `<h3>${esc(r.Title)}</h3>`;
    if (r.Note)    h += `<p>${esc(r.Note)}</p>`;
    if (r.Comment) h += `<p><em>${esc(r.Comment)}</em></p>`;
    const tags = tagsOf(r);
    if (tags.length) h += `<p>${tags.map(t => `<span class="chip-sm">${esc(t)}</span>`).join(" ")}</p>`;
    if (/^https?:\/\//.test(r.URL || "")) h += `<a href="${esc(r.URL)}" target="_blank" rel="noopener">OPEN LINK ▶</a>`;
    return h;
}

function addPlace(r, coords) {
    r.Lat = coords[0]; r.Lng = coords[1];
    const marker = L.marker(coords, { icon: pinIcon, title: r.Title })
        .bindPopup(popupHTML(r)).addTo(map);
    places.push({ row: r, marker });
}

/* ---------- Tag filter ---------- */
function buildFilter(rows) {
    const all = [...new Set(rows.flatMap(tagsOf))].sort();
    filterEl.innerHTML = "";
    all.forEach(tag => {
        const b = document.createElement("button");
        b.className = "chip"; b.textContent = tag;
        b.onclick = () => {
            activeTags.has(tag) ? activeTags.delete(tag) : activeTags.add(tag);
            b.classList.toggle("on");
            applyFilter();
        };
        filterEl.appendChild(b);
    });
}

function applyFilter() {
    places.forEach(({ row, marker }) => {
        const show = !activeTags.size || tagsOf(row).some(t => activeTags.has(t));
        show ? marker.addTo(map) : marker.remove();
    });
}

/* ---------- Export CSV with coordinates ---------- */
function exportCSV() {
    const cols = ["Title", "Note", "URL", "Tags", "Comment", "Lat", "Lng"];
    const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const csv = [cols.join(",")]
        .concat(places.map(p => cols.map(c => q(p.row[c])).join(","))).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "places-with-coords.csv";
    a.click();
}
exportBtn.onclick = exportCSV;

/* ---------- Main ---------- */
async function loadRows(rows) {
    places.forEach(p => p.marker.remove()); places = [];
    buildFilter(rows);
    let missed = 0;

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.Title) continue;
        let coords = coordsFromRow(r);
        if (!coords) {
            statusEl.textContent = `SEARCHING ${i + 1}/${rows.length}: ${r.Title}`;
            coords = await geocode(r.Title);
        }
        if (coords) addPlace(r, coords); else missed++;
        if (places.length) map.fitBounds(L.featureGroup(places.map(p => p.marker)).getBounds().pad(0.2));
    }
    statusEl.textContent = `${places.length} PLACES ON MAP` + (missed ? ` · ${missed} NOT FOUND` : "");
    if (places.length) exportBtn.style.display = "inline-block";
}

fetch(CSV_FILE)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(t => loadRows(parseCSV(t)))
    .catch(() => {
        statusEl.textContent = "CAN'T READ places.csv AUTOMATICALLY. PICK THE FILE:";
        pickBtn.style.display = "inline-block";
    });

fileInput.onchange = e => {
    const f = e.target.files[0];
    if (f) f.text().then(t => { pickBtn.style.display = "none"; loadRows(parseCSV(t)); });
};
