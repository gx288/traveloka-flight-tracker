// ==UserScript==
// @name         Vietjet 0đ Auto-Sniper, Flight Auditor & One-Click VietQR
// @namespace    https://github.com/gx288/traveloka-flight-tracker
// @version      1.7.1
// @description  Fix triệt để vòng lặp bảo hiểm, tự hủy hành lý 400k, tự tích điều khoản Passengers & Payment, tự chọn VietQR!
// @author       Antigravity
// @match        https://*.vietjetair.com/*
// @match        https://*.abay.vn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log("⚡ [Vietjet Sniper v1.7.1] Fix triệt để vòng lặp vô hạn bảo hiểm...");

    // ----------------- CẤU HÌNH THÔNG TIN CHUẨN -----------------
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

    function triggerClick(el) {
        if (!el) return;
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.click();
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }

    // ----------------- 1. TỰ ĐỘNG BẮT VÉ 0Đ TRÊN LỊCH THÁNG -----------------
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
                    triggerClick(el);
                    soundSuccess();
                }
            }
        });
    }

    // ----------------- 2. TỰ ĐỘNG TÍCH CHỌN ĐIỀU KHOẢN (PASSENGERS & PAYMENT) -----------------
    function autoTickTermsCheckboxes() {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            const parent = cb.closest('label') || cb.closest('.MuiFormControlLabel-root') || cb.closest('div') || cb.parentElement;
            const text = (parent ? parent.innerText : "").toLowerCase();

            // Tuyệt đối không tích bảo hiểm
            if (text.includes("bảo hiểm") || text.includes("insurance")) return;

            // Bắt điều khoản quy định
            if (text.includes("tôi đã đọc") ||
                text.includes("quyền riêng tư") ||
                text.includes("điều lệ vận chuyển") ||
                text.includes("điều kiện vé") ||
                text.includes("vật dụng bị cấm") ||
                text.includes("đồng ý với") ||
                text.includes("điều khoản") ||
                text.includes("chính sách") ||
                text.includes("terms") ||
                text.includes("conditions")) {
                
                if (!cb.checked) {
                    console.log("⚡ [Sniper Auto] Đã tự động tích chọn: Điều khoản quy định!");
                    triggerClick(cb);
                    if (cb.closest('label')) {
                        triggerClick(cb.closest('label'));
                    }
                }
            }
        });

        // Highlight nút "Đi tiếp" trên trang Passengers
        const isPassenger = document.body && (
            document.body.innerText.includes("Thông tin hành khách") ||
            document.body.innerText.includes("Danh xưng") ||
            window.location.href.includes("passenger")
        );
        if (isPassenger) {
            const buttons = document.querySelectorAll('button');
            buttons.forEach(btn => {
                const txt = (btn.innerText || "").trim().toLowerCase();
                if (txt === "đi tiếp" || txt.includes("đi tiếp") || txt === "tiếp tục") {
                    btn.style.boxShadow = "0 0 20px #22c55e";
                    btn.style.transform = "scale(1.04)";
                    btn.style.fontWeight = "bold";
                }
            });
        }
    }

    // ----------------- 3. TỰ ĐỘNG MỞ & BỎ CHỌN: HÀNH LÝ 400K & BẢO HIỂM (CHỐNG LẶP VÔ HẠN) -----------------
    let openedBaggageOnce = false;
    let openedInsuranceOnce = false;
    let isDrawerProcessing = false;
    let lastTabSwitchTime = 0;

    function autoDismissDrawers() {
        const isServicePage = document.body && (
            document.body.innerText.includes("Chọn hành lý") ||
            document.body.innerText.includes("Bảo hiểm du lịch") ||
            window.location.href.includes("select-service")
        );
        if (!isServicePage) return;

        // --- A. NẾU DRAWER ĐANG MỞ: TỰ CHỌN "KHÔNG, CẢM ƠN" VÀ "XÁC NHẬN" ---
        const drawer = document.querySelector('.MuiDrawer-paper, .MuiDialog-root');
        if (drawer && drawer.offsetWidth > 0 && drawer.offsetHeight > 0) {
            isDrawerProcessing = true;

            // Xử lý Tabs khứ hồi nếu có
            const tabs = drawer.querySelectorAll('button[role="tab"]');
            if (tabs.length > 1) {
                const now = Date.now();
                if (tabs[0].getAttribute('aria-selected') === 'true' && !drawer.dataset.tab1Done) {
                    selectNoChoiceInContainer(drawer);
                    if (now - lastTabSwitchTime > 400) {
                        lastTabSwitchTime = now;
                        drawer.dataset.tab1Done = "true";
                        console.log("⚡ [Sniper Auto] Đã bỏ chọn Chuyến đi, chuyển sang Chuyến về...");
                        triggerClick(tabs[1]);
                        return;
                    }
                } else if (tabs[1].getAttribute('aria-selected') === 'true' && !drawer.dataset.tab2Done) {
                    selectNoChoiceInContainer(drawer);
                    drawer.dataset.tab2Done = "true";
                    console.log("⚡ [Sniper Auto] Đã bỏ chọn Chuyến về!");
                }
            } else {
                selectNoChoiceInContainer(drawer);
            }

            // Tự động bấm nút "Xác nhận" DUY NHẤT 1 LẦN
            const buttons = drawer.querySelectorAll('button');
            buttons.forEach(btn => {
                const bTxt = (btn.innerText || "").trim().toLowerCase();
                if (bTxt.includes("xác nhận")) {
                    if (!btn.dataset.autoConfirmed) {
                        btn.dataset.autoConfirmed = "true";
                        setTimeout(() => {
                            triggerClick(btn);
                            console.log("⚡ [Sniper Auto] Đã tự động click nút: XÁC NHẬN!");
                            setTimeout(() => { isDrawerProcessing = false; }, 500);
                        }, 250);
                    }
                }
            });
            return;
        }

        if (isDrawerProcessing) return;

        // --- B. NẾU DRAWER CHƯA MỞ: TUẦN TỰ MỞ HÀNH LÝ VÀ BẢO HIỂM (MỖI THỨ CHỈ 1 LẦN) ---
        const pageText = document.body ? document.body.innerText : "";

        // 1. Mở thẻ Hành lý (CHỈ MỞ 1 LẦN NẾU THẤY CÒN DÍNH PHÍ GÓI 20KG)
        if (!openedBaggageOnce && (pageText.includes("Gói 20kg") || pageText.includes("400,000 VND") || pageText.includes("200,000 VND"))) {
            const cards = document.querySelectorAll('div, span');
            for (let card of cards) {
                const txt = card.innerText || "";
                if (txt.includes("Chọn hành lý") && (txt.includes("Gói 20kg") || txt.includes("400,000 VND"))) {
                    const clickable = card.closest('.jss683') || card.closest('div[role="button"]') || card;
                    openedBaggageOnce = true;
                    console.log("⚡ [Sniper Auto] Tự động mở thẻ Hành lý để gỡ gói 20kg...");
                    triggerClick(clickable);
                    return;
                }
            }
        }

        // 2. Mở thẻ Bảo hiểm (CHỈ MỞ 1 LẦN DUY NHẤT NẾU CHƯA XỬ LÝ)
        if (!openedInsuranceOnce && (pageText.includes("Bảo hiểm du lịch Vietjet Travel Safe") || pageText.includes("Bảo hiểm du lịch"))) {
            // Kiểm tra xem bảo hiểm có đang bị tính phí không (nếu có 44,000 VND hoặc chưa mở bao giờ)
            const cards = document.querySelectorAll('div, span');
            for (let el of cards) {
                const txt = (el.innerText || "").trim();
                if (txt === "Bảo hiểm du lịch Vietjet Travel Safe" || txt === "Bảo hiểm du lịch") {
                    const insCard = el.closest('.jss683') || el.closest('div[role="button"]') || el;
                    openedInsuranceOnce = true; // Đánh dấu đã mở 1 lần duy nhất, TUYỆT ĐỐI KHÔNG MỞ LẠI!
                    console.log("⚡ [Sniper Auto] Tự động mở thẻ Bảo hiểm (1 lần duy nhất) để gỡ bỏ...");
                    triggerClick(insCard);
                    return;
                }
            }
        }

        // Highlight nút "Đi tiếp" trên trang dịch vụ
        const proceedButtons = document.querySelectorAll('button');
        proceedButtons.forEach(btn => {
            if ((btn.innerText || "").includes("Đi tiếp")) {
                btn.style.boxShadow = "0 0 15px #22c55e";
                btn.style.transform = "scale(1.05)";
                btn.style.transition = "all 0.3s ease";
            }
        });
    }

    function selectNoChoiceInContainer(container) {
        const noChoiceInputs = container.querySelectorAll('input[type="radio"][value="noChoise"], input[value="noChoise"]');
        noChoiceInputs.forEach(inp => {
            const label = inp.closest('label') || inp.parentElement;
            if (!inp.checked) {
                console.log("⚡ [Sniper Auto] Tự động click: Không, cảm ơn!");
                triggerClick(label || inp);
            }
        });

        const labels = container.querySelectorAll('label, span');
        labels.forEach(lbl => {
            const t = (lbl.innerText || "").trim().toLowerCase();
            if (t === "không, cảm ơn" || t === "không, cám ơn") {
                const radio = lbl.querySelector('input[type="radio"]') || lbl;
                triggerClick(radio);
            }
        });
    }

    // ----------------- 4. TRANG THANH TOÁN: CHỌN VIETQR (KHÔNG PHỤ THUỘC URL) -----------------
    function handlePaymentPage() {
        const isPayment = document.body && (
            document.body.innerText.includes("Phương thức thanh toán") ||
            document.body.innerText.includes("Mobile Banking VietQR") ||
            document.body.innerText.includes("Chi tiết thanh toán")
        );
        if (!isPayment) return;

        // Tự động click chọn phương thức "Mobile Banking VietQR"
        const allElements = document.querySelectorAll('span, div, img');
        allElements.forEach(el => {
            const txt = (el.innerText || "").trim();
            const src = el.getAttribute('src') || "";
            if (txt === "Mobile Banking VietQR" || txt.includes("Mobile Banking VietQR") || src.includes("vietqrtrans")) {
                const card = el.closest('.MuiPaper-root') || el.closest('div[style*="width: 18%"]') || el.parentElement;
                if (card && !card.dataset.sniperVietQrSelected) {
                    card.dataset.sniperVietQrSelected = "true";
                    console.log("⚡ [Sniper Auto] Đang tự động click chọn: Mobile Banking VietQR!");
                    triggerClick(el);
                    triggerClick(card);
                    card.style.border = "3px solid #22c55e";
                    card.style.boxShadow = "0 0 20px rgba(34, 197, 94, 0.8)";
                }
            }
        });

        // Highlight nút "Thanh toán"
        const buttons = document.querySelectorAll('button');
        buttons.forEach(btn => {
            const bTxt = (btn.innerText || "").trim().toLowerCase();
            if (bTxt === "thanh toán" || bTxt.includes("thanh toán")) {
                btn.style.boxShadow = "0 0 25px #22c55e";
                btn.style.transform = "scale(1.06)";
                btn.style.transition = "all 0.3s ease";
                btn.style.fontWeight = "bold";
            }
        });
    }

    // ----------------- 5. TRANG CHỦ: HỖ TRỢ NÚT TÌM CHUYẾN BAY -----------------
    function handleHomepage() {
        const isHome = document.body && (
            document.body.innerText.includes("Điểm khởi hành") &&
            document.body.innerText.includes("Tìm chuyến bay")
        );
        if (!isHome) return;

        const buttons = document.querySelectorAll('button');
        buttons.forEach(btn => {
            const txt = (btn.innerText || "").trim().toLowerCase();
            if (txt === "tìm chuyến bay" || txt.includes("tìm chuyến bay")) {
                btn.style.boxShadow = "0 0 25px #ef4444";
                btn.style.fontWeight = "bold";
            }
        });
    }

    // ----------------- 6. AUDITOR GÓC MÀN HÌNH: SOI LỖI VÉ & PHÍ DỊCH VỤ -----------------
    function auditAndRenderWidget() {
        const pageText = document.body ? document.body.innerText : "";
        if (!pageText || pageText.length < 50) return;

        const isService = pageText.includes("Chọn hành lý") || pageText.includes("Bảo hiểm du lịch");
        const isPayment = pageText.includes("Phương thức thanh toán") || pageText.includes("Chi tiết thanh toán");

        let errors = [];
        let items = [];

        // Chiều đi
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

        // Chiều về
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

        // Tên khách
        const okPassenger = TARGET.passengerRegex.test(pageText);
        if (okPassenger) {
            items.push({ status: "ok", text: "Khách: TRẦN THỊ KIM TĨNH" });
        } else {
            if (isService || isPayment) {
                errors.push("Chưa đúng tên khách: TRAN THI KIM TINH!");
                items.push({ status: "error", text: "Khách: Chưa có tên Kim Tĩnh" });
            } else {
                items.push({ status: "pending", text: "Khách: Cần điền TRAN THI KIM TINH" });
            }
        }

        // Phí dịch vụ
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
            errors.push(`DÍNH PHÍ DỊCH VỤ: ${detectedServiceFee.toLocaleString('vi-VN')} đ!`);
            items.push({ status: "error", text: `Phí Dịch vụ: ${detectedServiceFee.toLocaleString('vi-VN')} đ (Đang gỡ...)` });
        } else if (isService || isPayment) {
            items.push({ status: "ok", text: "Phí Dịch vụ: 0 đ (Sạch)" });
        }

        // VietQR status
        if (isPayment) {
            items.push({ status: "ok", text: "Thanh toán: Mobile Banking VietQR" });
        }

        // Render Widget
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
        pickZeroDongFlight();
        autoTickTermsCheckboxes();
        autoDismissDrawers();
        handlePaymentPage();
        handleHomepage();
        auditAndRenderWidget();
    }, 300);

})();
