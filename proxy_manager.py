#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Proxy Manager & Scraper for Flight Tracker
- Tự động cào proxy miễn phí từ các nguồn uy tín (GitHub monosans, TheSpeedX, ProxyScrape, Geonode)
- Kiểm tra tính sống/chết (liveness check) đa luồng siêu tốc
- Hỗ trợ cả Proxy miễn phí (Auto Scrape) và Proxy riêng (Custom/Residential Proxy)
- Tích hợp chuẩn vào Playwright để cào Traveloka
"""

import os
import sys
import io
import re
import json
import time

# Fix Windows console encoding
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

PROXY_SOURCES = [
    # monosans/proxy-list (Cập nhật liên tục mỗi giờ)
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    # TheSpeedX/SOCKS-List
    "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt",
    # ProxyScrape Elite HTTP
    "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=yes&anonymity=elite",
    # OpenProxyList HTTPS
    "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt"
]

CHECK_TARGETS = [
    "https://api.ipify.org?format=json",
    "https://httpbin.org/ip",
    "https://icanhazip.com"
]

def fetch_free_proxies(max_candidates: int = 150) -> list:
    """Cào danh sách proxy thô từ các nguồn mở trên GitHub / API"""
    raw_proxies = set()
    print("[*] Đang cào danh sách proxy miễn phí từ các nguồn mở...")
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    }
    
    for url in PROXY_SOURCES:
        try:
            r = requests.get(url, headers=headers, timeout=6)
            if r.status_code == 200:
                lines = r.text.splitlines()
                valid_count = 0
                for line in lines:
                    line = line.strip()
                    # Match ip:port
                    if re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}$", line):
                        raw_proxies.add(line)
                        valid_count += 1
                # print(f"  [+] {url[:45]}... -> {valid_count} proxies")
        except Exception:
            pass

        if len(raw_proxies) >= max_candidates * 2:
            break

    candidates = list(raw_proxies)[:max_candidates]
    print(f"[✔] Đã thu thập được {len(candidates)} proxy tiềm năng.")
    return candidates

def check_single_proxy(proxy_str: str, timeout: int = 3) -> dict:
    """Kiểm tra độ trễ và tính sống còn của một proxy"""
    if "://" not in proxy_str:
        proxy_url = f"http://{proxy_str}"
    else:
        proxy_url = proxy_str

    proxies = {
        "http": proxy_url,
        "https": proxy_url
    }
    
    t0 = time.time()
    try:
        r = requests.get(CHECK_TARGETS[0], proxies=proxies, timeout=timeout)
        latency = round((time.time() - t0) * 1000)
        if r.status_code == 200:
            return {
                "server": proxy_url,
                "latency_ms": latency,
                "alive": True
            }
    except Exception:
        pass
    return {"server": proxy_url, "alive": False}

def get_working_proxies(max_working: int = 10, check_limit: int = 60, timeout: int = 3) -> list:
    """Lọc và trả về danh sách proxy hoạt động tốt nhất, sắp xếp theo độ trễ"""
    candidates = fetch_free_proxies(max_candidates=check_limit)
    if not candidates:
        return []

    print(f"[*] Đang kiểm tra liveness đa luồng ({len(candidates)} proxy, timeout {timeout}s)...")
    working = []

    with ThreadPoolExecutor(max_workers=25) as executor:
        futures = {executor.submit(check_single_proxy, p, timeout): p for p in candidates}
        for future in as_completed(futures):
            res = future.result()
            if res.get("alive"):
                working.append(res)
                if len(working) >= max_working:
                    break

    working.sort(key=lambda x: x["latency_ms"])
    print(f"[✔] Tìm thấy {len(working)} proxy sống hoạt động tốt!")
    for idx, w in enumerate(working[:5]):
        print(f"    #{idx+1}: {w['server']} (Ping: {w['latency_ms']}ms)")
    return working

def get_proxy_for_playwright(cfg: dict) -> dict:
    """
    Trả về cấu hình proxy chuẩn cho Playwright browser context:
    {"server": "http://ip:port", "username": "...", "password": "..."}
    """
    proxy_cfg = cfg.get("proxy", {})
    if not proxy_cfg.get("enabled", False):
        return None

    mode = proxy_cfg.get("mode", "auto").lower()

    # 1. Custom proxy (người dùng tự cấp proxy riêng, residential proxy...)
    custom_proxy = os.getenv("CUSTOM_PROXY") or proxy_cfg.get("custom_proxy", "")
    if custom_proxy and (mode == "custom" or not mode):
        print(f"[*] Sử dụng Custom Proxy từ cấu hình: {custom_proxy.split('@')[-1]}")
        return parse_playwright_proxy(custom_proxy)

    # 2. Auto scrape free proxy
    working = get_working_proxies(max_working=3, check_limit=50, timeout=proxy_cfg.get("timeout", 3))
    if working:
        best_proxy = working[0]["server"]
        print(f"[*] Đã chọn proxy tự động tốt nhất: {best_proxy} ({working[0]['latency_ms']}ms)")
        return parse_playwright_proxy(best_proxy)

    print("[!] Không tìm thấy proxy miễn phí nào hoạt động ổn định. Bỏ qua proxy.")
    return None

def parse_playwright_proxy(proxy_str: str) -> dict:
    """Phân tích chuỗi proxy (bao gồm user:pass@ip:port nếu có) thành dict Playwright"""
    clean = proxy_str.strip()
    # If contains authentication: http://user:pass@ip:port
    auth_match = re.search(r"://([^:@]+):([^@]+)@([^:]+:\d+)", clean)
    if auth_match:
        user, pwd, host_port = auth_match.groups()
        protocol = clean.split("://")[0]
        return {
            "server": f"{protocol}://{host_port}",
            "username": user,
            "password": pwd
        }
    
    if "://" not in clean:
        clean = f"http://{clean}"
    return {"server": clean}

if __name__ == "__main__":
    print("=== TEST PROXY MANAGER ===")
    proxies = get_working_proxies(max_working=5, check_limit=40, timeout=3)
    if proxies:
        print("\nPlaywright Config format:")
        pw_config = parse_playwright_proxy(proxies[0]["server"])
        print(json.dumps(pw_config, indent=2))
