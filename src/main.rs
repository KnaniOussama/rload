//! rload — a small, fast HTTP load testing CLI.
//!
//! Spins up N concurrent workers that hammer a URL either for a fixed number of
//! requests (`-n`) or a fixed duration (`-d`), then reports throughput, latency
//! percentiles, and a status-code breakdown.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use clap::Parser;
use hdrhistogram::Histogram;
use tokio::sync::Mutex;

/// A small, fast HTTP load tester.
#[derive(Parser, Debug)]
#[command(name = "rload", version, about)]
struct Args {
    /// Target URL, e.g. http://localhost:8080/
    url: String,

    /// Number of concurrent workers (connections in flight).
    #[arg(short = 'c', long, default_value_t = 50)]
    concurrency: usize,

    /// Total number of requests to send. Ignored if --duration is set.
    #[arg(short = 'n', long, default_value_t = 10_000)]
    requests: u64,

    /// Run for this many seconds instead of a fixed request count.
    #[arg(short = 'd', long)]
    duration: Option<u64>,

    /// HTTP method to use.
    #[arg(short = 'm', long, default_value = "GET")]
    method: String,

    /// Request timeout in seconds.
    #[arg(short = 't', long, default_value_t = 30)]
    timeout: u64,
}

/// Per-worker results, merged once all workers finish.
struct Stats {
    /// Latency histogram in microseconds.
    hist: Histogram<u64>,
    /// Count of responses per HTTP status code.
    statuses: BTreeMap<u16, u64>,
    /// Count of transport-level errors (timeouts, connection refused, ...).
    errors: u64,
    /// Total bytes read from response bodies.
    bytes: u64,
}

impl Stats {
    fn new() -> Self {
        Stats {
            // 1µs .. ~60s range, 3 significant figures.
            hist: Histogram::new_with_bounds(1, 60_000_000, 3).unwrap(),
            statuses: BTreeMap::new(),
            errors: 0,
            bytes: 0,
        }
    }

    fn merge(&mut self, other: Stats) {
        self.hist.add(other.hist).unwrap();
        for (k, v) in other.statuses {
            *self.statuses.entry(k).or_insert(0) += v;
        }
        self.errors += other.errors;
        self.bytes += other.bytes;
    }
}

#[tokio::main]
async fn main() {
    let args = Args::parse();

    let method = match args.method.to_uppercase().parse::<reqwest::Method>() {
        Ok(m) => m,
        Err(_) => {
            eprintln!("error: invalid HTTP method '{}'", args.method);
            std::process::exit(2);
        }
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(args.timeout))
        .pool_max_idle_per_host(args.concurrency)
        .build()
        .expect("failed to build HTTP client");

    // Shared, monotonic counter of issued requests for request-count mode.
    // Counting up (vs. down) avoids any underflow/wraparound race at the boundary.
    let issued = Arc::new(AtomicU64::new(0));
    let total_requests = args.requests;
    let deadline = args
        .duration
        .map(|secs| Instant::now() + Duration::from_secs(secs));

    println!(
        "Running {} against {} with {} workers...",
        match deadline {
            Some(_) => format!("{}s", args.duration.unwrap()),
            None => format!("{} requests", args.requests),
        },
        args.url,
        args.concurrency
    );

    let merged = Arc::new(Mutex::new(Stats::new()));
    let wall_start = Instant::now();

    let mut handles = Vec::with_capacity(args.concurrency);
    for _ in 0..args.concurrency {
        let client = client.clone();
        let url = args.url.clone();
        let method = method.clone();
        let issued = issued.clone();
        let merged = merged.clone();

        handles.push(tokio::spawn(async move {
            let mut local = Stats::new();

            loop {
                // Decide whether to keep going.
                match deadline {
                    Some(dl) => {
                        if Instant::now() >= dl {
                            break;
                        }
                    }
                    None => {
                        // Claim the next request slot; stop once the budget is used up.
                        if issued.fetch_add(1, Ordering::Relaxed) >= total_requests {
                            break;
                        }
                    }
                }

                let started = Instant::now();
                match client.request(method.clone(), &url).send().await {
                    Ok(resp) => {
                        let status = resp.status().as_u16();
                        match resp.bytes().await {
                            Ok(body) => {
                                let elapsed = started.elapsed().as_micros() as u64;
                                local.hist.record(elapsed.max(1)).ok();
                                local.bytes += body.len() as u64;
                                *local.statuses.entry(status).or_insert(0) += 1;
                            }
                            Err(_) => local.errors += 1,
                        }
                    }
                    Err(_) => local.errors += 1,
                }
            }

            merged.lock().await.merge(local);
        }));
    }

    for h in handles {
        let _ = h.await;
    }

    let wall = wall_start.elapsed();
    let stats = merged.lock().await;
    report(&stats, wall);
}

fn report(stats: &Stats, wall: Duration) {
    let total_ok: u64 = stats.statuses.values().sum();
    let total = total_ok + stats.errors;
    let secs = wall.as_secs_f64().max(1e-9);

    println!("\n--- results ---------------------------------------");
    println!("requests sent : {}", total);
    println!("succeeded     : {}", total_ok);
    println!("errors        : {}", stats.errors);
    println!("duration      : {:.3} s", secs);
    println!("throughput    : {:.0} req/s", total_ok as f64 / secs);
    println!(
        "data read     : {:.2} MB ({:.2} MB/s)",
        stats.bytes as f64 / 1e6,
        stats.bytes as f64 / 1e6 / secs
    );

    if total_ok > 0 {
        println!("\nlatency (ms):");
        println!("  min   {:>8.2}", us_to_ms(stats.hist.min()));
        println!("  mean  {:>8.2}", stats.hist.mean() / 1000.0);
        println!(
            "  p50   {:>8.2}",
            us_to_ms(stats.hist.value_at_quantile(0.50))
        );
        println!(
            "  p90   {:>8.2}",
            us_to_ms(stats.hist.value_at_quantile(0.90))
        );
        println!(
            "  p99   {:>8.2}",
            us_to_ms(stats.hist.value_at_quantile(0.99))
        );
        println!("  max   {:>8.2}", us_to_ms(stats.hist.max()));
    }

    if !stats.statuses.is_empty() {
        println!("\nstatus codes:");
        for (code, count) in &stats.statuses {
            println!("  {} : {}", code, count);
        }
    }
}

fn us_to_ms(us: u64) -> f64 {
    us as f64 / 1000.0
}
