// Reference HTTP load tester in Node.js — a fair, idiomatic async implementation
// used as the baseline to compare against the Rust `rload` tool.
//
// Usage: node bench/node-load.js <url> -c <concurrency> -n <requests>
const http = require("http");
const { URL } = require("url");

function parseArgs(argv) {
  const args = { concurrency: 50, requests: 10000, url: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-c") args.concurrency = Number(argv[++i]);
    else if (a === "-n") args.requests = Number(argv[++i]);
    else if (!args.url) args.url = a;
  }
  if (!args.url) {
    console.error("usage: node node-load.js <url> -c <conc> -n <reqs>");
    process.exit(2);
  }
  return args;
}

// Keep-alive agent so we reuse sockets, matching how rload pools connections.
const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });

function request(target) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const req = http.get(
      { ...target, agent },
      (res) => {
        let bytes = 0;
        res.on("data", (d) => (bytes += d.length));
        res.on("end", () => {
          const us = Number(process.hrtime.bigint() - start) / 1000;
          resolve({ status: res.statusCode, us, bytes, error: false });
        });
      }
    );
    req.on("error", () => resolve({ error: true }));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const u = new URL(args.url);
  const target = {
    hostname: u.hostname,
    port: u.port || 80,
    path: u.pathname + u.search,
  };

  console.log(
    `Running ${args.requests} requests against ${args.url} with ${args.concurrency} workers...`
  );

  let remaining = args.requests;
  const latencies = [];
  const statuses = new Map();
  let errors = 0;
  let bytes = 0;

  const wallStart = process.hrtime.bigint();

  async function worker() {
    while (remaining > 0) {
      remaining--;
      const r = await request(target);
      if (r.error) {
        errors++;
      } else {
        latencies.push(r.us);
        bytes += r.bytes;
        statuses.set(r.status, (statuses.get(r.status) || 0) + 1);
      }
    }
  }

  await Promise.all(
    Array.from({ length: args.concurrency }, () => worker())
  );

  const secs = Number(process.hrtime.bigint() - wallStart) / 1e9;
  report({ latencies, statuses, errors, bytes, secs });
}

function pct(sorted, q) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx] / 1000; // us -> ms
}

function report({ latencies, statuses, errors, bytes, secs }) {
  latencies.sort((a, b) => a - b);
  const ok = latencies.length;
  const mean = ok ? latencies.reduce((a, b) => a + b, 0) / ok / 1000 : 0;

  console.log("\n--- results ---------------------------------------");
  console.log(`requests sent : ${ok + errors}`);
  console.log(`succeeded     : ${ok}`);
  console.log(`errors        : ${errors}`);
  console.log(`duration      : ${secs.toFixed(3)} s`);
  console.log(`throughput    : ${Math.round(ok / secs)} req/s`);
  console.log(
    `data read     : ${(bytes / 1e6).toFixed(2)} MB (${(bytes / 1e6 / secs).toFixed(2)} MB/s)`
  );
  if (ok > 0) {
    console.log("\nlatency (ms):");
    console.log(`  min   ${(latencies[0] / 1000).toFixed(2)}`);
    console.log(`  mean  ${mean.toFixed(2)}`);
    console.log(`  p50   ${pct(latencies, 0.5).toFixed(2)}`);
    console.log(`  p90   ${pct(latencies, 0.9).toFixed(2)}`);
    console.log(`  p99   ${pct(latencies, 0.99).toFixed(2)}`);
    console.log(`  max   ${(latencies[latencies.length - 1] / 1000).toFixed(2)}`);
  }
  if (statuses.size > 0) {
    console.log("\nstatus codes:");
    for (const [code, count] of [...statuses.entries()].sort()) {
      console.log(`  ${code} : ${count}`);
    }
  }
}

main();
