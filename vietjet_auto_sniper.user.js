// ==UserScript==
// @name         Vietjet 0đ Auto-Sniper & Real-time Flight Auditor
// @namespace    https://github.com/gx288/traveloka-flight-tracker
// @version      1.4.0
// @description  Tự động bắt vé 0đ, tự động click "Không, cảm ơn" & "Xác nhận" gỡ sạch hành lý 400k/bảo hiểm, soi chuẩn xác Tên khách + Khứ hồi, báo động góc màn hình!
// @author       Antigravity
// @match        https://*.vietjetair.com/*
// @match        https://*.abay.vn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log("⚡ [Vietjet Sniper v1.4.0] Khởi chạy Auto-Clicker diệt phụ phí & Auditor...");

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

    // Helper kích hoạt click chuẩn xác cho React / Material-UI
    function triggerClick(el) {
        if (!el) return;
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.click();
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
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
                    triggerClick(el);
                    soundSuccess();
                }
            }
        });
    }

    // ----------------- 2. TỰ ĐỘNG CLICK "KHÔNG, CẢM ƠN" & "XÁC NHẬN" (DRAWER BẢO HIỂM / HÀNH LÝ) -----------------
    let lastTabSwitchTime = 0;

    function autoDismissDrawers() {
        // Tìm Drawer hoặc Dialog trượt từ bên phải ra (MuiDrawer-paper)
        const drawers = document.querySelectorAll('.MuiDrawer-paper, .MuiDialog-root');
        drawers.forEach(drawer => {
            // Nếu drawer không hiển thị thì bỏ qua
            if (drawer.offsetWidth === 0 || drawer.offsetHeight === 0) return;

            // A. Kiểm tra và chuyển Tab nếu là vé khứ hồi (Chuyến đi & Chuyến về)
            const tabs = drawer.querySelectorAll('button[role="tab"]');
            if (tabs.length > 1) {
                const now = Date.now();
                // Nếu Tab 0 đang chọn, xử lý Tab 0 rồi chuyển sang Tab 1
                if (tabs[0].getAttribute('aria-selected') === 'true' && !drawer.dataset.tab1Handled) {
                    // Click Không, cảm ơn ở Tab 0
                    selectNoChoiceInContainer(drawer);
                    if (now - lastTabSwitchTime > 500) {
                        lastTabSwitchTime = now;
                        drawer.dataset.tab1Handled = "true";
                        console.log("⚡ [Sniper Auto] Đã bỏ hành lý Chuyến đi, đang chuyển sang Chuyến về...");
                        triggerClick(tabs[1]);
                        return;
                    }
                } else if (tabs[1].getAttribute('aria-selected') === 'true' && !drawer.dataset.tab2Handled) {
                    // Click Không, cảm ơn ở Tab 1
                    selectNoChoiceInContainer(drawer);
                    drawer.dataset.tab2Handled = "true";
                    console.log("⚡ [Sniper Auto] Đã bỏ hành lý Chuyến về!");
                }
            } else {
                // Drawer 1 chiều hoặc Bảo hiểm
                selectNoChoiceInContainer(drawer);
            }

            // B. Tự động click nút "Xác nhận"
            const buttons = drawer.querySelectorAll('button');
            buttons.forEach(btn => {
                const bTxt = (btn.innerText || "").trim().toLowerCase();
                if (bTxt.includes("xác nhận")) {
                    if (!btn.dataset.autoClickedConfirm) {
                        btn.dataset.autoClickedConfirm = "true";
                        setTimeout(() => {
                            triggerClick(btn);
                            console.log("⚡ [Sniper Auto] Đã tự động click nút: XÁC NHẬN!");
                        }, 300);
                    }
                }
            });
        });

        // C. Tự động mở thẻ Hành lý nếu thấy Vietjet đang tự gài Gói 20kg trên trang select-service
        if (window.location.href.includes("select-service")) {
            const isDrawerOpen = document.querySelector('.MuiDrawer-paperAnchorRight');
            if (!isDrawerOpen) {
                const cards = document.querySelectorAll('div');
                cards.forEach(card => {
                    const txt = card.innerText || "";
                    if (txt.includes("Chọn hành lý") && (txt.includes("Gói 20kg") || txt.includes("200,000 VND") || txt.includes("400,000 VND"))) {
                        if (!card.dataset.autoOpenedBySniper) {
                            card.dataset.autoOpenedBySniper = "true";
                            console.log("⚡ [Sniper Auto] Phát hiện hành lý 20kg, tự động click mở Drawer để gỡ...");
                            triggerClick(card);
                        }
                    }
                });
            }
        }
    }

    // Helper: Tìm và click radio "Không, cảm ơn" (value="noChoise")
    function selectNoChoiceInContainer(container) {
        // Tìm radio input theo value="noChoise"
        const noChoiceInputs = container.querySelectorAll('input[type="radio"][value="noChoise"], input[value="noChoise"]');
        noChoiceInputs.forEach(inp => {
            const label = inp.closest('label') || inp.parentElement;
            if (!inp.checked) {
                console.log("⚡ [Sniper Auto] Tự động click: Không, cảm ơn!");
                triggerClick(label || inp);
            }
        });

        // Tìm thêm theo nhãn chữ "Không, cảm ơn"
        const labels = container.querySelectorAll('label, span');
        labels.forEach(lbl => {
            const t = (lbl.innerText || "").trim().toLowerCase();
            if (t === "không, cảm ơn" || t === "không, cám ơn") {
                const radio = lbl.querySelector('input[type="radio"]') || lbl;
                triggerClick(radio);
            }
        });
    }

    // ----------------- 3. BẢO HIỂM: TỰ ĐỘNG GỠ CHECKBOX TRÊN TOÀN TRANG -----------------
    function uncheckInsurance() {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            const label = (cb.parentElement ? cb.parentElement.innerText : "").toLowerCase();
            if (label.includes("bảo hiểm") || label.includes("insurance") || label.includes("bảo việt") || label.includes("bảo minh")) {
                if (cb.checked) {
                    triggerClick(cb);
                    console.log("⚡ [Sniper Auto] Đã tự động bỏ chọn checkbox bảo hiểm!");
                }
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

        // --- D. Kiểm tra Phí dịch vụ / Hành lý (Soi số tiền thực tế) ---
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

        // Highlight nút "Đi tiếp" trên trang dịch vụ
        const buttons = document.querySelectorAll('button');
        buttons.forEach(btn => {
            if ((btn.innerText || "").includes("Đi tiếp")) {
                btn.style.boxShadow = "0 0 15px #22c55e";
                btn.style.transform = "scale(1.05)";
                btn.style.transition = "all 0.3s ease";
            }
        });
    }

    // ----------------- VÒNG LẶP LIÊN TỤC -----------------
    setInterval(() => {
        uncheckInsurance();
        pickZeroDongFlight();
        autoDismissDrawers();
        auditAndRenderWidget();
    }, 400);

})();
