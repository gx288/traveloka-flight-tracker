// ==UserScript==
// @name         Vietjet 0đ Sniper v2 (Bắt 0đ + Gỡ hành lý/bảo hiểm + VietQR + Auditor)
// @namespace    https://github.com/gx288/traveloka-flight-tracker
// @version      2.0.0
// @description  Viết lại sạch: phát hiện vé 0đ đúng định dạng giá Vietjet, gỡ hành lý/bảo hiểm 1 lần không lặp, tích điều khoản, chọn VietQR có kiểm tra, bảng soi lỗi không chặn click.
// @author       Antigravity
// @match        https://*.vietjetair.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ======================= CẤU HÌNH =======================
    const CFG = {
        passengerRegex: /TRAN\s*THI\s*KIM\s*TINH|TRẦN\s*THỊ\s*KIM\s*TĨNH/i,
        departDate: '21/10/2026',
        returnDate: '22/10/2026',      // để '' nếu bay 1 chiều
        AUTO_CLICK_ZERO: false,        // true = tự click vé 0đ đầu tiên (có thể chọn sai giờ bay)
        TICK_MS: 500,
    };

    const BAGGAGE_TITLE = 'Chọn hành lý/Dịch vụ nối chuyến';
    const INSURANCE_TITLE = 'Bảo hiểm du lịch Vietjet Travel Safe';
    const log = (...a) => console.log('⚡[VJ Sniper]', ...a);

    // ======================= TIỆN ÍCH =======================
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const txt = el => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    const visible = el => !!el && el.offsetWidth > 0 && el.offsetHeight > 0;
    const digits = s => parseInt(String(s).replace(/[^\d]/g, ''), 10);

    function click(el) {
        if (!el) return;
        if (typeof el.click === 'function') el.click();
        else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }

    function beep(freqs) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            freqs.forEach((f, i) => {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.connect(g); g.connect(ctx.destination);
                o.frequency.value = f; g.gain.value = 0.3;
                o.start(ctx.currentTime + i * 0.25);
                o.stop(ctx.currentTime + i * 0.25 + 0.22);
            });
        } catch (e) { /* trình duyệt chặn audio khi chưa tương tác */ }
    }

    function findByExactText(selector, text) {
        for (const el of document.querySelectorAll(selector)) {
            if (txt(el) === text) return el;
        }
        return null;
    }

    // Thẻ dịch vụ = tổ tiên cao nhất vẫn có cursor:pointer (thẻ .jssXXX có cursor:pointer)
    function cardOf(el) {
        let card = el, cur = el;
        for (let i = 0; i < 10 && cur && cur !== document.body; i++) {
            if (getComputedStyle(cur).cursor === 'pointer') card = cur;
            cur = cur.parentElement;
        }
        return card;
    }

    // ======================= TRẠNG THÁI THEO TRANG =======================
    let page = '';
    let S = {};
    function resetState() {
        S = {
            zeroAlerted: false, zeroClicked: false,
            bagTries: 0, insDone: false, lastOpen: 0, busy: false, handledDrawers: new Set(),
            qrDone: false, qrTries: 0, qrLast: 0,
            errBeeped: false, widgetHtml: '',
        };
    }
    resetState();

    function detectPage(t) {
        if (t.includes('Phương thức thanh toán') && t.includes('Chi tiết thanh toán')) return 'payment';
        if (t.includes(BAGGAGE_TITLE) || t.includes(INSURANCE_TITLE)) return 'service';
        if (t.includes('Tôi đã đọc, hiểu và đồng ý') || (t.includes('Thông tin hành khách') && t.includes('Danh xưng'))) return 'passengers';
        if (t.includes('Bay thẳng') || t.includes('Hết chỗ') || /\d{1,2} tháng \d{1,2}/.test(t) && t.includes('VND')) return 'flight';
        if (t.includes('Điểm khởi hành') && t.includes('Tìm chuyến bay')) return 'home';
        return 'other';
    }

    // ======================= 1. VÉ 0Đ (trang chọn chuyến) =======================
    // Giá hiển thị tách node: "375" + "000 VND"  →  vé 0đ = "0" + "000 VND" hoặc "0 VND"
    function scanZeroFares() {
        const zeros = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: n => /VND/i.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
        });
        let n;
        while ((n = walker.nextNode())) {
            let priceEl = null, cur = n.parentElement;
            for (let i = 0; i < 3 && cur; i++) {
                if (/^(Từ\s*)?\d[\d.,\s]*VND$/i.test(txt(cur))) priceEl = cur;
                cur = cur.parentElement;
            }
            if (!priceEl || digits(txt(priceEl)) !== 0 || zeros.includes(priceEl)) continue;
            // Bỏ qua cột "Thông tin đặt chỗ" (Tổng tiền / Dịch vụ / Giá vé / Thuế, phí = 0 VND khi chưa chọn)
            const ctx = txt(priceEl.parentElement) + ' ' + txt(priceEl.parentElement && priceEl.parentElement.parentElement);
            if (/Tổng tiền|Dịch vụ|Giá vé|Thuế|Tạm tính|Phí tiện ích|Mã khuyến mãi/i.test(ctx)) continue;
            zeros.push(priceEl);
        }
        zeros.forEach(el => {
            el.style.outline = '3px solid #22c55e';
            el.style.background = 'rgba(34,197,94,.25)';
        });
        if (zeros.length && !S.zeroAlerted) {
            S.zeroAlerted = true;
            log(`PHÁT HIỆN ${zeros.length} vé 0đ!`);
            beep([880, 1175, 1568]);
        }
        if (zeros.length && CFG.AUTO_CLICK_ZERO && !S.zeroClicked) {
            S.zeroClicked = true;
            click(zeros[0]);
        }
    }

    // ======================= 2. TÍCH ĐIỀU KHOẢN =======================
    const tickTimes = new WeakMap();
    function tickTerms() {
        for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
            if (cb.disabled) continue;
            let label = '', cur = cb.parentElement;
            for (let i = 0; i < 6 && cur; i++) {
                const t = txt(cur);
                if (t.length >= 15) { label = t; break; }
                cur = cur.parentElement;
            }
            if (!label || label.length > 800) continue;
            if (/bảo hiểm|insurance/i.test(label)) continue;
            if (!/tôi đã đọc|điều lệ vận chuyển/i.test(label)) continue;

            const root = cb.closest('.MuiCheckbox-root');
            const checked = root ? root.classList.contains('Mui-checked') : cb.checked;
            if (checked) continue;
            const last = tickTimes.get(cb) || 0;
            if (Date.now() - last < 1500) continue;   // chống bấm 2 lần làm bỏ tích
            tickTimes.set(cb, Date.now());
            click(cb);                                  // CHỈ click input, không click thêm label
            log('Đã tích ô điều khoản');
        }
    }

    // ======================= 3. GỠ HÀNH LÝ + BẢO HIỂM =======================
    function pickNoThanks(drawer) {
        let done = false;
        for (const inp of drawer.querySelectorAll('input[type="radio"][value="noChoise"]')) {
            if (!visible(inp.closest('label') || inp.parentElement)) continue;
            const root = inp.closest('.MuiRadio-root');
            if (root && root.classList.contains('Mui-checked')) { done = true; continue; }
            click(inp.closest('label') || inp);
            done = true;
        }
        if (!done) {
            for (const lb of drawer.querySelectorAll('label')) {
                if (/^không, c[ảá]m ơn$/i.test(txt(lb)) && visible(lb)) { click(lb); done = true; }
            }
        }
        return done;
    }

    async function clearDrawer(drawer, title) {
        S.busy = true;
        try {
            const tabs = [...drawer.querySelectorAll('[role="tab"]')];
            if (tabs.length > 1) {
                for (const tab of tabs) {
                    click(tab);
                    await sleep(450);
                    pickNoThanks(drawer);
                    await sleep(250);
                }
            } else {
                pickNoThanks(drawer);
                await sleep(300);
            }
            const btn = [...drawer.querySelectorAll('button')].find(b => txt(b) === 'Xác nhận');
            if (btn) { click(btn); log(`Đã chọn "Không, cảm ơn" + Xác nhận: ${title}`); }
            await sleep(900);
        } finally {
            S.busy = false;
        }
    }

    function handleService() {
        if (S.busy) return;

        // A. Có drawer hành lý/bảo hiểm đang mở → xử lý đúng 1 lần cho mỗi lần mở
        const drawer = [...document.querySelectorAll('.MuiDrawer-paper')].find(visible);
        if (drawer) {
            const title = txt(drawer.querySelector('h4'));
            if (/hành lý|bảo hiểm/i.test(title) && !S.handledDrawers.has(title)) {
                S.handledDrawers.add(title);
                clearDrawer(drawer, title);
            }
            return;
        }
        S.handledDrawers.clear();

        const now = Date.now();
        if (now - S.lastOpen < 2500) return;

        // B. Hành lý đang bị gài (thẻ có "Gói 20kg" / giá) → mở thẻ, tối đa 3 lần
        const bagTitle = findByExactText('span', BAGGAGE_TITLE);
        if (bagTitle) {
            const card = cardOf(bagTitle);
            const hasBag = /Gói\s*\d+\s*kg/i.test(txt(card)) || /[1-9][\d,.]*\s*VND/.test(txt(card));
            if (hasBag && S.bagTries < 3) {
                S.bagTries++; S.lastOpen = now;
                log(`Mở thẻ hành lý để gỡ (lần ${S.bagTries})`);
                click(bagTitle);               // click node trong cùng → nổi bọt lên onClick của thẻ
                return;
            }
        }

        // C. Bảo hiểm (Vietjet chọn sẵn "Đồng ý mua") → mở đúng 1 lần để chọn "Không, cảm ơn"
        const insTitle = findByExactText('span', INSURANCE_TITLE);
        if (insTitle && !S.insDone) {
            S.insDone = true; S.lastOpen = now;
            log('Mở thẻ bảo hiểm để gỡ (1 lần duy nhất)');
            click(insTitle);
        }
    }

    // ======================= 4. CHỌN VIETQR =======================
    function handlePayment() {
        if (S.qrDone || S.qrTries >= 4) return;
        const now = Date.now();
        if (now - S.qrLast < 1000) return;

        const card = [...document.querySelectorAll('.MuiPaper-root')].find(p => txt(p) === 'Mobile Banking VietQR');
        if (!card) return;

        // Thẻ đang được chọn có thêm 1 class so với các thẻ khác cùng nhóm
        const peers = [...card.parentElement.parentElement.querySelectorAll('.MuiPaper-root')];
        const minCls = Math.min(...peers.map(p => p.classList.length));
        if (card.classList.length > minCls) {
            S.qrDone = true;
            card.style.outline = '3px solid #22c55e';
            log('VietQR đã được chọn ✔');
            return;
        }
        S.qrTries++; S.qrLast = now;
        click(S.qrTries % 2 ? card : card.parentElement);
        log(`Click chọn Mobile Banking VietQR (lần ${S.qrTries})`);
    }

    // ======================= 5. BẢNG SOI LỖI =======================
    function serviceFeeTotal() {
        let total = 0, found = false;
        for (const h of document.querySelectorAll('h4')) {
            if (txt(h) !== 'Dịch vụ') continue;
            const v = h.nextElementSibling;
            if (v && /VND/.test(txt(v))) { total += digits(txt(v)) || 0; found = true; }
        }
        return found ? total : null;
    }

    function renderAuditor(t) {
        const items = [], errors = [];
        const add = (ok, label) => { items.push({ ok, label }); if (ok === false) errors.push(label); };

        add(t.includes(CFG.departDate), `Chiều đi ${CFG.departDate}`);
        if (CFG.returnDate) add(t.includes(CFG.returnDate), `Chiều về ${CFG.returnDate}`);
        if (page !== 'passengers') add(CFG.passengerRegex.test(t), 'Tên khách: TRAN THI KIM TINH');

        const fee = serviceFeeTotal();
        if (fee !== null) add(fee === 0, fee === 0 ? 'Phí dịch vụ: 0đ' : `Phí dịch vụ: ${fee.toLocaleString('vi-VN')}đ`);
        if (page === 'payment') add(S.qrDone ? true : null, S.qrDone ? 'Thanh toán: VietQR' : 'Thanh toán: đang chọn VietQR...');

        if (page === 'payment' && errors.length && !S.errBeeped) { S.errBeeped = true; beep([330, 220]); }

        const bad = errors.length > 0;
        const color = bad ? '#ef4444' : '#22c55e';
        const rows = items.map(i => {
            const ic = i.ok === true ? '✅' : i.ok === false ? '❌' : '⏳';
            const c = i.ok === true ? '#4ade80' : i.ok === false ? '#f87171' : '#cbd5e1';
            return `<div style="color:${c};margin:3px 0">${ic} ${i.label}</div>`;
        }).join('');
        const html = `<div style="position:fixed;top:12px;right:12px;z-index:2147483647;pointer-events:none;
            width:270px;background:rgba(15,23,42,.92);border:2px solid ${color};border-radius:10px;padding:10px 12px;
            font:12px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 8px 20px rgba(0,0,0,.5)">
            <div style="font-weight:800;color:${color};margin-bottom:4px">${bad ? '🚨 CÓ LỖI – KIỂM TRA LẠI' : '✅ VÉ ĐÚNG THÔNG TIN'} <span style="color:#94a3b8;font-weight:400">(${page})</span></div>
            ${rows}</div>`;

        let box = document.getElementById('vj-auditor');
        if (!box) { box = document.createElement('div'); box.id = 'vj-auditor'; document.body.appendChild(box); }
        if (html !== S.widgetHtml) { box.innerHTML = html; S.widgetHtml = html; }
    }

    function hideAuditor() {
        const box = document.getElementById('vj-auditor');
        if (box && box.innerHTML) { box.innerHTML = ''; S.widgetHtml = ''; }
    }

    // ======================= VÒNG LẶP CHÍNH =======================
    function tick() {
        if (!document.body) return;
        const t = document.body.innerText || '';     // đọc 1 lần/tick để không làm lag trang
        const p = detectPage(t);
        if (p !== page) { page = p; resetState(); log('Trang:', page); }

        try {
            if (page === 'flight') scanZeroFares();
            if (page === 'passengers' || page === 'payment') tickTerms();
            if (page === 'service') handleService();
            if (page === 'payment') handlePayment();
            if (page === 'service' || page === 'payment' || page === 'passengers') renderAuditor(t);
            else hideAuditor();
        } catch (e) {
            console.error('[VJ Sniper] lỗi:', e);
        }
    }

    log('v2.0.0 đã chạy');
    setInterval(tick, CFG.TICK_MS);
})();
