import tls from "tls";

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

// 🔑 Input & Output
const INPUT_PROXY_FILE = "/src/mazproxy.txt";     // input list
const OUTPUT_PROXY_FILE = "/src/mazcekproxy.txt"; // hasil aktif

const IP_RESOLVER_DOMAIN = "myip.ipeek.workers.dev";
const IP_RESOLVER_PATH = "/";
const CONCURRENCY = 99;

const CHECK_QUEUE: string[] = [];

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
      .then((res) => {
        if (!res.error && res.result?.proxyip === true && res.result.country) {
          activeProxyList.push(
            `${res.result?.proxy},${res.result?.port},${res.result?.country},${res.result?.asOrganization}`
          );

          proxySaved += 1;
          console.log(`[${i}/${proxyList.length}] Proxy aktif disimpan:`, proxySaved);
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

function sortByCountry(a: string, b: string) {
  a = a.split(",")[2];
  b = b.split(",")[2];
  return a.localeCompare(b);
}
