(() => {
    const XLSX_FILE = "workdata.xlsx";
    const DATE_COL = 1;   // column B holds the date (YYYYMMDD)

// Sheets to show. Leave [] to use every sheet.
    const SHEETS = ["LIVE演出", "音番打歌", "CD收录"];

// Card fields = header names in row 1 (not case-sensitive).
// Missing headers fall back to column position after the date:
// title = 1st, text = 2nd, tag = 3rd, foot = 4th. "end" has no fallback.
    const FIELDS = {
        title: "Title",
        text:  "Description",
        tag:   "Category",
        foot:  "Note",
        end:   "End"
    };

// Newest first? true = newest at the top, false = oldest at the top
    const NEWEST_FIRST = false;

    const COLORS = {
        "LIVE演出": { f: "var(--pink, #ffc8dd)", d: "var(--pink-d, #e58aa8)" },
        "音番打歌": { f: "var(--yellow)", d: "var(--yellow-d)" },
        "CD收录": { f: "var(--green)",  d: "var(--green-d)" }
    };
    const PALETTE = [
        { f: "var(--green)",  d: "var(--green-d)" },
        { f: "var(--yellow)", d: "var(--yellow-d)" }
    ];


    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const pad = n => String(n).padStart(2, "0");

    let entries = [];
    let sheetColor = {};
    let activeSheets = new Set();

    /* ---------- Strict date parsing: YYYYMMDD or YYYY-MM-DD ---------- */
    function toKey(v) {
        const s = String(v ?? "").trim();
        const m = s.match(/^(\d{4})(\d{2})(\d{2})$/) ||
            s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
        if (!m) return null;
        const y = +m[1], mo = +m[2], d = +m[3];
        const dt = new Date(y, mo - 1, d);
        if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
        return `${y}-${pad(mo)}-${pad(d)}`;
    }

    /* ---------- Read workbook ---------- */
    function readWorkbook(buf) {
        const wb = XLSX.read(buf, { type: "array" });
        entries = []; sheetColor = {};
        let skipped = 0;

        const wanted = SHEETS.length ? SHEETS : wb.SheetNames;
        const missing = wanted.filter(n => !wb.Sheets[n]);
        const found = wanted.filter(n => wb.Sheets[n]);

        found.forEach((name, si) => {
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" });
            if (rows.length < 2) return;
            sheetColor[name] = COLORS[name] || PALETTE[si % PALETTE.length];

            const headers = rows[0].map(h => String(h).trim().toLowerCase());
            const others = headers.map((_, i) => i).filter(i => i !== DATE_COL);
            const pick = (field, pos) => {
                const i = headers.indexOf(FIELDS[field].toLowerCase());
                return i !== -1 ? i : (pos == null ? -1 : (others[pos] ?? -1));
            };
            const col = {
                title: pick("title", 0), text: pick("text", 1),
                tag: pick("tag", 2),     foot: pick("foot", 3),
                end: pick("end", null)
            };
            const get = (r, i) => i === -1 ? "" : String(r[i] ?? "").trim();

            rows.slice(1).forEach(r => {
                if (r.every(c => String(c).trim() === "")) return;
                const key = toKey(r[DATE_COL]);
                if (!key) { skipped++; return; }
                entries.push({
                    key, sheet: name,
                    end:   toKey(get(r, col.end)),
                    title: get(r, col.title),
                    text:  get(r, col.text),
                    tag:   get(r, col.tag),
                    foot:  get(r, col.foot)
                });
            });
        });

        entries.sort((a, b) => a.key.localeCompare(b.key) ||
            found.indexOf(a.sheet) - found.indexOf(b.sheet));
        if (NEWEST_FIRST) entries.reverse();

        activeSheets = new Set(Object.keys(sheetColor));
        const warn = [
            skipped ? `${skipped} ROWS SKIPPED (BAD DATE)` : "",
            missing.length ? `SHEET NOT FOUND: ${missing.join(", ")}` : ""
        ].filter(Boolean).join(" · ");

        $("tl-status").textContent = warn;
        $("tl-status").style.display = warn ? "block" : "none";


        buildChips();
        render();
    }

    /* ---------- Sheet filter chips ---------- */
    function buildChips() {
        $("tl-sheets").innerHTML = "";
        Object.keys(sheetColor).forEach(name => {
            const b = document.createElement("button");
            b.className = "chip on";
            b.textContent = name;
            b.style.setProperty("--c", sheetColor[name].f);
            b.style.setProperty("--cd", sheetColor[name].d);
            b.onclick = () => {
                activeSheets.has(name) ? activeSheets.delete(name) : activeSheets.add(name);
                b.classList.toggle("on");
                render();
            };
            $("tl-sheets").appendChild(b);
        });
    }

    /* ---------- Date label (supports ranges) ---------- */
    function dateLabel(e) {
        const a = e.key.replace(/-/g, ".");
        if (!e.end || e.end === e.key) return a;
        const sameYear = e.end.slice(0, 4) === e.key.slice(0, 4);
        return `${a} – ${(sameYear ? e.end.slice(5) : e.end).replace(/-/g, ".")}`;
    }

    /* ---------- Render vertical timeline (reveal on 50% scroll) ---------- */
    const INITIAL = 1;          // items drawn on load
    const STEP = 1;             // items added each time
    const THRESHOLD = 0.5;      // scroll progress needed to reveal the next item
    const COOLDOWN = 200;       // ms between reveals (keeps it one at a time)

    let list = [], shown = 0, lastYear = null, side = 0;
    let yearEls = {}, lastLoad = 0;

    const root = document.documentElement;

    const sentinel = document.createElement("div");
    sentinel.id = "tl-sentinel";
    sentinel.style.cssText = "height:1px;text-align:center;";
    $("tl-track").after(sentinel);

    function addYearPill(y) {
        const m = document.createElement("div");
        m.className = "tl-year";
        m.innerHTML = `<span>${y}</span>`;
        $("tl-track").appendChild(m);
        yearEls[y] = m;
    }

    function addItem(e) {
        const item = document.createElement("div");
        item.className = `tl-item ${side++ % 2 === 0 ? "left" : "right"}`;
        item.style.setProperty("--c", sheetColor[e.sheet].f);
        item.style.setProperty("--cd", sheetColor[e.sheet].d);
        item.style.animation = "bloom .4s steps(4) backwards";
        item.innerHTML =
            `<div class="tl-dot"></div>` +
            `<article class="tl-card">` +
            `<div class="tl-date">${esc(dateLabel(e))}</div>` +
            (e.tag ? `<span class="tl-tag">${esc(e.tag)}</span>` : "") +
            (e.title && !/^\d+$/.test(e.title) ? `<h3>${esc(e.title)}</h3>` : "") +
            (e.text ? `<p>${esc(e.text)}</p>` : "") +
            `<div class="tl-foot">${e.foot ? esc(e.foot) : ""}<em>${esc(e.sheet)}</em></div>` +
            `</article>`;
        $("tl-track").appendChild(item);
    }

    function loadMore(count) {
        const end = Math.min(shown + count, list.length);
        for (; shown < end; shown++) {
            const e = list[shown];
            const y = e.key.slice(0, 4);
            if (y !== lastYear) { lastYear = y; addYearPill(y); }
            addItem(e);
        }
        if (shown >= list.length) {
            sentinel.textContent = "— THE END —";
            sentinel.style.cssText = "text-align:center;padding:12px 0 24px;";
        }
    }

    /* ---------- Reveal the next item after 50% scroll ---------- */
    function maxScroll() {
        return root.scrollHeight - window.innerHeight;   // total scrollable distance
    }

    function tryLoad(fromInput) {
        if (shown >= list.length) return;

        const now = performance.now();
        if (now - lastLoad < COOLDOWN) return;

        const max = maxScroll();
        if (max <= 24) {
            // page too short to scroll: a downward input is the nudge
            if (fromInput) { lastLoad = now; loadMore(STEP); }
            return;
        }
        if (window.scrollY / max >= THRESHOLD) { lastLoad = now; loadMore(STEP); }
    }

    window.addEventListener("scroll", () => tryLoad(false), { passive: true });

    window.addEventListener("wheel", e => {
        if (e.deltaY > 0) tryLoad(true);
    }, { passive: true });

    window.addEventListener("touchmove", () => tryLoad(true), { passive: true });

    window.addEventListener("keydown", e => {
        if (["ArrowDown", "PageDown", "End", " "].includes(e.key)) tryLoad(true);
    });

    /* ---------- Year chips ---------- */
    function buildYearChips() {
        const years = $("tl-years");
        years.innerHTML = "";
        [...new Set(list.map(e => e.key.slice(0, 4)))].forEach(y => {
            const btn = document.createElement("button");
            btn.className = "chip on";
            btn.textContent = y;
            btn.onclick = () => {
                while (!yearEls[y] && shown < list.length) loadMore(STEP);
                yearEls[y]?.scrollIntoView({ behavior: "smooth", block: "center" });
            };
            years.appendChild(btn);
        });
    }

    /* ---------- Render ---------- */
    function render() {
        const track = $("tl-track");
        track.innerHTML = "";

        list = entries.filter(e => activeSheets.has(e.sheet));
        shown = 0; lastYear = null; side = 0; yearEls = {}; lastLoad = 0;
        sentinel.textContent = "";
        sentinel.style.cssText = "height:1px;text-align:center;";
        buildYearChips();

        if (!list.length) {
            track.innerHTML = '<p class="tl-empty">NOTHING HERE YET.</p>';
            return;
        }
        loadMore(INITIAL);          // just the first item
    }

    /* ---------- Load ---------- */
    fetch(XLSX_FILE)
        .then(r => { if (!r.ok) throw new Error("HTTP " + r.status + " for " + XLSX_FILE); return r.arrayBuffer(); })
        .then(readWorkbook)
        .catch(err => {
            console.error(err);
            $("tl-status").textContent = "ERROR: " + err.message;
        });
})();
