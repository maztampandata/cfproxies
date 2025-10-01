import fs from "fs";

interface ProxyStruct {
  address: string;
  port: number;
  country: string;
  org: string;
}

interface ProxyTestResult {
  error: boolean;
  message?: string;
  result?: {
    proxy: string;
    proxyip: boolean;
    ip: string;
    port: number;
    delay: number;
    asOrganization: string;
  };
}

const API_CHECK = "https://check.mazlana.biz.id/api/v1";

const KV_PAIR_PROXY_FILE = "backend/src/maz.json";
const RAW_PROXY_LIST_FILE = "backend/src/mazproxy.txt";
const PROXY_LIST_FILE = "backend/src/mazcheckproxy.txt";

const CONCURRENCY = 50;
const CHECK_QUEUE: string[] = [];

/**
 * Cek proxy via API eksternal
 */
async function checkProxy(proxyAddress: string, proxyPort: number): Promise<ProxyTestResult> {
  try {
    const url = `${API_CHECK}?ip=${proxyAddress}&port=${proxyPort}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ProxyScanner/1.0" },
    });

    const data = await res.json();
    const msg = (data.message || "").toLowerCase();

    if (msg.includes("alive")) {
      return {
        error: false,
        result: {
          proxy: proxyAddress,
          port: proxyPort,
          proxyip: true,
          delay: data.delay || 0,
          ip: data.ip || proxyAddress,
          asOrganization: data.asOrganization && data.asOrganization !== "" ? data.asOrganization : "Unknown",
        },
      };
    } else {
      return { error: true, message: data.message || "Proxy failed" };
    }
  } catch (e: any) {
    return { error: true, message: e.message };
  }
}

/**
 * Baca file input daftar proxy
 */
async function readProxyList(): Promise<ProxyStruct[]> {
  const proxyList: ProxyStruct[] = [];
  const raw = fs.readFileSync(RAW_PROXY_LIST_FILE, "utf-8").split("\n");

  for (const line of raw) {
    if (!line.trim()) continue;
    const [address, port, country, org] = line.split(",");
    proxyList.push({
      address,
      port: parseInt(port),
      country: country && country.trim() !== "" ? country : "Unknown",
      org: org || "Unknown",
    });
  }
  return proxyList;
}

(async () => {
  // Hapus hasil lama dulu
  try {
    fs.unlinkSync(PROXY_LIST_FILE);
  } catch {}
  try {
    fs.unlinkSync(KV_PAIR_PROXY_FILE);
  } catch {}

  const proxyList = await readProxyList();
  console.log(`🔍 Total proxy yang akan dicek: ${proxyList.length}`);

  const proxyChecked: string[] = [];
  const activeProxyList: string[] = [];
  const kvPair: any = {};

  let proxySaved = 0;

  for (let i = 0; i < proxyList.length; i++) {
    const proxy = proxyList[i];
    const proxyKey = `${proxy.address}:${proxy.port}`;

    if (proxyChecked.includes(proxyKey)) continue;
    proxyChecked.push(proxyKey);

    CHECK_QUEUE.push(proxyKey);
    checkProxy(proxy.address, proxy.port)
      .then((res) => {
        if (!res.error && res.result?.proxyip) {
          const country = proxy.country; // ✅ negara dari input file
          const org = res.result?.asOrganization || proxy.org;

          activeProxyList.push(
            `${res.result.proxy},${res.result.port},${country},${org},${res.result.delay}`
          );

          if (!kvPair[country]) kvPair[country] = [];
          if (kvPair[country].length < 10) {
            kvPair[country].push(`${res.result.proxy}:${res.result.port}`);
          }

          proxySaved++;
          console.log(
            `[${i + 1}/${proxyList.length}] ✅ Alive ${proxyKey} (${res.result.delay} ms, ${country})`
          );
        } else {
          console.log(
            `[${i + 1}/${proxyList.length}] ❌ Dead ${proxyKey} (${res.message || "unknown"})`
          );
        }
      })
      .catch((err) => {
        console.error(`[${i + 1}/${proxyList.length}] ❌ Error ${proxyKey}: ${err.message}`);
      })
      .finally(() => {
        CHECK_QUEUE.pop();
      });

    // 🔽 Delay kecil antar request
    await new Promise((r) => setTimeout(r, 50));

    while (CHECK_QUEUE.length >= CONCURRENCY) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // Tunggu semua selesai
  while (CHECK_QUEUE.length) {
    await new Promise((r) => setTimeout(r, 100));
  }

  // Urutkan hasil
  activeProxyList.sort(sortByCountry);

  fs.writeFileSync(PROXY_LIST_FILE, activeProxyList.join("\n"));
  fs.writeFileSync(KV_PAIR_PROXY_FILE, JSON.stringify(kvPair, null, 2));

  console.log(`\n🎉 Selesai! Proxy aktif: ${proxySaved}/${proxyList.length}`);
  process.exit(0);
})();

function sortByCountry(a: string, b: string) {
  const ca = a.split(",")[2];
  const cb = b.split(",")[2];
  return ca.localeCompare(cb);
}
