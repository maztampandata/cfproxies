// backend/proxy.js
import fs from "fs/promises";

// File input/output
const INPUT_PROXY_FILE = "backend/src/mazproxy.txt";
const OUTPUT_PROXY_FILE = "backend/src/mazcekproxy.txt";

const API_URL = "https://check.mazlana.biz.id/api/v1";
const CONCURRENCY = 50; // jumlah max request bersamaan

// Baca list proxy
async function readProxyList() {
  const proxies = [];
  const text = await fs.readFile(INPUT_PROXY_FILE, "utf-8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.trim().split(",");
    if (parts.length >= 2) {
      const ip = parts[0];
      const port = parseInt(parts[1]);
      const country = parts[2] || "Unknown";
      const org = parts[3] || "Unknown";
      proxies.push({ ip, port, country, org });
    }
  }
  return proxies;
}

// Call API health check
async function checkProxy(ip, port) {
  try {
    const url = `${API_URL}?ip=${encodeURIComponent(ip)}&port=${port}`;
    const resp = await fetch(url, { timeout: 10000 });
    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` };
    }
    return await resp.json();
  } catch (err) {
    return { error: String(err) };
  }
}

// Batasi concurrency (parallel check)
async function mapLimit(items, limit, fn) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(worker));
  return results;
}

async function main() {
  const proxyList = await readProxyList();
  console.log(`🔍 Mengecek ${proxyList.length} proxy...\n`);

  const results = await mapLimit(proxyList, CONCURRENCY, async (proxy, i) => {
    const meta = await checkProxy(proxy.ip, proxy.port);

    if (meta && !meta.error && meta.delay && meta.delay > 0) {
      const line = [
        proxy.ip,
        proxy.port,
        proxy.country,
        proxy.org,
        meta.asn || "Unknown",
        meta.asOrganization || "Unknown",
        meta.colo || "Unknown",
        meta.latitude || "Unknown",
        meta.longitude || "Unknown",
        meta.delay || 0,
      ].join(",");

      console.log(
        `[${i + 1}/${proxyList.length}] ✅ Alive ${proxy.ip}:${proxy.port} ${meta.delay}ms ${proxy.country} ${meta.asOrganization}`
      );
      return line;
    } else {
      console.log(
        `[${i + 1}/${proxyList.length}] ❌ Dead ${proxy.ip}:${proxy.port} (${meta?.error || "unknown"})`
      );
      return null;
    }
  });

  const active = results.filter(Boolean);
  await fs.writeFile(OUTPUT_PROXY_FILE, active.join("\n"), "utf-8");

  console.log(`\nSelesai! Total proxy aktif: ${active.length} disimpan ke ${OUTPUT_PROXY_FILE}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
