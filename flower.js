/* One entry per petal, clockwise from the top. Edit freely. */
const PETALS = [
    { href: "chat.html",   label: "粉丝互动", fill: "#ffb7d0", edge: "#d9638c" }, // top
    { href: "blog.html", label: "博客收据", fill: "#ffb7d0", edge: "#d9638c" }, // upper right
    { href: "journal.html", label: "综艺热度", fill: "#ffb7d0", edge: "#d9638c" }, // lower right
    { href: "mediavariety.html",  label: "音乐音番", fill: "#ffb7d0", edge: "#d9638c" }, // lower left
    { href: "map.html",     label: "巡礼地图", fill: "#ffb7d0", edge: "#d9638c" }  // upper left
];
const CENTER = { href: "disclaimer.html", label: "钞组love", icon: "💌", fill: "#ffd93d", edge: "#b8941a" };

const N = 39, C = N / 2;          // grid size and center
const holder = document.getElementById("flower");
const caption = document.getElementById("caption");
const DEFAULT_CAPTION = caption.textContent;

/* ---------- 1. Work out which pixel belongs to which petal ---------- */
const grid = [];   // grid[y][x] = {id, r, phi} or null
for (let y = 0; y < N; y++) {
    grid[y] = [];
    for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - C, dy = y + 0.5 - C;
        const r = Math.hypot(dx, dy);
        let ang = Math.atan2(dx, -dy) * 180 / Math.PI;   // 0° = up, clockwise
        if (ang < 0) ang += 360;

        if (r < 3.8) { grid[y][x] = { id: 5, r, phi: 0 }; continue; }   // center = contact
        if (r < 4.8) { grid[y][x] = null; continue; }                   // gap ring

        const k = Math.floor(((ang + 36) % 360) / 72);
        let phi = ang - 72 * k;
        if (phi > 180) phi -= 360;
        if (phi < -180) phi += 360;

        const reach = 18.6 - 5 * Math.pow(Math.abs(phi) / 36, 2)        // rounded tip
            - 4.5 * Math.exp(-Math.pow(phi / 5, 2));     // sakura notch
        grid[y][x] = (Math.abs(phi) <= 34 && r < reach) ? { id: k, r, phi } : null;
    }
}

/* ---------- 2. Turn pixels into SVG rectangles ---------- */
const groups = PETALS.concat([CENTER]).map(() => "");
const same = (x, y, id) => y >= 0 && y < N && x >= 0 && x < N && grid[y][x] && grid[y][x].id === id;

for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
        const cell = grid[y][x];
        if (!cell) continue;
        const p = PETALS.concat([CENTER])[cell.id]
        const edge = !same(x - 1, y, cell.id) || !same(x + 1, y, cell.id) ||
            !same(x, y - 1, cell.id) || !same(x, y + 1, cell.id);
        const vein = cell.id < 5 && cell.r > 6 && cell.r < 12 &&
            Math.abs(cell.r * Math.sin(cell.phi * Math.PI / 180)) < 0.55 && Math.abs(cell.phi) < 20;
        const color = edge ? p.edge : p.fill;
        groups[cell.id] += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${color}"${vein && !edge ? ' opacity=".7"' : ""}/>`;
        if (vein && !edge) groups[cell.id] += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${p.edge}" opacity=".35"/>`;
    }
}

/* ---------- 3. Assemble the flower ---------- */
let svg = `<svg viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges" role="group">`;

PETALS.concat([CENTER]).forEach((p, i) => {
    const a = (72 * i) * Math.PI / 180;
    const isCenter = i === 5;
    const dx = isCenter ? 0 : Math.sin(a) * 0.9;     // hover pushes the petal outward
    const dy = isCenter ? 0 : -Math.cos(a) * 0.9;
    const lx = C + Math.sin(a) * 11.5, ly = C - Math.cos(a) * 11.5;

    const text = isCenter
        ? ""
        : `<text x="${lx}" y="${ly + 0.5}" font-size="1.3" text-anchor="middle" class="plabel">${p.label}</text>`;


    svg += `<a class="blossom ${isCenter ? "core" : ""}" href="${p.href}" data-label="${p.label}"
            style="--i:${i};--dx:${dx}px;--dy:${dy}px" aria-label="${p.label}">
            <title>${p.label}</title>${groups[i]}${text}</a>`;
});
svg += "</svg>";
holder.innerHTML = svg;

/* ---------- 4. Caption under the flower ---------- */
holder.querySelectorAll("a.blossom").forEach(a => {
    const on = () => (caption.textContent = "▶ " + a.dataset.label + " ◀");
    const off = () => (caption.textContent = DEFAULT_CAPTION);
    a.addEventListener("mouseenter", on);
    a.addEventListener("focus", on);
    a.addEventListener("mouseleave", off);
    a.addEventListener("blur", off);
});
