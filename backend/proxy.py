import requests
import json

INPUT_PROXY_FILE = "backend/src/mazproxy.txt"
OUTPUT_PROXY_FILE = "backend/src/mazcekproxy.txt"

API_URL = "https://check.mazlana.biz.id/api/v1"

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

def check_proxy(ip, port):
    try:
        resp = requests.get(API_URL, params={"ip": ip, "port": port}, timeout=10)
        if resp.status_code != 200:
            return {"error": f"HTTP {resp.status_code}"}
        return resp.json()
    except Exception as e:
        return {"error": str(e)}

def main():
    proxy_list = read_proxy_list()
    print(f"🔍 Mengecek {len(proxy_list)} proxy...\n")

    all_active = []
    for idx, (ip, port, country, org) in enumerate(proxy_list, 1):
        meta = check_proxy(ip, port)
        if meta and not meta.get("error") and meta.get("delay", 0) > 0:
            asn = meta.get("asn", "Unknown")
            asOrganization = meta.get("asOrganization", "Unknown")
            colo = meta.get("colo", "Unknown")
            latitude = meta.get("latitude", "Unknown")
            longitude = meta.get("longitude", "Unknown")
            delay = meta.get("delay", 0)

            line = f"{ip},{port},{country},{org},{asn},{asOrganization},{colo},{latitude},{longitude},{delay}"
            all_active.append(line)

            print(f"[{idx}/{len(proxy_list)}] ✅ Alive {ip}:{port} {delay}ms {country} {asOrganization}")
        else:
            print(f"[{idx}/{len(proxy_list)}] ❌ Dead {ip}:{port} ({meta.get('error') if meta else 'unknown'})")

    # simpan hasil
    with open(OUTPUT_PROXY_FILE, "w") as out:
        out.write("\n".join(all_active))

    print(f"\nSelesai! Total proxy aktif: {len(all_active)} disimpan ke {OUTPUT_PROXY_FILE}")

if __name__ == "__main__":
    main()
