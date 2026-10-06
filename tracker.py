#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Flight Price Tracker & Alert System (Vietnam Domestic + International)
- Primary Engine: Abay.vn High-Speed API (100% accurate VN domestic fares, tax/fee breakdown, no cloud IP block)
- Secondary Engine: Traveloka Intercept API (via Playwright with stealth configurations)
- Fallback Engine: Google Flights / GDS API (via fast-flights)
- Centralized configuration via config.json (Route, Airport, Dates, Time, Threshold, Telegram)
- Records price history into JSON
- Sends instant Telegram alert when price < threshold (700k) or drops significantly
- Generates interactive HTML Dashboard with Chart.js for GitHub Pages
"""

import os
import sys
import io
import re
import json
import time
import asyncio
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor

# Fix Windows console encoding
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import requests

try:
    from proxy_manager import get_proxy_for_playwright
except ImportError:
    get_proxy_for_playwright = lambda cfg: None

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

AIRLINE_NAMES = {
    "VU": "Vietravel Airlines",
    "VJ": "Vietjet Air",
    "VN": "Vietnam Airlines",
    "QH": "Bamboo Airways",
    "BL": "Pacific Airlines"
}

MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

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
        "proxy": {
            "enabled": False,
            "mode": "auto",
            "custom_proxy": "",
            "timeout": 3
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
    if os.getenv("USE_PROXY"):
        default_config["proxy"]["enabled"] = os.getenv("USE_PROXY").lower() in ["1", "true", "yes"]
    if os.getenv("CUSTOM_PROXY"):
        default_config["proxy"]["custom_proxy"] = os.getenv("CUSTOM_PROXY")
        default_config["proxy"]["enabled"] = True
    if os.getenv("TELEGRAM_BOT_TOKEN"):
        default_config["telegram"]["bot_token"] = os.getenv("TELEGRAM_BOT_TOKEN")
    if os.getenv("TELEGRAM_CHAT_ID"):
        default_config["telegram"]["chat_id"] = os.getenv("TELEGRAM_CHAT_ID")

    return default_config

def format_abay_date(dt_str: str) -> str:
    """Chuyển đổi DD-MM-YYYY hoặc YYYY-MM-DD sang định dạng Abay: 21Oct2026"""
    parts = re.split(r"[-/]", str(dt_str).strip())
    if len(parts) == 3:
        if len(parts[0]) == 4:
            y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
        else:
            d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
        return f"{d:02d}{MONTHS_EN[m-1]}{y}"
    return dt_str

def format_display_date(dt_str: str) -> str:
    """Chuyển đổi sang định dạng hiển thị DD/MM/YYYY"""
    parts = re.split(r"[-/]", str(dt_str).strip())
    if len(parts) == 3:
        if len(parts[0]) == 4:
            return f"{int(parts[2]):02d}/{int(parts[1]):02d}/{parts[0]}"
        else:
            return f"{int(parts[0]):02d}/{int(parts[1]):02d}/{parts[2]}"
    return dt_str

def build_abay_input(cfg: dict) -> str:
    orig = cfg.get("origin", "VII").upper().strip()
    dest = cfg.get("destination", "SGN").upper().strip()
    dep_date = format_abay_date(cfg.get("departure_date", "21-10-2026"))
    ret_date = format_abay_date(cfg.get("return_date", "22-10-2026"))
    
    pax = cfg.get("passengers", {})
    adults = pax.get("adults", 1)
    children = pax.get("children", 0)
    infants = pax.get("infants", 0)
    
    trip_type = cfg.get("trip_type", "round_trip").lower()
    if trip_type == "round_trip" and ret_date:
        return f"{orig}-{dest}-{adults}-{children}-{infants}-{dep_date}-{ret_date}"
    else:
        return f"{orig}-{dest}-{adults}-{children}-{infants}-{dep_date}"

def build_abay_url(cfg: dict) -> str:
    inp = build_abay_input(cfg)
    return f"https://www.abay.vn/_Web/ResultDom2024/ResultDom.aspx?input={inp}"

def build_traveloka_url(cfg: dict) -> str:
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

# ----------------- ENGINE 1: ABAY.VN CRAWLER (CHUẨN GIÁ NỘI ĐỊA) -----------------
def parse_price_str(val) -> int:
    if not val:
        return 0
    clean = re.sub(r"[^\d]", "", str(val))
    return int(clean) if clean else 0

def scrape_abay(cfg: dict):
    """
    Truy vấn trực tiếp Abay.vn AJAX API.
    - Không bị chặn bởi Cloudflare / DataDome trên GitHub Actions runner.
    - Đầy đủ 100% các hãng nội địa: Vietravel Airlines, Vietjet Air, Vietnam Airlines, Bamboo.
    - Tự động bóc tách chi tiết: Giá gốc (Base fare), Thuế phí (Taxes/Fees) và Tổng giá thanh toán.
    """
    print(f"[{get_current_time_vn()}] Bắt đầu quét Abay Engine (Chuẩn giá nội địa Việt Nam)...")
    input_code = build_abay_input(cfg)
    abay_url = build_abay_url(cfg)
    print(f"[*] Mã truy vấn: {input_code}")
    print(f"[*] URL kết quả: {abay_url}")

    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        "Referer": "https://www.abay.vn/",
        "Content-Type": "application/json"
    })

    time_filter = cfg.get("time_filter", {})
    apply_time_filter = time_filter.get("enabled", False)
    min_time = time_filter.get("min_departure_time", "00:00")
    max_time = time_filter.get("max_departure_time", "23:59")

    trip_type = cfg.get("trip_type", "round_trip").lower()
    has_return = trip_type == "round_trip" and bool(cfg.get("return_date"))

    legs_to_fetch = [("OutBound", "Chiều đi", cfg.get("origin", "VII"), cfg.get("destination", "SGN"), cfg.get("departure_date", ""))]
    if has_return:
        legs_to_fetch.append(("InBound", "Chiều về", cfg.get("destination", "SGN"), cfg.get("origin", "VII"), cfg.get("return_date", "")))

    all_flights = []

    for waytype, leg_display, orig_leg, dest_leg, leg_date in legs_to_fetch:
        print(f"[*] Đang lấy danh sách chuyến bay {leg_display} ({orig_leg} ➔ {dest_leg} ngày {leg_date})...")
        api_url = f"https://www.abay.vn/_WEB/ResultDom2024/ResultDomAjax.aspx/GetFlights?input={input_code}&waytype={waytype}&isAllowSearchReal=0&edition=2&lang=VN&display=1"
        try:
            res = session.post(api_url, json={}, timeout=15)
            if res.status_code != 200:
                print(f"[!] Abay trả mã lỗi {res.status_code} cho {waytype}")
                continue
            
            d_val = res.json().get("d", "")
            data_obj = json.loads(d_val) if isinstance(d_val, str) else d_val
            raw_flights = data_obj.get("D", []) if isinstance(data_obj, dict) else []
            print(f"  [+] Tìm thấy {len(raw_flights)} chuyến bay {leg_display} sơ bộ. Đang trích xuất chi tiết thuế phí...")
        except Exception as e:
            print(f"[!] Lỗi gọi Abay GetFlights ({waytype}): {e}")
            continue

        def fetch_flight_detail(item):
            detail_path = item.get("T")
            airline_code = item.get("E", "")
            airline_name = AIRLINE_NAMES.get(airline_code, airline_code)
            flight_no = item.get("F", "")
            dep_t = item.get("G", "")
            arr_t = item.get("H", "")
            base_p = parse_price_str(item.get("J"))
            total_p = base_p
            tax_fee = 0

            if detail_path:
                full_detail_url = f"https://www.abay.vn{detail_path}"
                try:
                    d_res = session.get(full_detail_url, timeout=6)
                    # Regex bóc tách Tổng Giá: <td align=center class="pax pb-price">970,000
                    m_total = re.search(r'class=[\"\']?pax pb-price[\"\']?>([\d,]+)', d_res.text)
                    if m_total:
                        total_p = parse_price_str(m_total.group(1))
                    # Regex bóc tách Thuế Phí: <td align=right class=pax>772,000<td align=center class="pax pb-price">
                    m_tax = re.search(r'class=pax>([\d,]+)<td[^>]*class=[\"\']?pax pb-price', d_res.text)
                    if m_tax:
                        tax_fee = parse_price_str(m_tax.group(1))
                except Exception:
                    pass

            return {
                "id": f"abay_{airline_code}_{flight_no}_{dep_t}_{waytype.lower()}",
                "price": total_p if total_p > 0 else base_p,
                "base_price": base_p,
                "tax_fee": tax_fee,
                "currency": "VND",
                "airline": airline_name,
                "airline_code": airline_code,
                "flight_number": flight_no,
                "departure_time": dep_t,
                "arrival_time": arr_t,
                "departure_date": format_display_date(leg_date),
                "from": orig_leg,
                "to": dest_leg,
                "stops": 0,
                "leg_type": waytype.lower(),
                "leg_display": leg_display,
                "booking_url_abay": abay_url,
                "booking_url_traveloka": build_traveloka_url(cfg)
            }

        # Concurrently fetch tax/fee details
        with ThreadPoolExecutor(max_workers=8) as ex:
            leg_flights = list(ex.map(fetch_flight_detail, raw_flights))

        # Filter time if enabled
        if apply_time_filter:
            leg_flights = [f for f in leg_flights if min_time <= f["departure_time"] <= max_time]

        # Sort leg by total_price
        leg_flights.sort(key=lambda x: x["price"])
        print(f"  [✔] {leg_display}: {len(leg_flights)} chuyến bay. Rẻ nhất: {leg_flights[0]['airline']} {leg_flights[0]['flight_number']} - {leg_flights[0]['price']:,} đ (Gốc: {leg_flights[0]['base_price']:,} đ)" if leg_flights else f"  [!] Không có chuyến {leg_display}")
        all_flights.extend(leg_flights)

    return all_flights

# ----------------- ENGINE 2: TRAVELOKA PLAYWRIGHT CRAWLER -----------------
async def scrape_traveloka(url: str, cfg: dict):
    print(f"[{get_current_time_vn()}] Bắt đầu quét Traveloka Engine...")
    print(f"[*] URL: {url}")
    
    try:
        from playwright.async_api import async_playwright
    except Exception as e:
        print(f"[!] Playwright chưa sẵn sàng: {e}")
        return []

    poll_payloads = []

    async with async_playwright() as p:
        is_linux_xvfb = sys.platform.startswith("linux") and bool(os.getenv("DISPLAY"))
        use_headless = False if is_linux_xvfb else True

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
                browser = await p.chromium.launch(
                    executable_path=executable_path,
                    headless=use_headless,
                    args=launch_args
                )
            except Exception:
                pass

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

        user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" if sys.platform == "win32" else "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

        proxy_opts = get_proxy_for_playwright(cfg)
        context_kwargs = {
            "user_agent": user_agent,
            "viewport": {"width": 1920, "height": 1080},
            "locale": "vi-VN",
            "extra_http_headers": {"Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"}
        }
        if proxy_opts:
            context_kwargs["proxy"] = proxy_opts
            print(f"[*] Đang áp dụng Proxy cho Traveloka: {proxy_opts.get('server')}")

        context = await browser.new_context(**context_kwargs)
        
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
        """)

        page = await context.new_page()

        async def on_net(res):
            if "flight/search/poll" in res.url:
                try:
                    data = await res.json()
                    results = data.get("data", {}).get("searchResults", [])
                    if results:
                        poll_payloads.append(data)
                except Exception:
                    pass

        page.on("response", on_net)

        try:
            await page.goto("https://www.traveloka.com/vi-vn/flight", wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(2000)
        except Exception:
            pass

        try:
            resp = await page.goto(url, referer="https://www.traveloka.com/vi-vn/flight", wait_until="networkidle", timeout=40000)
        except Exception:
            pass

        for _ in range(12):
            await page.wait_for_timeout(2500)
            if poll_payloads:
                is_completed = any(p.get("data", {}).get("meta", {}).get("searchCompleted") for p in poll_payloads)
                if is_completed or len(poll_payloads) >= 2:
                    break

        screenshot_path = os.path.join(os.path.dirname(__file__), "data", "latest_screen.png")
        try:
            await page.screenshot(path=screenshot_path)
        except Exception:
            pass

        await browser.close()

    if not poll_payloads:
        return []

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
                    
                    if apply_time_filter and not (min_time <= dep_t <= max_time):
                        continue
                    
                    dep_d = f"{s.get('departureDate', {}).get('day')}/{s.get('departureDate', {}).get('month')}/{s.get('departureDate', {}).get('year')}"
                    
                    sig = f"{flight_num}_{dep_t}_{amount}"
                    flights_map[sig] = {
                        "id": fid,
                        "price": amount,
                        "base_price": amount,
                        "tax_fee": 0,
                        "currency": "VND",
                        "airline": airline_name,
                        "airline_code": airline_code,
                        "flight_number": flight_num,
                        "departure_time": dep_t,
                        "arrival_time": arr_t,
                        "departure_date": dep_d,
                        "from": s.get("departureAirport", ""),
                        "to": s.get("arrivalAirport", ""),
                        "stops": int(r.get("totalNumStop", "0")),
                        "leg_type": "outbound",
                        "leg_display": "Chiều đi",
                        "booking_url_abay": build_abay_url(cfg),
                        "booking_url_traveloka": url
                    }

    flights = list(flights_map.values())
    flights.sort(key=lambda x: x["price"])
    return flights

# ----------------- ENGINE 3: GOOGLE FLIGHTS FALLBACK -----------------
def to_iso_date(date_str: str) -> str:
    parts = re.split(r"[-/]", str(date_str).strip())
    if len(parts) == 3:
        if len(parts[0]) == 4:
            return f"{parts[0]}-{int(parts[1]):02d}-{int(parts[2]):02d}"
        else:
            return f"{parts[2]}-{int(parts[1]):02d}-{int(parts[0]):02d}"
    return date_str

def scrape_fallback_flights(cfg: dict):
    try:
        from fast_flights import FlightQuery, Passengers, create_query, get_flights
    except Exception as e:
        print(f"[!] Thư viện fast-flights chưa cài đặt: {e}")
        return []

    print("[*] Đang truy vấn Google Flights / GDS Engine...")
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
        print(f"[!] Lỗi truy vấn Google Flights: {e}")
        return []

    time_filter = cfg.get("time_filter", {})
    apply_time_filter = time_filter.get("enabled", False)
    min_time = time_filter.get("min_departure_time", "00:00")
    max_time = time_filter.get("max_departure_time", "23:59")

    flights = []
    dep_date_display = format_display_date(cfg.get("departure_date", ""))

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
        flight_num = f"{airline_code}-{first_seg.duration}m" if airline_code else "Bay thẳng"

        flights.append({
            "id": f"gflights_{idx}_{dep_t}",
            "price": int(item.price),
            "base_price": int(item.price),
            "tax_fee": 0,
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
            "leg_type": "outbound",
            "leg_display": "Chiều đi",
            "booking_url_abay": build_abay_url(cfg),
            "booking_url_traveloka": build_traveloka_url(cfg)
        })

    flights.sort(key=lambda x: x["price"])
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

def save_latest(flights, cfg, source_name="Abay Engine"):
    os.makedirs(os.path.dirname(LATEST_FILE), exist_ok=True)
    clean_cfg = json.loads(json.dumps(cfg))
    if "telegram" in clean_cfg:
        clean_cfg["telegram"]["bot_token"] = ""
        clean_cfg["telegram"]["chat_id"] = ""
    
    outbound_flights = [f for f in flights if f.get("leg_type") == "outbound"]
    inbound_flights = [f for f in flights if f.get("leg_type") == "inbound"]
    
    cheapest_outbound = outbound_flights[0] if outbound_flights else None
    cheapest_inbound = inbound_flights[0] if inbound_flights else None

    payload = {
        "updated_at": get_current_time_vn(),
        "source": source_name,
        "config": clean_cfg,
        "total_flights": len(flights),
        "min_price": flights[0]["price"] if flights else 0,
        "cheapest_flight": flights[0] if flights else None,
        "cheapest_outbound": cheapest_outbound,
        "cheapest_inbound": cheapest_inbound,
        "flights": flights
    }
    with open(LATEST_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

# ----------------- HTML DASHBOARD GENERATOR -----------------
def generate_html_dashboard(history, latest_flights, cfg, source_name="Abay Engine (Chuẩn giá nội địa)"):
    threshold = cfg.get("price_threshold", 700000)
    updated_at = get_current_time_vn()

    orig_code = cfg.get("origin", "VII").upper()
    dest_code = cfg.get("destination", "SGN").upper()
    orig_name = AIRPORTS.get(orig_code, orig_code)
    dest_name = AIRPORTS.get(dest_code, dest_code)
    dep_date = format_display_date(cfg.get("departure_date", ""))
    ret_date = format_display_date(cfg.get("return_date", ""))
    trip_type = cfg.get("trip_type", "round_trip")
    
    date_display = f"{dep_date} ⇄ {ret_date}" if trip_type == "round_trip" and ret_date else f"{dep_date} (Một chiều)"
    traveloka_url = build_traveloka_url(cfg)
    abay_url = build_abay_url(cfg)

    outbound_flights = [f for f in latest_flights if f.get("leg_type") == "outbound"]
    inbound_flights = [f for f in latest_flights if f.get("leg_type") == "inbound"]
    
    cheapest_out = outbound_flights[0] if outbound_flights else None
    cheapest_in = inbound_flights[0] if inbound_flights else None
    overall_min = latest_flights[0]["price"] if latest_flights else 0

    # Prepare chart data
    labels = []
    prices = []
    thresholds = []
    chart_history = history[-60:] if len(history) > 60 else history
    for item in chart_history:
        labels.append(item.get("timestamp", "").replace("2026-", ""))
        prices.append(item.get("min_price", 0))
        thresholds.append(threshold)

    is_under_threshold = overall_min > 0 and overall_min < threshold
    status_text = f"GIÁ ĐÃ DƯỚI {(threshold//1000):,}K! 🚀" if is_under_threshold else "Đang theo dõi"
    status_class = "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" if is_under_threshold else "bg-blue-500/20 text-blue-400 border-blue-500/40"

    flights_rows_html = ""
    for idx, f in enumerate(latest_flights):
        is_cheap = f["price"] < threshold
        row_bg = "bg-emerald-950/20 border-l-4 border-l-emerald-500" if is_cheap else "hover:bg-slate-800/40"
        price_color = "text-emerald-400 font-bold" if is_cheap else "text-amber-400 font-semibold"
        leg_badge_class = "bg-blue-500/20 text-blue-300 border border-blue-500/30" if f.get("leg_type") == "outbound" else "bg-purple-500/20 text-purple-300 border border-purple-500/30"
        
        fee_str = f" | Phí: {f['tax_fee']:,} đ" if f.get('tax_fee') else ""
        target_badge = '<span class="inline-block mt-1 text-[10px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded border border-red-500/30 font-semibold">MỤC TIÊU ĐẠT!</span>' if is_cheap else ''
        
        flights_rows_html += f"""
        <tr class="border-b border-slate-800 {row_bg} transition-colors flight-row" data-leg="{f.get('leg_type', 'outbound')}">
            <td class="py-3 px-4 font-mono text-sm text-slate-400">#{idx+1}</td>
            <td class="py-3 px-4">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold {leg_badge_class} mb-1">{f.get('leg_display', 'Chiều đi')}</span>
                <div class="font-medium text-slate-200">{f['airline']}</div>
                <div class="text-xs text-slate-400 font-mono">{f['flight_number']}</div>
            </td>
            <td class="py-3 px-4">
                <div class="font-bold text-slate-200">{f['departure_time']} <span class="text-slate-500">→</span> {f['arrival_time']}</div>
                <div class="text-xs text-slate-400">{f['from']} → {f['to']} ({f['departure_date']})</div>
            </td>
            <td class="py-3 px-4">
                <div class="text-base {price_color}">{f['price']:,} đ</div>
                <div class="text-[11px] text-slate-400">Gốc: {f['base_price']:,} đ{fee_str}</div>
                {target_badge}
            </td>
            <td class="py-3 px-4 text-right">
                <div class="flex items-center justify-end gap-1.5">
                    <a href="{f.get('booking_url_abay', abay_url)}" target="_blank" class="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors shadow-sm">
                        <span>Abay</span>
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                    </a>
                    <a href="{traveloka_url}" target="_blank" class="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors shadow-sm">
                        <span>Traveloka</span>
                    </a>
                </div>
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

    inbound_title = f"Rẻ Nhất Chiều Về ({dest_code} ➔ {orig_code})" if cheapest_in else "Ngưỡng Báo Động"
    inbound_val = f"{cheapest_in['price']:,} đ" if cheapest_in else f"{threshold:,} đ"
    inbound_val_class = "text-purple-400" if cheapest_in else "text-rose-400"
    inbound_sub = f"{cheapest_in['airline']} ({cheapest_in['flight_number']}) - {cheapest_in['departure_time']}" if cheapest_in else f"Báo Telegram khi &lt; {threshold:,} đ"
    inbound_btn_html = f'<button onclick="filterLeg(\'inbound\')" id="btn-inbound" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all">Chiều về: {dest_code} ➔ {orig_code} ({len(inbound_flights)})</button>' if inbound_flights else ''

    html_content = f"""<!DOCTYPE html>
<html lang="vi" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Theo Dõi Giá Vé Máy Bay: {orig_code} ⇄ {dest_code}</title>
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
                <div class="flex items-center gap-3 flex-wrap">
                    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border {status_class}">
                        <span class="w-2 h-2 rounded-full {'bg-emerald-400 animate-pulse' if is_under_threshold else 'bg-blue-400'}"></span>
                        {status_text}
                    </span>
                    <span class="text-xs text-slate-400 font-mono">Cập nhật: {updated_at}</span>
                    <span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Nguồn: {source_name}</span>
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

            <div class="flex items-center gap-3 flex-wrap">
                <a href="{abay_url}" target="_blank" class="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2 text-sm">
                    <span>Đặt trên Abay</span>
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                </a>
                <a href="{traveloka_url}" target="_blank" class="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium rounded-xl shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 text-sm">
                    <span>Đặt trên Traveloka</span>
                </a>
            </div>
        </div>

        <!-- Metrics Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="glass-card rounded-2xl p-5 space-y-1 relative overflow-hidden">
                <div class="text-xs font-medium text-slate-400 uppercase tracking-wider">Rẻ Nhất Chiều Đi ({orig_code} ➔ {dest_code})</div>
                <div class="text-3xl font-black {'text-emerald-400' if cheapest_out and cheapest_out['price'] < threshold else 'text-amber-400'}">
                    {cheapest_out['price']:,} <span class="text-sm font-semibold">đ</span>
                </div>
                <div class="text-xs text-slate-400">
                    {cheapest_out['airline']} ({cheapest_out['flight_number']}) - {cheapest_out['departure_time']}
                </div>
            </div>

            <div class="glass-card rounded-2xl p-5 space-y-1">
                <div class="text-xs font-medium text-slate-400 uppercase tracking-wider">{inbound_title}</div>
                <div class="text-3xl font-black {inbound_val_class}">
                    {inbound_val}
                </div>
                <div class="text-xs text-slate-400">
                    {inbound_sub}
                </div>
            </div>

            <div class="glass-card rounded-2xl p-5 space-y-1">
                <div class="text-xs font-medium text-slate-400 uppercase tracking-wider">Ngưỡng Báo Telegram</div>
                <div class="text-3xl font-black text-rose-400">
                    {threshold:,} <span class="text-sm font-semibold">đ</span>
                </div>
                <div class="text-xs text-slate-400">
                    Đã tích hợp Telegram Bot tự động
                </div>
            </div>

            <div class="glass-card rounded-2xl p-5 space-y-1">
                <div class="text-xs font-medium text-slate-400 uppercase tracking-wider">Tổng Chuyến Bay Đã Quét</div>
                <div class="text-3xl font-black text-indigo-400">
                    {len(latest_flights)} <span class="text-sm font-semibold">chuyến</span>
                </div>
                <div class="text-xs text-slate-400">
                    Đi: {len(outbound_flights)} | Về: {len(inbound_flights)} chuyến
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
                    <p class="text-xs text-slate-400">Theo dõi xu hướng giá vé qua các chu kỳ quét</p>
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
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 class="text-lg font-bold text-white flex items-center gap-2">
                        📋 Danh Sách Chuyến Bay Sắp Xếp Theo Tổng Giá Rẻ Nhất
                    </h2>
                    <p class="text-xs text-slate-400">Đã bao gồm thuế, phí sân bay & phụ thu đầy đủ (Chuẩn giá thanh toán)</p>
                </div>
                <div class="flex items-center gap-2 flex-wrap" id="filter-buttons">
                    <button onclick="filterLeg('all')" id="btn-all" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white transition-all">Tất cả ({len(latest_flights)})</button>
                    <button onclick="filterLeg('outbound')" id="btn-outbound" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all">Chiều đi: {orig_code} ➔ {dest_code} ({len(outbound_flights)})</button>
                    {inbound_btn_html}
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="border-b border-slate-700/80 text-xs uppercase tracking-wider text-slate-400 font-semibold bg-slate-900/50">
                            <th class="py-3 px-4">#</th>
                            <th class="py-3 px-4">Chặng / Hãng Bay</th>
                            <th class="py-3 px-4">Giờ Bay / Ngày Bay</th>
                            <th class="py-3 px-4">Tổng Giá (Bao gồm thuế phí)</th>
                            <th class="py-3 px-4 text-right">Đặt Vé</th>
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
            Flight Price Alert System • Abay & Traveloka Engine • Tự động hóa qua GitHub Actions
        </div>

    </div>

    <script>
        function filterLeg(leg) {{
            document.querySelectorAll('.flight-row').forEach(row => {{
                if (leg === 'all' || row.getAttribute('data-leg') === leg) {{
                    row.style.display = '';
                }} else {{
                    row.style.display = 'none';
                }}
            }});
            ['btn-all', 'btn-outbound', 'btn-inbound'].forEach(id => {{
                const btn = document.getElementById(id);
                if (btn) {{
                    if (id === 'btn-' + leg) {{
                        btn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white transition-all";
                    }} else {{
                        btn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all";
                    }}
                }}
            }});
        }}

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
                        label: 'Giá Vé Thấp Nhất (VND)',
                        data: prices,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.35,
                        pointBackgroundColor: '#3b82f6',
                        pointBorderColor: '#fff',
                        pointHoverRadius: 6,
                        pointRadius: 4
                    }},
                    {{
                        label: 'Ngưỡng Báo Động ({threshold:,} đ)',
                        data: thresholds,
                        borderColor: '#f43f5e',
                        borderWidth: 1.5,
                        borderDash: [6, 4],
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
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        titleColor: '#e2e8f0',
                        bodyColor: '#38bdf8',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: false,
                        callbacks: {{
                            label: function(context) {{
                                return context.dataset.label + ': ' + context.parsed.y.toLocaleString('vi-VN') + ' đ';
                            }}
                        }}
                    }}
                }},
                scales: {{
                    x: {{
                        grid: {{ display: false }},
                        ticks: {{ color: '#64748b', font: {{ family: 'JetBrains Mono', size: 10 }} }}
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
    threshold = cfg.get("price_threshold", 700000)

    orig_code = cfg.get("origin", "VII").upper()
    dest_code = cfg.get("destination", "SGN").upper()
    orig_name = AIRPORTS.get(orig_code, orig_code)
    dest_name = AIRPORTS.get(dest_code, dest_code)

    print("="*60)
    print(f" FLIGHT PRICE TRACKER - {get_current_time_vn()}")
    print(f" Lộ trình: {orig_name} ({orig_code}) ➔ {dest_name} ({dest_code})")
    print(f" Ngày bay: {cfg.get('departure_date')} (Về: {cfg.get('return_date', 'N/A')})")
    print(f" Ngưỡng báo động: {threshold:,} VND")
    print("="*60)

    flights = []
    source_name = ""

    # Priority 1: For Vietnam domestic routes, use Abay High-Speed Engine
    is_domestic = orig_code in AIRPORTS and dest_code in AIRPORTS
    if is_domestic:
        try:
            flights = scrape_abay(cfg)
            if flights:
                source_name = "Abay Engine (Chuẩn giá nội địa)"
        except Exception as e:
            print(f"[!] Abay Engine gặp sự cố: {e}")

    # Priority 2: Traveloka Playwright Engine (if Abay empty or international)
    if not flights:
        print("[*] Thử nghiệm Traveloka Playwright Engine...")
        traveloka_url = build_traveloka_url(cfg)
        try:
            flights = await scrape_traveloka(traveloka_url, cfg)
            if flights:
                source_name = "Traveloka API"
        except Exception as e:
            print(f"[!] Traveloka Engine gặp sự cố: {e}")

    # Priority 3: Google Flights Fallback
    if not flights:
        print("[!] Không thu thập được từ Abay & Traveloka. Kích hoạt Google Flights / GDS Engine...")
        flights = scrape_fallback_flights(cfg)
        if flights:
            source_name = "Google Flights / GDS (Dự phòng)"

    if not flights:
        print("[!] Không tìm thấy chuyến bay nào phù hợp tiêu chí từ tất cả các nguồn.")
        return

    outbound_flights = [f for f in flights if f.get("leg_type") == "outbound"]
    inbound_flights = [f for f in flights if f.get("leg_type") == "inbound"]
    
    cheapest = outbound_flights[0] if outbound_flights else flights[0]
    min_price = cheapest["price"]

    print(f"\n[★] Chuyến bay rẻ nhất hiện tại (Nguồn: {source_name}):")
    print(f"    - Hãng bay: {cheapest['airline']} ({cheapest['flight_number']})")
    print(f"    - Lộ trình: {cheapest['from']} ➔ {cheapest['to']} ({cheapest['departure_date']})")
    print(f"    - Giờ bay: {cheapest['departure_time']} ➔ {cheapest['arrival_time']}")
    print(f"    - Giá vé gốc: {cheapest['base_price']:,} VND | Thuế phí: {cheapest.get('tax_fee', 0):,} VND")
    print(f"    - TỔNG THANH TOÁN: {min_price:,} VND (Ngưỡng cảnh báo: {threshold:,} VND)")

    if inbound_flights:
        cheapest_in = inbound_flights[0]
        print(f"\n[★] Chuyến bay chiều về rẻ nhất ({cheapest_in['from']} ➔ {cheapest_in['to']}):")
        print(f"    - Hãng bay: {cheapest_in['airline']} ({cheapest_in['flight_number']})")
        print(f"    - Giờ bay: {cheapest_in['departure_time']} ➔ {cheapest_in['arrival_time']} ({cheapest_in['departure_date']})")
        print(f"    - TỔNG THANH TOÁN: {cheapest_in['price']:,} VND (Gốc: {cheapest_in['base_price']:,} VND)")

    history = load_history()
    prev_min_price = history[-1].get("min_price", 999999999) if history else 999999999
    now_str = get_current_time_vn()
    alert_sent = False

    abay_url = build_abay_url(cfg)
    traveloka_url = build_traveloka_url(cfg)

    # Check alert condition: if price < threshold
    if min_price < threshold:
        print(f"\n[🚨 CẢNH BÁO] PHÁT HIỆN GIÁ VÉ DƯỚI {(threshold//1000):,}K: {min_price:,} VND!")
        msg = f"""🚨 <b>CẢNH BÁO GIÁ VÉ DƯỚI {(threshold//1000):,}K!</b> 🚨

✈️ <b>Chặng bay ({cheapest.get('leg_display', 'Chiều đi')}):</b> {orig_name} ({orig_code}) ➔ {dest_name} ({dest_code})
📅 <b>Ngày bay:</b> {cheapest['departure_date']}
🕒 <b>Giờ bay:</b> {cheapest['departure_time']} - {cheapest['arrival_time']}
🏢 <b>Hãng:</b> {cheapest['airline']} (<b>{cheapest['flight_number']}</b>)
💰 <b>TỔNG GIÁ THANH TOÁN:</b> <b>{min_price:,} đ</b>
   └ <i>Giá vé gốc: {cheapest['base_price']:,} đ | Thuế phí: {cheapest.get('tax_fee', 0):,} đ</i>
🎯 <b>Mục tiêu:</b> &lt; {threshold:,} đ
🌐 <b>Nguồn:</b> {source_name}

👉 <a href="{abay_url}"><b>Đặt vé trên Abay</b></a> | <a href="{traveloka_url}"><b>Đặt trên Traveloka</b></a>

⏱️ Thời gian quét: <code>{now_str}</code>"""
        alert_sent = send_telegram_alert(cfg, msg)

    elif min_price < prev_min_price and (prev_min_price - min_price) >= 50000 and prev_min_price < 900000000:
        print(f"\n[📉 GIẢM GIÁ] Giá vé giảm từ {prev_min_price:,} xuống {min_price:,} VND!")
        msg = f"""📉 <b>THÔNG BÁO: GIÁ VÉ VỪA GIẢM {prev_min_price - min_price:,} đ!</b>

✈️ <b>Chặng bay ({cheapest.get('leg_display', 'Chiều đi')}):</b> {orig_name} ({orig_code}) ➔ {dest_name} ({dest_code})
📅 <b>Ngày bay:</b> {cheapest['departure_date']}
🕒 <b>Giờ bay:</b> {cheapest['departure_time']} - {cheapest['arrival_time']}
🏢 <b>Hãng:</b> {cheapest['airline']} (<b>{cheapest['flight_number']}</b>)
💰 <b>Tổng giá mới:</b> <b>{min_price:,} đ</b> (Giá trước: {prev_min_price:,} đ)
   └ <i>Giá vé gốc: {cheapest['base_price']:,} đ</i>
🌐 <b>Nguồn:</b> {source_name}

👉 <a href="{abay_url}"><b>Xem trên Abay</b></a> | <a href="{traveloka_url}"><b>Xem trên Traveloka</b></a>"""
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

    generate_html_dashboard(history, flights, cfg, source_name=source_name)
    print("\n[✔] Quá trình quét và cập nhật đã hoàn tất thành công.")

if __name__ == "__main__":
    asyncio.run(main_tracker())
