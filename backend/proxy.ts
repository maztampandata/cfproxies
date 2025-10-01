import tls from "tls";
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
    country: string;
    asOrganization: string;
  };
}

let myGeoIpString: any = null;

const KV_PAIR_PROXY_FILE = "backend/src/maz.json";
const RAW_PROXY_LIST_FILE = "backend/src/mazproxy.txt";
const PROXY_LIST_FILE = "backend/src/mazcheckproxy.txt";
const IP_RESOLVER_DOMAIN = "myip.ipeek.workers.dev";
const IP_RESOLVER_PATH = "/";
const CONCURRENCY = 99;

const CHECK_QUEUE: string[] = [];

/**
 * Kirim request TLS ke target
 */
async function sendRequest(host: string, path: string, proxy: any = null) {
  return new Promise((resolve, reject) => {
    const options = {
      host: proxy ? proxy.host : host,
      port: proxy ? proxy.port : 443,
      servername: host,
    };

    const socket = tls.connect(options, () => {
      const request =
        `GET ${path} HTTP/1.1\r\n` +
        `Host: ${host}\r\n` +
        `User-Agent: Mozilla/5.0\r\n` +
        `Connection: close\r\n\r\n`;
      socket.write(request);
    });

    let responseBody = "";

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("socket timeout"));
    }, 5000);

    socket.on("data", (data) => (responseBody += data.toString()));
    socket.on("end", () => {
      clearTimeout(timeout);
      const body = responseBody.split("\r\n\r\n")[1] || "";
      resolve(body);
    });
    socket.on("error", (error) => {
      reject(error);
    });
  });
}

/**
 * Cek apakah proxy aktif
 */
export async function checkProxy(proxyAddress: string, proxyPort: number): Promise<ProxyTestResult> {
  let result: ProxyTestResult = {
    message: "Unknown error",
    error: true,
  };

  const proxyInfo = { host: proxyAddress, port: proxyPort };

  try {
    const start = new Date().getTime();
    const [ipinfo, myip] = await Promise.all([
      sendRequest(IP_RESOLVER_DOMAIN, IP_RESOLVER_PATH, proxyInfo),
      myGeoIpString == null ? sendRequest(IP_RESOLVER_DOMAIN, IP_RESOLVER_PATH, null) : myGeoIpString,
    ]);
    const finish = new Date().getTime();

    if (myGeoIpString == null) myGeoIpString = myip;

    const parsedIpInfo = JSON.parse(ipinfo as string);
    const parsedMyIp = JSON.parse(myip as string);

    if (parsedIpInfo.ip && parsedIpInfo.ip !== parsedMyIp.ip) {
      result = {
        error: false,
        result: {
          proxy: proxyAddress,
          port: proxyPort,
          proxyip: true,
          delay: finish - start,
          ...parsedIpInfo,
        },
      };
    }
  } catch (error: any) {
    result.message = error.message;
  }

  return result;
}

/**
 * Baca list proxy dari file txt
 */
async function readProxyList(): Promise<ProxyStruct[]> {
  const proxyList: ProxyStruct[] = [];
  const proxyListString = fs.readFileSync(RAW_PROXY_LIST_FILE, "utf-8").split("\n");

  for (const proxy of proxyListString) {
    if (!proxy.trim()) continue;
    const [address, port, country, org] = proxy.split(",");
    proxyList.push({
      address,
      port: parseInt(port),
      country: country || "Unknown",
      org: org || "Unknown",
    });
  }

  return proxyList;
}

(async () => {
  const proxyList = await readProxyList();
  console.log(`🔍 Total proxy yang akan dicek: ${proxyList.length}`);

  const proxyChecked: string[] = [];
  const uniqueRawProxies: string[] = [];
  const activeProxyList: string[] = [];
  const kvPair: any = {};

  let proxySaved = 0;

  for (let i = 0; i < proxyList.length; i++) {
    const proxy = proxyList[i];
    const proxyKey = `${proxy.address}:${proxy.port}`;

    if (!proxyChecked.includes(proxyKey)) {
      proxyChecked.push(proxyKey);
      try {
        uniqueRawProxies.push(
          `${proxy.address},${proxy.port},${proxy.country},${proxy.org.replaceAll(/[+]/g, " ")}`
        );
      } catch {
        continue;
      }
    } else {
      continue;
    }

    CHECK_QUEUE.push(proxyKey);
    checkProxy(proxy.address, proxy.port)
      .then((res) => {
        if (!res.error && res.result?.proxyip === true && res.result.country) {
          activeProxyList.push(
            `${res.result?.proxy},${res.result?.port},${res.result?.country},${res.result?.asOrganization}`
          );

          if (kvPair[res.result.country] == undefined) kvPair[res.result.country] = [];
          if (kvPair[res.result.country].length < 10) {
            kvPair[res.result.country].push(`${res.result.proxy}:${res.result.port}`);
          }

          proxySaved += 1;
          console.log(`[${i + 1}/${proxyList.length}] ✅ Alive: ${proxyKey} (${res.result.delay}ms)`);
          process.stdout.write(""); // flush biar muncul di Actions
        } else {
          console.log(
            `[${i + 1}/${proxyList.length}] ❌ Dead: ${proxyKey} (${res.message || "unknown"})`
          );
          process.stdout.write("");
        }
      })
      .finally(() => {
        CHECK_QUEUE.pop();
      });

    while (CHECK_QUEUE.length >= CONCURRENCY) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  while (CHECK_QUEUE.length) {
    await new Promise((r) => setTimeout(r, 100));
  }

  uniqueRawProxies.sort(sortByCountry);
  activeProxyList.sort(sortByCountry);

  fs.writeFileSync(KV_PAIR_PROXY_FILE, JSON.stringify(kvPair, null, 2));
  fs.writeFileSync(RAW_PROXY_LIST_FILE, uniqueRawProxies.join("\n"));
  fs.writeFileSync(PROXY_LIST_FILE, activeProxyList.join("\n"));

  console.log(`\n🎉 Selesai! Proxy aktif: ${proxySaved}/${proxyList.length}`);
  process.exit(0);
})();

function sortByCountry(a: string, b: string) {
  const ca = a.split(",")[2];
  const cb = b.split(",")[2];
  return ca.localeCompare(cb);
}
