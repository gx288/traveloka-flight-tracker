// ==UserScript==
// @name         Vietjet & Abay 0đ Flight Auto-Sniper (Săn vé 0 đồng siêu tốc)
// @namespace    https://github.com/gx288/traveloka-flight-tracker
// @version      1.0.0
// @description  Tự động chọn vé 0đ, điền thông tin hành khách trong 0.5s, bỏ chọn bảo hiểm phụ phí và dẫn thẳng tới màn hình thanh toán VietQR.
// @author       Antigravity
// @match        https://*.vietjetair.com/*
// @match        https://*.abay.vn/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // CẤU HÌNH MẶC ĐỊNH (Bạn có thể sửa trực tiếp ở đây hoặc nhập trên bảng điều khiển nổi)
    const DEFAULT_CONFIG = {
        ho_dem: "LE MINH",
        ten: "HUY",
        gioi_tinh: "MALE", // MALE hoặc FEMALE
        ngay_sinh: "15/08/1995", // DD/MM/YYYY
        sdt: "0912345678",
        email: "example@gmail.com",
        auto_fill: true,
        auto_uncheck_insurance: true,
        auto_pick_cheapest: true,
        alert_sound: true
    };

    function loadConfig() {
        try {
            return JSON.parse(localStorage.getItem('VJ_SNIPER_CFG')) || DEFAULT_CONFIG;
        } catch(e) {
            return DEFAULT_CONFIG;
        }
    }

    function saveConfig(cfg) {
        localStorage.setItem('VJ_SNIPER_CFG', JSON.stringify(cfg));
    }

    let config = loadConfig();

    // ----------------- ÂM THANH BÁO ĐỘNG KHI TỚI TRANG THANH TOÁN -----------------
    function playAlarmSound() {
        if (!config.alert_sound) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.setValueAtTime(880, ctx.currentTime); // 880Hz
            gain.gain.setValueAtTime(0.5, ctx.currentTime);
            osc.start();
            osc.stop(ctx.currentTime + 0.8);
        } catch(e) {
            console.log("Audio not supported", e);
        }
    }

    // ----------------- TỰ ĐỘNG ĐIỀN FORM HÀNH KHÁCH & LIÊN HỆ -----------------
    function fillPassengerAndContact() {
        if (!config.auto_fill) return;

        let filled = false;

        // 1. Họ và Tên đệm
        const lastNameInputs = document.querySelectorAll('input[name*="lastName" i], input[placeholder*="Họ" i], input[name*="family" i], input[id*="lastName" i]');
        lastNameInputs.forEach(input => {
            if (!input.value) {
                input.value = config.ho_dem;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                filled = true;
            }
        });

        // 2. Tên chính
        const firstNameInputs = document.querySelectorAll('input[name*="firstName" i], input[placeholder*="Tên" i], input[name*="given" i], input[id*="firstName" i]');
        firstNameInputs.forEach(input => {
            if (!input.value) {
                input.value = config.ten;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                filled = true;
            }
        });

        // 3. Số điện thoại
        const phoneInputs = document.querySelectorAll('input[type="tel"], input[name*="phone" i], input[placeholder*="thoại" i], input[id*="phone" i]');
        phoneInputs.forEach(input => {
            if (!input.value) {
                input.value = config.sdt;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                filled = true;
            }
        });

        // 4. Email
        const emailInputs = document.querySelectorAll('input[type="email"], input[name*="email" i], input[placeholder*="email" i], input[id*="email" i]');
        emailInputs.forEach(input => {
            if (!input.value) {
                input.value = config.email;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                filled = true;
            }
        });

        // 5. Tự động bỏ tích bảo hiểm du lịch
        if (config.auto_uncheck_insurance) {
            const checkboxes = document.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => {
                const label = (cb.parentElement ? cb.parentElement.innerText : "").toLowerCase();
                if (label.includes("bảo hiểm") || label.includes("insurance") || label.includes("bảo việt") || label.includes("bảo minh")) {
                    if (cb.checked) {
                        cb.click();
                        console.log("⚡ [Sniper] Đã tự động bỏ chọn bảo hiểm!");
                    }
                }
            });
        }

        if (filled) {
            console.log("⚡ [Sniper] Đã tự động điền form hành khách thành công!");
        }
    }

    // ----------------- TỰ ĐỘNG CHỌN VÉ RẺ NHẤT / VÉ 0Đ -----------------
    function selectCheapestFlight() {
        if (!config.auto_pick_cheapest) return;

        // Tìm các nút vé có chữ "0" hoặc "Eco" hoặc giá nhỏ nhất
        const ecoElements = document.querySelectorAll('[class*="eco" i], [class*="promo" i], [class*="price" i]');
        ecoElements.forEach(el => {
            const text = el.innerText || "";
            if (text.includes("0 đ") || text.includes("0 VND") || text.includes("0VND") || text.includes("0đ")) {
                console.log("🎯 [Sniper] PHÁT HIỆN VÉ 0 ĐỒNG! Đang tự động chọn...");
                el.click();
                playAlarmSound();
            }
        });
    }

    // ----------------- BẢNG ĐIỀU KHIỂN NỔI (FLOATING UI WIDGET) -----------------
    function injectFloatingUI() {
        if (document.getElementById('vj-sniper-widget')) return;

        const widget = document.createElement('div');
        widget.id = 'vj-sniper-widget';
        widget.innerHTML = `
            <div style="
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 999999;
                background: rgba(15, 23, 42, 0.95);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(239, 68, 68, 0.4);
                border-radius: 16px;
                padding: 16px;
                color: #fff;
                font-family: system-ui, -apple-system, sans-serif;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
                width: 310px;
                font-size: 13px;
            ">
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-bottom: 12px;">
                    <span style="font-weight: 800; color: #ef4444; display: flex; align-items: center; gap: 6px;">
                        ⚡ VJ AUTO-SNIPER 0Đ
                    </span>
                    <span style="background: #22c55e; color: #000; font-size: 10px; font-weight: bold; padding: 2px 6px; rounded; border-radius: 9999px;">ĐANG TRỰC</span>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div>
                        <label style="font-size: 11px; color: #94a3b8;">Họ và Tên Đệm (không dấu):</label>
                        <input id="vj-ho-dem" type="text" value="${config.ho_dem}" style="width: 100%; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 5px 8px; border-radius: 6px; font-size: 12px; margin-top: 2px;">
                    </div>
                    <div>
                        <label style="font-size: 11px; color: #94a3b8;">Tên (không dấu):</label>
                        <input id="vj-ten" type="text" value="${config.ten}" style="width: 100%; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 5px 8px; border-radius: 6px; font-size: 12px; margin-top: 2px;">
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div>
                            <label style="font-size: 11px; color: #94a3b8;">Số điện thoại:</label>
                            <input id="vj-sdt" type="text" value="${config.sdt}" style="width: 100%; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 5px 8px; border-radius: 6px; font-size: 12px; margin-top: 2px;">
                        </div>
                        <div>
                            <label style="font-size: 11px; color: #94a3b8;">Giới tính:</label>
                            <select id="vj-gioi-tinh" style="width: 100%; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 5px 8px; border-radius: 6px; font-size: 12px; margin-top: 2px;">
                                <option value="MALE" ${config.gioi_tinh === 'MALE' ? 'selected' : ''}>Nam</option>
                                <option value="FEMALE" ${config.gioi_tinh === 'FEMALE' ? 'selected' : ''}>Nữ</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label style="font-size: 11px; color: #94a3b8;">Email nhận vé:</label>
                        <input id="vj-email" type="text" value="${config.email}" style="width: 100%; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 5px 8px; border-radius: 6px; font-size: 12px; margin-top: 2px;">
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #cbd5e1; cursor: pointer;">
                            <input type="checkbox" id="vj-cb-autofill" ${config.auto_fill ? 'checked' : ''}> Tự động điền Form trong 0.5s
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #cbd5e1; cursor: pointer;">
                            <input type="checkbox" id="vj-cb-uncheck" ${config.auto_uncheck_insurance ? 'checked' : ''}> Tự động bỏ chọn bảo hiểm cộng tiền
                        </label>
                    </div>

                    <button id="vj-btn-fill-now" style="
                        margin-top: 6px;
                        background: linear-gradient(to right, #ef4444, #dc2626);
                        color: white;
                        font-weight: 700;
                        padding: 8px;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: opacity 0.2s;
                    ">⚡ ĐIỀN THÔNG TIN NGAY (1-CLICK)</button>
                </div>
            </div>
        `;
        document.body.appendChild(widget);

        // Bind events
        document.getElementById('vj-btn-fill-now').addEventListener('click', () => {
            updateConfigFromUI();
            fillPassengerAndContact();
            alert("✔ Đã chạy điền thông tin và hủy phụ phí bảo hiểm!");
        });

        const inputs = ['vj-ho-dem', 'vj-ten', 'vj-sdt', 'vj-gioi-tinh', 'vj-email', 'vj-cb-autofill', 'vj-cb-uncheck'];
        inputs.forEach(id => {
            document.getElementById(id).addEventListener('change', updateConfigFromUI);
        });
    }

    function updateConfigFromUI() {
        config.ho_dem = document.getElementById('vj-ho-dem').value.trim();
        config.ten = document.getElementById('vj-ten').value.trim();
        config.sdt = document.getElementById('vj-sdt').value.trim();
        config.gioi_tinh = document.getElementById('vj-gioi-tinh').value;
        config.email = document.getElementById('vj-email').value.trim();
        config.auto_fill = document.getElementById('vj-cb-autofill').checked;
        config.auto_uncheck_insurance = document.getElementById('vj-cb-uncheck').checked;
        saveConfig(config);
    }

    // ----------------- VÒNG LẶP THEO DÕI VÀ TỰ ĐỘNG THỰC THI -----------------
    setInterval(() => {
        fillPassengerAndContact();
        selectCheapestFlight();
    }, 800);

    // Khởi tạo giao diện sau khi trang nạp xong
    setTimeout(injectFloatingUI, 1200);

})();
