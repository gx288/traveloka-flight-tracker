// ==UserScript==
// @name         Vietjet 0Ä‘ Sniper v2 (Báº¯t 0Ä‘ + Gá»¡ hÃ nh lÃ½/báº£o hiá»ƒm + VietQR + Auditor)
// @namespace    https://github.com/gx288/traveloka-flight-tracker
// @version      2.0.1
// @description  Viáº¿t láº¡i sáº¡ch: phÃ¡t hiá»‡n vÃ© 0Ä‘ Ä‘Ãºng Ä‘á»‹nh dáº¡ng giÃ¡ Vietjet, gá»¡ hÃ nh lÃ½/báº£o hiá»ƒm 1 láº§n khÃ´ng láº·p, tÃ­ch Ä‘iá»u khoáº£n, chá»n VietQR cÃ³ kiá»ƒm tra, báº£ng soi lá»—i khÃ´ng cháº·n click.
// @author       Antigravity
// @match        https://*.vietjetair.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ======================= Cáº¤U HÃŒNH =======================
    const CFG = {
        passengerRegex: /TRAN\s*THI\s*KIM\s*TINH|TRáº¦N\s*THá»Š\s*KIM\s*TÄ¨NH/i,
        departDate: '21/10/2026',
        returnDate: '22/10/2026',      // Ä‘á»ƒ '' náº¿u bay 1 chiá»u
        AUTO_CLICK_ZERO: false,        // true = tá»± click vÃ© 0Ä‘ Ä‘áº§u tiÃªn (cÃ³ thá»ƒ chá»n sai giá» bay)
        TICK_MS: 500,
    };

    const BAGGAGE_TITLE = 'Chá»n hÃ nh lÃ½/Dá»‹ch vá»¥ ná»‘i chuyáº¿n';
    const INSURANCE_TITLE = 'Báº£o hiá»ƒm du lá»‹ch Vietjet Travel Safe';
    const log = (...a) => console.log('âš¡[VJ Sniper]', ...a);

    // ======================= TIá»†N ÃCH =======================
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
        } catch (e) { /* trÃ¬nh duyá»‡t cháº·n audio khi chÆ°a tÆ°Æ¡ng tÃ¡c */ }
    }

    function findByExactText(selector, text) {
        for (const el of document.querySelectorAll(selector)) {
            if (txt(el) === text) return el;
        }
        return null;
    }

    // Tháº» dá»‹ch vá»¥ = tá»• tiÃªn cao nháº¥t váº«n cÃ³ cursor:pointer (tháº» .jssXXX cÃ³ cursor:pointer)
    function cardOf(el) {
        let card = el, cur = el;
        for (let i = 0; i < 10 && cur && cur !== document.body; i++) {
            if (getComputedStyle(cur).cursor === 'pointer') card = cur;
            cur = cur.parentElement;
        }
        return card;
    }

    // ======================= TRáº NG THÃI THEO TRANG =======================
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
        if (t.includes('PhÆ°Æ¡ng thá»©c thanh toÃ¡n') && t.includes('Chi tiáº¿t thanh toÃ¡n')) return 'payment';
        if (t.includes(BAGGAGE_TITLE) || t.includes(INSURANCE_TITLE)) return 'service';
        if (t.includes('Bay tháº³ng') || t.includes('Háº¿t chá»—') || t.includes('Ná»‘i chuyáº¿n')) return 'flight';
        if (t.includes('TÃ´i Ä‘Ã£ Ä‘á»c, hiá»ƒu vÃ  Ä‘á»“ng Ã½') || t.includes('ThÃ´ng tin hÃ nh khÃ¡ch') || t.includes('Danh xÆ°ng')) return 'passengers';
        if (t.includes('Äiá»ƒm khá»Ÿi hÃ nh') && t.includes('TÃ¬m chuyáº¿n bay')) return 'home';
        if (/\d{1,2} thÃ¡ng \d{1,2}/.test(t) && t.includes('VND')) return 'flight';   // lá»‹ch "TÃ¬m vÃ© ráº» nháº¥t"
        return 'other';
    }

    // ======================= 1. VÃ‰ 0Ä (trang chá»n chuyáº¿n) =======================
    // GiÃ¡ hiá»ƒn thá»‹ tÃ¡ch node: "375" + "000 VND"  â†’  vÃ© 0Ä‘ = "0" + "000 VND" hoáº·c "0 VND"
    function scanZeroFares() {
        const zeros = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: n => /VND/i.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
        });
        let n;
        while ((n = walker.nextNode())) {
            let priceEl = null, cur = n.parentElement;
            for (let i = 0; i < 3 && cur; i++) {
                if (/^(Tá»«\s*)?\d[\d.,\s]*VND$/i.test(txt(cur))) priceEl = cur;
                cur = cur.parentElement;
            }
            if (!priceEl || digits(txt(priceEl)) !== 0 || zeros.includes(priceEl)) continue;
            // Bá» qua cá»™t "ThÃ´ng tin Ä‘áº·t chá»—" (Tá»•ng tiá»n / Dá»‹ch vá»¥ / GiÃ¡ vÃ© / Thuáº¿, phÃ­ = 0 VND khi chÆ°a chá»n)
            const ctx = txt(priceEl.parentElement) + ' ' + txt(priceEl.parentElement && priceEl.parentElement.parentElement);
            if (/Tá»•ng tiá»n|Dá»‹ch vá»¥|GiÃ¡ vÃ©|Thuáº¿|Táº¡m tÃ­nh|PhÃ­ tiá»‡n Ã­ch|MÃ£ khuyáº¿n mÃ£i/i.test(ctx)) continue;
            zeros.push(priceEl);
        }
        S.zeroCount = zeros.length;
        zeros.forEach(el => {
            el.style.outline = '3px solid #22c55e';
            el.style.background = 'rgba(34,197,94,.25)';
        });
        if (zeros.length && !S.zeroAlerted) {
            S.zeroAlerted = true;
            log(`PHÃT HIá»†N ${zeros.length} vÃ© 0Ä‘!`);
            beep([880, 1175, 1568]);
        }
        if (zeros.length && CFG.AUTO_CLICK_ZERO && !S.zeroClicked) {
            S.zeroClicked = true;
            click(zeros[0]);
        }
    }

    // ======================= 2. TÃCH ÄIá»€U KHOáº¢N =======================
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
            if (/báº£o hiá»ƒm|insurance/i.test(label)) continue;
            if (!/tÃ´i Ä‘Ã£ Ä‘á»c|Ä‘iá»u lá»‡ váº­n chuyá»ƒn/i.test(label)) continue;

            const root = cb.closest('.MuiCheckbox-root');
            const checked = root ? root.classList.contains('Mui-checked') : cb.checked;
            if (checked) continue;
            const last = tickTimes.get(cb) || 0;
            if (Date.now() - last < 1500) continue;   // chá»‘ng báº¥m 2 láº§n lÃ m bá» tÃ­ch
            tickTimes.set(cb, Date.now());
            click(cb);                                  // CHá»ˆ click input, khÃ´ng click thÃªm label
            log('ÄÃ£ tÃ­ch Ã´ Ä‘iá»u khoáº£n');
        }
    }

    // ======================= 3. Gá»  HÃ€NH LÃ + Báº¢O HIá»‚M =======================
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
                if (/^khÃ´ng, c[áº£Ã¡]m Æ¡n$/i.test(txt(lb)) && visible(lb)) { click(lb); done = true; }
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
            const btn = [...drawer.querySelectorAll('button')].find(b => txt(b) === 'XÃ¡c nháº­n');
            if (btn) { click(btn); log(`ÄÃ£ chá»n "KhÃ´ng, cáº£m Æ¡n" + XÃ¡c nháº­n: ${title}`); }
            await sleep(900);
        } finally {
            S.busy = false;
        }
    }

    function handleService() {
        if (S.busy) return;

        // A. CÃ³ drawer hÃ nh lÃ½/báº£o hiá»ƒm Ä‘ang má»Ÿ â†’ xá»­ lÃ½ Ä‘Ãºng 1 láº§n cho má»—i láº§n má»Ÿ
        const drawer = [...document.querySelectorAll('.MuiDrawer-paper')].find(visible);
        if (drawer) {
            const title = txt(drawer.querySelector('h4'));
            if (/hÃ nh lÃ½|báº£o hiá»ƒm/i.test(title) && !S.handledDrawers.has(title)) {
                S.handledDrawers.add(title);
                clearDrawer(drawer, title);
            }
            return;
        }
        S.handledDrawers.clear();

        const now = Date.now();
        if (now - S.lastOpen < 2500) return;

        // B. HÃ nh lÃ½ Ä‘ang bá»‹ gÃ i (tháº» cÃ³ "GÃ³i 20kg" / giÃ¡) â†’ má»Ÿ tháº», tá»‘i Ä‘a 3 láº§n
        const bagTitle = findByExactText('span', BAGGAGE_TITLE);
        if (bagTitle) {
            const card = cardOf(bagTitle);
            const hasBag = /GÃ³i\s*\d+\s*kg/i.test(txt(card)) || /[1-9][\d,.]*\s*VND/.test(txt(card));
            if (hasBag && S.bagTries < 3) {
                S.bagTries++; S.lastOpen = now;
                log(`Má»Ÿ tháº» hÃ nh lÃ½ Ä‘á»ƒ gá»¡ (láº§n ${S.bagTries})`);
                click(bagTitle);               // click node trong cÃ¹ng â†’ ná»•i bá»t lÃªn onClick cá»§a tháº»
                return;
            }
        }

        // C. Báº£o hiá»ƒm (Vietjet chá»n sáºµn "Äá»“ng Ã½ mua") â†’ má»Ÿ Ä‘Ãºng 1 láº§n Ä‘á»ƒ chá»n "KhÃ´ng, cáº£m Æ¡n"
        const insTitle = findByExactText('span', INSURANCE_TITLE);
        if (insTitle && !S.insDone) {
            S.insDone = true; S.lastOpen = now;
            log('Má»Ÿ tháº» báº£o hiá»ƒm Ä‘á»ƒ gá»¡ (1 láº§n duy nháº¥t)');
            click(insTitle);
        }
    }

    // ======================= 4. CHá»ŒN VIETQR =======================
    function handlePayment() {
        if (S.qrDone || S.qrTries >= 4) return;
        const now = Date.now();
        if (now - S.qrLast < 1000) return;

        const card = [...document.querySelectorAll('.MuiPaper-root')].find(p => txt(p) === 'Mobile Banking VietQR');
        if (!card) return;

        // Tháº» Ä‘ang Ä‘Æ°á»£c chá»n cÃ³ thÃªm 1 class so vá»›i cÃ¡c tháº» khÃ¡c cÃ¹ng nhÃ³m
        const peers = [...card.parentElement.parentElement.querySelectorAll('.MuiPaper-root')];
        const minCls = Math.min(...peers.map(p => p.classList.length));
        if (card.classList.length > minCls) {
            S.qrDone = true;
            card.style.outline = '3px solid #22c55e';
            log('VietQR Ä‘Ã£ Ä‘Æ°á»£c chá»n âœ”');
            return;
        }
        S.qrTries++; S.qrLast = now;
        click(S.qrTries % 2 ? card : card.parentElement);
        log(`Click chá»n Mobile Banking VietQR (láº§n ${S.qrTries})`);
    }

    // ======================= 5. Báº¢NG SOI Lá»–I =======================
    function serviceFeeTotal() {
        let total = 0, found = false;
        for (const h of document.querySelectorAll('h4')) {
            if (txt(h) !== 'Dá»‹ch vá»¥') continue;
            const v = h.nextElementSibling;
            if (v && /VND/.test(txt(v))) { total += digits(txt(v)) || 0; found = true; }
        }
        return found ? total : null;
    }

    function renderAuditor(t) {
        const items = [], errors = [];
        const add = (ok, label) => { items.push({ ok, label }); if (ok === false) errors.push(label); };

        add(t.includes(CFG.departDate), `Chiá»u Ä‘i ${CFG.departDate}`);
        if (CFG.returnDate) add(t.includes(CFG.returnDate), `Chiá»u vá» ${CFG.returnDate}`);
        if (page !== 'passengers') add(CFG.passengerRegex.test(t), 'TÃªn khÃ¡ch: TRAN THI KIM TINH');

        const fee = serviceFeeTotal();
        if (fee !== null) add(fee === 0, fee === 0 ? 'PhÃ­ dá»‹ch vá»¥: 0Ä‘' : `PhÃ­ dá»‹ch vá»¥: ${fee.toLocaleString('vi-VN')}Ä‘`);
        if (page === 'payment') add(S.qrDone ? true : null, S.qrDone ? 'Thanh toÃ¡n: VietQR' : 'Thanh toÃ¡n: Ä‘ang chá»n VietQR...');

        if (page === 'payment' && errors.length && !S.errBeeped) { S.errBeeped = true; beep([330, 220]); }

        const bad = errors.length > 0;
        const color = bad ? '#ef4444' : '#22c55e';
        const rows = items.map(i => {
            const ic = i.ok === true ? 'âœ…' : i.ok === false ? 'âŒ' : 'â³';
            const c = i.ok === true ? '#4ade80' : i.ok === false ? '#f87171' : '#cbd5e1';
            return `<div style="color:${c};margin:3px 0">${ic} ${i.label}</div>`;
        }).join('');
        const html = `<div style="position:fixed;top:12px;right:12px;z-index:2147483647;pointer-events:none;
            width:270px;background:rgba(15,23,42,.92);border:2px solid ${color};border-radius:10px;padding:10px 12px;
            font:12px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 8px 20px rgba(0,0,0,.5)">
            <div style="font-weight:800;color:${color};margin-bottom:4px">${bad ? 'ðŸš¨ CÃ“ Lá»–I â€“ KIá»‚M TRA Láº I' : 'âœ… VÃ‰ ÄÃšNG THÃ”NG TIN'} <span style="color:#94a3b8;font-weight:400">(${page})</span></div>
            ${rows}</div>`;

        let box = document.getElementById('vj-auditor');
        if (!box) { box = document.createElement('div'); box.id = 'vj-auditor'; document.body.appendChild(box); }
        if (html !== S.widgetHtml) { box.innerHTML = html; S.widgetHtml = html; }
    }

    function drawBox(html) {
        let box = document.getElementById('vj-auditor');
        if (!box) { box = document.createElement('div'); box.id = 'vj-auditor'; document.body.appendChild(box); }
        if (html !== S.widgetHtml) { box.innerHTML = html; S.widgetHtml = html; }
    }

    const BOX_STYLE = (color) => `position:fixed;top:12px;right:12px;z-index:2147483647;pointer-events:none;
        width:270px;background:rgba(15,23,42,.92);border:2px solid ${color};border-radius:10px;padding:10px 12px;
        font:12px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 8px 20px rgba(0,0,0,.5)`;

    // Trang chá»§ / chá»n chuyáº¿n / khÃ¡c: chá»‰ hiá»‡n Ã´ tráº¡ng thÃ¡i gá»n
    function renderStatus() {
        let line = 'Äang chá»...';
        let color = '#38bdf8';
        if (page === 'home') line = 'Trang chá»§ â€“ báº¥m "TÃ¬m chuyáº¿n bay" lÃºc 12:00';
        if (page === 'flight') {
            const n = S.zeroCount || 0;
            line = n ? `ðŸŽ¯ CÃ“ ${n} VÃ‰ 0Ä (viá»n xanh) â€“ CHá»ŒN NGAY!` : 'Äang quÃ©t vÃ© 0Ä‘... (chÆ°a tháº¥y)';
            if (n) color = '#22c55e';
        }
        drawBox(`<div style="${BOX_STYLE(color)}">
            <div style="font-weight:800;color:${color}">âš¡ VJ Sniper v2 Ä‘ang cháº¡y <span style="color:#94a3b8;font-weight:400">(${page})</span></div>
            <div style="margin-top:3px">${line}</div></div>`);
    }

    // ======================= VÃ’NG Láº¶P CHÃNH =======================
    function tick() {
        if (!document.body) return;
        const t = document.body.innerText || '';     // Ä‘á»c 1 láº§n/tick Ä‘á»ƒ khÃ´ng lÃ m lag trang
        const p = detectPage(t);
        if (p !== page) { page = p; resetState(); log('Trang:', page); }

        try {
            if (page === 'flight') scanZeroFares();
            if (page === 'passengers' || page === 'payment') tickTerms();
            if (page === 'service') handleService();
            if (page === 'payment') handlePayment();
            if (page === 'service' || page === 'payment' || page === 'passengers') renderAuditor(t);
            else renderStatus();
        } catch (e) {
            console.error('[VJ Sniper] lá»—i:', e);
        }
    }

    log('v2.0.1 Ä‘Ã£ cháº¡y');
    setInterval(tick, CFG.TICK_MS);
})();
