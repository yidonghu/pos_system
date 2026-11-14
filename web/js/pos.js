'use strict';

/* ================= 基础工具 ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const money = n => (Math.round(Number(n || 0)) / 100).toFixed(2);
const yuanToFen = v => Math.round(Number(String(v).replace(/[^0-9.\-]/g, '') || 0) * 100);

function toast(msg, type = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'show ' + type;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 2200);
}

function openModal(id) { $('#' + id).classList.add('show'); }
function closeModal(id) { $('#' + id).classList.remove('show'); }

/* ================= 设备身份（本地保存） ================= */
const DEVICE_KEY = 'pos.device';
const CACHE_KEY = 'pos.cache.products';

function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('pos-device', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function idbSet(v) {
    try {
        const db = await idbOpen();
        db.transaction('kv', 'readwrite').objectStore('kv').put(v, 'device');
    } catch (e) { /* 忽略 */ }
}
async function idbGet() {
    try {
        const db = await idbOpen();
        return await new Promise(res => {
            const r = db.transaction('kv').objectStore('kv').get('device');
            r.onsuccess = () => res(r.result || null);
            r.onerror = () => res(null);
        });
    } catch (e) { return null; }
}

const Device = {
    async load() {
        try {
            const v = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null');
            if (v && v.id) return v;
        } catch (e) { }
        return await idbGet();
    },
    async save(d) {
        localStorage.setItem(DEVICE_KEY, JSON.stringify(d));
        await idbSet(d);
    },
    async clear() {
        localStorage.removeItem(DEVICE_KEY);
        await idbSet(null);
    }
};

/* ================= 状态 ================= */
const state = {
    device: null,
    online: true,
    config: {},
    products: [],
    cats: [],
    cart: [],
    cat: 0,
    kw: '',
    discountPct: 0,
    roundMode: '0',
    shift: null,
    online: true,
    pay: { rows: [], method: 'cash', tendered: '', remark: '' }
};

/* ================= API ================= */
async function api(path, { method = 'GET', body, admin = false } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.device) headers['X-Device-Id'] = state.device.id;
    if (admin) headers['X-Admin-Token'] = localStorage.getItem('pos.admin.token') || '';

    let res;
    try {
        res = await fetch(path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch (e) {
        setOnline(false);
        throw new Error('无法连接收银主机，请检查网络');
    }
    setOnline(true);

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { msg: text }; }
    if (!res.ok || (data && data.ok === false)) {
        throw new Error((data && data.msg) || ('请求失败 ' + res.status));
    }
    return data;
}

function setOnline(on) {
    if (state.online === on) return;
    state.online = on;
    const chip = $('#netChip');
    chip.classList.toggle('off', !on);
    $('.txt', chip).textContent = on ? '在线' : '离线';
}

/* ================= 启动 ================= */
async function init() {
    bindEvents();
    buildKeypad();

    const d = await Device.load();
    if (!d || !d.id) {
        showWizard();
        return;
    }
    state.device = d;
    await boot();
}

async function boot() {
    $('#deviceName').textContent = state.device.name;
    $('#moreDeviceId').textContent = state.device.id;

    // 先渲染缓存，界面立刻可用
    restoreProductCache();

    await Promise.allSettled([loadConfig(), loadCats(), loadProducts(true), refreshShift()]);

    setInterval(() => { loadProducts(true).catch(() => { }); }, 60000);
    setInterval(() => { refreshShift().catch(() => { }); }, 30000);
}

function restoreProductCache() {
    try {
        const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (c && Array.isArray(c.data)) {
            state.products = c.data;
            renderGrid();
        }
    } catch (e) { }
}

async function loadConfig() {
    state.config = await api('/api/device/config');
    $('#shopName').textContent = state.config.shop_name || '收银台';
    document.title = (state.config.shop_name || '') + ' · 收银台';
}

async function loadCats() {
    state.cats = await api('/api/categories');
    renderCats();
}

async function loadProducts(force) {
    try {
        const list = await api('/api/products?limit=500');
        state.products = list;
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: list }));
        setNet(true);
        renderGrid();
    } catch (e) {
        setNet(false);
        renderGrid();
        throw e;
    }
}

function setNet(online) {
    if (state.online === online) return;
    state.online = online;
    const chip = $('#netChip');
    if (!chip) return;
    chip.classList.toggle('off', !online);
    chip.querySelector('.txt').textContent = online ? '在线' : '离线';
}

/* ================= 设备向导 ================= */
function showWizard(prefill) {
    $('#wizName').value = prefill || suggestedName();
    openModal('wizardMask');
    setTimeout(() => $('#wizName').focus(), 100);
}

function suggestedName() {
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    return mobile ? '手机收银' : '前台1';
}

async function registerDevice(name) {
    const id = (state.device && state.device.id) ||
        (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    const type = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'phone' : 'pc';
    const r = await api('/api/device/register', { method: 'POST', body: { id, name, type } });
    const device = { id, name: r.device.name, type };
    await Device.save(device);
    state.device = device;
    return device;
}

/* ================= 商品与购物车 ================= */
function renderCats() {
    const box = $('#cats');
    const total = state.products.length;
    box.innerHTML = `<button class="cat-btn ${state.cat === 0 ? 'active' : ''}" data-cat="0">全部 ${total}</button>` +
        state.cats.map(c =>
            `<button class="cat-btn ${state.cat === c.id ? 'active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`
        ).join('');
}

function renderGrid() {
    renderCats();
    const grid = $('#grid');
    const kw = state.kw.trim().toLowerCase();
    let list = state.products.filter(p => {
        if (state.cat && Number(p.category_id) !== state.cat) return false;
        if (!kw) return true;
        const n = (p.name || '').toLowerCase();
        const b = (p.barcodes || '').toLowerCase();
        return n.includes(kw) || b.includes(kw);
    });

    if (!list.length) {
        grid.innerHTML = state.online === false
            ? `<div class="empty" style="grid-column:1/-1">
                <span class="icon">📴</span>当前离线，本地也没有商品缓存<br><span style="font-size:12px">请检查收银主机的服务是否运行、Wi-Fi 是否连通，恢复后会自动刷新</span>
            </div>`
            : `<div class="empty" style="grid-column:1/-1">
                <span class="icon">🔍</span>没有找到商品<br><span style="font-size:12px">可在管理后台添加商品，或检查条码</span>
            </div>`;
        return;
    }

    grid.innerHTML = list.map(p => {
        const stock = Number(p.stock || 0);
        const out = stock <= 0;
        const low = !out && stock <= Number(p.stock_alert || 5);
        return `<div class="p-card ${out ? 'out' : ''} ${low ? 'low' : ''}" data-id="${p.id}">
            <div class="name">${esc(p.name)}</div>
            <div class="meta">
                <div class="price"><small>¥</small>${money(p.sale_price)}</div>
                <div class="stock">${out ? '无货' : '库存 ' + stock}</div>
            </div>
        </div>`;
    }).join('');
}

function findProduct(id) { return state.products.find(p => Number(p.id) === Number(id)); }

function addToCart(product, qty = 1) {
    if (!product) return false;
    const stock = Number(product.stock || 0);
    const allowNegative = state.config.allow_negative === '1';
    const line = state.cart.find(i => i.id === Number(product.id));
    const next = (line ? line.qty : 0) + qty;
    if (!allowNegative && next > stock) {
        toast(`${product.name} 库存只剩 ${stock}`, 'err');
        return false;
    }
    if (line) line.qty = next;
    else state.cart.push({
        id: Number(product.id),
        name: product.name,
        price: Number(product.sale_price),
        qty,
        barcode: (product.barcodes || '').split('|')[0] || '',
        stock
    });
    renderCart();
    const card = $(`.p-card[data-id="${product.id}"]`);
    if (card) {
        card.style.transition = 'none';
        card.style.background = '#E6F4F1';
        setTimeout(() => { card.style.transition = ''; card.style.background = ''; }, 200);
    }
    return true;
}

function total() {
    return state.cart.reduce((s, i) => s + i.price * i.qty, 0);
}

function calc() {
    const t = total();
    let discount = 0;
    if (state.discountPct > 0) discount = Math.round(t * state.discountPct / 100);
    const afterDiscount = Math.max(0, t - discount);
    let roundOff = 0;
    if (state.roundMode === 'jiao') roundOff = afterDiscount % 10;
    else if (state.roundMode === 'yuan') roundOff = afterDiscount % 100;
    const payable = Math.max(0, afterDiscount - roundOff);
    return { total: t, discount, roundOff, payable };
}

function renderCart() {
    const box = $('#cartList');
    const qty = state.cart.reduce((s, i) => s + i.qty, 0);
    $('#headCount').textContent = qty;

    if (!state.cart.length) {
        box.innerHTML = `<div class="cart-empty">购物车是空的<br><span style="font-size:12px">扫码或点商品加入</span></div>`;
    } else {
        box.innerHTML = state.cart.map(i => `
            <div class="cart-row" data-id="${i.id}">
                <div class="info">
                    <div class="cname">${esc(i.name)}</div>
                    <div class="csub">¥${money(i.price)} × ${i.qty}</div>
                </div>
                <div class="qty-box">
                    <button data-act="minus">−</button>
                    <span class="q">${i.qty}</span>
                    <button data-act="plus">＋</button>
                </div>
                <div class="amt">¥${money(i.price * i.qty)}</div>
            </div>`).join('');
    }

    const c = calc();
    $('#sumAmt').textContent = money(c.payable);
    const parts = [`共 ${qty} 件`];
    if (c.discount > 0) parts.push(`优惠 ¥${money(c.discount)}`);
    if (c.roundOff > 0) parts.push(`抹零 ¥${money(c.roundOff)}`);
    $('#sumTip').textContent = parts.join(' · ');
    const hint = $('#cartHint');
    if (hint) hint.textContent = state.cart.length ? `共 ${qty} 件 · 查看明细 ▲` : '购物车为空';
    $('#payBtn').disabled = !state.cart.length;
}

/* ================= 结算 ================= */
function openPay() {
    if (!state.cart.length) return;
    const c = calc();
    state.pay.rows = [{ method: state.pay.method, amount: c.payable }];
    state.pay.tendered = money(c.payable);
    state.pay.remark = '';
    $('#orderRemark').value = '';
    $('#payMoney').textContent = '¥' + money(c.payable);
    $('#payTip').textContent = c.discount || c.roundOff
        ? `原价 ¥${money(c.total)}，优惠 ¥${money(c.discount)}，抹零 ¥${money(c.roundOff)}`
        : '应收金额';
    renderPayRows();
    openModal('payMask');
}

function renderPayRows() {
    const c = calc();
    const rows = state.pay.rows;
    const sum = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const remain = c.payable - sum;

    $('#payRows').innerHTML = rows.map((r, i) => `
        <div class="pay-row" data-i="${i}">
            <div class="pname">${methodName(r.method)}</div>
            <input class="input num" data-amount="${i}" type="text" inputmode="decimal" value="${money(r.amount)}">
            ${rows.length > 1 ? `<button class="del" data-del="${i}">×</button>` : ''}
        </div>`).join('');

    $('#remainAmt').textContent = '¥' + money(remain);
    $('#remainAmt').style.color = remain === 0 ? 'var(--ok)' : 'var(--danger)';

    $$('.method-btn').forEach(b => {
        b.classList.toggle('active', rows.length === 1 && b.dataset.method === rows[0].method);
    });

    const cashRow = rows.find(r => r.method === 'cash');
    $('#cashPanel').style.display = cashRow ? 'block' : 'none';
    if (cashRow) {
        const tendered = yuanToFen(state.pay.tendered || '0');
        const change = tendered - Number(cashRow.amount || 0);
        $('#cashTendered').textContent = money(tendered);
        $('#cashChange').textContent = '¥' + money(Math.max(0, change));
    }
}

function methodName(m) {
    return { cash: '现金', wechat: '微信', alipay: '支付宝', bank: '银行卡' }[m] || m;
}

function buildKeypad() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
    $('#keypad').innerHTML = keys.map(k => `<button data-key="${k}">${k}</button>`).join('');
    $('#quickCash').innerHTML = [10, 20, 50, 100]
        .map(v => `<button class="btn ghost sm" data-cash="${v}">${v} 元</button>`).join('') +
        '<button class="btn ghost sm" data-cash="exact">整付</button>';
}

/* ================= 小票 ================= */
function receiptHtml(data) {
    const cfg = state.config;
    const items = (data.items || []).map(i => `
        <tr><td>${esc(i.name)}</td><td class="r-right">${i.qty} × ${money(i.price)}</td><td class="r-right">${money(i.amount)}</td></tr>
    `).join('');

    const pays = (data.payments || []).map(p =>
        `<div style="display:flex;justify-content:space-between"><span>${methodName(p.method)}</span><span>¥${money(p.amount)}</span></div>`
    ).join('');

    return `<div class="receipt-paper">
        <div class="r-title">${esc(cfg.shop_name || '我的小店')}</div>
        ${cfg.shop_address ? `<div class="r-sub">${esc(cfg.shop_address)}</div>` : ''}
        ${cfg.shop_phone ? `<div class="r-sub">TEL: ${esc(cfg.shop_phone)}</div>` : ''}
        <div class="r-line"></div>
        <div style="font-size:11px">单号：${esc(data.order_no)}</div>
        <div style="font-size:11px">时间：${new Date(data.occur_at).toLocaleString('zh-CN')}</div>
        <div style="font-size:11px">收银台：${esc(data.device_name || state.device.name)}</div>
        <div class="r-line"></div>
        <table>
            <thead><tr><td>商品</td><td class="r-right">数量</td><td class="r-right">金额</td></tr></thead>
            <tbody>${items}</tbody>
        </table>
        <div class="r-line"></div>
        <div style="display:flex;justify-content:space-between"><span>合计</span><span>¥${money(data.total)}</span></div>
        ${data.discount ? `<div style="display:flex;justify-content:space-between"><span>优惠</span><span>-¥${money(data.discount)}</span></div>` : ''}
        ${data.round_off ? `<div style="display:flex;justify-content:space-between"><span>抹零</span><span>-¥${money(data.round_off)}</span></div>` : ''}
        <div class="r-total"><span>实收</span><span>¥${money(data.payable)}</span></div>
        <div class="r-line"></div>
        ${pays}
        <div class="r-foot">${esc(cfg.receipt_footer || '谢谢惠顾，欢迎再次光临')}</div>
    </div>`;
}

function printReceipt(html) {
    $('#printArea').innerHTML = html;
    window.print();
}

/* ================= 扫码枪（USB HID） ================= */
let scanBuf = '', scanLast = 0;

/* ================= 摄像头扫码 ================= */
let camStream = null, camTimer = null, camReader = null, camLoopOn = false, camFrames = 0, camLastErr = '';

function secureUrl() {
    return 'https://' + location.hostname + ':8443/pos';
}

/** 安卓只在安全上下文（https / localhost）里允许调用摄像头 */
function canUseCamera() {
    return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

/** 按需加载离线条码识别库（安卓 Chrome 多数没有 BarcodeDetector） */
async function ensureZXing() {
    if (window.ZXing) return true;
    return new Promise(resolve => {
        const s = document.createElement('script');
        s.src = '/js/vendor/zxing.min.js';
        s.onload = () => resolve(!!window.ZXing);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
    });
}

/** 诊断信息：手机上出问题时，点「查看诊断信息」就能看到到底缺哪一环 */
function camDiagText() {
    const v = $('#camVideo');
    return [
        '安全上下文=' + (window.isSecureContext ? 'true' : 'false'),
        '地址=' + location.origin,
        'getUserMedia=' + !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        'BarcodeDetector=' + ('BarcodeDetector' in window),
        'ZXing=' + (window.ZXing ? 'loaded' : 'no'),
        '视频=' + (v ? v.videoWidth + 'x' + v.videoHeight + ' ready=' + v.readyState : 'none'),
        '已取帧=' + camFrames,
        '错误=' + (camLastErr || 'none')
    ].join(' | ');
}

function showCamDiag() {
    const box = $('#camDiag');
    if (!box) return;
    box.style.display = 'block';
    box.textContent = camDiagText();
}

/** 统一的 ZXing hints */
function zxingHints(Z) {
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
        Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.CODE_128,
        Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E,
        Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.CODE_93
    ]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    hints.set(Z.DecodeHintType.CHARACTER_SET, 'UTF-8');
    return hints;
}

/** 拍照/相册图片识别：不依赖实时取流，安卓上最稳的兜底 */
async function decodeImageFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    try {
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    } catch (e) {
        URL.revokeObjectURL(url);
        camLastErr = 'img load fail';
        return '';
    }
    const c = document.createElement('canvas');
    const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
    c.width = Math.round(img.width * scale) || 1;
    c.height = Math.round(img.height * scale) || 1;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);

    if ('BarcodeDetector' in window) {
        try {
            let det;
            try {
                det = new BarcodeDetector({
                    formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code']
                });
            } catch (e) { det = new BarcodeDetector(); }
            const codes = await det.detect(c);
            if (codes && codes.length) return codes[0].rawValue;
        } catch (e) { camLastErr = 'BD:' + (e.message || e); }
    }

    if (window.ZXing) {
        const Z = window.ZXing;
        const decodeCanvasZx = (cv) => {
            const src = new Z.HTMLCanvasElementLuminanceSource(cv);
            const bin = new Z.HybridBinarizer(src);
            const reader = new Z.MultiFormatReader();
            const hints = zxingHints(Z);
            reader.setHints(hints);
            const res = reader.decode(bin, hints);
            return res ? res.getText() : '';
        };
        try {
            const direct = decodeCanvasZx(c);
            if (direct) return direct;
        } catch (e) { camLastErr = 'ZX:' + (e.message || e.name || e); }
        // 竖拍的照片先转回横向再试
        for (const deg of [90, 270]) {
            const rc = document.createElement('canvas');
            rc.width = c.height;
            rc.height = c.width;
            const rctx = rc.getContext('2d');
            rctx.translate(rc.width / 2, rc.height / 2);
            rctx.rotate(deg * Math.PI / 180);
            rctx.drawImage(c, -c.width / 2, -c.height / 2);
            try {
                const got = decodeCanvasZx(rc);
                if (got) return got;
            } catch (e) { }
        }
    }
    return '';
}

async function startCamera() {
    const video = $('#camVideo');
    camFrames = 0;
    camLastErr = '';
    const diagBox = $('#camDiag');
    if (diagBox) diagBox.style.display = 'none';

    if (!canUseCamera()) {
        $('#camTip').innerHTML = 'http 地址不能调摄像头，请用 <a href="' + secureUrl() + '">' + secureUrl() + '</a>';
        return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        camLastErr = 'no mediaDevices';
        $('#camTip').textContent = '此浏览器不支持摄像头，请手动输入条码';
        showCamDiag();
        return;
    }

    $('#camTip').textContent = '正在启动…';
    try {
        camStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
            audio: false
        });
        video.srcObject = camStream;
        await video.play();
        // 尽量让手机持续对焦，近距离条码才不会糊
        try {
            const track = camStream.getVideoTracks()[0];
            await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        } catch (e) { }
    } catch (e) {
        camLastErr = 'gUM:' + (e.name || '') + ' ' + (e.message || '');
        $('#camTip').innerHTML = '无法打开摄像头：' + (e.message || '权限被拒绝') +
            '<br><span style="color:#94A3B8">在网站设置里把摄像头改为「允许」后重试</span>';
        showCamDiag();
        return;
    }

    if ('BarcodeDetector' in window) {
        let detector = null;
        try {
            detector = new BarcodeDetector({
                formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code']
            });
        } catch (e) {
            try { detector = new BarcodeDetector(); } catch (e2) { detector = null; }
        }
        // 先探一次：不少设备（Windows Chrome、部分安卓）只暴露接口、没有解码服务，detect 会直接抛
        if (detector) {
            try { await detector.detect(video); }
            catch (e) {
                camLastErr = 'BD:' + (e.message || e.name || '');
                detector = null;
            }
        }
        if (detector) {
            $('#camTip').textContent = '把条码放进框里';
            const tick = async () => {
                if (!camStream) return;
                try {
                    const codes = await detector.detect(video);
                    camFrames++;
                    if (codes && codes.length) {
                        const code = codes[0].rawValue;
                        stopCamera();
                        closeModal('camMask');
                        await handleBarcode(code);
                        return;
                    }
                } catch (e) {
                    camLastErr = 'BD:' + (e.message || e.name || '');
                    // 运行中解码服务挂掉，同样降级到内置 ZXing，不能死等
                    if (/unavailable|not implemented|not supported/i.test(camLastErr)) {
                        const okZx = await ensureZXing();
                        if (okZx) { camLastErr += ' → 已切到 ZXing'; startZXingLoop(video); }
                        return;
                    }
                }
                camTimer = setTimeout(tick, 400);
            };
            tick();
            return;
        }
        camLastErr = (camLastErr || 'BD unavailable') + ' → 改用 ZXing';
    }

    // 兼容模式：内置 ZXing 本地解码，自己取帧（限制分辨率 + 先裁取景框再整帧），识别率高很多
    const ok = await ensureZXing();
    if (!ok) {
        camLastErr = 'zxing load fail';
        $('#camTip').textContent = '识别组件加载失败，请手动输入条码';
        showCamDiag();
        return;
    }
    $('#camTip').textContent = '把条码放进框里';
    try {
        startZXingLoop(video);
    } catch (e) {
        $('#camTip').textContent = '识别启动失败，请手动输入条码';
    }
}

/** 自建取帧循环 + ZXing 解码：默认 hint 太少、整帧太大，是手机上识别不出的主因 */
function startZXingLoop(video) {
    const Z = window.ZXing;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const hints = zxingHints(Z);

    const reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    camReader = reader;

    let ticks = 0;
    camFrames = 0;
    const tip = $('#camTip');

    const tryDecode = (sx, sy, sw, sh) => {
        if (sw < 40 || sh < 40) return '';
        const scale = Math.min(1, 800 / sw);
        canvas.width = Math.round(sw * scale);
        canvas.height = Math.round(sh * scale);
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        try {
            const src = new Z.HTMLCanvasElementLuminanceSource(canvas);
            const bin = new Z.HybridBinarizer(src);
            const res = reader.decode(bin, hints);
            return res ? res.getText() : '';
        } catch (e) {
            camLastErr = 'ZX:' + (e.name || '') + ' ' + (e.message || '');
            return '';
        } finally {
            try { reader.reset(); } catch (e) { }
        }
    };

    const decodeCanvas = (c) => {
        const src = new Z.HTMLCanvasElementLuminanceSource(c);
        const bin = new Z.HybridBinarizer(src);
        const r2 = new Z.MultiFormatReader();
        const h = zxingHints(Z);
        r2.setHints(h);
        const res = r2.decode(bin, h);
        return res ? res.getText() : '';
    };

    // 深度尝试：高分辨率整帧 + 旋转 90/270 度 + 反色（手机端条码可能斜着、也可能白底太亮）
    const deepCanvas = document.createElement('canvas');
    const deepCtx = deepCanvas.getContext('2d', { willReadFrequently: true });
    const rotCanvas = document.createElement('canvas');
    const deepTry = () => {
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return '';
        const scale = Math.min(1, 1500 / Math.max(vw, vh));
        deepCanvas.width = Math.round(vw * scale);
        deepCanvas.height = Math.round(vh * scale);
        deepCtx.drawImage(video, 0, 0, deepCanvas.width, deepCanvas.height);
        try {
            const c = decodeCanvas(deepCanvas);
            if (c) return c;
        } catch (e) { }
        for (const deg of [90, 270]) {
            rotCanvas.width = deepCanvas.height;
            rotCanvas.height = deepCanvas.width;
            const rc = rotCanvas.getContext('2d');
            rc.save();
            rc.translate(rotCanvas.width / 2, rotCanvas.height / 2);
            rc.rotate(deg * Math.PI / 180);
            rc.drawImage(deepCanvas, -deepCanvas.width / 2, -deepCanvas.height / 2);
            rc.restore();
            try {
                const c = decodeCanvas(rotCanvas);
                if (c) return c;
            } catch (e) { }
        }
        return '';
    };

    camLoopOn = true;
    const loop = () => {
        if (!camLoopOn || !camStream) return;
        const vw = video.videoWidth, vh = video.videoHeight;
        if (vw && vh) {
            camFrames++;
            // 先只解中间取景框（约 80% 宽 × 34% 高），没命中再兜底整帧
            let code = tryDecode(vw * 0.1, Math.max(0, (vh - vh * 0.34) / 2), vw * 0.8, vh * 0.34);
            if (!code) code = tryDecode(0, 0, vw, vh);
            // 每 6 帧（约 1.2 秒）做一次深度尝试：1500px 整帧 + 旋转 + TRY_HARDER
            if (!code && ticks % 6 === 5) code = deepTry();
            if (code) {
                camLoopOn = false;
                stopCamera();
                closeModal('camMask');
                handleBarcode(code);
                return;
            }
        }
        ticks++;
        if (tip && ticks % 5 === 0) {
            tip.textContent = camFrames ? '正在识别… 已取 ' + camFrames + ' 帧' : '正在识别…';
        }
        camTimer = setTimeout(loop, 200);
    };
    loop();
}

function stopCamera() {
    camLoopOn = false;
    if (camTimer) { clearTimeout(camTimer); camTimer = null; }
    if (camReader) {
        try { camReader.reset(); } catch (e) { }
        camReader = null;
    }
    if (camStream) {
        camStream.getTracks().forEach(t => t.stop());
        camStream = null;
    }
    const v = $('#camVideo');
    if (v) v.srcObject = null;
}

async function handleBarcode(code) {
    code = String(code || '').trim();
    if (!code) return;
    try {
        const p = await api('/api/products/barcode/' + encodeURIComponent(code));
        if (addToCart(p, 1)) toast(`已加入：${p.name}`, 'ok');
        beep();
    } catch (e) {
        toast(e.message, 'err');
    }
}

function beep() {
    try {
        if (navigator.vibrate) navigator.vibrate(30);
    } catch (e) { }
}

/* ================= 交接班 ================= */
async function refreshShift() {
    const s = await api('/api/shifts/current');
    state.shift = s && s.open ? s : null;
    $('#shiftBtn').textContent = state.shift ? '交班' : '开班';
    $('#shiftBtn').classList.toggle('primary', !state.shift);
}

function openShift() {
    const body = $('#shiftBody');
    const foot = $('#shiftFoot');
    if (!state.shift) {
        $('#shiftTitle').textContent = '开班';
        body.innerHTML = `
            <div class="field">
                <label>备用金（元）</label>
                <input class="input num" id="openingCash" inputmode="decimal" value="0">
                <div class="hint">抽屉里起始的现金，用于交班对账</div>
            </div>`;
        foot.innerHTML = `<button class="btn ghost" data-close="shiftMask">取消</button>
            <button class="btn primary" id="startShift">开始营业</button>`;
    } else {
        const s = state.shift;
        $('#shiftTitle').textContent = '交班';
        body.innerHTML = `
            <div class="card pad" style="box-shadow:none;background:#F8FAFC;margin-bottom:14px">
                <div style="display:flex;justify-content:space-between;padding:3px 0"><span>开班时间</span><span>${new Date(s.start_at).toLocaleString('zh-CN')}</span></div>
                <div style="display:flex;justify-content:space-between;padding:3px 0"><span>本班订单</span><span>${s.orders || 0} 单</span></div>
                <div style="display:flex;justify-content:space-between;padding:3px 0"><span>备用金</span><span>¥${money(s.opening_cash)}</span></div>
                <div style="display:flex;justify-content:space-between;padding:3px 0"><span>现金收入</span><span>¥${money(s.cash_in)}</span></div>
                <div style="display:flex;justify-content:space-between;padding:6px 0 2px;border-top:1px dashed var(--line);margin-top:6px"><span>应有现金</span><b>¥${money(s.cash_expected)}</b></div>
            </div>
            <div class="field">
                <label>实收现金（元）</label>
                <input class="input num" id="cashActual" inputmode="decimal" value="${money(s.cash_expected)}">
                <div class="hint">点钞后填写实际金额，系统自动算差额</div>
            </div>`;
        foot.innerHTML = `<button class="btn ghost" data-close="shiftMask">取消</button>
            <button class="btn primary" id="endShift">确认交班</button>`;
    }
    openModal('shiftMask');
}

/* ================= 挂单 ================= */
async function doHold() {
    if (!state.cart.length) return toast('购物车为空');
    await api('/api/orders/hold', {
        method: 'POST',
        body: {
            payload: { items: state.cart, discountPct: state.discountPct, roundMode: state.roundMode },
            note: `共 ${state.cart.length} 种商品`
        }
    });
    state.cart = [];
    state.discountPct = 0;
    state.roundMode = '0';
    renderCart();
    toast('已挂单', 'ok');
}

async function openHeld() {
    const list = await api('/api/orders/held');
    const box = $('#heldList');
    if (!list.length) {
        box.innerHTML = `<div class="empty"><span class="icon">📋</span>暂无挂单</div>`;
    } else {
        box.innerHTML = list.map(h => {
            const d = h.data || {};
            const items = d.items || [];
            const total = items.reduce((s, i) => s + i.price * i.qty, 0);
            return `<div class="held-item" data-id="${h.id}">
                <div>
                    <div>${items.length} 种商品 · ¥${money(total)}</div>
                    <div class="t">${new Date(h.created_at).toLocaleString('zh-CN')}</div>
                </div>
                <div style="display:flex;gap:8px">
                    <button class="btn sm" data-pick="${h.id}">取回</button>
                    <button class="btn sm ghost" data-drop="${h.id}">删除</button>
                </div>
            </div>`;
        }).join('');
    }
    openModal('heldMask');
}

async function pickHeld(id) {
    const list = await api('/api/orders/held');
    const h = list.find(x => Number(x.id) === Number(id));
    if (!h) return;
    const d = h.data || {};
    state.cart = (d.items || []).map(i => ({
        id: Number(i.id), name: i.name, price: Number(i.price), qty: Number(i.qty),
        barcode: i.barcode || '', stock: Number(i.stock || 0)
    }));
    state.discountPct = Number(d.discountPct || 0);
    state.roundMode = d.roundMode || '0';
    renderCart();
    await api('/api/orders/held/' + id, { method: 'DELETE' });
    closeModal('heldMask');
    toast('已取回挂单', 'ok');
}

/* ================= 事件绑定 ================= */
function bindEvents() {
    // 扫码枪
    document.addEventListener('keydown', e => {
        const tag = (e.target.tagName || '').toLowerCase();
        const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';
        if (e.key === 'Enter') {
            if (isInput) {
                if (e.target.id === 'searchInput') {
                    const v = e.target.value.trim();
                    if (v.length >= 4 && /^[0-9A-Za-z\-]+$/.test(v)) {
                        e.preventDefault();
                        handleBarcode(v);
                        e.target.value = '';
                        state.kw = '';
                        renderGrid();
                    }
                }
                return;
            }
            if (scanBuf.length >= 4) {
                e.preventDefault();
                handleBarcode(scanBuf);
            }
            scanBuf = '';
            return;
        }
        if (isInput) return;
        if (e.key.length === 1 && e.key !== ' ') {
            const now = Date.now();
            if (now - scanLast > 150) scanBuf = '';
            scanBuf += e.key;
            scanLast = now;
        }
    });

    // 搜索
    $('#searchInput').addEventListener('input', e => {
        state.kw = e.target.value;
        renderGrid();
    });

    // 分类
    $('#cats').addEventListener('click', e => {
        const b = e.target.closest('[data-cat]');
        if (!b) return;
        state.cat = Number(b.dataset.cat) || 0;
        renderCats();
        renderGrid();
    });

    // 商品点击
    $('#grid').addEventListener('click', e => {
        const card = e.target.closest('.p-card');
        if (!card) return;
        addToCart(findProduct(card.dataset.id), 1);
    });

    // 购物车行操作
    $('#cartList').addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const row = btn.closest('.cart-row');
        const id = Number(row.dataset.id);
        const line = state.cart.find(i => i.id === id);
        if (!line) return;
        if (btn.dataset.act === 'plus') {
            const allowNegative = state.config.allow_negative === '1';
            if (!allowNegative && line.qty + 1 > line.stock) return toast('库存不足', 'err');
            line.qty++;
        } else {
            line.qty--;
            if (line.qty <= 0) state.cart = state.cart.filter(i => i.id !== id);
        }
        renderCart();
    });

    $('#clearBtn').addEventListener('click', () => {
        if (!state.cart.length) return;
        state.cart = [];
        state.discountPct = 0;
        state.roundMode = '0';
        renderCart();
    });

    // 移动端展开购物车
    $('#cartHead').addEventListener('click', () => {
        if (window.innerWidth > 900) return;
        $('#cartPane').classList.toggle('collapsed');
    });
    // 手机端：折叠状态下点「合计 / 查看明细」区域即可展开，看到每件商品与优惠明细
    $('#cartPane').addEventListener('click', e => {
        if (!$('#cartPane').classList.contains('collapsed')) return;
        if (e.target.closest('.cart-actions, .cart-head, button, input')) return;
        $('#cartPane').classList.remove('collapsed');
    });
    $('#payBtn').addEventListener('click', () => {
        if (window.innerWidth <= 900 && !$('#cartPane').classList.contains('collapsed')) {
            $('#cartPane').classList.add('collapsed');
        }
        openPay();
    });

    // 结算弹窗
    $('#methods').addEventListener('click', e => {
        const btn = e.target.closest('.method-btn');
        if (!btn) return;
        const method = btn.dataset.method;
        const rows = state.pay.rows;
        if (rows.length === 1) {
            rows[0].method = method;
            if (method === 'cash') state.pay.tendered = money(rows[0].amount);
        } else {
            const c = calc();
            const paid = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
            const remain = c.payable - paid;
            if (remain <= 0) return toast('已收满，无需追加');
            rows.push({ method, amount: remain });
        }
        renderPayRows();
    });

    $('#payRows').addEventListener('input', e => {
        const inp = e.target.closest('[data-amount]');
        if (!inp) return;
        const i = Number(inp.dataset.amount);
        state.pay.rows[i].amount = yuanToFen(inp.value);
        const c = calc();
        const sum = state.pay.rows.reduce((s, r) => s + Number(r.amount || 0), 0);
        $('#remainAmt').textContent = '¥' + money(c.payable - sum);
    });

    $('#payRows').addEventListener('click', e => {
        const del = e.target.closest('[data-del]');
        if (!del) return;
        state.pay.rows.splice(Number(del.dataset.del), 1);
        renderPayRows();
    });

    $('#addPayBtn').addEventListener('click', () => {
        const c = calc();
        const paid = state.pay.rows.reduce((s, r) => s + Number(r.amount || 0), 0);
        const remain = c.payable - paid;
        if (remain <= 0) return toast('已收满');
        state.pay.rows.push({ method: 'wechat', amount: remain });
        renderPayRows();
    });

    $('#keypad').addEventListener('click', e => {
        const b = e.target.closest('[data-key]');
        if (!b) return;
        const k = b.dataset.key;
        let t = String(state.pay.tendered || '');
        if (k === '⌫') t = t.slice(0, -1);
        else if (k === '.') { if (!t.includes('.')) t += '.'; }
        else t += k;
        if (t.length > 10) return;
        state.pay.tendered = t;
        renderPayRows();
    });

    $('#quickCash').addEventListener('click', e => {
        const b = e.target.closest('[data-cash]');
        if (!b) return;
        if (b.dataset.cash === 'exact') {
            const cashRow = state.pay.rows.find(r => r.method === 'cash');
            state.pay.tendered = money(cashRow ? cashRow.amount : 0);
        } else {
            state.pay.tendered = String(Number(b.dataset.cash));
        }
        renderPayRows();
    });

    $('#confirmPay').addEventListener('click', confirmPay);

    // 优惠
    $('#discountBtn').addEventListener('click', openDiscount);
    $('#discQuick').addEventListener('click', e => {
        const b = e.target.closest('[data-pct]');
        if (!b) return;
        state.discountPct = Number(b.dataset.pct);
        $$('#discQuick .btn').forEach(x => x.classList.toggle('primary', x === b));
        updateDiscountPreview();
    });
    $('#discountBtnWrap') && $('#discountBtnWrap').addEventListener('click', () => { });
    document.addEventListener('click', e => {
        const b = e.target.closest('[data-round]');
        if (!b) return;
        state.roundMode = b.dataset.round;
        $$('[data-round]').forEach(x => x.classList.toggle('primary', x === b));
        updateDiscountPreview();
    });
    $('#discReset').addEventListener('click', () => {
        state.discountPct = 0;
        state.roundMode = '0';
        $$('#discQuick .btn').forEach(x => x.classList.toggle('primary', x.dataset.pct === '0'));
        $$('[data-round]').forEach(x => x.classList.toggle('primary', x.dataset.round === '0'));
        updateDiscountPreview();
    });

    // 挂单
    $('#heldBtn').addEventListener('click', () => doHold().catch(e => toast(e.message, 'err')));
    $('#pickBtn').addEventListener('click', () => openHeld().catch(e => toast(e.message, 'err')));
    $('#heldList').addEventListener('click', e => {
        const pick = e.target.closest('[data-pick]');
        const drop = e.target.closest('[data-drop]');
        if (pick) pickHeld(pick.dataset.pick).catch(x => toast(x.message, 'err'));
        if (drop) {
            api('/api/orders/held/' + drop.dataset.drop, { method: 'DELETE' })
                .then(() => openHeld())
                .catch(x => toast(x.message, 'err'));
        }
    });

    // 班次
    $('#shiftBtn').addEventListener('click', () => openShift());
    $('#moreBtn').addEventListener('click', () => openModal('moreMask'));
    $('#moreShift').addEventListener('click', () => { closeModal('moreMask'); openShift(); });
    $('#moreRefresh').addEventListener('click', async () => {
        closeModal('moreMask');
        await Promise.allSettled([loadProducts(true), loadCats(), refreshShift(), loadConfig()]);
        toast('已刷新', 'ok');
    });
    $('#moreAdmin').addEventListener('click', () => window.open('/admin', '_blank'));
    $('#moreRename').addEventListener('click', () => {
        closeModal('moreMask');
        showWizard(state.device.name);
    });

    $('#shiftFoot').addEventListener('click', async e => {
        if (e.target.id === 'startShift') {
            const cash = yuanToFen($('#openingCash').value);
            try {
                await api('/api/shifts/start', { method: 'POST', body: { opening_cash: cash } });
                closeModal('shiftMask');
                await refreshShift();
                toast('已开班', 'ok');
            } catch (err) { toast(err.message, 'err'); }
        }
        if (e.target.id === 'endShift') {
            const actual = yuanToFen($('#cashActual').value);
            try {
                const r = await api('/api/shifts/end', { method: 'POST', body: { cash_actual: actual } });
                closeModal('shiftMask');
                await refreshShift();
                toast(`交班完成，差额 ¥${money(r.diff)}`, Math.abs(r.diff) < 1 ? 'ok' : 'err');
            } catch (err) { toast(err.message, 'err'); }
        }
    });

    // 扫码
    $('#camBtn').addEventListener('click', () => {
        openModal('camMask');
        startCamera();
    });
    $('#camAlbum').addEventListener('click', () => $('#camFile').click());
    $('#camFile').addEventListener('change', async e => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        $('#camTip').textContent = '正在识别图片…';
        camLastErr = '';
        try {
            if (!window.ZXing) await ensureZXing();
            const code = await decodeImageFile(f);
            if (code) {
                stopCamera();
                closeModal('camMask');
                await handleBarcode(code);
            } else {
                $('#camTip').textContent = '没识别到条码，重拍一张再试';
                showCamDiag();
            }
        } catch (err) {
            camLastErr = 'img:' + (err.message || err);
            $('#camTip').textContent = '图片识别出错';
            showCamDiag();
        }
    });
    $('#camManual').addEventListener('keydown', async e => {
        if (e.key !== 'Enter') return;
        const v = e.target.value.trim();
        if (!v) return;
        e.target.value = '';
        stopCamera();
        closeModal('camMask');
        await handleBarcode(v);
    });

    // 设备向导
    $('#wizOk').addEventListener('click', async () => {
        const name = $('#wizName').value.trim() || suggestedName();
        const btn = $('#wizOk');
        btn.disabled = true;
        try {
            await registerDevice(name);
            closeModal('wizardMask');
            await boot();
            toast('设备已就绪：' + name, 'ok');
        } catch (e) {
            toast(e.message, 'err');
        } finally {
            btn.disabled = false;
        }
    });
    $('#wizBindBtn').addEventListener('click', () => {
        closeModal('wizardMask');
        openModal('bindMask');
    });
    $('#bindOk').addEventListener('click', async () => {
        const code = $('#bindCode').value.trim().toUpperCase();
        if (code.length !== 6) return toast('请输入 6 位设备码', 'err');
        try {
            const r = await api('/api/device/bind', { method: 'POST', body: { code } });
            const device = { id: r.id, name: r.name, type: r.type || 'pc' };
            await Device.save(device);
            state.device = device;
            closeModal('bindMask');
            await boot();
            toast('已绑定设备：' + r.name, 'ok');
        } catch (e) { toast(e.message, 'err'); }
    });

    // 关闭弹窗
    document.addEventListener('click', e => {
        const c = e.target.closest('[data-close]');
        if (c) {
            const id = c.dataset.close;
            closeModal(id);
            if (id === 'camMask') stopCamera();
        }
    });

    // 打印
    $('#printBtn').addEventListener('click', () => {
        printReceipt($('#receiptPreview').innerHTML);
    });

    // 网络状态
    window.addEventListener('online', () => setOnline(true));
    window.addEventListener('offline', () => setOnline(false));

    // 桌面端默认展开购物车
    if (window.innerWidth > 900) $('#cartPane').classList.remove('collapsed');
}

/* ================= 优惠弹窗 ================= */
function openDiscount() {
    if (!state.cart.length) return toast('购物车为空');
    $$('#discQuick .btn').forEach(x => x.classList.toggle('primary', Number(x.dataset.pct) === state.discountPct));
    $$('[data-round]').forEach(x => x.classList.toggle('primary', x.dataset.round === state.roundMode));
    updateDiscountPreview();
    openModal('discMask');
}

function updateDiscountPreview() {
    const c = calc();
    $('#discTotal').textContent = money(c.total);
    $('#discPreview').textContent = '¥' + money(c.discount);
    $('#roundPreview').textContent = '¥' + money(c.roundOff);
    $('#discPayable').textContent = money(c.payable);
    renderCart();
}

/* ================= 确认收款 ================= */
async function confirmPay() {
    const c = calc();
    const rows = state.pay.rows.map(r => ({ method: r.method, amount: Number(r.amount || 0) }));
    const sum = rows.reduce((s, r) => s + r.amount, 0);

    if (sum !== c.payable) return toast(`支付合计 ¥${money(sum)}，应收 ¥${money(c.payable)}`, 'err');
    if (!rows.length) return toast('请选择支付方式', 'err');

    const cashRow = rows.find(r => r.method === 'cash');
    if (cashRow) {
        const tendered = yuanToFen(state.pay.tendered || '0');
        if (tendered < cashRow.amount) return toast('实收现金不足', 'err');
    }

    const btn = $('#confirmPay');
    btn.disabled = true;
    btn.textContent = '处理中…';
    try {
        const r = await api('/api/orders/checkout', {
            method: 'POST',
            body: {
                items: state.cart.map(i => ({ product_id: i.id, qty: i.qty, price: i.price, barcode: i.barcode })),
                discount: c.discount,
                round_off: c.roundOff,
                payments: rows,
                remark: $('#orderRemark').value.trim()
            }
        });

        state.cart = [];
        state.discountPct = 0;
        state.roundMode = '0';
        renderCart();
        closeModal('payMask');
        await loadProducts(true).catch(() => { });

        const html = receiptHtml(r);
        $('#receiptPreview').innerHTML = html;

        const cfg = state.config;
        const autoPrint = cfg.auto_print === '1';
        openModal('receiptMask');
        if (autoPrint) setTimeout(() => printReceipt(html), 300);

        toast('收款成功 ¥' + money(r.payable), 'ok');
        await refreshShift().catch(() => { });
    } catch (e) {
        toast(e.message, 'err');
    } finally {
        btn.disabled = false;
        btn.textContent = '确认收款';
    }
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

document.addEventListener('DOMContentLoaded', init);
