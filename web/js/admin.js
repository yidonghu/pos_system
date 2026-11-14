'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const money = n => (Math.round(Number(n || 0)) / 100).toFixed(2);
const fen = v => Math.round(Number(String(v).replace(/[^0-9.\-]/g, '') || 0) * 100);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

let TOKEN = localStorage.getItem('pos.admin.token') || '';
let currentPage = 'dash';
const productState = { page: 1, kw: '', cat: 0 };

function toast(msg, type = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'show ' + type;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 2400);
}

async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'X-Admin-Token': TOKEN };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { msg: text }; }
    if (res.status === 401) {
        showLogin();
        throw new Error('请先登录');
    }
    if (!res.ok || (data && data.ok === false)) {
        throw new Error((data && data.msg) || ('请求失败 ' + res.status));
    }
    return data;
}

async function downloadFile(path, filename) {
    const res = await fetch(path, { headers: { 'X-Admin-Token': TOKEN } });
    if (!res.ok) return toast('导出失败：' + res.status, 'err');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function showModal(title, body, foot, width = 600) {
    $('#mTitle').textContent = title;
    $('#mBody').innerHTML = body;
    $('#mFoot').innerHTML = foot || '<button class="btn ghost" id="mCancel">关闭</button>';
    $('#modalBox').style.maxWidth = width + 'px';
    $('#modalMask').classList.add('show');
    const c = $('#mCancel');
    if (c) c.onclick = closeModal;
}

function closeModal() { $('#modalMask').classList.remove('show'); }

/* ================= 登录 ================= */
function showLogin() {
    $('#loginMask').classList.add('show');
    $('#shell').hidden = true;
}

async function doLogin() {
    const pwd = $('#loginPwd').value.trim();
    if (!pwd) return toast('请输入密码', 'err');
    try {
        const r = await api('/api/admin/login', { method: 'POST', body: { password: pwd } });
        TOKEN = r.token;
        localStorage.setItem('pos.admin.token', TOKEN);
        $('#loginMask').classList.remove('show');
        $('#shell').hidden = false;
        await start();
    } catch (e) {
        toast(e.message, 'err');
    }
}

/* ================= 启动 ================= */
async function start() {
    const cfg = await api('/api/admin/settings').catch(() => null);
    if (cfg && cfg.data) {
        $('#sideShop').textContent = cfg.data.shop_name || 'POS 管理后台';
        SHOP = cfg.data;
    }
    const valid = ['dash', 'products', 'inventory', 'orders', 'devices', 'reports', 'settings'];
    const hash = location.hash.replace('#', '');
    await go(valid.includes(hash) ? hash : 'dash');
}

async function go(page) {
    currentPage = page;
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    $('#pageActions').innerHTML = '';
    try {
        await ({ dash: pageDash, products: pageProducts, inventory: pageInventory,
            orders: pageOrders, devices: pageDevices, reports: pageReports, settings: pageSettings }[page])();
    } catch (e) {
        $('#page').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
}

/* ================= 工作台 ================= */
function todayStart() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

async function pageDash() {
    $('#pageTitle').textContent = '工作台';
    const now = Date.now();
    const weekStart = todayStart() - 6 * 86400000;

    const today = await api('/api/admin/reports/overview');
    const week = await api(`/api/admin/reports/overview?from=${weekStart}&to=${now}`);
    const recent = await api('/api/orders?limit=8');
    const alerts = await api('/api/inventory/alerts');

    const daily = week.daily || [];
    const maxAmt = Math.max(1, ...daily.map(d => Number(d.amount || 0)));
    const bars = daily.map(d => {
        const h = Math.max(2, Math.round(Number(d.amount || 0) / maxAmt * 120));
        return `<div class="bar-item">
            <div class="val">${Number(d.amount) ? money(d.amount) : ''}</div>
            <div class="bar" style="height:${h}px"></div>
            <div class="lbl">${String(d.day || '').slice(5)}</div>
        </div>`;
    }).join('') || '<div class="empty" style="width:100%">暂无数据</div>';

    const payNames = { cash: '现金', wechat: '微信', alipay: '支付宝', bank: '银行卡' };
    const payRows = (today.payments || []).map(p =>
        `<div class="list-row"><span>${payNames[p.method] || p.method}</span>
            <span class="r">¥${money(p.amount)} · ${p.cnt} 笔</span></div>`).join('')
        || '<div class="empty" style="padding:20px 0">今日暂无收款</div>';

    const recentRows = (recent || []).map(o => `
        <div class="list-row">
            <span>${esc(o.order_no)} <span class="badge ${o.status === 'refund' ? 'danger' : 'ok'}">${o.status === 'refund' ? '退款' : '正常'}</span></span>
            <span class="r">¥${money(o.payable)} · ${esc(o.device_name)}</span>
        </div>`).join('') || '<div class="empty" style="padding:20px 0">暂无订单</div>';

    const alertRows = (alerts.list || []).map(a =>
        `<div class="list-row"><span>${esc(a.name)}</span><span class="r" style="color:var(--warn)">剩 ${a.qty} / 预警 ${a.stock_alert}</span></div>`).join('')
        || '<div class="empty" style="padding:20px 0">库存充足</div>';

    $('#page').innerHTML = `
        <div class="stats">
            <div class="stat brand"><div class="k">今日营业额</div><div class="v">¥${money(today.revenue)}</div>
                <div class="s">退款 ¥${money(today.refund)}</div></div>
            <div class="stat"><div class="k">今日订单</div><div class="v">${today.orders}</div>
                <div class="s">卖出 ${today.items} 件</div></div>
            <div class="stat"><div class="k">客单价</div><div class="v">¥${money(today.avg)}</div>
                <div class="s">退款单 ${today.refund_orders}</div></div>
            <div class="stat"><div class="k">库存预警</div><div class="v" style="color:${alerts.count ? 'var(--warn)' : 'var(--ok)'}">${alerts.count}</div>
                <div class="s">库存成本 ¥${money(today.stock_value)}</div></div>
        </div>

        <div class="cols">
            <div class="card pad">
                <div class="card-title">近 7 日营业额</div>
                <div class="bars">${bars}</div>
            </div>
            <div class="card pad">
                <div class="card-title">今日支付方式</div>
                ${payRows}
            </div>
        </div>

        <div class="cols" style="margin-top:16px">
            <div class="card pad">
                <div class="card-title">最近订单 <button class="link" onclick="go('orders')">全部</button></div>
                ${recentRows}
            </div>
            <div class="card pad">
                <div class="card-title">库存预警 <button class="link" onclick="go('inventory')">处理</button></div>
                ${alertRows}
            </div>
        </div>`;
}

/* ================= 商品 ================= */
async function pageProducts() {
    $('#pageTitle').textContent = '商品管理';
    $('#pageActions').innerHTML = `
        <button class="btn ghost sm" id="btnCats">分类管理</button>
        <button class="btn ghost sm" id="btnImport">导入 CSV</button>
        <button class="btn ghost sm" id="btnExport">导出 CSV</button>
        <button class="btn primary sm" id="btnAddProduct">+ 新增商品</button>`;

    $('#btnAddProduct').onclick = () => productModal(null);
    $('#btnCats').onclick = categoryModal;
    $('#btnExport').onclick = () => downloadFile('/api/admin/products/export.csv', 'products.csv');
    $('#btnImport').onclick = () => $('#importFile').click();

    const cats = await api('/api/categories');
    const catOptions = ['<option value="0">全部分类</option>']
        .concat(cats.map(c => `<option value="${c.id}" ${productState.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)).join('');

    $('#page').innerHTML = `
        <div class="toolbar">
            <input class="input" id="pKw" placeholder="搜索名称或条码" value="${esc(productState.kw)}" style="min-width:220px">
            <select class="select" id="pCat">${catOptions}</select>
            <button class="btn sm" id="btnSearch">搜索</button>
            <div class="grow"></div>
            <span id="pTotal" style="font-size:13px;color:var(--muted)"></span>
        </div>
        <div class="card"><div class="table-wrap" id="pTable"></div></div>
        <div class="pager"><span id="pInfo"></span><div class="btns">
            <button class="btn sm ghost" id="pPrev">上一页</button>
            <button class="btn sm ghost" id="pNext">下一页</button>
        </div></div>`;

    const search = () => {
        productState.kw = $('#pKw').value.trim();
        productState.cat = Number($('#pCat').value);
        productState.page = 1;
        loadProducts();
    };
    $('#btnSearch').onclick = search;
    $('#pKw').onkeydown = e => { if (e.key === 'Enter') search(); };
    $('#pCat').onchange = search;
    $('#pPrev').onclick = () => { if (productState.page > 1) { productState.page--; loadProducts(); } };
    $('#pNext').onclick = () => { productState.page++; loadProducts(); };

    loadProducts();
}

async function loadProducts() {
    const q = new URLSearchParams({
        kw: productState.kw, cat: productState.cat, page: productState.page, size: 20
    });
    const r = await api('/api/admin/products?' + q.toString());
    $('#pTotal').textContent = `共 ${r.total} 个商品`;

    const rows = (r.list || []).map(p => `
        <tr>
            <td><b>${esc(p.name)}</b>${p.demo ? ' <span class="badge">演示</span>' : ''}</td>
            <td style="font-family:monospace;font-size:12px">${esc((p.barcodes || '').replace(/\|/g, ' / '))}</td>
            <td>${esc(p.category_name || '—')}</td>
            <td class="num">¥${money(p.sale_price)}</td>
            <td class="num" style="color:var(--muted)">¥${money(p.cost_price)}</td>
            <td class="num">${p.stock}</td>
            <td>${p.status == 1 ? '<span class="badge ok">在售</span>' : '<span class="badge">下架</span>'}</td>
            <td>
                <button class="link" data-edit="${p.id}">编辑</button>
                <button class="link ${p.status == 1 ? 'danger' : ''}" data-toggle="${p.id}" data-status="${p.status}">
                    ${p.status == 1 ? '下架' : '上架'}
                </button>
                <button class="link danger" data-del="${p.id}">删除</button>
            </td>
        </tr>`).join('') || `<tr><td colspan="8"><div class="empty">没有商品，点右上「新增商品」</div></td></tr>`;

    $('#pTable').innerHTML = `
        <table>
            <thead><tr><th>商品</th><th>条码</th><th>分类</th><th class="num">售价</th><th class="num">进价</th>
            <th class="num">库存</th><th>状态</th><th style="width:120px">操作</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;

    $$('#pTable [data-del]').forEach(b => b.onclick = async () => {
        const p = (r.list || []).find(x => String(x.id) === b.dataset.del);
        if (!p) return;
        if (!confirm('确定删除「' + p.name + '」？\n有历史订单的商品只会下架，不会从报表里消失。')) return;
        try {
            const res = await api('/api/admin/products/' + p.id, { method: 'DELETE' });
            toast(res.msg || '已删除', 'ok');
            loadProducts();
        } catch (e) { toast(e.message, 'err'); }
    });

    const pages = Math.ceil(r.total / r.size) || 1;
    $('#pInfo').textContent = `第 ${r.page} / ${pages} 页`;

    $$('#pTable [data-edit]').forEach(b => b.onclick = () => {
        const p = (r.list || []).find(x => String(x.id) === b.dataset.edit);
        productModal(p);
    });
    $$('#pTable [data-toggle]').forEach(b => b.onclick = async () => {
        const next = b.dataset.status == 1 ? 0 : 1;
        try {
            await api('/api/admin/products/' + b.dataset.toggle, { method: 'PUT', body: { status: next } });
            toast(next ? '已上架' : '已下架', 'ok');
            loadProducts();
        } catch (e) { toast(e.message, 'err'); }
    });
}

async function productModal(p) {
    const cats = await api('/api/categories');
    const opts = cats.map(c => `<option value="${c.id}" ${p && p.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const editing = !!(p && p.id);
    const barcodes = p ? String(p.barcodes || '').replace(/\|/g, ',') : '';

    showModal(editing ? '编辑商品' : '新增商品', `
        <div class="form-grid">
            <div class="field full"><label>商品名称 *</label><input class="input" id="fName" value="${esc(p ? p.name : '')}"></div>
            <div class="field"><label>分类</label><select class="select" id="fCat"><option value="">未分类</option>${opts}</select></div>
            <div class="field"><label>单位</label><input class="input" id="fUnit" value="${esc(p ? p.unit : '件')}"></div>
            <div class="field full"><label>条码（多个用逗号分隔）</label>
                <div style="display:flex;gap:8px">
                    <input class="input" id="fBarcode" value="${esc(barcodes)}" style="font-family:monospace">
                    <button class="btn ghost" id="fBarcodeScan" type="button" style="flex:none">扫码</button>
                </div></div>
            <div class="field"><label>进价（元）</label><input class="input num" id="fCost" value="${money(p ? p.cost_price : 0)}"></div>
            <div class="field"><label>售价（元）*</label><input class="input num" id="fSale" value="${money(p ? p.sale_price : 0)}"></div>
            <div class="field"><label>库存预警值</label><input class="input num" id="fAlert" value="${p ? p.stock_alert : 5}"></div>
            <div class="field"><label>${editing ? '当前库存' : '初始库存'}</label>
                <input class="input num" id="fStock" value="${editing ? (p.stock || 0) : 0}" ${editing ? 'disabled' : ''}>
                <div class="hint">${editing ? '调整库存请到「库存」页做入库/盘点' : '建档后自动生成入库流水'}</div></div>
        </div>`,
        `<button class="btn ghost" id="mCancel">取消</button>
         <button class="btn primary" id="saveProduct">保存</button>`, 640);

    const scanBtn = $('#fBarcodeScan');
    if (scanBtn && window.openScanDialog) {
        scanBtn.onclick = () => {
            openScanDialog(code => {
                const cur = $('#fBarcode').value.split(/[,，\s]+/).filter(Boolean);
                if (!cur.includes(code)) cur.push(code);
                $('#fBarcode').value = cur.join(',');
                toast('已填入条码 ' + code, 'ok');
            });
        };
    }

    $('#saveProduct').onclick = async () => {
        const name = $('#fName').value.trim();
        const sale = fen($('#fSale').value);
        if (!name) return toast('请填写商品名称', 'err');
        if (sale < 0) return toast('售价不能为负', 'err');
        const body = {
            name,
            category_id: $('#fCat').value || null,
            unit: $('#fUnit').value.trim() || '件',
            barcodes: $('#fBarcode').value.split(/[,，\s]+/).filter(Boolean),
            cost_price: fen($('#fCost').value),
            sale_price: sale,
            stock_alert: Number($('#fAlert').value) || 0
        };
        if (!editing) body.stock = Number($('#fStock').value) || 0;
        try {
            if (editing) await api('/api/admin/products/' + p.id, { method: 'PUT', body });
            else await api('/api/admin/products', { method: 'POST', body });
            closeModal();
            toast('已保存', 'ok');
            loadProducts();
        } catch (e) { toast(e.message, 'err'); }
    };
}

async function categoryModal() {
    const cats = await api('/api/categories');
    showModal('分类管理', `
        <div class="toolbar">
            <input class="input" id="newCatName" placeholder="新分类名称">
            <button class="btn sm primary" id="addCat">添加</button>
        </div>
        <div>${cats.map(c => `
            <div class="list-row">
                <span>${esc(c.name)} <span style="color:var(--muted);font-size:12px">${c.cnt} 个商品</span></span>
                <button class="link danger" data-delcat="${c.id}">删除</button>
            </div>`).join('') || '<div class="empty">暂无分类</div>'}</div>`,
        '<button class="btn ghost" id="mCancel">关闭</button>', 480);

    $('#addCat').onclick = async () => {
        const name = $('#newCatName').value.trim();
        if (!name) return toast('请输入分类名', 'err');
        try {
            await api('/api/admin/categories', { method: 'POST', body: { name } });
            toast('已添加', 'ok');
            categoryModal();
        } catch (e) { toast(e.message, 'err'); }
    };

    $$('[data-delcat]').forEach(b => b.onclick = async () => {
        try {
            await api('/api/admin/categories/' + b.dataset.delcat, { method: 'DELETE' });
            toast('已删除', 'ok');
            categoryModal();
        } catch (e) { toast(e.message, 'err'); }
    });
}

/* ================= 库存 ================= */
async function pageInventory() {
    $('#pageTitle').textContent = '库存';
    $('#pageActions').innerHTML = `
        <button class="btn ghost sm" id="btnMove">入库 / 出库</button>
        <button class="btn ghost sm" id="btnStocktake">盘点</button>
        <button class="btn ghost sm" id="btnMovements">库存流水</button>`;

    $('#page').innerHTML = `
        <div class="toolbar">
            <input class="input" id="invKw" placeholder="搜索商品" style="min-width:220px">
            <label class="chip" style="cursor:pointer"><input type="checkbox" id="onlyAlert" style="margin-right:4px">只看预警</label>
            <button class="btn sm" id="invSearch">搜索</button>
        </div>
        <div class="card"><div class="table-wrap" id="invTable"></div></div>`;

    const load = async () => {
        const q = new URLSearchParams({ kw: $('#invKw').value.trim(), onlyAlert: $('#onlyAlert').checked ? 1 : 0 });
        const list = await api('/api/inventory?' + q.toString());
        const rows = list.map(p => {
            const low = Number(p.qty) <= Number(p.stock_alert);
            return `<tr>
                <td><b>${esc(p.name)}</b></td>
                <td>${esc(p.category_name || '—')}</td>
                <td class="num" style="color:${low ? 'var(--warn)' : 'inherit'};font-weight:${low ? 600 : 400}">${p.qty}</td>
                <td class="num">${p.stock_alert}</td>
                <td class="num">¥${money(p.cost_price)}</td>
                <td class="num">¥${money(p.cost_price * p.qty)}</td>
                <td>
                    <button class="link" data-in="${p.id}">入库</button>
                    <button class="link" data-out="${p.id}">出库</button>
                    <button class="link" data-check="${p.id}">盘点</button>
                </td>
            </tr>`;
        }).join('') || '<tr><td colspan="7"><div class="empty">没有商品</div></td></tr>';

        $('#invTable').innerHTML = `<table>
            <thead><tr><th>商品</th><th>分类</th><th class="num">库存</th><th class="num">预警值</th>
            <th class="num">进价</th><th class="num">库存成本</th><th style="width:150px">操作</th></tr></thead>
            <tbody>${rows}</tbody></table>`;

        $$('#invTable [data-in]').forEach(b => b.onclick = () => moveModal(list.find(x => String(x.id) === b.dataset.in), 'in'));
        $$('#invTable [data-out]').forEach(b => b.onclick = () => moveModal(list.find(x => String(x.id) === b.dataset.out), 'out'));
        $$('#invTable [data-check]').forEach(b => b.onclick = () => stocktakeModal(list.find(x => String(x.id) === b.dataset.check)));
    };

    $('#invSearch').onclick = load;
    $('#invKw').onkeydown = e => { if (e.key === 'Enter') load(); };
    $('#onlyAlert').onchange = load;
    $('#btnMove').onclick = () => moveModal(null, 'in');
    $('#btnStocktake').onclick = () => stocktakeModal(null);
    $('#btnMovements').onclick = () => movementsModal(null);
    load();
}

async function moveModal(product, type) {
    const list = product ? [product] : await api('/api/inventory');
    if (!list.length) return toast('没有可操作的商品', 'err');
    const opts = list.map(p => `<option value="${p.id}">${esc(p.name)}（剩 ${p.qty}）</option>`).join('');

    showModal(type === 'out' ? '商品出库' : '商品入库', `
        <div class="field"><label>商品</label><select class="select" id="mvProduct">${opts}</select></div>
        <div class="form-grid">
            <div class="field"><label>数量 *</label><input class="input num" id="mvQty" value="1" inputmode="numeric"></div>
            <div class="field"><label>${type === 'out' ? '出库类型' : '入库单价（元，可选）'}</label>
                ${type === 'out'
            ? '<select class="select" id="mvType"><option value="out">正常出库</option><option value="scrap">报损</option></select>'
            : '<input class="input num" id="mvCost" placeholder="不填用成本价">'}
            </div>
        </div>
        <div class="field"><label>备注</label><input class="input" id="mvNote" placeholder="如：进货单号、报损原因"></div>`,
        `<button class="btn ghost" id="mCancel">取消</button>
         <button class="btn primary" id="mvSave">确认${type === 'out' ? '出库' : '入库'}</button>`, 520);

    $('#mvSave').onclick = async () => {
        const qty = Number($('#mvQty').value);
        if (!qty || qty <= 0) return toast('请输入正确数量', 'err');
        const body = {
            product_id: Number($('#mvProduct').value),
            type: type === 'out' ? ($('#mvType') ? $('#mvType').value : 'out') : 'in',
            qty,
            note: $('#mvNote').value.trim()
        };
        if (type === 'in' && $('#mvCost') && $('#mvCost').value) body.unit_cost = fen($('#mvCost').value);
        try {
            const r = await api('/api/inventory/move', { method: 'POST', body });
            closeModal();
            toast(`${r.name} 现有库存 ${r.qty}`, 'ok');
            pageInventory();
        } catch (e) { toast(e.message, 'err'); }
    };
}

async function stocktakeModal(product) {
    const list = product ? [product] : await api('/api/inventory');
    if (!list.length) return toast('没有可盘点的商品', 'err');
    const p = product || list[0];
    const opts = list.map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}（账面 ${x.qty}）</option>`).join('');

    showModal('库存盘点', `
        <div class="field"><label>商品</label><select class="select" id="stProduct">${opts}</select></div>
        <div class="field"><label>实际盘点数量 *</label>
            <input class="input num" id="stQty" value="${p.qty}" inputmode="numeric"></div>
        <div class="hint-box">账面数量 <b>${p.qty}</b>，提交后按差额生成盘点流水并调整库存。</div>`,
        `<button class="btn ghost" id="mCancel">取消</button>
         <button class="btn primary" id="stSave">提交盘点</button>`, 480);

    $('#stSave').onclick = async () => {
        const items = [{ product_id: Number($('#stProduct').value), real_qty: Number($('#stQty').value) }];
        try {
            const r = await api('/api/inventory/stocktake', { method: 'POST', body: { items } });
            closeModal();
            toast(r.changed ? `已调整 ${r.changed} 个商品` : '账面一致，无需调整', 'ok');
            pageInventory();
        } catch (e) { toast(e.message, 'err'); }
    };
}

async function movementsModal(productId) {
    const list = await api('/api/inventory/movements?limit=100' + (productId ? '&product_id=' + productId : ''));
    const typeName = { in: '入库', out: '出库', sale: '销售', return: '退货', check: '盘点', scrap: '报损', adjust: '调整' };
    showModal('库存流水', `
        <div class="table-wrap" style="max-height:60vh">
            <table>
                <thead><tr><th>时间</th><th>商品</th><th>类型</th><th class="num">数量</th><th>单据/备注</th></tr></thead>
                <tbody>${list.map(m => `
                    <tr>
                        <td style="white-space:nowrap">${new Date(m.occur_at).toLocaleString('zh-CN')}</td>
                        <td>${esc(m.name)}</td>
                        <td><span class="badge ${m.qty > 0 ? 'ok' : 'warn'}">${typeName[m.type] || m.type}</span></td>
                        <td class="num" style="color:${m.qty > 0 ? 'var(--ok)' : 'var(--danger)'}">${m.qty > 0 ? '+' : ''}${m.qty}</td>
                        <td style="font-size:12px;color:var(--muted)">${esc(m.ref_no || '')} ${esc(m.note || '')}</td>
                    </tr>`).join('') || '<tr><td colspan="5"><div class="empty">暂无流水</div></td></tr>'}
                </tbody>
            </table>
        </div>`,
        '<button class="btn ghost" id="mCancel">关闭</button>', 760);
}

/* ================= 订单 ================= */
function dayStr(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function strDayStart(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
}
function strDayEnd(s) {
    return strDayStart(s) + 86399999;
}

async function pageOrders() {
    $('#pageTitle').textContent = '订单';
    const today = dayStr(new Date());
    $('#page').innerHTML = `
        <div class="toolbar">
            <input class="input" type="date" id="oFrom" value="${today}" style="min-width:140px">
            <span style="color:var(--muted)">至</span>
            <input class="input" type="date" id="oTo" value="${today}" style="min-width:140px">
            <select class="select" id="oStatus">
                <option value="">全部状态</option>
                <option value="paid">正常</option>
                <option value="refund">退款</option>
            </select>
            <input class="input" id="oKw" placeholder="订单号" style="min-width:140px">
            <button class="btn sm" id="oSearch">查询</button>
        </div>
        <div class="card"><div class="table-wrap" id="oTable"></div></div>`;

    const load = async () => {
        const q = new URLSearchParams({
            from: strDayStart($('#oFrom').value || today),
            to: strDayEnd($('#oTo').value || today),
            status: $('#oStatus').value,
            kw: $('#oKw').value.trim(),
            limit: 200
        });
        const list = await api('/api/orders?' + q.toString());
        const payName = { cash: '现金', wechat: '微信', alipay: '支付宝', bank: '银行卡' };
        $('#oTable').innerHTML = `
            <table>
                <thead><tr><th>时间</th><th>订单号</th><th>设备</th><th class="num">件</th><th class="num">实收</th>
                <th>支付</th><th>状态</th><th style="width:150px">操作</th></tr></thead>
                <tbody>${list.map(o => `
                    <tr>
                        <td style="white-space:nowrap">${new Date(o.occur_at).toLocaleString('zh-CN')}</td>
                        <td style="font-family:monospace">${esc(o.order_no)}</td>
                        <td>${esc(o.device_name)}</td>
                        <td class="num">${o.item_count}</td>
                        <td class="num" style="font-weight:600">¥${money(o.payable)}</td>
                        <td style="font-size:12px">${esc(String(o.pays || '').split('|').filter(Boolean).map(x => {
            const [m, a] = x.split(':');
            return (payName[m] || m) + ' ' + money(a);
        }).join(' / '))}</td>
                        <td>${o.status === 'refund' ? '<span class="badge danger">退款</span>' : '<span class="badge ok">正常</span>'}</td>
                        <td>
                            <button class="link" data-detail="${o.id}">详情</button>
                            <button class="link" data-print="${o.id}">重打</button>
                            ${o.status === 'paid' ? `<button class="link danger" data-return="${o.id}">退货</button>` : ''}
                        </td>
                    </tr>`).join('') || '<tr><td colspan="8"><div class="empty">该时段没有订单</div></td></tr>'}
                </tbody>
            </table>`;

        $$('[data-detail]').forEach(b => b.onclick = () => orderDetail(b.dataset.detail));
        $$('[data-print]').forEach(b => b.onclick = async () => {
            const d = await api('/api/orders/' + b.dataset.print);
            printHtml(receiptHtml(d));
        });
        $$('[data-return]').forEach(b => b.onclick = () => returnModal(b.dataset.return));
    };

    $('#oSearch').onclick = load;
    $('#oKw').onkeydown = e => { if (e.key === 'Enter') load(); };
    $('#oStatus').onchange = load;
    $('#oFrom').onchange = load;
    $('#oTo').onchange = load;
    load();
}

async function orderDetail(id) {
    const d = await api('/api/orders/' + id);
    const o = d.order;
    const items = d.items || [];
    const pays = d.payments || [];
    const payName = { cash: '现金', wechat: '微信', alipay: '支付宝', bank: '银行卡' };

    showModal('订单详情 ' + o.order_no, `
        <div class="list-row"><span>时间</span><span class="r">${new Date(o.occur_at).toLocaleString('zh-CN')}</span></div>
        <div class="list-row"><span>设备</span><span class="r">${esc(o.device_name)}</span></div>
        <div class="list-row"><span>状态</span><span class="r">${o.status === 'refund' ? '退款单' : '正常'}${o.refund_of ? '（原单 #' + o.refund_of + '）' : ''}</span></div>
        <div style="margin:12px 0 6px;font-weight:600">商品</div>
        <div class="table-wrap">
            <table>
                <thead><tr><th>商品</th><th class="num">单价</th><th class="num">数量</th><th class="num">金额</th></tr></thead>
                <tbody>${items.map(i => `<tr><td>${esc(i.product_name)}</td><td class="num">¥${money(i.price)}</td>
                    <td class="num">${i.qty}</td><td class="num">¥${money(i.amount)}</td></tr>`).join('')}</tbody>
            </table>
        </div>
        <div style="margin-top:14px">
            <div class="list-row"><span>合计</span><span class="r">¥${money(o.total)}</span></div>
            <div class="list-row"><span>优惠</span><span class="r">-¥${money(o.discount)}</span></div>
            <div class="list-row"><span>抹零</span><span class="r">-¥${money(o.round_off)}</span></div>
            <div class="list-row"><span><b>实收</b></span><span class="r"><b>¥${money(o.payable)}</b></span></div>
            ${pays.map(p => `<div class="list-row"><span>${payName[p.method] || p.method}</span><span class="r">¥${money(p.amount)}</span></div>`).join('')}
        </div>
        ${d.refunds && d.refunds.length ? `<div class="hint-box" style="margin-top:12px;color:var(--danger)">已退款：${esc(d.refunds[0].order_no)}（¥${money(d.refunds[0].payable)}）</div>` : ''}`,
        `<button class="btn ghost" id="mCancel">关闭</button>
         <button class="btn ghost" id="detailPrint">打印</button>`, 620);

    $('#detailPrint').onclick = () => printHtml(receiptHtml(d));
}

function returnModal(id) {
    showModal('确认退货', `
        <div class="hint-box" style="margin-bottom:14px">
            将对整单做红冲：生成负数订单、原路退回支付记录、商品库存回补。此操作不可撤销。
        </div>
        <div class="field" style="margin-bottom:0"><label>退货原因</label>
            <input class="input" id="retReason" placeholder="如：顾客反悔、商品破损"></div>`,
        `<button class="btn ghost" id="mCancel">取消</button>
         <button class="btn danger" id="retOk">确认退货</button>`, 460);

    $('#retOk').onclick = async () => {
        try {
            const r = await api('/api/orders/' + id + '/return', {
                method: 'POST', body: { reason: $('#retReason').value.trim() }
            });
            closeModal();
            toast('已退款，退款单 ' + r.refund_order_no, 'ok');
            pageOrders();
        } catch (e) { toast(e.message, 'err'); }
    };
}

/* ================= 小票打印 ================= */
let SHOP = {};
const PAY_NAME = { cash: '现金', wechat: '微信', alipay: '支付宝', bank: '银行卡' };

function receiptHtml(d) {
    const o = d.order;
    const items = (d.items || []).map(i => `
        <tr><td>${esc(i.product_name)}</td><td style="text-align:right">${i.qty} × ${money(i.price)}</td>
        <td style="text-align:right">${money(i.amount)}</td></tr>`).join('');
    const pays = (d.payments || []).map(p =>
        `<div style="display:flex;justify-content:space-between"><span>${PAY_NAME[p.method] || p.method}</span><span>¥${money(p.amount)}</span></div>`).join('');

    return `<div style="font-family:'Courier New',monospace;font-size:12px;line-height:1.5;width:72mm">
        <div style="text-align:center;font-size:15px;font-weight:700">${esc(SHOP.shop_name || '我的小店')}</div>
        ${SHOP.shop_address ? `<div style="text-align:center;font-size:11px">${esc(SHOP.shop_address)}</div>` : ''}
        ${SHOP.shop_phone ? `<div style="text-align:center;font-size:11px">TEL: ${esc(SHOP.shop_phone)}</div>` : ''}
        <div style="border-top:1px dashed #000;margin:5px 0"></div>
        <div style="font-size:11px">单号：${esc(o.order_no)}</div>
        <div style="font-size:11px">时间：${new Date(o.occur_at).toLocaleString('zh-CN')}</div>
        <div style="font-size:11px">收银台：${esc(o.device_name)}</div>
        <div style="border-top:1px dashed #000;margin:5px 0"></div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr><td>商品</td><td style="text-align:right">数量</td><td style="text-align:right">金额</td></tr></thead>
            <tbody>${items}</tbody>
        </table>
        <div style="border-top:1px dashed #000;margin:5px 0"></div>
        <div style="display:flex;justify-content:space-between"><span>合计</span><span>¥${money(o.total)}</span></div>
        ${o.discount ? `<div style="display:flex;justify-content:space-between"><span>优惠</span><span>-¥${money(o.discount)}</span></div>` : ''}
        ${o.round_off ? `<div style="display:flex;justify-content:space-between"><span>抹零</span><span>-¥${money(o.round_off)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;margin-top:4px">
            <span>实收</span><span>¥${money(o.payable)}</span></div>
        <div style="border-top:1px dashed #000;margin:5px 0"></div>
        ${pays}
        <div style="text-align:center;font-size:11px;margin-top:10px">${esc(SHOP.receipt_footer || '谢谢惠顾')}</div>
    </div>`;
}

function printHtml(html) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const doc = f.contentDocument;
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8"><title>打印</title></head><body>' + html + '</body></html>');
    doc.close();
    setTimeout(() => {
        try {
            f.contentWindow.focus();
            f.contentWindow.print();
        } catch (e) { toast('打印失败，请用浏览器打印', 'err'); }
        setTimeout(() => f.remove(), 800);
    }, 200);
}

/* ================= 设备 ================= */
async function pageDevices() {
    $('#pageTitle').textContent = '设备管理';
    $('#pageActions').innerHTML = `<button class="btn ghost sm" id="devHelp">如何添加设备</button>`;
    $('#devHelp').onclick = () => showModal('如何添加设备', `
        <div class="hint-box" style="line-height:1.9">
            1. 让新设备（手机 / 平板 / 收银机）连上店内 Wi-Fi。<br>
            2. 浏览器打开 <b>http://${location.host}/pos</b>（或用后台「设置」页的二维码）。<br>
            3. 首次打开会要求给设备起名，填完即可收银，设备自动出现在这里。<br>
            4. 若浏览器清空了数据，点「生成设备码」得到 6 位码，在收银台「绑定已有设备」里输入即可恢复。
        </div>`, '<button class="btn ghost" id="mCancel">知道了</button>', 520);

    const list = await api('/api/admin/devices');
    const typeName = { pc: '收银电脑', phone: '手机', kiosk: '自助机' };

    $('#page').innerHTML = `<div class="devices">${list.map(d => {
        const perms = (() => { try { return JSON.parse(d.permissions || '{}'); } catch (e) { return {}; } })();
        return `<div class="device-card">
            <div class="top">
                <div class="nm">${esc(d.name)}</div>
                ${d.enabled == 1 ? '<span class="badge ok">启用</span>' : '<span class="badge danger">停用</span>'}
            </div>
            <div class="meta">
                类型：${typeName[d.type] || d.type}<br>
                今日订单：${d.today_orders} 单<br>
                最近活跃：${d.last_seen ? new Date(d.last_seen).toLocaleString('zh-CN') : '从未'}<br>
                设备码：${d.bind_code ? `<span class="code-pill">${d.bind_code}</span>` : '<span style="color:var(--muted)">未生成</span>'}<br>
                权限：${perms.can_change_price ? '可改价 ' : ''}${perms.can_return === false ? '禁止退货 ' : '可退货 '}折扣上限 ${perms.discount_limit || 0}%
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
                <button class="btn sm ghost" data-rename="${esc(d.id)}">改名</button>
                <button class="btn sm ghost" data-perm="${esc(d.id)}">权限</button>
                <button class="btn sm ghost" data-code="${esc(d.id)}">设备码</button>
                <button class="btn sm ghost" data-enable="${esc(d.id)}" data-val="${d.enabled}">${d.enabled == 1 ? '停用' : '启用'}</button>
                <button class="btn sm ghost" data-del="${esc(d.id)}" style="color:var(--danger)">删除</button>
            </div>
        </div>`;
    }).join('') || '<div class="empty">还没有设备接入。用手机浏览器打开 /pos 即可自动接入。</div>'}</div>`;

    $$('[data-rename]').forEach(b => b.onclick = () => renameModal(list.find(x => x.id === b.dataset.rename)));
    $$('[data-perm]').forEach(b => b.onclick = () => permModal(list.find(x => x.id === b.dataset.perm)));
    $$('[data-code]').forEach(b => b.onclick = async () => {
        try {
            const r = await api('/api/admin/devices/' + b.dataset.code + '/code', { method: 'POST' });
            toast('设备码：' + r.code, 'ok');
            pageDevices();
        } catch (e) { toast(e.message, 'err'); }
    });
    $$('[data-enable]').forEach(b => b.onclick = async () => {
        try {
            await api('/api/admin/devices/' + b.dataset.enable, {
                method: 'PUT', body: { enabled: b.dataset.val == 1 ? 0 : 1 }
            });
            toast('已更新', 'ok');
            pageDevices();
        } catch (e) { toast(e.message, 'err'); }
    });
    $$('[data-del]').forEach(b => b.onclick = () => {
        const dev = list.find(x => x.id === b.dataset.del);
        showModal('删除设备', `<div class="hint-box">删除后该设备需要重新初始化，历史订单中的设备名会保留。确认删除「${esc(dev.name)}」？</div>`,
            `<button class="btn ghost" id="mCancel">取消</button><button class="btn danger" id="delOk">删除</button>`, 420);
        $('#delOk').onclick = async () => {
            try {
                await api('/api/admin/devices/' + dev.id, { method: 'DELETE' });
                closeModal();
                toast('已删除', 'ok');
                pageDevices();
            } catch (e) { toast(e.message, 'err'); }
        };
    });
}

function renameModal(device) {
    showModal('修改设备名', `
        <div class="field" style="margin-bottom:0">
            <label>设备名称</label>
            <input class="input" id="devName" value="${esc(device.name)}" maxlength="20">
            <div class="hint">改名后，新订单显示新名称；历史订单保留原名称</div>
        </div>`,
        `<button class="btn ghost" id="mCancel">取消</button><button class="btn primary" id="rnOk">保存</button>`, 420);
    $('#rnOk').onclick = async () => {
        const name = $('#devName').value.trim();
        if (!name) return toast('名称不能为空', 'err');
        try {
            await api('/api/admin/devices/' + device.id, { method: 'PUT', body: { name } });
            closeModal();
            toast('已修改', 'ok');
            pageDevices();
        } catch (e) { toast(e.message, 'err'); }
    };
}

function permModal(device) {
    let perms = {};
    try { perms = JSON.parse(device.permissions || '{}'); } catch (e) { }
    showModal('设备权限 ' + device.name, `
        <div class="hint-box" style="margin-bottom:14px">
            权限按设备生效，不区分操作人。自助机建议关闭改价与退货。
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
            <label class="chip" style="height:auto;padding:10px;cursor:pointer">
                <input type="checkbox" id="pmPrice" ${perms.can_change_price ? 'checked' : ''}> 允许收银端改价
            </label>
            <label class="chip" style="height:auto;padding:10px;cursor:pointer">
                <input type="checkbox" id="pmReturn" ${perms.can_return === false ? '' : 'checked'}> 允许退货
            </label>
            <label class="chip" style="height:auto;padding:10px;cursor:pointer">
                <input type="checkbox" id="pmStock" ${perms.can_stock === false ? '' : 'checked'}> 允许库存操作
            </label>
            <div class="field" style="margin:10px 0 0">
                <label>折扣上限（%）</label>
                <input class="input num" id="pmLimit" value="${perms.discount_limit == null ? 10 : perms.discount_limit}">
                <div class="hint">0 表示不允许任何折扣</div>
            </div>
        </div>`,
        `<button class="btn ghost" id="mCancel">取消</button><button class="btn primary" id="pmOk">保存</button>`, 460);
    $('#pmOk').onclick = async () => {
        try {
            await api('/api/admin/devices/' + device.id, {
                method: 'PUT',
                body: {
                    permissions: {
                        can_change_price: $('#pmPrice').checked,
                        can_return: $('#pmReturn').checked,
                        can_stock: $('#pmStock').checked,
                        discount_limit: Number($('#pmLimit').value) || 0
                    }
                }
            });
            closeModal();
            toast('已保存', 'ok');
            pageDevices();
        } catch (e) { toast(e.message, 'err'); }
    };
}

/* ================= 报表 ================= */
async function pageReports() {
    $('#pageTitle').textContent = '报表';
    const today = dayStr(new Date());
    $('#page').innerHTML = `
        <div class="toolbar">
            <button class="btn sm ghost" data-range="today">今天</button>
            <button class="btn sm ghost" data-range="yesterday">昨天</button>
            <button class="btn sm ghost" data-range="week">近 7 天</button>
            <button class="btn sm ghost" data-range="month">本月</button>
            <input class="input" type="date" id="rFrom" value="${today}" style="min-width:140px">
            <span style="color:var(--muted)">至</span>
            <input class="input" type="date" id="rTo" value="${today}" style="min-width:140px">
            <button class="btn sm" id="rSearch">查询</button>
            <div class="grow"></div>
            <button class="btn sm ghost" id="expSales">导出销售</button>
            <button class="btn sm ghost" id="expProducts">导出商品</button>
            <button class="btn sm ghost" id="expPayments">导出支付</button>
        </div>
        <div id="reportBody"></div>`;

    const load = async () => {
        const from = strDayStart($('#rFrom').value || today);
        const to = strDayEnd($('#rTo').value || today);
        const d = await api(`/api/admin/reports/overview?from=${from}&to=${to}`);
        const payRows = (d.payments || []).map(p => `
            <tr><td>${PAY_NAME[p.method] || p.method}</td><td class="num">${p.cnt}</td>
            <td class="num">¥${money(p.amount)}</td></tr>`).join('')
            || '<tr><td colspan="3"><div class="empty">暂无收款</div></td></tr>';
        const topRows = (d.top || []).map(t => `
            <tr><td>${esc(t.name)}</td><td class="num">${t.qty}</td><td class="num">¥${money(t.amount)}</td></tr>`).join('')
            || '<tr><td colspan="3"><div class="empty">暂无销售</div></td></tr>';
        const devRows = (d.devices || []).map(t => `
            <tr><td>${esc(t.name)}</td><td class="num">${t.cnt}</td><td class="num">¥${money(t.amount)}</td></tr>`).join('')
            || '<tr><td colspan="3"><div class="empty">暂无数据</div></td></tr>';
        const dailyRows = (d.daily || []).map(t => `
            <tr><td>${t.day}</td><td class="num">${t.cnt}</td><td class="num">¥${money(t.amount)}</td></tr>`).join('')
            || '<tr><td colspan="3"><div class="empty">暂无数据</div></td></tr>';

        $('#reportBody').innerHTML = `
            <div class="stats">
                <div class="stat brand"><div class="k">净营业额</div><div class="v">¥${money(d.revenue)}</div>
                    <div class="s">含退款 -¥${money(d.refund)}</div></div>
                <div class="stat"><div class="k">订单数</div><div class="v">${d.orders}</div>
                    <div class="s">退款单 ${d.refund_orders}</div></div>
                <div class="stat"><div class="k">客单价</div><div class="v">¥${money(d.avg)}</div>
                    <div class="s">卖出 ${d.items} 件</div></div>
                <div class="stat"><div class="k">库存成本</div><div class="v">¥${money(d.stock_value)}</div>
                    <div class="s">按进价计算</div></div>
            </div>
            <div class="cols">
                <div class="card pad">
                    <div class="card-title">支付方式</div>
                    <table><thead><tr><th>方式</th><th class="num">笔数</th><th class="num">金额</th></tr></thead>
                    <tbody>${payRows}</tbody></table>
                </div>
                <div class="card pad">
                    <div class="card-title">设备营业额</div>
                    <table><thead><tr><th>设备</th><th class="num">单数</th><th class="num">金额</th></tr></thead>
                    <tbody>${devRows}</tbody></table>
                </div>
            </div>
            <div class="cols" style="margin-top:16px">
                <div class="card pad">
                    <div class="card-title">热销商品 TOP10</div>
                    <table><thead><tr><th>商品</th><th class="num">销量</th><th class="num">销售额</th></tr></thead>
                    <tbody>${topRows}</tbody></table>
                </div>
                <div class="card pad">
                    <div class="card-title">每日汇总</div>
                    <div class="table-wrap" style="max-height:320px">
                        <table><thead><tr><th>日期</th><th class="num">单数</th><th class="num">金额</th></tr></thead>
                        <tbody>${dailyRows}</tbody></table>
                    </div>
                </div>
            </div>`;
    };

    const setRange = (type) => {
        const now = new Date();
        const t = dayStr(now);
        if (type === 'today') { $('#rFrom').value = t; $('#rTo').value = t; }
        if (type === 'yesterday') {
            const y = new Date(now.getTime() - 86400000);
            $('#rFrom').value = dayStr(y); $('#rTo').value = dayStr(y);
        }
        if (type === 'week') {
            const s = new Date(now.getTime() - 6 * 86400000);
            $('#rFrom').value = dayStr(s); $('#rTo').value = t;
        }
        if (type === 'month') {
            $('#rFrom').value = dayStr(new Date(now.getFullYear(), now.getMonth(), 1));
            $('#rTo').value = t;
        }
        load();
    };

    $$('[data-range]').forEach(b => b.onclick = () => setRange(b.dataset.range));
    $('#rSearch').onclick = load;
    $('#rFrom').onchange = load;
    $('#rTo').onchange = load;
    const range = () => `from=${strDayStart($('#rFrom').value)}&to=${strDayEnd($('#rTo').value)}`;
    $('#expSales').onclick = () => downloadFile('/api/admin/reports/export.csv?type=sales&' + range(), 'sales.csv');
    $('#expProducts').onclick = () => downloadFile('/api/admin/reports/export.csv?type=products&' + range(), 'product-sales.csv');
    $('#expPayments').onclick = () => downloadFile('/api/admin/reports/export.csv?type=payments&' + range(), 'payments.csv');
    load();
}

/* ================= 设置 ================= */
async function pageSettings() {
    $('#pageTitle').textContent = '设置';
    const res = await api('/api/admin/settings');
    const s = res.data;
    const lanSecure = (res.lan_url_secure || res.lan_url || location.origin) + '/pos';
    const lanPlain = (res.lan_url || location.origin) + '/pos';
    const lanUrl = lanSecure;
    SHOP = s;

    $('#page').innerHTML = `
        <div class="cols">
            <div class="card pad">
                <div class="card-title">店铺信息 <span style="font-size:12px;color:var(--muted);font-weight:400">用于小票抬头</span></div>
                <div class="form-grid">
                    <div class="field full"><label>店名</label><input class="input" id="sName" value="${esc(s.shop_name || '')}"></div>
                    <div class="field full"><label>地址</label><input class="input" id="sAddr" value="${esc(s.shop_address || '')}"></div>
                    <div class="field"><label>电话</label><input class="input" id="sPhone" value="${esc(s.shop_phone || '')}"></div>
                    <div class="field"><label>小票纸宽</label>
                        <select class="select" id="sPaper">
                            <option value="58" ${s.paper_width === '58' ? 'selected' : ''}>58mm</option>
                            <option value="80" ${s.paper_width === '80' ? 'selected' : ''}>80mm</option>
                        </select>
                    </div>
                    <div class="field full"><label>小票页脚</label><input class="input" id="sFooter" value="${esc(s.receipt_footer || '')}"></div>
                    <div class="field"><label>库存为负</label>
                        <select class="select" id="sNeg">
                            <option value="0" ${s.allow_negative !== '1' ? 'selected' : ''}>禁止（库存不足拦截）</option>
                            <option value="1" ${s.allow_negative === '1' ? 'selected' : ''}>允许（超卖记账）</option>
                        </select>
                    </div>
                    <div class="field"><label>收款后自动打印</label>
                        <select class="select" id="sAuto">
                            <option value="0" ${s.auto_print !== '1' ? 'selected' : ''}>关闭</option>
                            <option value="1" ${s.auto_print === '1' ? 'selected' : ''}>开启</option>
                        </select>
                    </div>
                </div>
                <button class="btn primary" id="saveShop">保存设置</button>
            </div>

            <div style="display:flex;flex-direction:column;gap:16px">
                <div class="card pad">
                    <div class="card-title">手机 / 自助机访问</div>
                    <div style="font-size:13px;line-height:1.9">
                        同一 Wi-Fi 下打开（可扫码、可用摄像头）：<br>
                        <b style="font-family:monospace;font-size:15px;color:var(--brand)">${esc(lanSecure)}</b>
                    </div>
                    <div style="display:flex;gap:14px;align-items:flex-start;margin-top:10px">
                        <img src="/api/qr.png?size=320&text=${encodeURIComponent(lanSecure)}" alt="收银台二维码"
                             style="width:120px;height:120px;border:1px solid var(--line);border-radius:10px;background:#fff">
                        <div style="font-size:12px;color:var(--muted);line-height:1.8">
                            安卓扫这张码可直接进收银台并使用摄像头。<br>
                            https 首次会提示证书不受信任，点「继续前往 / 高级 → 继续访问」即可（本机自签，十年有效）。
                            不想看提示可以用 <span style="font-family:monospace">${esc(lanPlain)}</span>，但安卓该地址下无法调用摄像头，只能手输条码或扫码枪。
                        </div>
                    </div>
                    <button class="btn ghost sm" id="copyLan" style="margin-top:10px">复制 https 地址</button>
                    <button class="btn ghost sm" id="copyLanPlain" style="margin-top:10px">复制 http 地址</button>
                    <div class="hint" style="margin-top:8px;color:var(--muted);font-size:12px">
                        把该地址存成手机书签或加到主屏幕，店员扫码即用。收银端无需登录。
                    </div>
                </div>

                <div class="card pad">
                    <div class="card-title">修改管理员密码</div>
                    <div class="field"><label>原密码</label><input class="input" id="pwOld" type="password"></div>
                    <div class="field"><label>新密码（至少 6 位）</label><input class="input" id="pwNew" type="password"></div>
                    <button class="btn" id="savePwd">修改密码</button>
                </div>

                <div class="card pad">
                    <div class="card-title">数据备份</div>
                    <div class="hint" style="color:var(--muted);font-size:12px;line-height:1.8;margin-bottom:10px">
                        备份是 SQLite 单文件的一致性快照，可直接用 DB Browser 打开。<br>
                        恢复后需要重启服务生效（启动时会自动替换并保留旧库）。
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <button class="btn" id="btnBackup">下载备份</button>
                        <button class="btn ghost" id="btnRestore">恢复备份</button>
                        <button class="btn ghost" id="btnDemo" style="color:var(--danger)">清除演示商品</button>
                    </div>
                </div>

                <div class="card pad" style="margin-top:16px">
                    <div class="card-title" style="color:var(--danger)">初始化 / 清空数据</div>
                    <div class="hint" style="color:var(--muted);font-size:12px;line-height:1.8;margin-bottom:10px">
                        清空商品、分类、订单、支付、库存流水、挂单、交接班、设备，设置回到出厂默认；<b>管理员密码保留</b>。<br>
                        清空前会自动备份到 <span style="font-family:monospace">backup/pos-before-reset-*.db</span>。
                    </div>
                    <div id="sysStats" style="font-size:12px;color:var(--muted);margin-bottom:10px">统计加载中…</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <button class="btn ghost" id="btnSysStats">刷新统计</button>
                        <button class="btn ghost" id="btnResetEmpty" style="color:var(--danger)">清空所有数据</button>
                        <button class="btn ghost" id="btnResetDemo">清空并写入演示商品</button>
                    </div>
                </div>
            </div>
        </div>

        <div class="card pad" style="margin-top:16px">
            <div class="card-title">交接班记录</div>
            <div class="table-wrap" id="shiftTable" style="max-height:300px"></div>
        </div>`;

    $('#copyLan').onclick = async () => {
        try { await navigator.clipboard.writeText(lanSecure); toast('https 地址已复制', 'ok'); }
        catch (e) { toast('复制失败，请手动选择地址', 'err'); }
    };
    $('#copyLanPlain').onclick = async () => {
        try { await navigator.clipboard.writeText(lanPlain); toast('http 地址已复制', 'ok'); }
        catch (e) { toast('复制失败，请手动选择地址', 'err'); }
    };

    $('#saveShop').onclick = async () => {
        try {
            await api('/api/admin/settings', {
                method: 'PUT',
                body: {
                    shop_name: $('#sName').value.trim(),
                    shop_address: $('#sAddr').value.trim(),
                    shop_phone: $('#sPhone').value.trim(),
                    receipt_footer: $('#sFooter').value.trim(),
                    paper_width: $('#sPaper').value,
                    allow_negative: $('#sNeg').value,
                    auto_print: $('#sAuto').value
                }
            });
            $('#sideShop').textContent = $('#sName').value.trim() || 'POS 管理后台';
            toast('已保存', 'ok');
        } catch (e) { toast(e.message, 'err'); }
    };

    $('#savePwd').onclick = async () => {
        try {
            await api('/api/admin/password', {
                method: 'POST',
                body: { old: $('#pwOld').value, new: $('#pwNew').value }
            });
            $('#pwOld').value = '';
            $('#pwNew').value = '';
            toast('密码已修改', 'ok');
        } catch (e) { toast(e.message, 'err'); }
    };

    $('#btnBackup').onclick = () => {
        const name = 'pos-backup-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.db';
        downloadFile('/api/admin/backup', name);
    };
    $('#btnRestore').onclick = () => $('#restoreFile').click();
    $('#btnDemo').onclick = () => {
        showModal('清除演示数据', '<div class="hint-box">将删除 6 个演示商品及其库存流水（不影响真实订单）。确认继续？</div>',
            `<button class="btn ghost" id="mCancel">取消</button><button class="btn danger" id="demoOk">清除</button>`, 420);
        $('#demoOk').onclick = async () => {
            try {
                const r = await api('/api/admin/demo/clear', { method: 'POST' });
                closeModal();
                toast(r.msg || '已清除', 'ok');
            } catch (e) { toast(e.message, 'err'); }
        };
    };

    // 初始化 / 清空数据
    const loadSysStats = async () => {
        const box = $('#sysStats');
        if (!box) return;
        try {
            const s = await api('/api/admin/system/stats');
            box.innerHTML = '当前数据：商品 ' + s.product + ' · 分类 ' + s.category + ' · 订单 ' + s.orders +
                ' · 设备 ' + s.device + ' · 库存流水 ' + s.inventory_movement +
                ' · 数据库 ' + (s.db_size / 1024 / 1024).toFixed(2) + ' MB';
        } catch (e) {
            box.textContent = '统计读取失败';
        }
    };
    if ($('#sysStats')) {
        loadSysStats();
        $('#btnSysStats').onclick = loadSysStats;
        const doReset = (demo) => {
            showModal(demo ? '清空并写入演示商品' : '清空所有数据',
                '<div class="hint-box" style="color:var(--danger)">' +
                '将删除全部商品、订单、库存流水、设备与交接班记录，设置恢复出厂默认（管理员密码保留）。' +
                '<br>系统会先自动备份一份数据库到 backup/，可用「恢复备份」找回。确认继续？</div>',
                `<button class="btn ghost" id="mCancel">取消</button><button class="btn danger" id="resetOk">确认初始化</button>`, 460);
            $('#resetOk').onclick = async () => {
                const btn = $('#resetOk');
                btn.disabled = true;
                try {
                    const r = await api('/api/admin/system/reset?demo=' + (demo ? 'true' : 'false'), { method: 'POST' });
                    closeModal();
                    toast(r.msg || '已初始化', 'ok');
                    loadSysStats();
                    loadProducts();
                } catch (e) {
                    btn.disabled = false;
                    toast(e.message, 'err');
                }
            };
        };
        $('#btnResetEmpty').onclick = () => doReset(false);
        $('#btnResetDemo').onclick = () => doReset(true);
    }

    // 班次记录
    try {
        const shifts = await api('/api/admin/shifts?limit=30');
        $('#shiftTable').innerHTML = `<table>
            <thead><tr><th>设备</th><th>开班</th><th>交班</th><th class="num">备用金</th><th class="num">应有现金</th><th class="num">实收</th><th class="num">差额</th></tr></thead>
            <tbody>${shifts.map(x => `<tr>
                <td>${esc(x.device_name || x.device_id)}</td>
                <td>${new Date(x.start_at).toLocaleString('zh-CN')}</td>
                <td>${x.end_at ? new Date(x.end_at).toLocaleString('zh-CN') : '<span class="badge ok">进行中</span>'}</td>
                <td class="num">¥${money(x.opening_cash)}</td>
                <td class="num">¥${money(x.cash_expected)}</td>
                <td class="num">${x.cash_actual == null ? '—' : '¥' + money(x.cash_actual)}</td>
                <td class="num" style="color:${x.diff && Math.abs(x.diff) > 0 ? 'var(--danger)' : 'inherit'}">${x.diff == null ? '—' : money(x.diff)}</td>
            </tr>`).join('') || '<tr><td colspan="7"><div class="empty">暂无记录</div></td></tr>'}</tbody>
        </table>`;
    } catch (e) {
        $('#shiftTable').innerHTML = '<div class="empty">读取失败</div>';
    }
}

/* ================= 事件 ================= */
document.addEventListener('DOMContentLoaded', async () => {
    $('#loginBtn').onclick = doLogin;
    $('#loginPwd').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
    $('#mClose').onclick = closeModal;
    $('#modalMask').addEventListener('click', e => { if (e.target.id === 'modalMask') closeModal(); });
    $('#logoutBtn').onclick = () => {
        localStorage.removeItem('pos.admin.token');
        TOKEN = '';
        showLogin();
    };

    $('#nav').addEventListener('click', e => {
        const b = e.target.closest('[data-page]');
        if (!b) return;
        if (location.hash !== '#' + b.dataset.page) history.replaceState(null, '', '#' + b.dataset.page);
        go(b.dataset.page);
    });

    // 导入 CSV
    $('#importFile').onchange = async e => {
        const f = e.target.files[0];
        if (!f) return;
        try {
            const text = await f.text();
            const res = await fetch('/api/admin/products/import', {
                method: 'POST',
                headers: { 'X-Admin-Token': TOKEN, 'Content-Type': 'text/plain;charset=UTF-8' },
                body: text
            });
            const r = await res.json();
            if (!res.ok) throw new Error(r.msg || '导入失败');
            toast(`导入完成：新增 ${r.created}，更新 ${r.updated}`, 'ok');
            if (r.errors && r.errors.length) {
                showModal('导入有部分行失败', `<div class="hint-box" style="white-space:pre-line">${esc(r.errors.join('\n'))}</div>`,
                    '<button class="btn ghost" id="mCancel">关闭</button>', 560);
            }
            loadProducts();
        } catch (err) {
            toast(err.message, 'err');
        } finally {
            e.target.value = '';
        }
    };

    // 恢复备份
    $('#restoreFile').onchange = async e => {
        const f = e.target.files[0];
        if (!f) return;
        try {
            const buf = await f.arrayBuffer();
            const res = await fetch('/api/admin/restore', {
                method: 'POST',
                headers: { 'X-Admin-Token': TOKEN, 'Content-Type': 'application/octet-stream' },
                body: buf
            });
            const r = await res.json();
            if (!res.ok) throw new Error(r.msg || '恢复失败');
            showModal('已暂存备份', `<div class="hint-box">${esc(r.msg)}<br><br>请关闭服务窗口并重新运行 start.bat，数据库会被替换（旧库保留为 pos.db.bak-*）。</div>`,
                '<button class="btn ghost" id="mCancel">知道了</button>', 520);
        } catch (err) {
            toast(err.message, 'err');
        } finally {
            e.target.value = '';
        }
    };

    // 自动登录
    if (TOKEN) {
        try {
            const cfg = await api('/api/admin/settings');
            SHOP = cfg.data || {};
            $('#loginMask').classList.remove('show');
            $('#shell').hidden = false;
            await start();
        } catch (e) {
            showLogin();
        }
    } else {
        showLogin();
    }
});
