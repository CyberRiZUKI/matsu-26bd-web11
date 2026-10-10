const CSV_FILE = "Matsuri_1stPB_coords.csv";
const PICS_DIR = "pics/";
const CACHE_KEY = "sakura-geocache-v1";

const map = L.map("map", { closePopupOnClick: true }).setView([22.3193, 114.1694], 11); // starting view: Hong Kong
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
}).addTo(map);

let places = [];        // {row, marker}
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

/* ---------- Photos & tags ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const IMG_RE = /\.(jpe?g|png|gif|webp|avif)$/i;

// Photo = "Pic" column if present, else a Tags value that looks like an image filename
const picOf = r => r.Pic || (IMG_RE.test(r.Tags || "") ? r.Tags : "");

// Real tags only (a filename in the Tags column is not a tag)
const tagsOf = r => IMG_RE.test((r.Tags || "").trim()) ? []
    : (r.Tags || "").split(/[,;|]/).map(t => t.trim()).filter(Boolean);

/* ---------- Markers ---------- */
const pinIcon = L.divIcon({
    className: "pin", html: "<div class='pin-dot'></div>",
    iconSize: [24, 28], iconAnchor: [12, 28], popupAnchor: [0, -28]
});

function popupHTML(r) {
    let h = "";
    const pic = picOf(r);
    if (pic) {
        h += `<img class="pop-pic" src="${PICS_DIR}${encodeURIComponent(pic)}" alt="${esc(r.Title)}"
                   onerror="this.remove()">`;
    }
    h += `<h3>${esc(r.Title)}</h3>`;
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
        .bindPopup(popupHTML(r), {
            minWidth: 220,
            maxWidth: 300,
            closeOnClick: true,        // click blank map = popup disappears
            closeButton: true,
            autoPanPadding: [30, 40]   // extra room so the corner button stays on screen
        })
        .addTo(map);

    // once the photo finishes loading, re-measure the popup so it sits correctly above the pin
    marker.on("popupopen", e => {
        const img = e.popup.getElement().querySelector("img");
        if (img && !img.complete) img.addEventListener("load", () => e.popup.update(), { once: true });
    });

    places.push({ row: r, marker });
}

/* ---------- Main ---------- */
async function loadRows(rows) {
    places.forEach(p => p.marker.remove()); places = [];

    for (const r of rows) {
        if (!r.Title) continue;
        let coords = coordsFromRow(r);
        if (!coords) coords = await geocode(r.Title);
        if (coords) addPlace(r, coords);
        else console.warn("Not found:", r.Title);
        if (places.length) map.fitBounds(L.featureGroup(places.map(p => p.marker)).getBounds().pad(0.2));
    }
}

fetch(CSV_FILE)
    .then(r => { if (!r.ok) throw new Error("HTTP " + r.status + " for " + CSV_FILE); return r.text(); })
    .then(t => loadRows(parseCSV(t)))
    .catch(err => console.error("Can't load places:", err));
