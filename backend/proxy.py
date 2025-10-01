import socket
import ssl
import json
import time

INPUT_PROXY_FILE = "backend/src/mazproxy.txt"
OUTPUT_PROXY_FILE = "backend/src/mazcekproxy.txt"

IP_RESOLVER = "speed.cloudflare.com"
PATH_RESOLVER = "/meta"
TIMEOUT = 5  # detik

def check(host, path, ip, port):
    start_time = time.time()
    payload = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}\r\n"
        "User-Agent: Mozilla/5.0\r\n"
        "Connection: close\r\n\r\n"
    )
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((ip, port), timeout=TIMEOUT) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as conn:
                conn.sendall(payload.encode())
                resp = b""
                while True:
                    data = conn.recv(4096)
                    if not data:
                        break
                    resp += data

        resp = resp.decode("utf-8", errors="ignore")
        body = resp.split("\r\n\r\n", 1)[1]
        end_time = time.time()
        delay = int((end_time - start_time) * 1000)

        try:
            return json.loads(body), delay
        except json.JSONDecodeError:
            return {"error": "JSON parse failed"}, 0

    except Exception as e:
        return {"error": str(e)}, 0

def read_proxy_list():
    proxies = []
    with open(INPUT_PROXY_FILE) as f:
        for line in f:
            if not line.strip():
                continue
            parts = line.strip().split(",")
            if len(parts) >= 2:
                ip, port = parts[0], int(parts[1])
                country = parts[2] if len(parts) > 2 else "Unknown"
                org = parts[3] if len(parts) > 3 else "Unknown"
                proxies.append((ip, port, country, org))
    return proxies

def main():
    ori, _ = check(IP_RESOLVER, PATH_RESOLVER, IP_RESOLVER, 443)
    if "clientIp" not in ori:
        print("❌ Tidak bisa resolve IP asli.")
        return

    all_active = []
    proxy_list = read_proxy_list()
    print(f"🔍 Mengecek {len(proxy_list)} proxy...\n")

    for idx, (ip, port, country, org) in enumerate(proxy_list, 1):
        meta, delay = check(IP_RESOLVER, PATH_RESOLVER, ip, port)
        if "clientIp" in meta and meta["clientIp"] != ori.get("clientIp"):
            asn = meta.get("asn", "Unknown")
            asOrganization = meta.get("asOrganization", "Unknown")
            colo = meta.get("colo", "Unknown")
            latitude = meta.get("latitude", "Unknown")
            longitude = meta.get("longitude", "Unknown")

            line = f"{ip},{port},{country},{org},{asn},{asOrganization},{colo},{latitude},{longitude},{delay}"
            all_active.append(line)

            print(f"[{idx}/{len(proxy_list)}] ✅ Alive {ip}:{port} {delay}ms {country} {asOrganization}")
        else:
            print(f"[{idx}/{len(proxy_list)}] ❌ Dead {ip}:{port}")

    # simpan hasil
    with open(OUTPUT_PROXY_FILE, "w") as out:
        out.write("\n".join(all_active))

    print(f"\nSelesai! Total proxy aktif: {len(all_active)} disimpan ke {OUTPUT_PROXY_FILE}")

if __name__ == "__main__":
    main()
