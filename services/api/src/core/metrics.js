// Prometheus metrics (D-99): request counts and latency per route, plus business gauges read at scrape time.
// Kept in memory per API process; DigitalOcean monitoring or any Prometheus scraper reads /metrics.

const BUCKETS_MS = [25, 50, 100, 200, 300, 500, 1000, 2500, 5000];

export function createMetrics() {
  const counts = new Map(); // `${method} ${route} ${status}` → n
  const hist = new Map(); // route → { buckets: number[], sum, count }
  return {
    /** Records one finished request. `route` is the route pattern (never the raw URL: no ids in labels). */
    observe(method, route, status, ms) {
      const key = `${method}\t${route}\t${status}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const h = hist.get(route) ?? { buckets: BUCKETS_MS.map(() => 0), sum: 0, count: 0 };
      BUCKETS_MS.forEach((b, i) => {
        if (ms <= b) h.buckets[i] += 1;
      });
      h.sum += ms;
      h.count += 1;
      hist.set(route, h);
    },
    /** Prometheus text exposition; `gauges` are [name, help, value] read from the database at scrape time. */
    render(gauges = []) {
      const esc = (v) => String(v).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
      const out = [
        '# HELP jamzo_http_requests_total HTTP requests by route and status',
        '# TYPE jamzo_http_requests_total counter',
      ];
      for (const [k, n] of counts) {
        const [method, route, status] = k.split('\t');
        out.push(
          `jamzo_http_requests_total{method="${esc(method)}",route="${esc(route)}",status="${status}"} ${n}`,
        );
      }
      out.push(
        '# HELP jamzo_http_request_duration_ms Request duration in milliseconds',
        '# TYPE jamzo_http_request_duration_ms histogram',
      );
      for (const [route, h] of hist) {
        BUCKETS_MS.forEach((b, i) =>
          out.push(`jamzo_http_request_duration_ms_bucket{route="${esc(route)}",le="${b}"} ${h.buckets[i]}`),
        );
        out.push(`jamzo_http_request_duration_ms_bucket{route="${esc(route)}",le="+Inf"} ${h.count}`);
        out.push(`jamzo_http_request_duration_ms_sum{route="${esc(route)}"} ${Math.round(h.sum)}`);
        out.push(`jamzo_http_request_duration_ms_count{route="${esc(route)}"} ${h.count}`);
      }
      for (const [name, help, value] of gauges)
        out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`);
      return out.join('\n') + '\n';
    },
  };
}
