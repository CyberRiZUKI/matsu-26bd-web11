const fs = require("fs");

// ---------- Plus Code decoder ----------
const ALPHABET = "23456789CFGHJMPQRVWX";
const idx = (ch) => {
    const i = ALPHABET.indexOf(ch);
    if (i === -1) throw new Error(`Invalid Plus Code character: ${ch}`);
    return i;
};

function decodeFull(code) {
    code = code.toUpperCase().replace("+", "").replace(/0+$/, "");
    let lat = -90, lng = -180, size = 20;
    const pairLen = Math.min(code.length, 10);
    for (let i = 0; i < pairLen; i += 2) {
        lat += idx(code[i]) * size;
        lng += idx(code[i + 1]) * size;
        if (i + 2 < pairLen) size /= 20;
    }
    let latSize = size, lngSize = size;
    for (let i = 10; i < code.length; i++) {
        latSize /= 5;
        lngSize /= 4;
        const d = idx(code[i]);
        lat += Math.floor(d / 4) * latSize;
        lng += (d % 4) * lngSize;
    }
    return { lat: lat + latSize / 2, lng: lng + lngSize / 2 };
}

function prefixFrom(refLat, refLng, nChars) {
    let lat = Math.min(Math.max(refLat, -90), 89.9999999) + 90;
    let lng = (((refLng + 180) % 360) + 360) % 360;
    let out = "", res = 20;
    for (let i = 0; i < nChars / 2; i++) {
        const a = Math.floor(lat / res), b = Math.floor(lng / res);
        out += ALPHABET[a] + ALPHABET[b];
        lat -= a * res;
        lng -= b * res;
        res /= 20;
    }
    return out;
}

function decodeShort(code, refLat, refLng) {
    const sep = code.indexOf("+");
    const padding = 8 - sep;
    const resolution = Math.pow(20, 2 - padding / 2);
    let { lat, lng } = decodeFull(prefixFrom(refLat, refLng, padding) + code);
    if (refLat + resolution / 2 < lat && lat - resolution >= -90) lat -= resolution;
    else if (refLat - resolution / 2 > lat && lat + resolution <= 90) lat += resolution;
    if (refLng + resolution / 2 < lng) lng -= resolution;
    else if (refLng - resolution / 2 > lng) lng += resolution;
    return { lat, lng };
}

// ---------- Reference points for short codes ----------
const LOCALITIES = {
    auckland: [-36.8485, 174.7633],
    rotorua: [-38.1368, 176.2497],
};

// ---------- Resolve one raw value ----------
const COORD_RE = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/;
const PLUS_RE = /^([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,7})\s*(.*)$/i;

function resolve(raw) {
    raw = raw.trim();

    let m = raw.match(COORD_RE);
    if (m) return { lat: +m[1], lng: +m[2], status: "ok-coordinate" };

    m = raw.match(PLUS_RE);
    if (m) {
        const code = m[1].toUpperCase();
        const place = m[2].toLowerCase();
        if (code.indexOf("+") === 8) {
            return { ...decodeFull(code), status: "ok-plus-full" };
        }
        const key = Object.keys(LOCALITIES).find((k) => place.includes(k));
        if (!key) return { lat: null, lng: null, status: "error-unknown-locality" };
        const [rLat, rLng] = LOCALITIES[key];
        return { ...decodeShort(code, rLat, rLng), status: "ok-plus-short" };
    }

    return { lat: null, lng: null, status: "unresolved" };
}

// ---------- Pairing (same order as the CSV data rows) ----------
// raw: your replacement content | extra: remarks to put in Comment
// manual: fallback if raw can't be resolved (marked manual-approx)
const PAIRS = [
    { raw: "-36.8445681,174.7642238" },
    { raw: "4R27+7R Auckland, New Zealand" },
    { raw: "5Q36+8Q Auckland, New Zealand", extra: "swimsuit A" },
    { raw: "-36.8468688,174.7598509" },
    { raw: "-36.8491602,174.7456106" },
    { raw: "5P3R+GQ Auckland, New Zealand" },
    { raw: "V6QC+RQ Rotorua, New Zealand" },
    { raw: "-36.8466449,174.7453705", extra: "天空塔旁教堂" },
    { raw: "Auckland 0772, New Zealand", extra: "outside swimsuit",
        manual: { lat: -36.9544, lng: 174.4688 } }, // approx, please verify
    { raw: "-36.8445681,174.7642238", extra: "Matsublog on 20251025" },
    { raw: "5Q28+WQ Auckland, New Zealand" },
    { raw: "R7VF+84 Rotorua, New Zealand" },
    { raw: "W57V+R4 Rotorua, New Zealand" },
    { raw: "5Q28+R4 Auckland, New Zealand" },
    { raw: "5Q38+5FG Auckland, New Zealand" },
    { raw: "4PJG+VQ Auckland, New Zealand" },
    { raw: "4PWJ+8M Auckland, New Zealand" },
    { raw: "4R35+2P Auckland, New Zealand" },
];

// ---------- CSV parse / write ----------
function parseCSV(text) {
    text = text.replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') q = false;
            else cell += c;
        } else if (c === '"') q = true;
        else if (c === ",") { row.push(cell); cell = ""; }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(cell); rows.push(row); row = []; cell = "";
        } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

const esc = (v) => {
    v = v == null ? "" : String(v);
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

// ---------- Main ----------
const inFile = process.argv[2] || "Matsuri_1stPB.csv";
const outCsv = inFile.replace(/\.csv$/i, "_coords.csv");
const outJson = inFile.replace(/\.csv$/i, "_coords.json");

const rows = parseCSV(fs.readFileSync(inFile, "utf8"));
const data = rows.slice(1).filter((r) => r.some((c) => c.trim() !== "")); // skip header + blank rows

if (data.length !== PAIRS.length) {
    console.warn(`⚠️ Row count mismatch: CSV has ${data.length}, PAIRS has ${PAIRS.length}`);
}

const results = data.map((r, i) => {
    const [title, note, , tags, comment] = r;
    const p = PAIRS[i] || { raw: "" };
    let res = resolve(p.raw);
    if (res.lat == null && p.manual) {
        res = { lat: p.manual.lat, lng: p.manual.lng, status: "manual-approx" };
    }
    const mergedComment = [comment, p.extra].filter(Boolean).join("; ");
    return {
        title,
        note: note || "",
        lat: res.lat == null ? null : +res.lat.toFixed(7),
        lng: res.lng == null ? null : +res.lng.toFixed(7),
        source: p.raw,
        status: res.status,
        tags: tags || "",
        comment: mergedComment,
    };
});

const header = ["Title", "Note", "Lat", "Lng", "Source", "Status", "Tags", "Comment"];
const lines = [header.join(",")].concat(
    results.map((o) =>
        [o.title, o.note, o.lat, o.lng, o.source, o.status, o.tags, o.comment].map(esc).join(",")
    )
);

fs.writeFileSync(outCsv, lines.join("\n"), "utf8");
fs.writeFileSync(outJson, JSON.stringify(results, null, 2), "utf8");

console.table(results.map(({ title, lat, lng, status }) => ({ title, lat, lng, status })));
console.log(`\nWrote ${outCsv} and ${outJson}`);
