(() => {
    /* ================= CONFIG ================= */
    const XLSX_FILE = "workdata.xlsx";

    // Sheet tabs to show (hardcoded). Names must match the tab names in the xlsx exactly.
    const SHEETS = ["握手会", "出席活动"];

    // Optional per-sheet overrides. Every key is optional.
    // A value can be a header name ("书名") or a column letter ("C").
    // Use false to switch a field off for that sheet.
    // headerRow = which row holds the headers (1 = first row).
    const SHEET_MAP = {
        // "握手会":   { title: "C", date: "A", headerRow: 1 },
        // "出席活动": { title: "名称", url: false }
    };

    // Fallback header keywords (partial match, case-insensitive).
    const FIELDS = {
        title: ["博客标题", "标题", "名称", "书名", "片名", "地点", "title", "name"],
        date:  ["日期", "date", "day"],
        time:  ["发布时间", "时间", "time"],
        blog:  ["博客序号", "编号"],
        count: ["图片数", "数量", "count", "qty"],
        url:   ["官网链接", "链接", "网址", "url", "link"]
    };

// Row-number headers that never show as content.
    const IGNORE = ["序号", "#", "no", "no."];
    /* ========================================== */

    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    let rooms = [];
    let active = "ALL";
    let newestFirst = true;

    /* ---------- helpers ---------- */
    const TESTS = {
        url:  v => /^https?:\/\//i.test(v),
        time: v => /\d{1,2}:\d{2}/.test(v),
        date: v => /^(19|20)\d{2}[-./年]?\d{1,2}[-./月]?\d{1,2}/.test(v)
    };

    function normDate(s) {
        const m = String(s).match(/((?:19|20)\d{2})\D?(\d{1,2})\D?(\d{1,2})/);
        return m ? `${m[1]}.${m[2].padStart(2, "0")}.${m[3].padStart(2, "0")}` : "";
    }

    function letter(i) {
        let s = "";
        for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
        return s;
    }

    function colFromLetter(s) {
        if (!/^[A-Za-z]{1,2}$/.test(s)) return -1;
        return s.toUpperCase().split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
    }

    function findCol(headers, names) {
        for (const n of names) {
            const i = headers.findIndex(h => h && h.toLowerCase().includes(n.toLowerCase()));
            if (i !== -1) return i;
        }
        return -1;
    }

// resolve an override: header text first, then column letter
    function resolve(headers, spec) {
        const i = findCol(headers, [String(spec)]);
        return i !== -1 ? i : colFromLetter(String(spec));
    }

// first unused column where >=60% of non-empty cells pass the test
    function sniff(data, width, used, test) {
        for (let c = 0; c < width; c++) {
            if (used.has(c)) continue;
            const vals = data.map(r => String(r[c] ?? "").trim()).filter(Boolean);
            if (vals.length && vals.filter(test).length / vals.length >= 0.6) return c;
        }
        return -1;
    }

    /* ---------- parsing ---------- */
    function parseSheet(ws, name) {
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        const cfg = SHEET_MAP[name] || {};
        const filled = r => r.filter(c => String(c).trim() !== "").length;

        const hr = cfg.headerRow ? cfg.headerRow - 1 : rows.findIndex(r => filled(r) >= 2);
        if (hr < 0 || !rows[hr]) return null;

        const width = Math.max(...rows.map(r => r.length));
        const headers = Array.from({ length: width }, (_, i) => String(rows[hr][i] ?? "").trim());
        const data = rows.slice(hr + 1).filter(r => filled(r) > 0);
        if (!data.length) return null;

        // 1) override  2) header keywords
        const ix = {};
        for (const k in FIELDS) {
            if (cfg[k] === false) ix[k] = -2;                 // switched off
            else if (cfg[k] != null) ix[k] = resolve(headers, cfg[k]);
            else ix[k] = findCol(headers, FIELDS[k]);
        }
        const used = () => new Set(Object.values(ix).filter(i => i >= 0));

        // 3) sniff cell contents for what's still missing
        for (const k of ["url", "time", "date"]) {
            if (ix[k] === -1) ix[k] = sniff(data, width, used(), TESTS[k]);
        }
        if (ix.title === -1) {
            const u = used();
            const textual = v => isNaN(Number(v)) && !TESTS.date(v) && !TESTS.url(v) && !TESTS.time(v);
            ix.title = sniff(data, width, u, textual);
            if (ix.title === -1) ix.title = [...Array(width).keys()].find(c => !u.has(c)) ?? 0;
        }

        const taken = used();
        const extra = headers
            .map((h, i) => ({ h: h || "COL " + letter(i), i }))
            .filter(c => !taken.has(c.i) && !IGNORE.includes(c.h.toLowerCase()));

        const cell = (r, i) => i < 0 ? "" : String(r[i] ?? "").trim();

        const msgs = data
            .filter(r => cell(r, ix.title) !== "")
            .map((r, n) => {
                const time = cell(r, ix.time);
                const date = normDate(cell(r, ix.date)) || normDate(time);
                const hm = (time.match(/(\d{1,2}:\d{2})/) || [])[1] || "";
                return {
                    sheet: name, n, date, hm,
                    title: cell(r, ix.title),
                    blog:  cell(r, ix.blog),
                    count: parseInt(cell(r, ix.count), 10) || 0,
                    url:   cell(r, ix.url),
                    extra: extra.map(c => ({ label: c.h, value: cell(r, c.i) })).filter(e => e.value)
                };
            });

        if (!msgs.length) return null;
        console.log(`[chat] ${name}: title=${headers[ix.title] || letter(ix.title)}, ` +
            `date=${ix.date >= 0 ? letter(ix.date) : "-"}, time=${ix.time >= 0 ? letter(ix.time) : "-"}, ` +
            `url=${ix.url >= 0 ? letter(ix.url) : "-"}`);
        return { name, msgs };
    }

    function readWorkbook(buf) {
        const wb = XLSX.read(buf, { type: "array" });
        const names = SHEETS.length ? SHEETS.filter(s => wb.Sheets[s]) : wb.SheetNames;

        rooms = names.map(n => parseSheet(wb.Sheets[n], n)).filter(Boolean);
        if (!rooms.length) throw new Error("No readable sheets found in " + XLSX_FILE);

        buildTabs();
        render(true);
    }

    /* ---------- tabs ---------- */
    function allMsgs() {
        // stable sort: undated rows keep their sheet order
        return rooms.flatMap(r => r.msgs)
            .sort((a, b) => (a.date + a.hm).localeCompare(b.date + b.hm));
    }

    function currentMsgs() {
        return active === "ALL" ? allMsgs() : rooms.find(r => r.name === active).msgs;
    }

    function buildTabs() {
        const total = rooms.reduce((s, r) => s + r.msgs.length, 0);
        const tabs = [{ name: "ALL", count: total }, ...rooms.map(r => ({ name: r.name, count: r.msgs.length }))];

        $("c-tabs").innerHTML = tabs.map(t =>
            `<button class="tab${t.name === active ? " on" : ""}" data-name="${esc(t.name)}">${esc(t.name)}<small>${t.count}</small></button>`
        ).join("");
    }

    $("c-tabs").addEventListener("click", e => {
        const b = e.target.closest(".tab");
        if (!b) return;
        active = b.dataset.name;
        buildTabs();
        render(true);
    });

    /* ---------- rendering ---------- */
    function bubble(m, showSheet) {
        const safe = /^https?:\/\//i.test(m.url) ? m.url : "";
        const title = safe
            ? `<a class="ttl" href="${esc(safe)}" target="_blank" rel="noopener">${esc(m.title)}</a>`
            : `<span class="ttl">${esc(m.title)}</span>`;

        const body = m.extra.length
            ? `<div class="body">${m.extra.length === 1
                ? esc(m.extra[0].value)
                : m.extra.map(e => `<span class="lbl">${esc(e.label)}:</span> ${esc(e.value)}`).join("\n")}</div>`
            : "";

        const chips = (showSheet || m.blog || m.count)
            ? `<div class="chips">
         ${showSheet ? `<span class="chip sheet">${esc(m.sheet)}</span>` : ""}
         ${m.blog ? `<span class="chip tag">${esc(m.blog)}</span>` : ""}
         ${m.count ? `<span class="chip">📷 ×${m.count}</span>` : ""}
       </div>` : "";

        return `
  <div class="msg">
    <div class="avatar">🌸</div>
    <div class="bubble">${title}${body}${chips}</div>
    <div class="time">${esc(m.hm)}</div>
  </div>`;
    }

    function render(scrollToEnd) {
        const q = $("c-search").value.trim().toLowerCase();
        let list = currentMsgs().filter(m =>
            !q || (m.title + " " + m.blog + " " + m.extra.map(e => e.value).join(" ")).toLowerCase().includes(q));
        if (newestFirst) list = list.slice().reverse();

        const room = $("c-room");
        if (!list.length) { room.innerHTML = `<p class="status">NO MESSAGES.</p>`; return; }

        const showSheet = active === "ALL";
        let html = "", lastDay = null;
        list.forEach(m => {
            if (m.date !== lastDay) {
                html += `<div class="day"><span>${esc(m.date || "NO DATE")}</span></div>`;
                lastDay = m.date;
            }
            html += bubble(m, showSheet);
        });
        room.innerHTML = html;

        if (scrollToEnd) room.scrollTop = newestFirst ? 0 : room.scrollHeight;
    }

    /* ---------- controls ---------- */
    $("c-search").addEventListener("input", () => render(false));
    $("c-sort").addEventListener("click", () => {
        newestFirst = !newestFirst;
        $("c-sort").textContent = newestFirst ? "最新 ▼" : "最新 ▲";
        render(true);
    });

    /* ---------- opening ---------- */
    (() => {
        const chat = document.querySelector(".chat");
        const m1 = $("im1"), m2 = $("im2");
        const wrap = $("c-open-wrap");
        const timers = [];
        const later = (fn, ms) => timers.push(setTimeout(fn, ms));

        function showAll() {                       // jump to the final state
            timers.forEach(clearTimeout);
            m1.classList.add("show");
            m2.classList.add("show");
            wrap.classList.add("show");
        }

        if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
            showAll();
        } else {
            later(() => m1.classList.add("show"), 500);     // right: 今日もお疲れ様
            later(() => m2.classList.add("show"), 1500);    // left: いつもありがとう
            later(() => wrap.classList.add("show"), 2300);  // the button

            $("c-intro").addEventListener("click", e => {   // click anywhere to skip
                if (e.target.id !== "c-open") showAll();
            });
        }

        $("c-open").addEventListener("click", () => {
            chat.classList.add("opened");
            render(true);                          // re-render now that the room is visible
        });
    })();



    /* ---------- load ---------- */
    fetch(XLSX_FILE)
        .then(r => { if (!r.ok) throw new Error("HTTP " + r.status + " for " + XLSX_FILE); return r.arrayBuffer(); })
        .then(readWorkbook)
        .catch(err => {
            console.error(err);
            $("c-room").innerHTML = `<p class="status">ERROR: ${esc(err.message)}</p>`;
        });
})();
