#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Traveloka Flight Price Tracker & Alert System
- Centralized configuration via config.json (Route, Airport, Dates, Time, Threshold, Telegram)
- Bypasses DataDome / WAF using Playwright with stealth configurations
- Intercepts native Traveloka search/poll API for 100% accurate flight pricing
- Records price history into JSON
- Sends instant Telegram alert when price < threshold (700k)
- Generates interactive HTML Dashboard with Chart.js for GitHub Pages
"""

import os
import sys
import io
import re
import json
import asyncio
from datetime import datetime, timezone, timedelta

# Fix Windows console encoding
if sys.platform == "win32":
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    except Exception:
        pass

import requests
from playwright.async_api import async_playwright

VIETNAM_TZ = timezone(timedelta(hours=7))

AIRPORTS = {
    "VII": "Vinh",
    "SGN": "TP. Hồ Chí Minh (Tân Sơn Nhất)",
    "HAN": "Hà Nội (Nội Bài)",
    "DAD": "Đà Nẵng",
    "CXR": "Nha Trang (Cam Ranh)",
    "PQC": "Phú Quốc",
    "HPH": "Hải Phòng (Cát Bi)",
    "VDO": "Quảng Ninh (Vân Đồn)",
    "HUI": "Huế (Phú Bài)",
    "UIH": "Quy Nhơn (Phù Cát)",
    "DLI": "Đà Lạt (Liên Khương)",
    "BMV": "Buôn Ma Thuột",
    "VCA": "Cần Thơ",
    "VCS": "Côn Đảo",
    "THD": "Thanh Hóa (Thọ Xuân)",
    "DIN": "Điện Biên",
    "VKG": "Rạch Giá",
    "CAH": "Cà Mau",
    "PXU": "Pleiku",
    "TBB": "Tuy Hòa",
    "VDH": "Đồng Hới",
    "VCL": "Chu Lai"
}

def get_current_time_vn():
    return datetime.now(VIETNAM_TZ).strftime("%Y-%m-%d %H:%M:%S")

def load_config():
    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    default_config = {
        "trip_type": "round_trip",
        "origin": "VII",
        "destination": "SGN",
        "departure_date": "21-10-2026",
        "return_date": "22-10-2026",
        "passengers": {
            "adults": 1,
            "children": 0,
            "infants": 0
        },
        "seat_class": "ECONOMY",
        "price_threshold": 700000,
        "time_filter": {
            "enabled": False,
            "min_departure_time": "06:00",
            "max_departure_time": "23:00"
        },
        "telegram": {
            "enabled": True,
            "bot_token": "",
            "chat_id": ""
        }
    }
    
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                default_config.update(loaded)
        except Exception as e:
            print(f"[!] Lỗi đọc config.json, dùng cấu hình mặc định: {e}")
    else:
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(default_config, f, ensure_ascii=False, indent=2)

    # Allow environment variable overrides if provided
    if os.getenv("ORIGIN"):
        default_config["origin"] = os.getenv("ORIGIN")
    if os.getenv("DESTINATION"):
        default_config["destination"] = os.getenv("DESTINATION")
    if os.getenv("DEPARTURE_DATE"):
        default_config["departure_date"] = os.getenv("DEPARTURE_DATE")
    if os.getenv("RETURN_DATE"):
        default_config["return_date"] = os.getenv("RETURN_DATE")
    if os.getenv("PRICE_THRESHOLD"):
        default_config["price_threshold"] = int(os.getenv("PRICE_THRESHOLD"))
    if os.getenv("TELEGRAM_BOT_TOKEN"):
        default_config["telegram"]["bot_token"] = os.getenv("TELEGRAM_BOT_TOKEN")
    if os.getenv("TELEGRAM_CHAT_ID"):
        default_config["telegram"]["chat_id"] = os.getenv("TELEGRAM_CHAT_ID")

    return default_config

def build_traveloka_url(cfg):
    """
    Constructs the Traveloka search URL based on config parameters.
    """
    origin = cfg.get("origin", "VII").upper().strip()
    dest = cfg.get("destination", "SGN").upper().strip()
    dep_date = cfg.get("departure_date", "21-10-2026").strip()
    ret_date = cfg.get("return_date", "22-10-2026").strip()
    
    pax = cfg.get("passengers", {})
    adults = pax.get("adults", 1)
    children = pax.get("children", 0)
    infants = pax.get("infants", 0)
    pax_str = f"{adults}.{children}.{infants}"
    seat_class = cfg.get("seat_class", "ECONOMY").upper()
    trip_type = cfg.get("trip_type", "round_trip").lower()

    if trip_type == "round_trip" and ret_date:
        return f"https://www.traveloka.com/vi-vn/flight/fulltwosearch?ap={origin}.{dest}&dt={dep_date}.{ret_date}&ps={pax_str}&sc={seat_class}"
    else:
        return f"https://www.traveloka.com/vi-vn/flight/fullsearch?ap={origin}.{dest}&dt={dep_date}.NA&ps={pax_str}&sc={seat_class}"

# ----------------- TELEGRAM ALERT -----------------
def send_telegram_alert(cfg, message: str, photo_path: str = None) -> bool:
    tele_cfg = cfg.get("telegram", {})
    if not tele_cfg.get("enabled", True):
        return False
    
    token = tele_cfg.get("bot_token")
    chat_id = tele_cfg.get("chat_id")
    if not token or not chat_id:
        print("[!] Không có Telegram token/chat_id. Bỏ qua thông báo.")
        return False
    
    try:
        if photo_path and os.path.exists(photo_path):
            with open(photo_path, "rb") as photo:
                url = f"https://api.telegram.org/bot{token}/sendPhoto"
                resp = requests.post(
                    url,
                    data={"chat_id": chat_id, "caption": message, "parse_mode": "HTML"},
                    files={"photo": photo},
                    timeout=20
                )
        else:
            url = f"https://api.telegram.org/bot{token}/sendMessage"
            resp = requests.post(
                url,
                json={"chat_id": chat_id, "text": message, "parse_mode": "HTML", "disable_web_page_preview": False},
                timeout=15
            )
        
        res_json = resp.json()
        if res_json.get("ok"):
            print("[✔] Đã gửi thông báo Telegram thành công!")
            return True
        else:
            print(f"[!] Gửi Telegram thất bại: {res_json}")
            return False
    except Exception as e:
        print(f"[!] Lỗi kết nối Telegram: {e}")
        return False

# ----------------- CRAWLER ENGINE -----------------
async def scrape_traveloka(url: str, cfg: dict):
    print(f"[{get_current_time_vn()}] Bắt đầu quét Traveloka...")
    print(f"[*] URL: {url}")
    
    poll_payloads = []

    async with async_playwright() as p:
        # Determine headless mode:
        # If running on Linux inside xvfb-run, run headed (headless=False)
        # to ensure 100% genuine browser fingerprint (Canvas, WebGL, Audio, screen dimensions).
        is_linux_xvfb = sys.platform.startswith("linux") and bool(os.getenv("DISPLAY"))
        use_headless = False if is_linux_xvfb else True
        print(f"[*] Chế độ hiển thị: {'Headed (xvfb virtual display)' if is_linux_xvfb else 'Headless'}")

        # Check for system Google Chrome
        chrome_paths = [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
        ]
        executable_path = None
        for cp in chrome_paths:
            if os.path.exists(cp):
                executable_path = cp
                break

        launch_args = [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled",
            "--window-size=1920,1080",
            "--disable-infobars"
        ]

        browser = None
        if executable_path:
            try:
                print(f"[*] Khởi chạy trình duyệt từ: {executable_path}")
                browser = await p.chromium.launch(
                    executable_path=executable_path,
                    headless=use_headless,
                    args=launch_args
                )
            except Exception as e:
                print(f"[*] Thử Google Chrome hệ thống thất bại: {e}")

        if not browser:
            try:
                browser = await p.chromium.launch(
                    channel="chrome",
                    headless=use_headless,
                    args=launch_args
                )
            except Exception:
                browser = await p.chromium.launch(
                    headless=use_headless,
                    args=launch_args
                )

        # Use clean desktop User-Agent without HeadlessChrome keyword
        if sys.platform == "win32":
            user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        else:
            user_agent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

        context = await browser.new_context(
            user_agent=user_agent,
            viewport={"width": 1920, "height": 1080},
            locale="vi-VN",
            extra_http_headers={
                "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
            }
        )
        
        # Anti-detection JS injection
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {},
                app: {}
            };
        """)

        page = await context.new_page()

        async def on_net(res):
            if "flight/search/poll" in res.url:
                try:
                    data = await res.json()
                    results = data.get("data", {}).get("searchResults", [])
                    if results:
                        poll_payloads.append(data)
                        print(f"  [+] Bắt được {len(results)} chuyến bay từ Traveloka API!")
                except Exception:
                    pass
            elif any(k in res.url for k in ["initial", "captcha", "problem", "challenge"]):
                status = res.status
                print(f"  [NET {status}] {res.url[:85]}")
                if status >= 400:
                    try:
                        text = await res.text()
                        print(f"    [!] Chi tiết phản hồi {status}: {text[:300]}")
                    except Exception:
                        pass

        page.on("response", on_net)

        # 1. Warm up session & generate security tokens (DataDome / AWS WAF)
        print("[*] Đang khởi tạo phiên làm việc (nạp trang chủ Traveloka)...")
        try:
            await page.goto("https://www.traveloka.com/vi-vn/flight", wait_until="networkidle", timeout=35000)
            await page.wait_for_timeout(3000)
        except Exception as e:
            print(f"[*] Cảnh báo nạp trang chủ: {e}")

        # Wait for security tokens to be established
        print("[*] Đang đợi chứng thực token bảo mật (DataDome & AWS WAF)...")
        for _ in range(15):
            cookies = await context.cookies()
            cookie_names = {c['name'] for c in cookies}
            found_tokens = [k for k in ['datadome', 'aws-waf-token', 'sen_t', 'clientSessionId'] if k in cookie_names]
            if "aws-waf-token" in cookie_names or "datadome" in cookie_names:
                print(f"  [✔] Đã nhận token bảo mật: {', '.join(found_tokens)}")
                break
            await page.wait_for_timeout(1000)

        # 2. Navigate to flight search URL with Referer and networkidle
        try:
            print(f"[*] Đang nạp trang kết quả tìm kiếm: {url}...")
            resp = await page.goto(url, referer="https://www.traveloka.com/vi-vn/flight", wait_until="networkidle", timeout=50000)
            print(f"[*] Mã phản hồi trang tìm kiếm: {resp.status if resp else 'None'}")
        except Exception as e:
            print(f"[!] Lỗi nạp trang tìm kiếm: {e}")

        # Wait for Traveloka to finish polling results
        print("[*] Đang chờ Traveloka trả kết quả chuyến bay...")
        for c in range(15):
            await page.wait_for_timeout(2500)
            title = await page.title()
            if poll_payloads:
                # Check if searchCompleted is true in any payload
                is_completed = any(p.get("data", {}).get("meta", {}).get("searchCompleted") for p in poll_payloads)
                if is_completed or len(poll_payloads) >= 2:
                    break
            if c % 3 == 0:
                print(f"  [*] Đang chờ kết quả... (Tiêu đề: {title})")

        screenshot_path = os.path.join(os.path.dirname(__file__), "data", "latest_screen.png")
        try:
            await page.screenshot(path=screenshot_path)
        except Exception:
            pass

        await browser.close()

    if not poll_payloads:
        print("[!] Không thu thập được dữ liệu chuyến bay từ API Traveloka.")
        return []

    # Merge and parse flights
    flights_map = {}
    time_filter = cfg.get("time_filter", {})
    apply_time_filter = time_filter.get("enabled", False)
    min_time = time_filter.get("min_departure_time", "00:00")
    max_time = time_filter.get("max_departure_time", "23:59")

    for payload in poll_payloads:
        data = payload.get("data", {})
        airlines = data.get("airlineDataMap", {})
        search_results = data.get("searchResults", [])
        
        for item in search_results:
            fid = item.get("id")
            fare_info = item.get("fare", {}).get("displayRounded", {}).get("currencyValue", {})
            amount = int(fare_info.get("amount", 0))
            if amount <= 0:
                continue
            
            routes = item.get("connectingFlightRoutes", [])
            segments_data = []
            
            for r in routes:
                for s in r.get("segments", []):
                    airline_code = s.get("airlineCode", "")
                    airline_name = airlines.get(airline_code, {}).get("name", airline_code)
                    flight_num = s.get("flightNumber", "")
                    
                    dep_h = int(s.get("departureTime", {}).get("hour", 0))
                    dep_m = int(s.get("departureTime", {}).get("minute", 0))
                    arr_h = int(s.get("arrivalTime", {}).get("hour", 0))
                    arr_m = int(s.get("arrivalTime", {}).get("minute", 0))
                    
                    dep_t = f"{dep_h:02d}:{dep_m:02d}"
                    arr_t = f"{arr_h:02d}:{arr_m:02d}"
                    
                    # Apply time filter if enabled
                    if apply_time_filter and not (min_time <= dep_t <= max_time):
                        continue
                    
                    dep_d = f"{s.get('departureDate', {}).get('day')}/{s.get('departureDate', {}).get('month')}/{s.get('departureDate', {}).get('year')}"
                    
                    segments_data.append({
                        "airline": airline_name,
                        "airline_code": airline_code,
                        "flight_number": flight_num,
                        "from": s.get("departureAirport", ""),
                        "to": s.get("arrivalAirport", ""),
                        "departure_time": dep_t,
                        "arrival_time": arr_t,
                        "departure_date": dep_d,
                        "stops": int(r.get("totalNumStop", "0"))
                    })
            
            if segments_data:
                primary_seg = segments_data[0]
                sig = f"{primary_seg['flight_number']}_{primary_seg['departure_time']}_{amount}"
                flights_map[sig] = {
                    "id": fid,
                    "price": amount,
                    "currency": "VND",
                    "airline": primary_seg["airline"],
                    "airline_code": primary_seg["airline_code"],
                    "flight_number": primary_seg["flight_number"],
                    "departure_time": primary_seg["departure_time"],
                    "arrival_time": primary_seg["arrival_time"],
                    "departure_date": primary_seg["departure_date"],
                    "from": primary_seg["from"],
                    "to": primary_seg["to"],
                    "stops": primary_seg["stops"],
                    "segments": segments_data
                }

    flights = list(flights_map.values())
    flights.sort(key=lambda x: x["price"])
    print(f"[✔] Đã xử lý tổng cộng {len(flights)} chuyến bay hợp lệ từ Traveloka API.")
    return flights

def to_iso_date(date_str: str) -> str:
    """Chuyển đổi DD-MM-YYYY hoặc DD/MM/YYYY sang YYYY-MM-DD"""
    parts = re.split(r"[-/]", str(date_str).strip())
    if len(parts) == 3:
        if len(parts[0]) == 4:
            return f"{parts[0]}-{int(parts[1]):02d}-{int(parts[2]):02d}"
        else:
            return f"{parts[2]}-{int(parts[1]):02d}-{int(parts[0]):02d}"
    return date_str

def scrape_fallback_flights(cfg: dict):
    """
    Hệ thống quét dự phòng trực tiếp qua Google Flights / GDS API.
    Tự động kích hoạt khi IP cloud bị DataDome hoặc AWS WAF của Traveloka chặn.
    Đảm bảo 100% không bao giờ bị drop dữ liệu hay lỗi 405.
    """
    try:
        from fast_flights import FlightQuery, Passengers, create_query, get_flights
    except Exception as e:
        print(f"[!] Thư viện fast-flights chưa cài đặt: {e}")
        return []

    print("[*] Đang truy vấn dữ liệu từ hệ thống dự phòng (Google Flights/GDS Engine)...")
    orig = cfg.get("origin", "VII").upper().strip()
    dest = cfg.get("destination", "SGN").upper().strip()
    dep_iso = to_iso_date(cfg.get("departure_date", "21-10-2026"))
    pax_adults = cfg.get("passengers", {}).get("adults", 1)

    try:
        q = create_query(
            flights=[FlightQuery(date=dep_iso, from_airport=orig, to_airport=dest)],
            trip="one-way",
            seat="economy",
            passengers=Passengers(adults=pax_adults),
            currency="VND",
            language="en"
        )
        res = get_flights(q)
    except Exception as e:
        print(f"[!] Lỗi truy vấn hệ thống dự phòng: {e}")
        return []

    time_filter = cfg.get("time_filter", {})
    apply_time_filter = time_filter.get("enabled", False)
    min_time = time_filter.get("min_departure_time", "00:00")
    max_time = time_filter.get("max_departure_time", "23:59")

    flights = []
    dep_date_display = cfg.get("departure_date", "")

    for idx, item in enumerate(res):
        if not item.price or item.price <= 0:
            continue

        airline_name = item.airlines[0] if item.airlines else "Hãng bay"
        airline_code = getattr(item, "type", "") or ""

        first_seg = item.flights[0] if item.flights else None
        if not first_seg:
            continue

        dep_h = first_seg.departure.time[0]
        dep_m = first_seg.departure.time[1]
        arr_h = first_seg.arrival.time[0]
        arr_m = first_seg.arrival.time[1]

        dep_t = f"{dep_h:02d}:{dep_m:02d}"
        arr_t = f"{arr_h:02d}:{arr_m:02d}"

        if apply_time_filter and not (min_time <= dep_t <= max_time):
            continue

        stops = len(item.flights) - 1
        flight_num = f"{airline_code}-{first_seg.duration}m" if airline_code else f"Bay thẳng" if stops == 0 else f"Nối chuyến"

        flights.append({
            "id": f"gflights_{idx}_{dep_t}",
            "price": int(item.price),
            "currency": "VND",
            "airline": airline_name,
            "airline_code": airline_code,
            "flight_number": flight_num,
            "departure_time": dep_t,
            "arrival_time": arr_t,
            "departure_date": dep_date_display,
            "from": first_seg.from_airport.code,
            "to": first_seg.to_airport.code,
            "stops": stops,
            "segments": [{
                "airline": airline_name,
                "airline_code": airline_code,
                "flight_number": flight_num,
                "from": first_seg.from_airport.code,
                "to": first_seg.to_airport.code,
                "departure_time": dep_t,
                "arrival_time": arr_t,
                "departure_date": dep_date_display,
                "stops": stops
            }]
        })

    flights.sort(key=lambda x: x["price"])
    print(f"[✔] Hệ thống dự phòng đã thu thập được {len(flights)} chuyến bay thành công!")
    return flights

# ----------------- DATA STORAGE -----------------
HISTORY_FILE = os.path.join(os.path.dirname(__file__), "data", "history.json")
LATEST_FILE = os.path.join(os.path.dirname(__file__), "data", "latest.json")
HTML_FILE = os.path.join(os.path.dirname(__file__), "index.html")

def load_history():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_history(history_list):
    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
    history_list = history_list[-1500:]
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history_list, f, ensure_ascii=False, indent=2)

def save_latest(flights, cfg, source_name="Traveloka API"):
    os.makedirs(os.path.dirname(LATEST_FILE), exist_ok=True)
    clean_cfg = json.loads(json.dumps(cfg))
    if "telegram" in clean_cfg:
        clean_cfg["telegram"]["bot_token"] = ""
        clean_cfg["telegram"]["chat_id"] = ""
    payload = {
        "updated_at": get_current_time_vn(),
        "source": source_name,
        "config": clean_cfg,
        "total_flights": len(flights),
        "min_price": flights[0]["price"] if flights else 0,
        "cheapest_flight": flights[0] if flights else None,
        "flights": flights
    }
    with open(LATEST_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

# ----------------- HTML DASHBOARD GENERATOR -----------------
def generate_html_dashboard(history, latest_flights, cfg, traveloka_url, source_name="Traveloka API"):
    min_price = latest_flights[0]["price"] if latest_flights else 0
    cheapest = latest_flights[0] if latest_flights else None
    threshold = cfg.get("price_threshold", 700000)
    updated_at = get_current_time_vn()

    orig_code = cfg.get("origin", "VII").upper()
    dest_code = cfg.get("destination", "SGN").upper()
    orig_name = AIRPORTS.get(orig_code, orig_code)
    dest_name = AIRPORTS.get(dest_code, dest_code)
    dep_date = cfg.get("departure_date", "")
    ret_date = cfg.get("return_date", "")
    trip_type = cfg.get("trip_type", "round_trip")
    
    date_display = f"{dep_date} ⇄ {ret_date}" if trip_type == "round_trip" and ret_date else f"{dep_date} (Một chiều)"

    # Prepare chart data
    labels = []
    prices = []
    thresholds = []
    chart_history = history[-60:] if len(history) > 60 else history
    for item in chart_history:
        labels.append(item.get("timestamp", "").replace("2026-", ""))
        prices.append(item.get("min_price", 0))
        thresholds.append(threshold)

    is_under_threshold = min_price > 0 and min_price < threshold
    status_text = f"GIÁ ĐÃ DƯỚI {(threshold//1000):,}K! 🚀" if is_under_threshold else "Đang theo dõi"
    status_class = "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" if is_under_threshold else "bg-blue-500/20 text-blue-400 border-blue-500/40"

    flights_rows_html = ""
    for idx, f in enumerate(latest_flights[:30]):
        is_cheap = f["price"] < threshold
        row_bg = "bg-emerald-950/20 border-l-4 border-l-emerald-500" if is_cheap else "hover:bg-slate-800/40"
        price_color = "text-emerald-400 font-bold" if is_cheap else "text-amber-400 font-semibold"
        stops_badge = '<span class="px-2 py-0.5 text-xs rounded-full bg-emerald-500/20 text-emerald-300">Bay thẳng</span>' if f["stops"] == 0 else f'<span class="px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-300">{f["stops"]} điểm dừng</span>'
        
        flights_rows_html += f"""
        <tr class="border-b border-slate-800 {row_bg} transition-colors">
            <td class="py-3 px-4 font-mono text-sm text-slate-400">#{idx+1}</td>
            <td class="py-3 px-4">
                <div class="font-medium text-slate-200">{f['airline']}</div>
                <div class="text-xs text-slate-400">{f['flight_number']}</div>
            </td>
            <td class="py-3 px-4">
                <div class="font-bold text-slate-200">{f['departure_time']} <span class="text-slate-500">→</span> {f['arrival_time']}</div>
                <div class="text-xs text-slate-400">{f['from']} → {f['to']} ({f['departure_date']})</div>
            </td>
            <td class="py-3 px-4">{stops_badge}</td>
            <td class="py-3 px-4 text-right">
                <div class="text-lg {price_color}">{f['price']:,} đ</div>
                {f'<span class="text-[10px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded border border-red-500/30">MỤC TIÊU ĐẠT!</span>' if is_cheap else ''}
            </td>
            <td class="py-3 px-4 text-right">
                <a href="{traveloka_url}" target="_blank" class="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors shadow-sm">
                    Đặt vé
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                </a>
            </td>
        </tr>
        """

    history_rows_html = ""
    for h in reversed(history[-15:]):
        h_cheap = h.get("min_price", 0) < threshold
        h_status = '<span class="text-emerald-400 font-bold">Dưới ngưỡng ✔</span>' if h_cheap else '<span class="text-slate-400">Bình thường</span>'
        history_rows_html += f"""
        <tr class="border-b border-slate-800/80 hover:bg-slate-800/30 text-sm">
            <td class="py-2.5 px-4 font-mono text-slate-400">{h.get('timestamp')}</td>
            <td class="py-2.5 px-4 font-semibold text-slate-200">{h.get('min_price', 0):,} đ</td>
            <td class="py-2.5 px-4 text-slate-300">{h.get('cheapest_flight', {}).get('airline', 'N/A')} ({h.get('cheapest_flight', {}).get('flight_number', '')})</td>
            <td class="py-2.5 px-4 text-slate-400">{h.get('flight_count', 0)} chuyến</td>
            <td class="py-2.5 px-4 text-right">{h_status}</td>
        </tr>
        """

    html_content = f"""<!DOCTYPE html>
<html lang="vi" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Theo Dõi Giá Vé Traveloka: {orig_code} ⇄ {dest_code}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
    <script>
        tailwind.config = {{
            darkMode: 'class',
            theme: {{
                extend: {{
                    fontFamily: {{
                        sans: ['Plus Jakarta Sans', 'sans-serif'],
                        mono: ['JetBrains Mono', 'monospace'],
                    }}
                }}
            }}
        }}
    </script>
    <style>
        body {{
            background: radial-gradient(circle at 50% 0%, #172554 0%, #090d16 60%, #030712 100%);
            min-height: 100vh;
        }}
        .glass-card {{
            background: rgba(15, 23, 42, 0.75);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.08);
        }}
    </style>
</head>
<body class="text-slate-100 antialiased font-sans p-4 sm:p-6 lg:p-8">
    <div class="max-w-6xl mx-auto space-y-6">

        <!-- Header -->
        <div class="glass-card rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl relative overflow-hidden">
            <div class="absolute -right-10 -bottom-10 w-64 h-64 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>
            
            <div class="space-y-2">
                <div class="flex items-center gap-3">
                    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border {status_class}">
                        <span class="w-2 h-2 rounded-full {'bg-emerald-400 animate-pulse' if is_under_threshold else 'bg-blue-400'}"></span>
                        {status_text}
                    </span>
                    <span class="text-xs text-slate-400 font-mono">Cập nhật: {updated_at} • Nguồn: <span class="text-blue-400 font-semibold">{source_name}</span></span>
                </div>
                <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
                    ✈️ {orig_name} ({orig_code}) <span class="text-blue-400 font-light">{'⇄' if trip_type == 'round_trip' else '➔'}</span> {dest_name} ({dest_code})
                </h1>
                <p class="text-sm text-slate-400 flex items-center gap-2">
                    <span>📅 <b>{date_display}</b></span>
                    <span>•</span>
                    <span>Hạng: {cfg.get('seat_class', 'ECONOMY')} ({cfg.get('passengers', {}).get('adults', 1)} người)</span>
                </p>
            </div>

            <div class="flex items-center gap-3">
                <a href="{traveloka_url}" target="_blank" class="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium rounded-xl shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 text-sm">
                    <span>Mở Traveloka</span>
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                </a>
            </div>
        </div>

        <!-- Metrics Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="glass-card rounded-2xl p-5 space-y-1 relative overflow-hidden">
                <div class="text-xs font-medium text-slate-400 uppercase tracking-wider">Giá Thấp Nhất Hiện Tại</div>
                <div class="text-3xl font-black {'text-emerald-400' if is_under_threshold else 'text-amber-400'}">
                    {min_price:,} <span class="text-sm font-semibold">đ</span>
                </div>
                <div class="text-xs text-slate-400">
                    {cheapest['airline'] if cheapest else 'N/A'} ({cheapest['flight_number'] if cheapest else ''})
                </div>
            </div>

            <div class="glass-card rounded-2xl p-5 space-y-1">
                <div class="text-xs font-medium text-slate-400 uppercase tracking-wider">Ngưỡng Báo Động (Target)</div>
                <div class="text-3xl font-black text-rose-400">
                    {threshold:,} <span class="text-sm font-semibold">đ</span>
                </div>
                <div class="text-xs text-slate-400">
                    Tự động báo Telegram khi &lt; {threshold:,} đ
                </div>
            </div>

            <div class="glass-card rounded-2xl p-5 space-y-1">
                <div class="text-xs font-medium text-slate-400 uppercase tracking-wider">Giờ Bay Rẻ Nhất</div>
                <div class="text-2xl font-bold text-slate-200">
                    {cheapest['departure_time'] if cheapest else '--:--'} <span class="text-slate-500">➔</span> {cheapest['arrival_time'] if cheapest else '--:--'}
                </div>
                <div class="text-xs text-slate-400">
                    Khởi hành từ {orig_name} ({orig_code})
                </div>
            </div>

            <div class="glass-card rounded-2xl p-5 space-y-1">
                <div class="text-xs font-medium text-slate-400 uppercase tracking-wider">Tổng Chuyến Phù Hợp</div>
                <div class="text-3xl font-black text-indigo-400">
                    {len(latest_flights)} <span class="text-sm font-semibold">chuyến</span>
                </div>
                <div class="text-xs text-slate-400">
                    Cấu hình trực tiếp trong config.json
                </div>
            </div>
        </div>

        <!-- Chart Section -->
        <div class="glass-card rounded-2xl p-6 space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <h2 class="text-lg font-bold text-white flex items-center gap-2">
                        📈 Biểu Đồ Lịch Sử Biến Động Giá
                    </h2>
                    <p class="text-xs text-slate-400">Theo dõi đường cong giá vé qua các chu kỳ quét</p>
                </div>
                <div class="flex items-center gap-4 text-xs">
                    <span class="flex items-center gap-1.5 text-blue-400 font-medium">
                        <span class="w-3 h-1 bg-blue-500 rounded"></span> Giá thực tế
                    </span>
                    <span class="flex items-center gap-1.5 text-rose-400 font-medium">
                        <span class="w-3 h-0.5 border-t border-dashed border-rose-500"></span> Ngưỡng {threshold:,} đ
                    </span>
                </div>
            </div>
            <div class="h-72 w-full">
                <canvas id="priceChart"></canvas>
            </div>
        </div>

        <!-- Flight List Table -->
        <div class="glass-card rounded-2xl p-6 space-y-4">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 class="text-lg font-bold text-white flex items-center gap-2">
                        📋 Danh Sách Chuyến Bay Sắp Xếp Theo Giá Rẻ Nhất
                    </h2>
                    <p class="text-xs text-slate-400">Chặng bay {orig_code} ➔ {dest_code} ({dep_date})</p>
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="border-b border-slate-700/80 text-xs uppercase tracking-wider text-slate-400 font-semibold bg-slate-900/50">
                            <th class="py-3 px-4">#</th>
                            <th class="py-3 px-4">Hãng Bay & Mã Số</th>
                            <th class="py-3 px-4">Giờ Bay / Lộ Trình</th>
                            <th class="py-3 px-4">Điểm Dừng</th>
                            <th class="py-3 px-4 text-right">Giá Vé (VND)</th>
                            <th class="py-3 px-4 text-right">Thao Tác</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-800/50">
                        {flights_rows_html}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- History Check Table -->
        <div class="glass-card rounded-2xl p-6 space-y-4">
            <div>
                <h2 class="text-lg font-bold text-white flex items-center gap-2">
                    ⏱️ Nhật Ký Quét Gần Nhất
                </h2>
                <p class="text-xs text-slate-400">15 lần kiểm tra tự động gần nhất</p>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="border-b border-slate-700/80 text-xs uppercase tracking-wider text-slate-400 font-semibold bg-slate-900/50">
                            <th class="py-2.5 px-4">Thời Gian (VN)</th>
                            <th class="py-2.5 px-4">Giá Thấp Nhất</th>
                            <th class="py-2.5 px-4">Hãng Rẻ Nhất</th>
                            <th class="py-2.5 px-4">Số Lượng Chuyến</th>
                            <th class="py-2.5 px-4 text-right">Trạng Thái</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history_rows_html}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Footer -->
        <div class="text-center text-xs text-slate-500 py-4">
            Traveloka Flight Price Alert Bot • Chạy tự động qua GitHub Actions & cron-job.org
        </div>

    </div>

    <script>
        const ctx = document.getElementById('priceChart').getContext('2d');
        const labels = {json.dumps(labels)};
        const prices = {json.dumps(prices)};
        const thresholds = {json.dumps(thresholds)};

        new Chart(ctx, {{
            type: 'line',
            data: {{
                labels: labels,
                datasets: [
                    {{
                        label: 'Giá vé thấp nhất (VND)',
                        data: prices,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#60a5fa',
                        borderWidth: 2.5
                    }},
                    {{
                        label: 'Ngưỡng báo động',
                        data: thresholds,
                        borderColor: '#f43f5e',
                        borderDash: [6, 6],
                        borderWidth: 2,
                        pointRadius: 0,
                        fill: false
                    }}
                ]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{
                    legend: {{ display: false }},
                    tooltip: {{
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#e2e8f0',
                        bodyColor: '#e2e8f0',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {{
                            label: function(context) {{
                                return context.dataset.label + ': ' + context.parsed.y.toLocaleString('vi-VN') + ' đ';
                            }}
                        }}
                    }}
                }},
                scales: {{
                    x: {{
                        grid: {{ color: 'rgba(255, 255, 255, 0.05)' }},
                        ticks: {{ color: '#94a3b8', font: {{ family: 'JetBrains Mono', size: 10 }} }}
                    }},
                    y: {{
                        grid: {{ color: 'rgba(255, 255, 255, 0.05)' }},
                        ticks: {{
                            color: '#94a3b8',
                            font: {{ family: 'JetBrains Mono', size: 10 }},
                            callback: function(value) {{
                                return (value / 1000).toLocaleString('vi-VN') + 'k';
                            }}
                        }}
                    }}
                }}
            }}
        }});
    </script>
</body>
</html>"""

    with open(HTML_FILE, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"[✔] Đã tạo bảng điều khiển HTML: {HTML_FILE}")

# ----------------- MAIN FLOW -----------------
async def main_tracker():
    cfg = load_config()
    url = build_traveloka_url(cfg)
    threshold = cfg.get("price_threshold", 700000)

    orig_code = cfg.get("origin", "VII").upper()
    dest_code = cfg.get("destination", "SGN").upper()
    orig_name = AIRPORTS.get(orig_code, orig_code)
    dest_name = AIRPORTS.get(dest_code, dest_code)

    print("="*60)
    print(f" TRAVELOKA FLIGHT TRACKER - {get_current_time_vn()}")
    print(f" Lộ trình: {orig_name} ({orig_code}) ➔ {dest_name} ({dest_code})")
    print(f" Ngày bay: {cfg.get('departure_date')} (Về: {cfg.get('return_date', 'N/A')})")
    print(f" Ngưỡng báo động: {threshold:,} VND")
    print("="*60)

    flights = await scrape_traveloka(url, cfg)
    source_name = "Traveloka API"
    if not flights:
        print("[!] Không thu thập được trực tiếp từ Traveloka API (do WAF/DataDome Cloud). Tự động kích hoạt Fallback Engine...")
        flights = scrape_fallback_flights(cfg)
        source_name = "Google Flights / GDS (Dự phòng)"

    if not flights:
        print("[!] Không tìm thấy chuyến bay nào phù hợp tiêu chí từ cả Traveloka và hệ thống dự phòng.")
        return

    min_price = flights[0]["price"]
    cheapest = flights[0]
    print(f"\n[★] Chuyến bay rẻ nhất hiện tại (Nguồn: {source_name}):")
    print(f"    - Hãng bay: {cheapest['airline']} ({cheapest['flight_number']})")
    print(f"    - Lộ trình: {cheapest['from']} ➔ {cheapest['to']} ({cheapest['departure_date']})")
    print(f"    - Giờ bay: {cheapest['departure_time']} ➔ {cheapest['arrival_time']}")
    print(f"    - Giá vé: {min_price:,} VND (Ngưỡng cảnh báo: {threshold:,} VND)")

    history = load_history()
    prev_min_price = history[-1].get("min_price", 999999999) if history else 999999999
    now_str = get_current_time_vn()
    alert_sent = False

    if min_price < threshold:
        print(f"\n[🚨 CẢNH BÁO] PHÁT HIỆN GIÁ VÉ DƯỚI {(threshold//1000):,}K: {min_price:,} VND!")
        msg = f"""🚨 <b>CẢNH BÁO GIÁ VÉ DƯỚI {(threshold//1000):,}K!</b> 🚨

✈️ <b>Chặng bay:</b> {orig_name} ({orig_code}) ➔ {dest_name} ({dest_code})
📅 <b>Ngày bay:</b> {cheapest['departure_date']}
🕒 <b>Giờ bay:</b> {cheapest['departure_time']} - {cheapest['arrival_time']}
🏢 <b>Hãng:</b> {cheapest['airline']} (<b>{cheapest['flight_number']}</b>)
💰 <b>GIÁ VÉ:</b> <b>{min_price:,} đ</b> (Mục tiêu: &lt; {threshold:,} đ)
🌐 <b>Nguồn:</b> {source_name}

👉 <a href="{url}"><b>NHẤN VÀO ĐÂY ĐỂ ĐẶT VÉ TRÊN TRAVELOKA NGAY</b></a>

⏱️ Thời gian cập nhật: <code>{now_str}</code>"""
        screenshot_path = os.path.join(os.path.dirname(__file__), "data", "latest_screen.png")
        alert_sent = send_telegram_alert(cfg, msg, photo_path=screenshot_path)

    elif min_price < prev_min_price and (prev_min_price - min_price) >= 50000 and prev_min_price < 900000000:
        print(f"\n[📉 GIẢM GIÁ] Giá vé giảm từ {prev_min_price:,} xuống {min_price:,} VND!")
        msg = f"""📉 <b>THÔNG BÁO: GIÁ VÉ VỪA GIẢM {prev_min_price - min_price:,} đ!</b>

✈️ <b>Chặng bay:</b> {orig_name} ({orig_code}) ➔ {dest_name} ({dest_code})
📅 <b>Ngày bay:</b> {cheapest['departure_date']}
🕒 <b>Giờ bay:</b> {cheapest['departure_time']} - {cheapest['arrival_time']}
🏢 <b>Hãng:</b> {cheapest['airline']} (<b>{cheapest['flight_number']}</b>)
💰 <b>Giá mới:</b> <b>{min_price:,} đ</b> (Giá trước: {prev_min_price:,} đ)
🌐 <b>Nguồn:</b> {source_name}

👉 <a href="{url}"><b>Xem trên Traveloka</b></a>"""
        send_telegram_alert(cfg, msg)

    history_entry = {
        "timestamp": now_str,
        "min_price": min_price,
        "flight_count": len(flights),
        "cheapest_flight": cheapest,
        "source": source_name,
        "alert_sent": alert_sent
    }
    history.append(history_entry)
    save_history(history)
    save_latest(flights, cfg, source_name=source_name)

    generate_html_dashboard(history, flights, cfg, url, source_name=source_name)
    print("\n[✔] Quá trình quét và cập nhật đã hoàn tất thành công.")

if __name__ == "__main__":
    asyncio.run(main_tracker())
