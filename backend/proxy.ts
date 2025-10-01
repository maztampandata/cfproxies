const PRX_HEALTH_CHECK_API = "https://id1.foolvpn.me/api/v1/check";

async function checkPrxHealth(prxIP: string, prxPort: number) {
  try {
    const req = await fetch(`${PRX_HEALTH_CHECK_API}?ip=${prxIP}:${prxPort}`);
    const data = await req.json();
    return data; // pastikan API return { ping: number, ... }
  } catch (err) {
    return { ping: 0, error: true };
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
    checkProxy(proxy.address, proxy.port)
      .then(async (res) => {
        if (!res.error && res.result?.proxyip === true && res.result.country) {
          // 🔍 Health check tambahan
          const health = await checkPrxHealth(res.result.proxy, res.result.port);

          if (health && health.ping && health.ping > 0) {
            activeProxyList.push(
              `${res.result?.proxy},${res.result?.port},${res.result?.country},${res.result?.asOrganization},${health.ping}`
            );

            proxySaved += 1;
            console.log(
              `[${i}/${proxyList.length}] Proxy aktif disimpan:`,
              proxySaved,
              `Ping: ${health.ping}ms`
            );
          } else {
            console.log(
              `[${i}/${proxyList.length}] ❌ Proxy dibuang (ping 0/tidak valid)`
            );
          }
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

  activeProxyList.sort(sortByCountry);

  await Bun.write(OUTPUT_PROXY_FILE, activeProxyList.join("\n"));

  console.log(`Waktu proses: ${(Bun.nanoseconds() / 1000000000).toFixed(2)} detik`);
  process.exit(0);
})();
