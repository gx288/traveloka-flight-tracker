// ==UserScript==
// @name         Vietjet 0đ Auto-Sniper (Chuyên săn vé 0đ & Tự hủy phụ phí/Hành lý)
// @namespace    https://github.com/gx288/traveloka-flight-tracker
// @version      1.2.0
// @description  Tự động bắt vé 0đ, tự gỡ bẫy hành lý 400k & bảo hiểm phụ thu, highlight nút Đi tiếp sang thanh toán VietQR.
// @author       Antigravity
// @match        https://*.vietjetair.com/*
// @match        https://*.abay.vn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log("⚡ [Vietjet Sniper v1.2] Đang kích hoạt chế độ săn vé 0đ & triệt tiêu phụ phí...");

    // ----------------- 1. ÂM THANH BÁO ĐỘNG KHI TÌM THẤY VÉ 0Đ -----------------
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

    // ----------------- 2. TỰ ĐỘNG PHÁT HIỆN & CHỌN VÉ 0Đ TRÊN LỊCH THÁNG -----------------
    function pickZeroDongFlight() {
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

    // ----------------- 3. BẢO HIỂM: TỰ ĐỘNG GỠ BỎ TÍCH -----------------
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

    // ----------------- 4. TRANG DỊCH VỤ (select-service): CẢNH BÁO BẪY HÀNH LÝ 400K -----------------
    function handleServiceAddons() {
        if (!window.location.href.includes("select-service")) return;

        // Quét thẻ hành lý ký gửi
        const allDivs = document.querySelectorAll('div, span');
        allDivs.forEach(el => {
            const text = el.innerText || "";
            // Nếu phát hiện Vietjet đang tự gài gói 20kg hoặc 400.000 VND
            if (text.includes("Chọn hành lý") && (text.includes("Gói 20kg") || text.includes("400,000 VND"))) {
                if (!el.dataset.luggageWarned) {
                    el.dataset.luggageWarned = "true";
                    el.style.border = "3px dashed #ef4444";
                    el.style.backgroundColor = "rgba(239, 68, 68, 0.1)";

                    // Thêm thanh thông báo nhắc nhở ngay trên thẻ
                    const warnNotice = document.createElement('div');
                    warnNotice.style.cssText = "background: #ef4444; color: #fff; padding: 6px 10px; font-weight: bold; font-size: 13px; border-radius: 6px; margin-bottom: 8px; text-align: center;";
                    warnNotice.innerHTML = "⚠️ CẢNH BÁO: Vietjet đang tự chọn Gói 20kg (+400k)! Nhấp vào đây chọn 0kg nếu chỉ mang xách tay.";
                    el.prepend(warnNotice);
                    console.log("⚠️ [Sniper] Phát hiện bẫy hành lý 400k! Đã cảnh báo trên màn hình.");
                }
            }
        });

        // Nếu người dùng mở modal/drawer chọn hành lý, tự động ưu tiên click "Không chọn" / "0 kg"
        const modalOptions = document.querySelectorAll('.MuiDialog-root div, .MuiDrawer-root div, div[role="dialog"] div');
        modalOptions.forEach(opt => {
            const optText = (opt.innerText || "").toLowerCase().trim();
            if (optText === "không có hành lý" || optText === "không chọn hành lý" || optText === "0 kg" || optText === "0kg (0 vnd)") {
                if (!opt.dataset.sniperSelected) {
                    opt.dataset.sniperSelected = "true";
                    opt.style.border = "2px solid #22c55e";
                    opt.click();
                    console.log("⚡ [Sniper] Đã tự động chọn: Không có hành lý (0đ)!");
                }
            }
        });

        // Làm nổi bật nút "Đi tiếp" để thao tác cực nhanh
        const buttons = document.querySelectorAll('button');
        buttons.forEach(btn => {
            if ((btn.innerText || "").includes("Đi tiếp")) {
                btn.style.boxShadow = "0 0 15px #22c55e";
                btn.style.transform = "scale(1.05)";
                btn.style.transition = "all 0.3s ease";
            }
        });
    }

    // ----------------- 5. BẢNG HIỂN THỊ TRẠNG THÁI GÓC MÀN HÌNH -----------------
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
                border: 1px solid #22c55e;
                border-radius: 12px;
                padding: 10px 14px;
                color: #fff;
                font-family: system-ui, sans-serif;
                font-size: 12px;
                display: flex;
                align-items: center;
                gap: 8px;
                box-shadow: 0 10px 20px rgba(0,0,0,0.6);
            ">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 9999px; background: #22c55e; animation: pulse 1.5s infinite;"></span>
                <span style="font-weight: bold; color: #22c55e;">VJ SNIPER v1.2:</span>
                <span>Sẵn sàng bắt 0đ & diệt phụ phí 400k</span>
            </div>
            <style>
                @keyframes pulse {
                    0% { transform: scale(0.95); opacity: 0.7; }
                    50% { transform: scale(1.4); opacity: 1; }
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
        handleServiceAddons();
    }, 600);

    setTimeout(showStatusBadge, 1200);

})();
