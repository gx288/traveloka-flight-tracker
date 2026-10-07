// ==UserScript==
// @name         Vietjet 0đ Auto-Sniper (Chuyên săn vé 0đ & Hủy phụ phí)
// @namespace    https://github.com/gx288/traveloka-flight-tracker
// @version      1.1.0
// @description  Tự động chọn vé 0đ/vé rẻ nhất, tự động gỡ bỏ bảo hiểm phụ phí và dẫn thẳng tới màn hình thanh toán VietQR.
// @author       Antigravity
// @match        https://*.vietjetair.com/*
// @match        https://*.abay.vn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log("⚡ [Vietjet Sniper] Đang chạy chế độ săn vé 0đ & hủy phụ phí...");

    // ----------------- ÂM THANH BÁO ĐỘNG KHI TÌM THẤY VÉ 0Đ -----------------
    let hasAlerted = false;
    function playAlarm() {
        if (hasAlerted) return;
        hasAlerted = true;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            gain.gain.setValueAtTime(0.6, ctx.currentTime);
            osc.start();
            osc.stop(ctx.currentTime + 1.2);
        } catch(e) {}
    }

    // ----------------- 1. TỰ ĐỘNG BỎ TÍCH BẢO HIỂM PHỤ THU -----------------
    function uncheckInsurance() {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            const label = (cb.parentElement ? cb.parentElement.innerText : "").toLowerCase();
            if (label.includes("bảo hiểm") || label.includes("insurance") || label.includes("bảo việt") || label.includes("bảo minh")) {
                if (cb.checked) {
                    cb.click();
                    console.log("⚡ [Sniper] Đã tự động bỏ chọn bảo hiểm phụ thu!");
                }
            }
        });
    }

    // ----------------- 2. TỰ ĐỘNG PHÁT HIỆN & CHỌN VÉ 0Đ TRÊN LỊCH THÁNG -----------------
    function pickZeroDongFlight() {
        // Tìm các ô vé có cước 0 đ hoặc nhãn giá thấp nhất
        const cells = document.querySelectorAll('td, div, button, span');
        cells.forEach(el => {
            const text = (el.innerText || "").trim();
            // Nhận diện vé 0đ: "0 đ", "0 VND", "0đ"
            if (/^0\s*(đ|vnd|vnds)/i.test(text) || text === "0 đ" || text === "0đ") {
                if (!el.dataset.sniperClicked) {
                    el.dataset.sniperClicked = "true";
                    el.style.border = "3px solid #22c55e";
                    el.style.backgroundColor = "rgba(34, 197, 94, 0.2)";
                    console.log("🎯 [Sniper] PHÁT HIỆN VÉ 0 ĐỒNG! Đang tự động click chọn...");
                    el.click();
                    playAlarm();
                }
            }
        });
    }

    // ----------------- 3. BẢNG HIỂN THỊ TRẠNG THÁI GÓC MÀN HÌNH -----------------
    function showStatusBadge() {
        if (document.getElementById('vj-sniper-badge')) return;
        const b = document.createElement('div');
        b.id = 'vj-sniper-badge';
        b.innerHTML = `
            <div style="
                position: fixed;
                bottom: 15px;
                right: 15px;
                z-index: 999999;
                background: #0f172a;
                border: 1px solid #ef4444;
                border-radius: 12px;
                padding: 10px 14px;
                color: #fff;
                font-family: system-ui, sans-serif;
                font-size: 12px;
                display: flex;
                align-items: center;
                gap: 8px;
                box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5);
            ">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 9999px; background: #22c55e; animation: pulse 1.5s infinite;"></span>
                <span style="font-weight: bold; color: #ef4444;">VJ SNIPER:</span>
                <span>Tự hủy bảo hiểm + Bắt vé 0đ</span>
            </div>
            <style>
                @keyframes pulse {
                    0% { transform: scale(0.95); opacity: 0.7; }
                    50% { transform: scale(1.3); opacity: 1; }
                    100% { transform: scale(0.95); opacity: 0.7; }
                }
            </style>
        `;
        document.body.appendChild(b);
    }

    // Vòng lặp liên tục quét DOM
    setInterval(() => {
        uncheckInsurance();
        pickZeroDongFlight();
    }, 600);

    setTimeout(showStatusBadge, 1500);

})();
