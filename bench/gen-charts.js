// Generates the benchmark SVG charts embedded in the README.
// Edit the `data` object with your own numbers and re-run:  node bench/gen-charts.js
// Output: assets/throughput.svg, assets/latency.svg
const fs = require("fs");
const path = require("path");

// --- benchmark data (200,000 requests @ concurrency 200) -------------------
const data = {
  subtitle: "200,000 requests @ concurrency 200 · local target server",
  throughput: { rust: 37985, node: 21896 }, // req/s
  latency: {
    // milliseconds
    labels: ["p50", "p90", "p99", "max"],
    rust: [5.17, 6.3, 7.8, 25.28],
    node: [9.32, 11.36, 16.28, 78.9],
  },
};

const RUST = "#dea584"; // rust-ish
const NODE = "#8cc84b"; // node green
const FG = "#24292f";
const MUTE = "#57606a";
const GRID = "#d0d7de";
const BG = "#ffffff";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function frame(w, h, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8" fill="${BG}" stroke="${GRID}"/>
  <text x="20" y="28" font-size="16" font-weight="700" fill="${FG}">${esc(title)}</text>
  <text x="20" y="48" font-size="11" fill="${MUTE}">${esc(data.subtitle)}</text>
${body}
</svg>`;
}

function legend(x, y) {
  return `  <rect x="${x}" y="${y}" width="12" height="12" rx="2" fill="${RUST}"/>
  <text x="${x + 18}" y="${y + 11}" font-size="12" fill="${FG}">Rust (rload)</text>
  <rect x="${x + 110}" y="${y}" width="12" height="12" rx="2" fill="${NODE}"/>
  <text x="${x + 128}" y="${y + 11}" font-size="12" fill="${FG}">Node baseline</text>`;
}

// --- throughput: two horizontal bars (higher is better) --------------------
function throughputChart() {
  const w = 680,
    h = 230;
  const x0 = 130,
    barMax = 480,
    top = 86,
    bh = 34,
    gap = 34;
  const max = Math.max(data.throughput.rust, data.throughput.node);
  const rows = [
    { name: "Rust (rload)", val: data.throughput.rust, color: RUST },
    { name: "Node baseline", val: data.throughput.node, color: NODE },
  ];
  let body = `  <text x="20" y="74" font-size="12" font-weight="600" fill="${MUTE}">Throughput (req/s) — higher is better</text>\n`;
  rows.forEach((r, i) => {
    const y = top + i * (bh + gap);
    const bw = Math.round((r.val / max) * barMax);
    body += `  <text x="${x0 - 10}" y="${y + bh / 2 + 4}" font-size="12" text-anchor="end" fill="${FG}">${r.name}</text>\n`;
    body += `  <rect x="${x0}" y="${y}" width="${bw}" height="${bh}" rx="4" fill="${r.color}"/>\n`;
    body += `  <text x="${x0 + bw + 8}" y="${y + bh / 2 + 4}" font-size="13" font-weight="700" fill="${FG}">${r.val.toLocaleString("en-US")}</text>\n`;
  });
  const mult = (data.throughput.rust / data.throughput.node).toFixed(1);
  body += `  <text x="20" y="${h - 16}" font-size="12" fill="${MUTE}">Rust drives <tspan font-weight="700" fill="${FG}">${mult}×</tspan> the throughput of the Node baseline.</text>\n`;
  return frame(w, h, "rload vs Node — throughput", body);
}

// --- latency: grouped vertical bars per percentile (lower is better) -------
function latencyChart() {
  const w = 680,
    h = 320;
  const { labels, rust, node } = data.latency;
  const plotL = 60,
    plotR = w - 30,
    plotT = 90,
    plotB = h - 50;
  const plotW = plotR - plotL,
    plotH = plotB - plotT;
  const max = Math.max(...rust, ...node);
  // round axis max up to a nice number
  const axisMax = Math.ceil(max / 10) * 10;
  const groups = labels.length;
  const groupW = plotW / groups;
  const barW = 26;

  let body = `  <text x="20" y="74" font-size="12" font-weight="600" fill="${MUTE}">Latency (ms) — lower is better</text>\n`;
  body += legend(w - 280, 60) + "\n";

  // gridlines + y labels
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const val = (axisMax / ticks) * t;
    const y = plotB - (val / axisMax) * plotH;
    body += `  <line x1="${plotL}" y1="${y}" x2="${plotR}" y2="${y}" stroke="${GRID}" stroke-width="1"/>\n`;
    body += `  <text x="${plotL - 8}" y="${y + 4}" font-size="10" text-anchor="end" fill="${MUTE}">${val.toFixed(0)}</text>\n`;
  }

  labels.forEach((lab, i) => {
    const cx = plotL + groupW * i + groupW / 2;
    const rh = (rust[i] / axisMax) * plotH;
    const nh = (node[i] / axisMax) * plotH;
    const rx = cx - barW - 3;
    const nx = cx + 3;
    body += `  <rect x="${rx}" y="${plotB - rh}" width="${barW}" height="${rh}" rx="3" fill="${RUST}"/>\n`;
    body += `  <rect x="${nx}" y="${plotB - nh}" width="${barW}" height="${nh}" rx="3" fill="${NODE}"/>\n`;
    body += `  <text x="${rx + barW / 2}" y="${plotB - rh - 5}" font-size="10" text-anchor="middle" fill="${FG}">${rust[i]}</text>\n`;
    body += `  <text x="${nx + barW / 2}" y="${plotB - nh - 5}" font-size="10" text-anchor="middle" fill="${FG}">${node[i]}</text>\n`;
    body += `  <text x="${cx}" y="${plotB + 18}" font-size="12" font-weight="600" text-anchor="middle" fill="${FG}">${lab}</text>\n`;
  });

  body += `  <line x1="${plotL}" y1="${plotB}" x2="${plotR}" y2="${plotB}" stroke="${MUTE}" stroke-width="1"/>\n`;
  return frame(w, h, "rload vs Node — latency percentiles", body);
}

const out = path.join(__dirname, "..", "assets");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "throughput.svg"), throughputChart());
fs.writeFileSync(path.join(out, "latency.svg"), latencyChart());
console.log("wrote assets/throughput.svg and assets/latency.svg");
