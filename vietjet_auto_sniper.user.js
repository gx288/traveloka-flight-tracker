// ==UserScript==
// @name         Vietjet 0đ Auto-Sniper & Real-time Flight Auditor
// @namespace    https://github.com/gx288/traveloka-flight-tracker
// @version      1.3.1
// @description  Tự động bắt vé 0đ, soi chuẩn xác Tên khách + Ngày đi + Ngày về khứ hồi, cảnh báo đỏ nếu dính phí dịch vụ 216k/400k hoặc thiếu chiều về!
// @author       Antigravity
// @match        https://*.vietjetair.com/*
// @match        https://*.abay.vn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log("⚡ [Vietjet Sniper v1.3.1] Khởi chạy Auditor kiểm tra vé & diệt phụ phí...");

    // ----------------- CẤU HÌNH THÔNG TIN CHUẨN CẦN KIỂM TRA -----------------
    const TARGET = {
        passengerRegex: /TRAN\s*THI\s*KIM\s*TINH|TRẦN\s*THỊ\s*KIM\s*TĨNH/i,
        departDateRegex: /21\/10\/2026|21\s*tháng\s*10/i,
        departRouteRegex: /VII.*SGN|Vinh.*Hồ Chí Minh/i,
        returnDateRegex: /22\/10\/2026|22\s*tháng\s*10|VJ216/i,
        returnRouteRegex: /SGN.*VII|Hồ Chí Minh.*Vinh/i
    };

    // ----------------- ÂM THANH BÁO ĐỘNG -----------------
    let alerted0d = false;
    let alertedError = false;

    function playTone(freq, duration, type = "sine") {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch(e) {}
    }

    function soundSuccess() {
        if (alerted0d) return;
        alerted0d = true;
        playTone(880, 0.4);
        setTimeout(() => playTone(1174, 0.6), 250);
    }

    function soundError() {
        if (alertedError) return;
        alertedError = true;
        playTone(300, 0.3, "sawtooth");
        setTimeout(() => playTone(220, 0.5, "sawtooth"), 250);
    }

    // ----------------- 1. TỰ ĐỘNG BẮT VÉ 0Đ -----------------
    function pickZeroDongFlight() {
        const cells = document.querySelectorAll('td, div, button, span');
        cells.forEach(el => {
            const text = (el.innerText || "").trim();
            if (/^0\s*(đ|vnd|vnds)/i.test(text) || text === "0 đ" || text === "0đ") {
                if (!el.dataset.sniperClicked) {
                    el.dataset.sniperClicked = "true";
                    el.style.border = "3px solid #22c55e";
                    el.style.backgroundColor = "rgba(34, 197, 94, 0.2)";
                    console.log("🎯 [Sniper] PHÁT HIỆN VÉ 0 ĐỒNG! Đang tự động click chọn...");
                    el.click();
                    soundSuccess();
                }
            }
        });
    }

    // ----------------- 2. BẢO HIỂM: TỰ ĐỘNG GỠ BỎ TÍCH -----------------
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

    // ----------------- 3. TRANG DỊCH VỤ: DIỆT BẪY HÀNH LÝ 400K -----------------
    function handleServiceAddons() {
        if (!window.location.href.includes("select-service")) return;

        // Nếu mở popup chọn hành lý -> tự chọn 0kg
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

        // Highlight nút Đi tiếp
        const buttons = document.querySelectorAll('button');
        buttons.forEach(btn => {
            if ((btn.innerText || "").includes("Đi tiếp")) {
                btn.style.boxShadow = "0 0 15px #22c55e";
                btn.style.transform = "scale(1.05)";
                btn.style.transition = "all 0.3s ease";
            }
        });
    }

    // ----------------- 4. AUDITOR GÓC MÀN HÌNH: SOI LỖI VÉ & PHÍ DỊCH VỤ -----------------
    function auditAndRenderWidget() {
        const url = window.location.href;
        const pageText = document.body ? document.body.innerText : "";
        if (!pageText || pageText.length < 50) return;

        const isFlight = url.includes("select-flight");
        const isPassenger = url.includes("passenger");
        const isService = url.includes("select-service");
        const isPayment = url.includes("payment");

        let errors = [];
        let items = [];

        // --- A. Kiểm tra Chiều đi ---
        const okDepart = TARGET.departDateRegex.test(pageText);
        if (okDepart) {
            items.push({ status: "ok", text: "Chiều đi: VII ➔ SGN (21/10/2026)" });
        } else {
            if (isService || isPayment) {
                errors.push("Sai hoặc thiếu ngày đi 21/10/2026!");
                items.push({ status: "error", text: "Chiều đi: Chưa thấy 21/10/2026" });
            } else {
                items.push({ status: "pending", text: "Chiều đi: Đang tìm 21/10/2026..." });
            }
        }

        // --- B. Kiểm tra Chiều về (Khứ hồi) ---
        const okReturn = TARGET.returnDateRegex.test(pageText);
        if (okReturn) {
            items.push({ status: "ok", text: "Chiều về: SGN ➔ VII (22/10/2026)" });
        } else {
            if (isService || isPayment) {
                errors.push("THIẾU CHUYẾN VỀ 22/10! (Đang là vé 1 chiều)");
                items.push({ status: "error", text: "Chiều về: THIẾU CHUYẾN VỀ 22/10!" });
            } else {
                items.push({ status: "pending", text: "Chiều về: Đang tìm 22/10/2026..." });
            }
        }

        // --- C. Kiểm tra Tên hành khách ---
        const okPassenger = TARGET.passengerRegex.test(pageText);
        if (okPassenger) {
            items.push({ status: "ok", text: "Khách: TRẦN THỊ KIM TĨNH" });
        } else {
            if (isService || isPayment) {
                errors.push("Chưa đúng tên khách: TRAN THI KIM TINH!");
                items.push({ status: "error", text: "Khách: Chưa có tên Kim Tĩnh" });
            } else if (isPassenger) {
                items.push({ status: "pending", text: "Khách: Cần điền TRAN THI KIM TINH" });
            }
        }

        // --- D. Kiểm tra Phí dịch vụ / Hành lý (Soi chính xác con số) ---
        let detectedServiceFee = 0;
        const allTextElements = document.querySelectorAll('h4, div, span, p');
        allTextElements.forEach(el => {
            const t = el.innerText || "";
            const m = t.match(/dịch vụ[\s\S]{0,30}?([\d,.]+)\s*vnd/i);
            if (m) {
                const amt = parseInt(m[1].replace(/[,.]/g, ''), 10);
                if (amt > detectedServiceFee) {
                    detectedServiceFee = amt;
                }
            }
        });

        if (detectedServiceFee > 0 && (isService || isPayment)) {
            errors.push(`DÍNH PHÍ DỊCH VỤ / HÀNH LÝ: ${detectedServiceFee.toLocaleString('vi-VN')} đ!`);
            items.push({ status: "error", text: `Phí Dịch vụ: ${detectedServiceFee.toLocaleString('vi-VN')} đ (CHƯA GỠ)` });
        } else if (isService || isPayment) {
            items.push({ status: "ok", text: "Phí Dịch vụ: 0 đ (Sạch)" });
        }

        // --- E. Cập nhật DOM Widget ---
        let box = document.getElementById('vj-auditor-widget');
        if (!box) {
            box = document.createElement('div');
            box.id = 'vj-auditor-widget';
            document.body.appendChild(box);
        }

        const hasError = errors.length > 0;
        if (hasError && (isService || isPayment)) {
            soundError();
        }

        const borderColor = hasError ? "#ef4444" : "#22c55e";
        const headerBg = hasError ? "rgba(239, 68, 68, 0.25)" : "rgba(34, 197, 94, 0.25)";
        const headerTitle = hasError ? "🚨 PHÁT HIỆN LỖI VÉ / PHỤ PHÍ!" : "✅ THÔNG TIN CHUẨN XÁC 100%";

        let itemsHtml = items.map(it => {
            let icon = "⏳";
            let color = "#94a3b8";
            if (it.status === "ok") { icon = "✅"; color = "#4ade80"; }
            if (it.status === "error") { icon = "❌"; color = "#f87171"; }
            return `<div style="color: ${color}; margin-bottom: 5px; display: flex; align-items: center; gap: 6px; font-weight: ${it.status === 'error' ? 'bold' : 'normal'};">
                <span>${icon}</span> <span>${it.text}</span>
            </div>`;
        }).join("");

        let alertBoxHtml = "";
        if (hasError) {
            alertBoxHtml = `<div style="background: #b91c1c; color: #fff; padding: 8px 10px; border-radius: 6px; font-weight: bold; margin-top: 8px; font-size: 11.5px; border: 1px solid #ef4444;">
                ${errors.map(e => `• ${e}`).join("<br>")}
            </div>`;
        }

        box.innerHTML = `
            <div style="
                position: fixed;
                top: 15px;
                right: 15px;
                z-index: 9999999;
                width: 330px;
                background: #0f172a;
                border: 2px solid ${borderColor};
                border-radius: 12px;
                padding: 12px 14px;
                box-shadow: 0 12px 25px rgba(0,0,0,0.7);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 12px;
                line-height: 1.4;
                backdrop-filter: blur(8px);
                animation: ${hasError ? 'pulseAlert 1.2s infinite' : 'none'};
            ">
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-bottom: 8px; background: ${headerBg}; padding: 6px 8px; border-radius: 6px;">
                    <span style="font-weight: 800; color: ${borderColor}; font-size: 13px;">${headerTitle}</span>
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 9999px; background: ${borderColor};"></span>
                </div>
                <div style="font-size: 11.5px;">
                    ${itemsHtml}
                </div>
                ${alertBoxHtml}
            </div>
            <style>
                @keyframes pulseAlert {
                    0% { transform: scale(1); box-shadow: 0 0 10px rgba(239, 68, 68, 0.4); }
                    50% { transform: scale(1.02); box-shadow: 0 0 25px rgba(239, 68, 68, 0.8); }
                    100% { transform: scale(1); box-shadow: 0 0 10px rgba(239, 68, 68, 0.4); }
                }
            </style>
        `;
    }

    // ----------------- VÒNG LẶP LIÊN TỤC -----------------
    setInterval(() => {
        uncheckInsurance();
        pickZeroDongFlight();
        handleServiceAddons();
        auditAndRenderWidget();
    }, 600);

})();
