// egl-export-core.js — shared export formats for Epic Games Library Exporter and Library Viewer.
//
// KEEP IN SYNC: an identical copy lives in the extension folder and in the Library Viewer site.
// Both products build TXT / CSV / JSON files with this file, so their output is always the same.
//
// "isFree" means the item cost nothing: a zero list price, or an order total of 0 (claimed giveaway).
//
// Canonical order (the structured JSON v2 order shape, amounts in major units):
//   { orderId, date (ISO), timestamp, orderType, paymentMethod, currency,
//     amounts: { subtotal?, discount, tax, total }, isFree,
//     items: [{ name, offerId, namespace, quantity, price, currency, isFree, giftRecipient }] }

(function (root) {
'use strict';

if (root.EGLExportCore) return;

const SCHEMA_VERSION = 2;
const FILE_BASE_NAME = 'My_Epic_Games_Library';

// Export fields, in file order. Same keys, labels and defaults as the extension popup.
const FIELDS = [
    { key: 'gameName', label: 'Game name', defaultOn: true },
    { key: 'purchaseDate', label: 'Purchase date', defaultOn: true },
    { key: 'originalPrice', label: 'Price', defaultOn: false },
    { key: 'discount', label: 'Discount amount', defaultOn: false },
    { key: 'totalPrice', label: 'Total price', defaultOn: true },
    { key: 'orderId', label: 'Order ID', defaultOn: false },
    { key: 'quantity', label: 'Quantity', defaultOn: false },
    { key: 'paymentMethod', label: 'Payment method', defaultOn: false },
    { key: 'tax', label: 'Tax', defaultOn: false },
    { key: 'giftRecipient', label: 'Gift recipient', defaultOn: false },
    { key: 'orderType', label: 'Order type', defaultOn: false }
];

const ALL_FIELDS_ON = Object.fromEntries(FIELDS.map(f => [f.key, true]));

// ---- Amounts & dates ----

// Epic amounts are in minor units (cents/agorot)
const toMajor = (minor) => (typeof minor === 'number' ? Math.round(minor) / 100 : null);
const toMinor = (major) => (typeof major === 'number' ? Math.round(major * 100) : 0);

const formatPrice = (amountMajor, currency) => {
    const symbol = currency === 'ILS' ? '₪' : (currency || '');
    return `${symbol}${(amountMajor || 0).toFixed(2)}`;
};

const toLocalDateString = (date) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// "YYYY-MM-DD" filter bounds in local time; the end date is inclusive
const inDateRange = (timestamp, startDate, endDate) => {
    if (typeof timestamp !== 'number') return !startDate && !endDate;
    if (startDate && timestamp < new Date(`${startDate}T00:00:00`).getTime()) return false;
    if (endDate && timestamp > new Date(`${endDate}T23:59:59.999`).getTime()) return false;
    return true;
};

// ---- Epic API order -> canonical order (all fields) ----

const fromEpicOrder = (raw) => {
    const currency = (raw.total && raw.total.currency) || null;
    const subtotal = raw.subtotal && typeof raw.subtotal === 'object' ? raw.subtotal.amount : raw.subtotal;
    const discount = (raw.promotions || []).reduce((sum, promo) => sum + (promo.amount || 0), 0);
    const total = raw.total ? raw.total.amount : null;

    const amounts = {};
    if (typeof subtotal === 'number') amounts.subtotal = toMajor(subtotal);
    amounts.discount = toMajor(discount);
    amounts.tax = toMajor(raw.tax ? raw.tax.amount : null);
    amounts.total = toMajor(total);

    return {
        orderId: raw.orderId || null,
        date: new Date(raw.createdAtMillis).toISOString(),
        timestamp: raw.createdAtMillis,
        orderType: raw.orderType || null,
        paymentMethod: (raw.transactions && raw.transactions[0] && raw.transactions[0].paymentMethodType) || null,
        currency,
        amounts,
        isFree: (total || 0) === 0,
        items: (raw.items || []).map(item => ({
            name: item.description || null,
            offerId: item.offerId || null,
            namespace: item.namespace || null,
            quantity: item.quantity || 1,
            price: toMajor(item.amount),
            currency: item.currency || currency,
            isFree: (item.amount || 0) === 0 || (total || 0) === 0,
            giftRecipient: item.giftRecipient || null
        }))
    };
};

// ---- Structured JSON (schemaVersion 2) ----

const structuredOrder = (order, options) => {
    const amounts = {};
    const src = order.amounts || {};
    if (typeof src.subtotal === 'number') amounts.subtotal = src.subtotal;
    if (options.discount) amounts.discount = src.discount ?? null;
    if (options.tax) amounts.tax = src.tax ?? null;
    if (options.totalPrice) amounts.total = src.total ?? null;

    const out = { orderId: order.orderId || null, date: order.date, timestamp: order.timestamp };
    if (options.orderType) out.orderType = order.orderType || null;
    if (options.paymentMethod) out.paymentMethod = order.paymentMethod || null;
    out.currency = order.currency || null;
    out.amounts = amounts;
    // An unknown total (null) is not "free"
    out.isFree = src.total === 0;
    out.items = order.items.map(item => {
        // Free = zero list price, or claimed in an order that cost nothing (e.g. weekly free games)
        const outItem = {
            name: item.name || null,
            offerId: item.offerId || null,
            namespace: item.namespace || null,
            quantity: item.quantity || 1,
            price: item.price ?? null,
            currency: item.currency || order.currency || null,
            isFree: item.price === 0 || out.isFree
        };
        if (options.giftRecipient) outItem.giftRecipient = item.giftRecipient || null;
        return outItem;
    });
    return out;
};

const buildSummary = (orders, options) => {
    const byCurrency = {};
    const byYear = {};
    let itemCount = 0;
    let freeItemCount = 0;
    let giftCount = 0;

    for (const order of orders) {
        const amounts = order.amounts || {};
        itemCount += order.items.length;
        const orderIsFree = amounts.total === 0;
        freeItemCount += order.items.filter(item => orderIsFree || item.price === 0).length;
        giftCount += order.items.filter(item => item.giftRecipient).length;

        // Sum in minor units and never mix currencies
        const currency = order.currency || 'UNKNOWN';
        const cur = byCurrency[currency] || (byCurrency[currency] = { orders: 0, total: 0, discount: 0, tax: 0 });
        cur.orders += 1;
        cur.total += toMinor(amounts.total);
        cur.discount += toMinor(amounts.discount);
        cur.tax += toMinor(amounts.tax);

        if (typeof order.timestamp === 'number') {
            const year = String(new Date(order.timestamp).getFullYear());
            const yr = byYear[year] || (byYear[year] = { orders: 0, items: 0 });
            yr.orders += 1;
            yr.items += order.items.length;
        }
    }

    for (const cur of Object.values(byCurrency)) {
        cur.total = toMajor(cur.total);
        if (options.discount) cur.discount = toMajor(cur.discount); else delete cur.discount;
        if (options.tax) cur.tax = toMajor(cur.tax); else delete cur.tax;
    }

    const timestamps = orders.map(order => order.timestamp).filter(ts => typeof ts === 'number');
    return {
        orderCount: orders.length,
        itemCount,
        freeItemCount,
        giftCount,
        firstPurchase: timestamps.length ? toLocalDateString(new Date(Math.min(...timestamps))) : null,
        lastPurchase: timestamps.length ? toLocalDateString(new Date(Math.max(...timestamps))) : null,
        byCurrency,
        byYear
    };
};

// meta: { exporter: { name, version }, filters: { startDate, endDate }, exportedAt? }
const buildStructured = (orders, options, meta = {}) => ({
    schemaVersion: SCHEMA_VERSION,
    exporter: meta.exporter || { name: 'Epic Games Library Exporter', version: null },
    exportedAt: meta.exportedAt || new Date().toISOString(),
    filters: {
        startDate: (meta.filters && meta.filters.startDate) || null,
        endDate: (meta.filters && meta.filters.endDate) || null
    },
    summary: buildSummary(orders, options),
    orders: orders.map(order => structuredOrder(order, options))
});

// ---- Flat rows (TXT / CSV) ----

// Order-level values (discount, total, tax) appear on the first item only and "-" on the
// following items, so multi-item orders are never counted twice.
const buildFlatRows = (orders, options) => orders.flatMap(order => {
    const amounts = order.amounts || {};
    const dateText = typeof order.timestamp === 'number' ? new Date(order.timestamp).toLocaleDateString('he-IL') : 'N/A';
    return order.items.map((item, index) => {
        const isFirstItem = index === 0;
        const row = {};
        if (options.gameName) row.gameName = item.name || 'N/A';
        if (options.purchaseDate) row.purchaseDate = dateText;
        if (options.originalPrice) row.originalPrice = formatPrice(item.price, item.currency || order.currency);
        if (options.discount) row.discount = isFirstItem ? `-${formatPrice(amounts.discount, order.currency)}` : '-';
        if (options.totalPrice) row.totalPrice = isFirstItem ? formatPrice(amounts.total, order.currency) : '-';
        if (options.orderId) row.orderId = order.orderId || 'N/A';
        if (options.quantity) row.quantity = item.quantity || 1;
        if (options.paymentMethod) row.paymentMethod = order.paymentMethod || 'N/A';
        if (options.tax) row.tax = isFirstItem ? formatPrice(amounts.tax, order.currency) : '-';
        if (options.giftRecipient) row.giftRecipient = item.giftRecipient || '-';
        if (options.orderType) row.orderType = order.orderType || 'N/A';
        return row;
    });
});

// One order item per line, so line breaks inside values become spaces
const toTxt = (rows) => rows
    .map(row => Object.entries(row).map(([key, val]) => `${key}: ${String(val).replace(/\r?\n|\r/g, ' ')}`).join(', '))
    .join('\n');

const escapeCsvValue = (value) => {
    const str = String(value ?? '');
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const toCsv = (rows) => {
    if (rows.length === 0) return '﻿';
    const headers = Object.keys(rows[0]);
    const lines = rows.map(row => headers.map(h => escapeCsvValue(row[h])).join(','));
    // BOM so Excel reads the file as UTF-8 (Hebrew names, ₪)
    return '﻿' + [headers.join(','), ...lines].join('\r\n');
};

// format: 'json' | 'csv' | 'txt'
const buildFile = (orders, format, options, meta) => {
    if (format === 'json') {
        const structured = buildStructured(orders, options, meta);
        return {
            content: JSON.stringify(structured, null, 2),
            mimeType: 'application/json',
            fileName: `${FILE_BASE_NAME}.json`,
            orderCount: structured.summary.orderCount,
            itemCount: structured.summary.itemCount
        };
    }
    const rows = buildFlatRows(orders, options);
    const isCsv = format === 'csv';
    return {
        content: isCsv ? toCsv(rows) : toTxt(rows),
        mimeType: isCsv ? 'text/csv' : 'text/plain',
        fileName: `${FILE_BASE_NAME}.${isCsv ? 'csv' : 'txt'}`,
        orderCount: orders.length,
        itemCount: rows.length
    };
};

root.EGLExportCore = Object.freeze({
    SCHEMA_VERSION,
    FIELDS,
    ALL_FIELDS_ON,
    fromEpicOrder,
    inDateRange,
    buildStructured,
    buildFlatRows,
    toTxt,
    toCsv,
    buildFile,
    formatPrice
});

})(typeof globalThis !== 'undefined' ? globalThis : window);
