interface ProxyStruct {
  address: string;
  port: number;
  country: string;
  org: string;
}

const INPUT_PROXY_FILE = `${import.meta.dir}/src/mazproxy.txt`;
const OUTPUT_PROXY_FILE = `${import.meta.dir}/src/mazcekproxy.txt`;

const CONCURRENCY = 99;
const CHECK_QUEUE: string[] = [];

const PRX_HEALTH_CHECK_API = "https://id1.foolvpn.me/api/v1/check";

async function readProxyList(): Promise<ProxyStruct[]> {
  const proxyList: ProxyStruct[] = [];
  const proxyListString = (await Bun.file(INPUT_PROXY_FILE).text()).split("\n");
  for (const proxy of proxyListString) {
    if (!proxy.trim()) continue;
    const [address, port, country, org] = proxy.split(",");
    proxyList.push({
      address,
      port: parseInt(port),
      country,
      org,
    });
  }
  return proxyList;
}

async function checkPrxHealth(prxIP: string, prxPort: number) {
  try {
    const req = await fetch(`${PRX_HEALTH_CHECK_API}?ip=${prxIP}:${prxPort}`);
    const data = await req.json();
    return data; // API sudah kasih "delay" & "message"
  } catch (err) {
    return { delay: 0, error: true, message: String(err) };
  }
}

(async () => {
  const proxyList = await readProxyList();
  const proxyChecked: string[] = [];
  const activeProxyList: string[] = [];

  let proxySaved = 0;

  for (let i = 0; i < proxyList.length; i++) {
    const proxy = proxyList[i];
    const proxyKey = `${proxy.address}:${proxy.port}`;

    if (proxyChecked.includes(proxyKey)) continue;
    proxyChecked.push(proxyKey);

    CHECK_QUEUE.push(proxyKey);
    checkPrxHealth(proxy.address, proxy.port)
      .then((health) => {
        if (health && health.delay && health.delay > 0 && !health.message) {
          activeProxyList.push(
            `${proxy.address},${proxy.port},${proxy.country},${proxy.org},${health.delay}`
          );

          proxySaved += 1;
          console.log(
            `[${i}/${proxyList.length}] ✅ Proxy aktif disimpan:`,
            proxySaved,
            `Delay: ${health.delay}ms`
          );
        } else {
          console.log(
            `[${i}/${proxyList.length}] ❌ Proxy dibuang (delay 0 / error: ${health.message || "unknown"})`
          );
        }
      })
      .finally(() => {
        CHECK_QUEUE.pop();
      });

    while (CHECK_QUEUE.length >= CONCURRENCY) {
      await Bun.sleep(1);
    }
  }

  while (CHECK_QUEUE.length) {
    await Bun.sleep(1);
  }

  // Urutkan berdasarkan delay (proxy tercepat di atas)
  activeProxyList.sort(sortByDelay);

  await Bun.write(OUTPUT_PROXY_FILE, activeProxyList.join("\n"));

  console.log(`Selesai! Total proxy aktif: ${proxySaved}`);
  process.exit(0);
})();

function sortByDelay(a: string, b: string) {
  const delayA = parseInt(a.split(",")[4] || "99999");
  const delayB = parseInt(b.split(",")[4] || "99999");
  return delayA - delayB;
}
