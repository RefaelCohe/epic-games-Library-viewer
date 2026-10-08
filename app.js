// Epic Games Library Viewer
// Everything runs in the user's browser: the export file is read locally, and cover
// lookups go straight from the browser to Wikidata (CORS-enabled) and the Steam image CDN.

(() => {
'use strict';

// =====================================================================
// Utilities
// =====================================================================

const $ = (sel) => document.querySelector(sel);

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[ch]);

const storage = {
    get(key) {
        try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
        try { localStorage.setItem(key, value); } catch { /* storage unavailable or full */ }
    },
    remove(key) {
        try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
    }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Lowercase, strip trademark symbols and punctuation, collapse spaces
const normalizeName = (name) => String(name || '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const icons = {
    copy: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z"/></svg>',
    external: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7ZM19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7Z"/></svg>',
    themeDark: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8A9.3 9.3 0 0 0 12 3Z"/></svg>',
    themeLight: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM11 1h2v3h-2V1Zm0 19h2v3h-2v-3ZM3.51 4.93l1.42-1.42 2.12 2.13-1.41 1.41L3.5 4.93Zm12.95 12.95 1.41-1.41 2.13 2.12-1.42 1.42-2.12-2.13ZM1 11h3v2H1v-2Zm19 0h3v2h-3v-2ZM4.93 20.49l-1.42-1.42 2.13-2.12 1.41 1.41-2.12 2.13ZM17.88 7.05l-1.41-1.41 2.12-2.13 1.42 1.42-2.13 2.12Z"/></svg>',
    themeSystem: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 3H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h6v2H8v2h8v-2h-2v-2h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 13H4V5h16v11Z"/></svg>'
};

// =====================================================================
// Parsing: every supported export format -> normalized orders
// =====================================================================
//
// Normalized order:
//   { orderId, date: Date|null, currency, total, discount, tax, subtotal,
//     paymentMethod, orderType, items: [{ name, price, currency, quantity,
//     giftRecipient, offerId, namespace }] }
// Amounts are numbers in major units (e.g. 59.9) or null when unknown.

const FLAT_KEYS = ['gameName', 'purchaseDate', 'originalPrice', 'discount', 'totalPrice', 'orderId',
    'quantity', 'paymentMethod', 'tax', 'giftRecipient', 'orderType'];

// Labels used by very old exporter versions
const LEGACY_KEYS = {
    'Game': 'gameName',
    'Date': 'purchaseDate',
    'Original Price': 'originalPrice',
    'Discount': 'discount',
    'Total Paid': 'totalPrice',
    'Order ID': 'orderId',
    'Quantity': 'quantity',
    'Payment Method': 'paymentMethod',
    'Tax': 'tax'
};

const ALL_LABELS = [...FLAT_KEYS, ...Object.keys(LEGACY_KEYS)];

// Split only before a known "key: " so commas inside game names are kept
const FIELD_SPLIT_RE = new RegExp(`, (?=(?:${ALL_LABELS.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}): )`);

const CURRENCY_SYMBOLS = { '₪': 'ILS', '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₩': 'KRW', '₹': 'INR', 'R$': 'BRL', 'zł': 'PLN', '₺': 'TRY', '₽': 'RUB' };

const cleanValue = (value) => {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    return (str === '' || str === '-' || str.toUpperCase() === 'N/A') ? null : str;
};

// "₪105.95", "USD9.99", "-₪5.00", "$1,299.00" -> { amount, currency }
const parseMoney = (value) => {
    if (typeof value === 'number') return { amount: value, currency: null };
    let str = cleanValue(value);
    if (!str) return null;
    const negative = str.startsWith('-');
    str = str.replace(/^-\s*/, '');
    const match = str.match(/^([^\d]*?)\s*([\d.,]+)\s*([A-Z]{3})?$/);
    if (!match) return null;
    const prefix = match[1].trim();
    const amount = parseFloat(match[2].replace(/,/g, ''));
    if (isNaN(amount)) return null;
    const currency = match[3] || CURRENCY_SYMBOLS[prefix] || (/^[A-Z]{3}$/.test(prefix) ? prefix : null);
    return { amount: negative ? -amount : amount, currency };
};

// "1.10.2026", "1/10/2026" (day first), or ISO
const parseDateValue = (value) => {
    const str = cleanValue(value);
    if (!str) return null;
    const dmy = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (dmy) {
        const date = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
        return isNaN(date) ? null : date;
    }
    const date = new Date(str);
    return isNaN(date) ? null : date;
};

const canonicalRow = (row) => {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        const k = key.trim();
        out[LEGACY_KEYS[k] || k] = typeof value === 'string' ? value.trim() : value;
    }
    return out;
};

const parseTxt = (text) => text
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => {
        const row = {};
        for (const part of line.split(FIELD_SPLIT_RE)) {
            const idx = part.indexOf(': ');
            if (idx === -1) continue;
            row[part.slice(0, idx).trim()] = part.slice(idx + 2);
        }
        return canonicalRow(row);
    });

// RFC 4180-style CSV parser (quoted fields, escaped quotes, newlines in quotes)
const parseCsv = (text) => {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            row.push(field); field = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some(v => v.trim())) rows.push(row);
            row = [];
        } else {
            field += ch;
        }
    }
    row.push(field);
    if (row.some(v => v.trim())) rows.push(row);

    if (rows.length < 2) return [];
    const headers = rows[0].map(h => h.trim());
    return rows.slice(1).map(values => canonicalRow(Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))));
};

// Flat rows (TXT / CSV / old JSON) -> orders.
// Rows sharing an orderId form one order. Exporter 1.2.4 writes order-level values on the
// first item and "-" on the following items, so "-" rows without an orderId join the previous order.
const rowsToOrders = (rows) => {
    if (!rows.some(row => cleanValue(row.gameName))) {
        throw new Error('The file has no game names. Export again with "Game name" enabled.');
    }

    const orders = [];
    const byId = new Map();
    let previous = null;

    for (const row of rows) {
        const sourceName = cleanValue(row.gameName);
        const orderId = cleanValue(row.orderId);
        const isContinuation = String(row.totalPrice ?? '').trim() === '-';
        const total = parseMoney(row.totalPrice);
        const price = parseMoney(row.originalPrice);

        let order = orderId ? byId.get(orderId) : null;
        if (!order && !orderId && isContinuation && previous) order = previous;

        if (!order) {
            order = {
                orderId,
                date: parseDateValue(row.purchaseDate),
                currency: null,
                total: null,
                discount: null,
                tax: null,
                subtotal: null,
                paymentMethod: null,
                orderType: null,
                items: []
            };
            orders.push(order);
            if (orderId) byId.set(orderId, order);
        }

        // Order-level values come from the first row that carries them
        if (order.total === null && total) {
            const discount = parseMoney(row.discount);
            const tax = parseMoney(row.tax);
            order.total = total.amount;
            order.currency = total.currency || order.currency;
            order.discount = discount ? Math.abs(discount.amount) : null;
            order.tax = tax ? tax.amount : null;
            order.paymentMethod = cleanValue(row.paymentMethod);
            order.orderType = cleanValue(row.orderType);
        }
        if (!order.currency && price) order.currency = price.currency;
        if (!order.date) order.date = parseDateValue(row.purchaseDate);

        order.items.push({
            name: sourceName || 'Unknown item',
            sourceName,
            price: price ? price.amount : null,
            currency: (price && price.currency) || null,
            quantity: parseInt(row.quantity, 10) || 1,
            giftRecipient: cleanValue(row.giftRecipient),
            offerId: null,
            namespace: null
        });
        previous = order;
    }
    return orders;
};

// Structured JSON from exporter 1.2.4 (schemaVersion 2)
const structuredToOrders = (data) => (data.orders || []).map(order => {
    const amounts = order.amounts || {};
    const num = (v) => (typeof v === 'number' ? v : null);
    return {
        orderId: order.orderId || null,
        date: order.date ? new Date(order.date) : (order.timestamp ? new Date(order.timestamp) : null),
        currency: order.currency || null,
        total: num(amounts.total),
        discount: num(amounts.discount),
        tax: num(amounts.tax),
        subtotal: num(amounts.subtotal),
        paymentMethod: order.paymentMethod || null,
        orderType: order.orderType || null,
        items: (order.items || []).map(item => ({
            name: item.name || 'Unknown item',
            sourceName: item.name || null,
            price: num(item.price),
            currency: item.currency || order.currency || null,
            quantity: item.quantity || 1,
            giftRecipient: item.giftRecipient || null,
            offerId: item.offerId || null,
            namespace: item.namespace || null
        }))
    };
});

// Which export fields a file actually contains, so the export dialog can offer only those
const fieldsOfRows = (rows) => {
    const fields = new Set();
    for (const row of rows) for (const key of Object.keys(row)) if (FLAT_KEYS.includes(key)) fields.add(key);
    return [...fields];
};

const fieldsOfStructured = (data) => {
    // Core fields are always present in structured JSON
    const fields = new Set(['gameName', 'purchaseDate', 'originalPrice', 'orderId', 'quantity']);
    for (const order of data.orders || []) {
        const amounts = order.amounts || {};
        if ('discount' in amounts) fields.add('discount');
        if ('tax' in amounts) fields.add('tax');
        if ('total' in amounts) fields.add('totalPrice');
        if ('paymentMethod' in order) fields.add('paymentMethod');
        if ('orderType' in order) fields.add('orderType');
        if ((order.items || []).some(item => 'giftRecipient' in item)) fields.add('giftRecipient');
    }
    return [...fields];
};

const parseFile = (rawText, fileName) => {
    const text = rawText.replace(/^﻿/, '');
    const trimmed = text.trimStart();
    const lowerName = (fileName || '').toLowerCase();

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        let data;
        try {
            data = JSON.parse(trimmed);
        } catch {
            throw new Error('This JSON file could not be read. It may be damaged or incomplete.');
        }
        if (Array.isArray(data)) {
            const rows = data.map(canonicalRow);
            return { format: 'JSON (classic)', orders: rowsToOrders(rows), fields: fieldsOfRows(rows) };
        }
        if (data && Array.isArray(data.orders)) {
            return { format: `JSON (v${data.schemaVersion || 2})`, orders: structuredToOrders(data), fields: fieldsOfStructured(data) };
        }
        throw new Error('This JSON file is not an Epic Games Library Exporter file.');
    }

    const firstLine = trimmed.split(/\r?\n/, 1)[0] || '';
    if (lowerName.endsWith('.csv') || (/^"?gameName"?,/.test(firstLine))) {
        const rows = parseCsv(text);
        return { format: 'CSV', orders: rowsToOrders(rows), fields: fieldsOfRows(rows) };
    }

    if (!ALL_LABELS.some(label => firstLine.includes(`${label}: `))) {
        throw new Error('This file is not an Epic Games Library Exporter file.');
    }
    const rows = parseTxt(text);
    return { format: 'Text', orders: rowsToOrders(rows), fields: fieldsOfRows(rows) };
};

// =====================================================================
// Model
// =====================================================================

const round2 = (n) => Math.round(n * 100) / 100;

// Flatten orders into display items. "paid" splits the order total across its
// items by list price, so a bundle's total isn't counted once per item.
const buildItems = (orders) => {
    const items = [];
    for (const order of orders) {
        const n = order.items.length;
        const priceSum = order.items.reduce((sum, item) => sum + Math.max(item.price || 0, 0), 0);
        order.items.forEach((item, index) => {
            let paid = null;
            if (order.total !== null) {
                if (n === 1) paid = order.total;
                else if (priceSum > 0) paid = round2(order.total * Math.max(item.price || 0, 0) / priceSum);
                else paid = round2(order.total / n);
            }
            const isFree = paid !== null ? paid === 0 : item.price === 0;
            items.push({
                id: items.length,
                name: item.name,
                searchName: normalizeName(item.name),
                date: order.date,
                price: item.price,
                paid,
                currency: item.currency || order.currency,
                quantity: item.quantity,
                giftRecipient: item.giftRecipient,
                offerId: item.offerId,
                namespace: item.namespace,
                isFree,
                isPaid: paid !== null && paid > 0,
                order,
                indexInOrder: index
            });
        });
    }
    return items;
};

const formatMoney = (amount, currency) => {
    if (amount === null || amount === undefined || isNaN(amount)) return '—';
    if (currency) {
        try {
            return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
        } catch { /* unknown currency code */ }
        return `${currency} ${amount.toFixed(2)}`;
    }
    return amount.toFixed(2);
};

const formatDate = (date, style = 'medium') => {
    if (!date) return 'Unknown date';
    return date.toLocaleDateString(undefined, style === 'long'
        ? { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }
        : { year: 'numeric', month: 'short', day: 'numeric' });
};

const sumByCurrency = (items, getAmount) => {
    const totals = {};
    for (const item of items) {
        const amount = getAmount(item);
        if (amount === null || amount === undefined) continue;
        const cur = item.currency || '—';
        totals[cur] = (totals[cur] || 0) + amount;
    }
    return Object.entries(totals)
        .map(([currency, amount]) => ({ currency, amount: round2(amount) }))
        .sort((a, b) => b.amount - a.amount);
};

// =====================================================================
// Cover images (Wikidata -> Steam app ID -> Steam CDN header)
// =====================================================================

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php?format=json&formatversion=2&origin=*&';
const STEAM_HEADER = (appId) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
const IMAGE_CACHE_KEY = 'egv.steamIds.v1';
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CONCURRENT_LOOKUPS = 3;
const LOOKUP_SPACING_MS = 150;

const imageCache = (() => {
    let data = {};
    try { data = JSON.parse(storage.get(IMAGE_CACHE_KEY) || '{}') || {}; } catch { data = {}; }
    let saveTimer = null;
    return {
        get(key) {
            const entry = data[key];
            if (!entry) return undefined;
            const [appId, savedAt] = entry;
            if (appId === null && Date.now() - savedAt > MISS_TTL_MS) return undefined;
            return appId;
        },
        set(key, appId) {
            data[key] = [appId, Date.now()];
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => storage.set(IMAGE_CACHE_KEY, JSON.stringify(data)), 500);
        }
    };
})();

// Keep the original sanitizer: strips edition tags and subtitles for a second lookup attempt
const sanitizeGameName = (name) => {
    let cleaned = name.replace(/™|®/g, '');
    cleaned = cleaned.split(/[:—]|\s--\s/)[0];
    const tagsToRemove = [
        'Standard Edition', 'Deluxe Edition', 'Premium Edition', 'Gold Edition',
        'Complete Edition', 'Ultimate Edition', 'GOTY Edition', 'Game of the Year Edition',
        'Versus Edition', 'Anniversary', 'Party Favor', 'Mod Kit', 'Development Toolkit',
        'Editor', 'Trial Week', 'Free Demo', 'Alpha 2'
    ];
    cleaned = cleaned.replace(new RegExp(`\\b(${tagsToRemove.join('|')})\\b`, 'gi'), '');
    return cleaned.replace(/\s\s+/g, ' ').trim();
};

const wikidata = async (params) => {
    const response = await fetch(WIKIDATA_API + params);
    if (!response.ok) throw new Error(`Wikidata ${response.status}`);
    return response.json();
};

const entityNames = (entity) => {
    const pick = (obj) => [].concat(obj?.en || [], obj?.mul || []).map(v => v.value);
    return [...pick(entity.labels), ...pick(entity.aliases)];
};

// One search term -> Steam app ID or null. Only accepts an exact (normalized) name match,
// or a close prefix match, so a wrong cover is never shown.
const lookupTerm = async (term) => {
    const query = term.replace(/[^\p{L}\p{N}\s'&.]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!query) return null;
    const search = await wikidata(`action=query&list=search&srsearch=${encodeURIComponent(`${query} haswbstatement:P1733`)}&srlimit=5&srprop=`);
    const ids = (search.query?.search || []).map(r => r.title);
    if (ids.length === 0) return null;

    const entities = (await wikidata(`action=wbgetentities&ids=${ids.join('|')}&props=labels|aliases&languages=en|mul`)).entities || {};
    const target = normalizeName(term);
    const candidates = ids.map(id => ({ id, names: entities[id] ? entityNames(entities[id]).map(normalizeName) : [] }));

    const match = candidates.find(c => c.names.includes(target))
        || candidates.find(c => c.names.some(n => n.length > 3 && (target.startsWith(`${n} `) || n.startsWith(`${target} `))));
    if (!match) return null;

    const claims = (await wikidata(`action=wbgetclaims&entity=${match.id}&property=P1733`)).claims?.P1733 || [];
    const claim = claims.find(c => c.rank === 'preferred') || claims.find(c => c.rank !== 'deprecated');
    return claim?.mainsnak?.datavalue?.value || null;
};

const lookupSteamId = async (name) => {
    const terms = [name];
    const sanitized = sanitizeGameName(name);
    if (sanitized && normalizeName(sanitized) !== normalizeName(name)) terms.push(sanitized);
    for (const term of terms) {
        const appId = await lookupTerm(term);
        if (appId) return appId;
    }
    return null;
};

// Small queue: at most 3 lookups at a time, spaced out, deduplicated by name
const coverQueue = (() => {
    const pending = [];
    const inflight = new Map();
    let active = 0;
    let lastStart = 0;

    const pump = async () => {
        if (active >= MAX_CONCURRENT_LOOKUPS || pending.length === 0) return;
        const job = pending.shift();
        active++;
        const wait = Math.max(0, lastStart + LOOKUP_SPACING_MS - Date.now());
        lastStart = Date.now() + wait;
        if (wait) await sleep(wait);
        pump();
        try {
            const appId = await lookupSteamId(job.name);
            imageCache.set(job.key, appId);
            job.resolve(appId);
        } catch (error) {
            // Network/rate-limit errors are not cached, so they are retried next time
            console.warn(`Cover lookup failed for "${job.name}":`, error.message);
            job.resolve(null);
        } finally {
            inflight.delete(job.key);
            active--;
            pump();
        }
    };

    return {
        get(name) {
            const key = normalizeName(name);
            const cached = imageCache.get(key);
            if (cached !== undefined) return Promise.resolve(cached);
            if (inflight.has(key)) return inflight.get(key);
            const promise = new Promise(resolve => pending.push({ key, name, resolve }));
            inflight.set(key, promise);
            pump();
            return promise;
        }
    };
})();

const initialsOf = (name) => {
    const words = String(name).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    return (words.slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
};

const fillCover = (coverEl, name) => {
    if (coverEl.dataset.coverState) return;
    coverEl.dataset.coverState = 'loading';
    coverQueue.get(name).then(appId => {
        if (!appId) { coverEl.dataset.coverState = 'none'; return; }
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        img.onload = () => { img.classList.add('is-loaded'); coverEl.dataset.coverState = 'done'; };
        img.onerror = () => { img.remove(); coverEl.dataset.coverState = 'none'; };
        img.src = STEAM_HEADER(appId);
        coverEl.appendChild(img);
        coverEl.dataset.steamId = appId;
    });
};

const coverObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            coverObserver.unobserve(entry.target);
            fillCover(entry.target, entry.target.dataset.name);
        }
    }, { rootMargin: '300px 0px' })
    : null;

const coverHtml = (name) => `
    <div class="cover" data-name="${escapeHtml(name)}">
        <span class="cover-initials" aria-hidden="true">${escapeHtml(initialsOf(name))}</span>
    </div>`;

// =====================================================================
// State & rendering
// =====================================================================

const state = {
    orders: [],
    items: [],
    cards: new Map(),
    fileName: '',
    format: '',
    filter: 'all',
    search: '',
    sort: 'date-desc',
    dateFrom: null,
    dateTo: null,
    priceMin: null,
    priceMax: null,
    drawerItemId: null,
    fields: new Set()
};

const els = {
    emptyState: $('#empty-state'),
    library: $('#library'),
    dropzone: $('#dropzone'),
    fileInput: $('#file-input'),
    loadError: $('#load-error'),
    stats: $('#stats'),
    grid: $('#grid'),
    noResults: $('#no-results'),
    resultCount: $('#result-count'),
    search: $('#search-input'),
    sort: $('#sort-select'),
    giftChip: $('#gift-chip'),
    filtersBtn: $('#filters-btn'),
    filtersPanel: $('#filters-panel'),
    filtersDot: $('#filters-dot'),
    dateFrom: $('#date-from'),
    dateTo: $('#date-to'),
    priceMin: $('#price-min'),
    priceMax: $('#price-max'),
    themeBtn: $('#theme-btn'),
    menuBtn: $('#menu-btn'),
    menuList: $('#menu-list'),
    drawer: $('#drawer'),
    drawerBody: $('#drawer-body'),
    drawerBackdrop: $('#drawer-backdrop'),
    dragOverlay: $('#drag-overlay'),
    toast: $('#toast'),
    receiving: $('#receiving'),
    menuVersion: $('#menu-version'),
    exportModal: $('#export-modal'),
    exportForm: $('#export-form'),
    exportFields: $('#export-fields'),
    exportFrom: $('#export-from'),
    exportTo: $('#export-to'),
    exportSummary: $('#export-summary'),
    exportJsonHint: $('#export-json-hint'),
    exportDownload: $('#export-download')
};

const createCard = (item) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.id = item.id;

    let tag;
    if (item.isFree) tag = '<span class="tag tag-free">Free</span>';
    else if (item.paid !== null) tag = `<span class="tag tag-paid">${escapeHtml(formatMoney(item.paid, item.currency))}</span>`;
    else tag = '<span class="tag tag-unknown">—</span>';

    card.innerHTML = `
        ${coverHtml(item.name)}
        <div class="card-body">
            <h3 class="card-title">${escapeHtml(item.name)}</h3>
            <div class="card-meta">
                <span class="card-date">${escapeHtml(formatDate(item.date))}</span>
                ${item.giftRecipient ? '<span class="tag tag-gift">Gift</span>' : tag}
            </div>
        </div>`;
    card.setAttribute('aria-label', `${item.name}, ${formatDate(item.date)}`);
    return card;
};

const getFilteredItems = () => {
    const term = normalizeName(state.search);
    const from = state.dateFrom ? new Date(`${state.dateFrom}T00:00:00`) : null;
    const to = state.dateTo ? new Date(`${state.dateTo}T23:59:59.999`) : null;
    const hasPriceFilter = state.priceMin !== null || state.priceMax !== null;

    const result = state.items.filter(item => {
        if (state.filter === 'free' && !item.isFree) return false;
        if (state.filter === 'paid' && !item.isPaid) return false;
        if (state.filter === 'gift' && !item.giftRecipient) return false;
        if (term && !item.searchName.includes(term)) return false;
        if (from && (!item.date || item.date < from)) return false;
        if (to && (!item.date || item.date > to)) return false;
        if (hasPriceFilter) {
            if (item.paid === null) return false;
            if (state.priceMin !== null && item.paid < state.priceMin) return false;
            if (state.priceMax !== null && item.paid > state.priceMax) return false;
        }
        return true;
    });

    const byDate = (a, b) => (a.date ? a.date.getTime() : 0) - (b.date ? b.date.getTime() : 0);
    // Unknown amounts always sort last
    const byPaid = (dir) => (a, b) => {
        if (a.paid === null && b.paid === null) return 0;
        if (a.paid === null) return 1;
        if (b.paid === null) return -1;
        return dir * (a.paid - b.paid);
    };
    const comparators = {
        'date-desc': (a, b) => byDate(b, a) || a.indexInOrder - b.indexInOrder,
        'date-asc': (a, b) => byDate(a, b) || a.indexInOrder - b.indexInOrder,
        'paid-desc': byPaid(-1),
        'paid-asc': byPaid(1),
        'name-asc': (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    };
    return result.sort(comparators[state.sort] || comparators['date-desc']);
};

const YEAR_BAR_MAX_PX = 44;

const renderStats = (items) => {
    const total = state.items.length;
    const freeCount = items.filter(i => i.isFree).length;
    const purchased = items.filter(i => i.isPaid);
    const spent = sumByCurrency(purchased, i => i.paid);
    const saved = sumByCurrency(items, i => (i.price !== null && i.paid !== null && i.price > i.paid) ? i.price - i.paid : null)
        .filter(s => s.amount > 0);

    const moneyLines = (list) => list.length
        ? list.slice(0, 3).map(s => `<div>${escapeHtml(formatMoney(s.amount, s.currency === '—' ? null : s.currency))}</div>`).join('')
        : '<div>—</div>';

    const years = {};
    for (const item of items) {
        if (!item.date) continue;
        const y = item.date.getFullYear();
        years[y] = (years[y] || 0) + 1;
    }
    const yearKeys = Object.keys(years).map(Number).sort((a, b) => a - b);
    const maxYear = Math.max(1, ...Object.values(years));
    const bars = yearKeys.map(y => `
        <div class="year-bar" title="${y}: ${years[y]} ${years[y] === 1 ? 'game' : 'games'}">
            <span class="bar" style="height:${Math.max(3, Math.round(years[y] / maxYear * YEAR_BAR_MAX_PX))}px"></span>
            <span class="lbl">${yearKeys.length > 8 ? `'${String(y).slice(2)}` : y}</span>
        </div>`).join('');

    const filtered = items.length !== total;
    els.stats.innerHTML = `
        <div class="stat">
            <div class="stat-label">Games</div>
            <div class="stat-value">${items.length.toLocaleString()}</div>
            <div class="stat-sub">${filtered ? `of ${total.toLocaleString()} in library` : `${state.orders.length.toLocaleString()} orders`}</div>
        </div>
        <div class="stat">
            <div class="stat-label">Claimed free</div>
            <div class="stat-value">${freeCount.toLocaleString()}</div>
            <div class="stat-sub">${items.length ? Math.round(freeCount / items.length * 100) : 0}% of games</div>
        </div>
        <div class="stat">
            <div class="stat-label">Spent</div>
            <div class="stat-value${spent.length > 1 ? ' multi' : ''}">${moneyLines(spent)}</div>
            <div class="stat-sub">${purchased.length.toLocaleString()} purchased</div>
        </div>
        <div class="stat">
            <div class="stat-label">Saved vs. list price</div>
            <div class="stat-value${saved.length > 1 ? ' multi' : ''}"><span class="saved">${moneyLines(saved)}</span></div>
            <div class="stat-sub">${saved.length ? 'discounts and free games' : 'needs “Price” in the export'}</div>
        </div>
        <div class="stat years">
            <div class="stat-label">Games per year</div>
            <div class="years-chart">${bars || '<span class="stat-sub">No dates</span>'}</div>
        </div>`;
};

const render = () => {
    const items = getFilteredItems();
    const fragment = document.createDocumentFragment();
    for (const item of items) fragment.appendChild(state.cards.get(item.id));
    els.grid.replaceChildren(fragment);

    els.noResults.hidden = items.length > 0;
    els.resultCount.textContent = items.length === state.items.length
        ? `${items.length.toLocaleString()} games`
        : `${items.length.toLocaleString()} of ${state.items.length.toLocaleString()}`;

    const filtersActive = Boolean(state.dateFrom || state.dateTo || state.priceMin !== null || state.priceMax !== null);
    els.filtersDot.hidden = !filtersActive;
    renderStats(items);
};

// =====================================================================
// Shared export format, session persistence
// =====================================================================

const Core = window.EGLExportCore;
const SESSION_KEY = 'egv.library.v1';
const VIEWER_VERSION = (window.EGL_VERSIONS && window.EGL_VERSIONS.viewer && window.EGL_VERSIONS.viewer.version) || null;
const viewerMeta = () => ({ name: 'Epic Games Library Viewer', version: VIEWER_VERSION });

// Internal order -> the canonical order shape used by egl-export-core.js
const toCanonical = (order) => {
    const amounts = {};
    if (typeof order.subtotal === 'number') amounts.subtotal = order.subtotal;
    amounts.discount = order.discount;
    amounts.tax = order.tax;
    amounts.total = order.total;
    const isFree = order.total === 0;
    return {
        orderId: order.orderId,
        date: order.date ? order.date.toISOString() : null,
        timestamp: order.date ? order.date.getTime() : null,
        orderType: order.orderType,
        paymentMethod: order.paymentMethod,
        currency: order.currency,
        amounts,
        isFree,
        items: order.items.map(item => ({
            // The original value, not the "Unknown item" display fallback
            name: item.sourceName ?? null,
            offerId: item.offerId,
            namespace: item.namespace,
            quantity: item.quantity,
            price: item.price,
            currency: item.currency || order.currency,
            isFree: item.price === 0 || isFree,
            giftRecipient: item.giftRecipient
        }))
    };
};

// The loaded library is kept for this tab only (sessionStorage), so reloading or
// visiting the About pages in the same tab doesn't lose it. Closing the tab clears it.
const persistLibrary = () => {
    try {
        const data = Core.buildStructured(state.orders.map(toCanonical), Core.ALL_FIELDS_ON, { exporter: viewerMeta() });
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            v: 1, fileName: state.fileName, format: state.format, fields: [...state.fields], data
        }));
    } catch { /* storage full or unavailable: the library just won't survive a reload */ }
};

const restoreLibrary = () => {
    try {
        const payload = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
        if (!payload || payload.v !== 1 || !payload.data) return false;
        loadLibrary(structuredToOrders(payload.data), payload.fileName, payload.format, payload.fields, { persist: false, toast: null });
        return true;
    } catch {
        return false;
    }
};

const loadLibrary = (orders, fileName, format, fields = [], { persist = true, toast } = {}) => {
    state.orders = orders;
    state.items = buildItems(orders);
    state.fileName = fileName;
    state.format = format;
    state.fields = new Set(fields);
    state.cards = new Map();

    for (const item of state.items) {
        const card = createCard(item);
        state.cards.set(item.id, card);
        const cover = card.querySelector('.cover');
        if (coverObserver) coverObserver.observe(cover);
        else fillCover(cover, item.name);
    }

    els.giftChip.hidden = !state.items.some(i => i.giftRecipient);
    if (els.giftChip.hidden && state.filter === 'gift') setFilterChip('all');

    document.body.classList.add('is-loaded');
    els.emptyState.hidden = true;
    els.library.hidden = false;
    document.querySelectorAll('[data-loaded-only]').forEach(el => { el.hidden = false; });
    els.receiving.hidden = true;
    els.dropzone.hidden = false;
    els.loadError.hidden = true;
    closeDrawer();
    render();
    window.scrollTo(0, 0);
    if (persist) persistLibrary();
    const message = toast === undefined ? `Loaded ${state.items.length.toLocaleString()} games from ${fileName}` : toast;
    if (message) showToast(message);
};

const closeLibrary = () => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    closeDrawer();
    state.orders = [];
    state.items = [];
    state.cards = new Map();
    state.fields = new Set();
    els.grid.replaceChildren();
    els.library.hidden = true;
    els.emptyState.hidden = false;
    els.search.value = '';
    state.search = '';
    document.body.classList.remove('is-loaded');
    document.querySelectorAll('[data-loaded-only]').forEach(el => { el.hidden = true; });
    window.scrollTo(0, 0);
};

// =====================================================================
// Receiving a library from the Exporter extension
// =====================================================================
// The extension opens this page with #import=<one-time token>&ext=<extension id>. The page asks
// the extension for the data through Chrome's web-page messaging (allowed because the extension
// lists this site in "externally_connectable"). Nothing goes through a server.

const readImportHash = () => {
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get('import');
    if (!token) return null;
    // Remove the token from the address bar and history
    history.replaceState(null, '', location.pathname + location.search);
    return { token, extensionId: params.get('ext') || '' };
};

const requestFromExtension = ({ token, extensionId }) => new Promise((resolve, reject) => {
    const runtime = window.chrome && window.chrome.runtime;
    if (!/^[a-p]{32}$/.test(extensionId) || !runtime || typeof runtime.sendMessage !== 'function') {
        reject(new Error('unreachable'));
        return;
    }
    const timer = setTimeout(() => reject(new Error('unreachable')), 8000);
    try {
        runtime.sendMessage(extensionId, { type: 'EGLE_GET_EXPORT', token }, (response) => {
            clearTimeout(timer);
            if (runtime.lastError) { reject(new Error('unreachable')); return; }
            if (!response || !response.ok) { reject(new Error(response && response.error === 'expired' ? 'expired' : 'unreachable')); return; }
            resolve(response);
        });
    } catch {
        clearTimeout(timer);
        reject(new Error('unreachable'));
    }
});

const importFromExtension = async (request) => {
    els.receiving.hidden = false;
    els.dropzone.hidden = true;
    try {
        const response = await requestFromExtension(request);
        const orders = structuredToOrders(response.data);
        const count = orders.reduce((sum, order) => sum + order.items.length, 0);
        const from = `Epic Games Library Exporter${response.version ? ` ${response.version}` : ''}`;
        loadLibrary(orders, 'Epic Games Library Exporter', 'Extension', fieldsOfStructured(response.data), {
            toast: `Imported ${count.toLocaleString()} games from ${from}`
        });
    } catch (error) {
        els.receiving.hidden = true;
        els.dropzone.hidden = false;
        showLoadError(error.message === 'expired'
            ? 'This export was already opened or has expired. Export again from the extension, or load a file.'
            : 'The Epic Games Library Exporter extension couldn’t be reached. Make sure it’s installed and enabled, then export again — or load a file.');
    }
};

// =====================================================================
// Drawer
// =====================================================================

const copyButton = (value, label) =>
    `<button class="icon-btn copy-btn" type="button" data-copy="${escapeHtml(value)}" title="Copy ${escapeHtml(label)}" aria-label="Copy ${escapeHtml(label)}">${icons.copy}</button>`;

const kvRow = (label, valueHtml, extraClass = '') =>
    `<div class="kv-row ${extraClass}"><dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd></div>`;

const openDrawer = (itemId) => {
    const item = state.items[itemId];
    if (!item) return;
    state.drawerItemId = itemId;
    const order = item.order;
    const cur = order.currency || item.currency;
    const multi = order.items.length > 1;

    const priceRows = [];
    if (item.price !== null) priceRows.push(kvRow('List price', escapeHtml(formatMoney(item.price, item.currency))));
    if (multi && item.paid !== null) priceRows.push(kvRow('Share of order', escapeHtml(formatMoney(item.paid, item.currency))));
    if (item.quantity > 1) priceRows.push(kvRow('Quantity', escapeHtml(item.quantity)));
    if (item.giftRecipient) priceRows.push(kvRow('Gifted to', escapeHtml(item.giftRecipient)));

    const orderRows = [];
    if (order.orderId) orderRows.push(kvRow('Order ID', `<span class="mono">${escapeHtml(order.orderId)}</span>${copyButton(order.orderId, 'order ID')}`));
    orderRows.push(kvRow('Date', escapeHtml(formatDate(order.date, 'long'))));
    if (order.paymentMethod) orderRows.push(kvRow('Payment method', escapeHtml(order.paymentMethod)));
    if (order.orderType) orderRows.push(kvRow('Order type', escapeHtml(order.orderType)));
    if (order.subtotal !== null) orderRows.push(kvRow('Subtotal', escapeHtml(formatMoney(order.subtotal, cur))));
    if (order.discount) orderRows.push(kvRow('Discount', `<span class="discount">−${escapeHtml(formatMoney(order.discount, cur))}</span>`));
    if (order.tax !== null) orderRows.push(kvRow('Tax', escapeHtml(formatMoney(order.tax, cur))));
    if (order.total !== null) orderRows.push(kvRow('Total paid', order.total === 0 ? 'Free' : escapeHtml(formatMoney(order.total, cur)), 'total'));

    const otherItems = multi ? `
        <section>
            <h3 class="section-title">Items in this order (${order.items.length})</h3>
            <div class="order-items">
                ${state.items.filter(i => i.order === order).map(i => `
                    <button type="button" class="order-item${i.id === item.id ? ' is-current' : ''}" data-item-id="${i.id}">
                        <span>${escapeHtml(i.name)}</span>
                        <span>${i.price !== null ? escapeHtml(formatMoney(i.price, i.currency)) : ''}</span>
                    </button>`).join('')}
            </div>
        </section>` : '';

    const storeQuery = encodeURIComponent(item.name);
    els.drawerBody.innerHTML = `
        ${coverHtml(item.name)}
        <div class="drawer-content">
            <div>
                <h2 id="drawer-title">${escapeHtml(item.name)}</h2>
                <div class="drawer-sub">
                    <span>${escapeHtml(formatDate(item.date))}</span>
                    ${item.isFree ? '<span class="tag tag-free">Free</span>' : ''}
                    ${item.giftRecipient ? '<span class="tag tag-gift">Gift</span>' : ''}
                </div>
            </div>
            ${priceRows.length ? `<section><h3 class="section-title">Item</h3><dl class="kv">${priceRows.join('')}</dl></section>` : ''}
            <section><h3 class="section-title">Order</h3><dl class="kv">${orderRows.join('')}</dl></section>
            ${otherItems}
            <div class="drawer-links" id="drawer-links">
                <a href="https://store.epicgames.com/browse?q=${storeQuery}" target="_blank" rel="noopener noreferrer">${icons.external}Epic Store</a>
            </div>
        </div>`;

    const cover = els.drawerBody.querySelector('.cover');
    fillCover(cover, item.name);
    coverQueue.get(item.name).then(appId => {
        if (!appId || state.drawerItemId !== itemId) return;
        const links = $('#drawer-links');
        if (links && !links.querySelector('[data-steam]')) {
            links.insertAdjacentHTML('beforeend',
                `<a data-steam href="https://store.steampowered.com/app/${encodeURIComponent(appId)}/" target="_blank" rel="noopener noreferrer">${icons.external}Steam page</a>`);
        }
    });

    els.drawerBackdrop.hidden = false;
    els.drawer.classList.add('is-open');
    els.drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    els.drawerBody.scrollTop = 0;
    $('#drawer-close').focus({ preventScroll: true });
};

let lastFocusedCardId = null;

const closeDrawer = () => {
    if (!els.drawer.classList.contains('is-open')) return;
    els.drawer.classList.remove('is-open');
    els.drawer.setAttribute('aria-hidden', 'true');
    els.drawerBackdrop.hidden = true;
    document.body.classList.remove('no-scroll');
    state.drawerItemId = null;
    const card = lastFocusedCardId !== null ? state.cards.get(lastFocusedCardId) : null;
    if (card && card.isConnected) card.focus({ preventScroll: true });
};

// =====================================================================
// Theme, toast, menus
// =====================================================================

const THEMES = ['dark', 'light', 'system'];

const applyTheme = (theme) => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    const icon = { dark: icons.themeDark, light: icons.themeLight, system: icons.themeSystem }[theme];
    els.themeBtn.innerHTML = icon;
    els.themeBtn.title = `Theme: ${theme[0].toUpperCase()}${theme.slice(1)}`;
    els.themeBtn.setAttribute('aria-label', `Theme: ${theme}. Click to change`);
};

const currentTheme = () => {
    const stored = storage.get('egv.theme');
    return THEMES.includes(stored) ? stored : 'dark';
};

let toastTimer = null;
const showToast = (message) => {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2800);
};

const setFilterChip = (filter) => {
    state.filter = filter;
    document.querySelectorAll('.chip').forEach(chip => {
        const active = chip.dataset.filter === filter;
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-selected', String(active));
    });
};

const togglePanel = (button, panel, open) => {
    const shouldOpen = open ?? panel.hidden;
    panel.hidden = !shouldOpen;
    button.setAttribute('aria-expanded', String(shouldOpen));
};

// =====================================================================
// Export dialog (same formats as the extension, via egl-export-core.js)
// =====================================================================

const EXPORT_PREFS_KEY = 'egv.exportPrefs';
let exportReturnFocus = null;

const loadExportPrefs = () => {
    try { return JSON.parse(storage.get(EXPORT_PREFS_KEY) || '{}') || {}; } catch { return {}; }
};

const readExportForm = () => {
    const format = els.exportForm.elements.format.value;
    const options = {};
    els.exportFields.querySelectorAll('input[type="checkbox"]').forEach(input => {
        options[input.value] = input.checked && !input.disabled;
    });
    return { format, options, startDate: els.exportFrom.value || null, endDate: els.exportTo.value || null };
};

const ordersForExport = (startDate, endDate) => state.orders.filter(order =>
    Core.inDateRange(order.date ? order.date.getTime() : null, startDate, endDate));

const updateExportSummary = () => {
    const { format, options, startDate, endDate } = readExportForm();
    els.exportJsonHint.hidden = format !== 'json';
    const invalidRange = startDate && endDate && startDate > endDate;
    const orders = invalidRange ? [] : ordersForExport(startDate, endDate);
    const games = orders.reduce((sum, order) => sum + order.items.length, 0);
    const noFields = format !== 'json' && !Object.values(options).some(Boolean);

    let text;
    if (invalidRange) text = 'The “From” date is after the “To” date.';
    else if (!orders.length) text = 'No orders in this date range.';
    else if (noFields) text = 'Choose at least one field.';
    else text = `${games.toLocaleString()} ${games === 1 ? 'game' : 'games'} in ${orders.length.toLocaleString()} ${orders.length === 1 ? 'order' : 'orders'} will be exported.`;

    const blocked = invalidRange || !orders.length || noFields;
    els.exportSummary.textContent = text;
    els.exportSummary.classList.toggle('is-empty', blocked);
    els.exportDownload.disabled = blocked;
};

const openExportDialog = () => {
    const prefs = loadExportPrefs();
    const savedFields = prefs.fields || {};

    els.exportFields.replaceChildren(...Core.FIELDS.map(field => {
        const available = state.fields.has(field.key);
        const label = document.createElement('label');
        label.className = `field-check${available ? '' : ' is-unavailable'}`;
        if (!available) label.title = 'This field isn’t in the loaded data';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = field.key;
        input.disabled = !available;
        input.checked = available && (field.key in savedFields ? savedFields[field.key] : field.defaultOn);
        const text = document.createElement('span');
        text.textContent = field.label;
        if (!available) {
            const note = document.createElement('small');
            note.textContent = 'Not in this file';
            text.appendChild(note);
        }
        label.append(input, text);
        return label;
    }));

    const format = ['json', 'csv', 'txt'].includes(prefs.format) ? prefs.format : 'json';
    els.exportForm.elements.format.value = format;
    els.exportFrom.value = state.dateFrom || '';
    els.exportTo.value = state.dateTo || '';
    updateExportSummary();

    exportReturnFocus = document.activeElement;
    els.exportModal.hidden = false;
    document.body.classList.add('no-scroll');
    els.exportForm.querySelector('input[name="format"]:checked').focus();
};

const closeExportDialog = () => {
    if (els.exportModal.hidden) return;
    els.exportModal.hidden = true;
    document.body.classList.remove('no-scroll');
    if (exportReturnFocus && exportReturnFocus.isConnected) exportReturnFocus.focus();
};

const downloadExport = () => {
    const { format, options, startDate, endDate } = readExportForm();
    storage.set(EXPORT_PREFS_KEY, JSON.stringify({ format, fields: options }));
    const orders = ordersForExport(startDate, endDate).map(toCanonical);
    const file = Core.buildFile(orders, format, options, { exporter: viewerMeta(), filters: { startDate, endDate } });

    const blob = new Blob([file.content], { type: `${file.mimeType};charset=utf-8` });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);

    closeExportDialog();
    showToast(`Downloaded ${file.fileName} · ${file.itemCount.toLocaleString()} games`);
};

// =====================================================================
// File loading
// =====================================================================

const showLoadError = (message) => {
    if (state.items.length) {
        showToast(message);
    } else {
        els.loadError.textContent = message;
        els.loadError.hidden = false;
    }
};

const handleFile = (file) => {
    if (!file) return;
    els.loadError.hidden = true;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const { orders, format, fields } = parseFile(String(reader.result), file.name);
            if (!orders.length || !orders.some(o => o.items.length)) {
                showLoadError('No games were found in this file.');
                return;
            }
            loadLibrary(orders, file.name, format, fields);
        } catch (error) {
            console.error(error);
            showLoadError(error.message || 'This file could not be read.');
        }
    };
    reader.onerror = () => showLoadError('This file could not be read.');
    reader.readAsText(file, 'utf-8');
};

// =====================================================================
// Events
// =====================================================================

const debounce = (fn, ms) => {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
};

const readNumber = (input) => {
    const value = parseFloat(input.value);
    return isNaN(value) ? null : value;
};

const init = () => {
    applyTheme(currentTheme());
    els.themeBtn.addEventListener('click', () => {
        const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
        storage.set('egv.theme', next);
        applyTheme(next);
    });

    // File picking
    const openPicker = () => { els.fileInput.value = ''; els.fileInput.click(); };
    $('#choose-file-btn').addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });
    els.dropzone.addEventListener('click', (e) => { if (!e.target.closest('a')) openPicker(); });
    els.dropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
    });
    $('#load-another-btn').addEventListener('click', openPicker);
    els.fileInput.addEventListener('change', () => handleFile(els.fileInput.files[0]));

    // Drag & drop anywhere on the page
    let dragDepth = 0;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth++;
        els.dragOverlay.hidden = false;
        els.dropzone.classList.add('is-over');
    });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', (e) => {
        if (!hasFiles(e)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) { els.dragOverlay.hidden = true; els.dropzone.classList.remove('is-over'); }
    });
    window.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth = 0;
        els.dragOverlay.hidden = true;
        els.dropzone.classList.remove('is-over');
        handleFile(e.dataTransfer.files[0]);
    });

    // Search, sort, chips
    els.search.addEventListener('input', debounce(() => { state.search = els.search.value; render(); }, 120));
    els.sort.addEventListener('change', () => { state.sort = els.sort.value; render(); });
    document.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => {
        setFilterChip(chip.dataset.filter);
        render();
    }));

    // Filters popover
    els.filtersBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(els.filtersBtn, els.filtersPanel); });
    els.filtersPanel.addEventListener('click', (e) => e.stopPropagation());
    const onFilterInput = () => {
        state.dateFrom = els.dateFrom.value || null;
        state.dateTo = els.dateTo.value || null;
        state.priceMin = readNumber(els.priceMin);
        state.priceMax = readNumber(els.priceMax);
        render();
    };
    [els.dateFrom, els.dateTo].forEach(input => input.addEventListener('change', onFilterInput));
    [els.priceMin, els.priceMax].forEach(input => input.addEventListener('input', debounce(onFilterInput, 200)));
    $('#reset-filters-btn').addEventListener('click', () => {
        els.dateFrom.value = '';
        els.dateTo.value = '';
        els.priceMin.value = '';
        els.priceMax.value = '';
        onFilterInput();
    });

    // Overflow menu
    els.menuBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(els.menuBtn, els.menuList); });
    document.addEventListener('click', () => {
        togglePanel(els.menuBtn, els.menuList, false);
        togglePanel(els.filtersBtn, els.filtersPanel, false);
    });

    // Cards and drawer
    els.grid.addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (!card) return;
        lastFocusedCardId = Number(card.dataset.id);
        openDrawer(lastFocusedCardId);
    });
    els.drawerBody.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('[data-copy]');
        if (copyBtn) {
            navigator.clipboard?.writeText(copyBtn.dataset.copy).then(() => {
                copyBtn.innerHTML = icons.check;
                setTimeout(() => { copyBtn.innerHTML = icons.copy; }, 1500);
            }).catch(() => showToast('Copy failed'));
            return;
        }
        const other = e.target.closest('[data-item-id]');
        if (other && !other.classList.contains('is-current')) openDrawer(Number(other.dataset.itemId));
    });
    $('#drawer-close').addEventListener('click', closeDrawer);
    els.drawerBackdrop.addEventListener('click', closeDrawer);

    // Keyboard
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!els.exportModal.hidden) { closeExportDialog(); return; }
            if (els.drawer.classList.contains('is-open')) closeDrawer();
            togglePanel(els.menuBtn, els.menuList, false);
            togglePanel(els.filtersBtn, els.filtersPanel, false);
        } else if (e.key === '/' && state.items.length && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) {
            e.preventDefault();
            els.search.focus();
        }
    });

    // Export dialog
    $('#export-btn').addEventListener('click', openExportDialog);
    $('#export-close').addEventListener('click', closeExportDialog);
    $('#export-cancel').addEventListener('click', closeExportDialog);
    els.exportModal.addEventListener('click', (e) => { if (e.target === els.exportModal) closeExportDialog(); });
    els.exportForm.addEventListener('change', updateExportSummary);
    els.exportForm.addEventListener('submit', (e) => { e.preventDefault(); if (!els.exportDownload.disabled) downloadExport(); });

    $('#close-library-btn').addEventListener('click', () => {
        togglePanel(els.menuBtn, els.menuList, false);
        closeLibrary();
    });
    els.menuVersion.textContent = VIEWER_VERSION ? `Library Viewer ${VIEWER_VERSION}` : '';

    document.querySelectorAll('[data-loaded-only]').forEach(el => { el.hidden = true; });

    const importRequest = readImportHash();
    if (importRequest) importFromExtension(importRequest);
    else restoreLibrary();
};

init();

// Exposed for debugging and tests only
window.__egv = { parseFile, buildItems, parseMoney, parseDateValue, lookupSteamId, loadLibrary, toCanonical, state };

})();
