// egl-logger.js — a small console logger for Epic Games Library Exporter and Library Viewer.
//
// KEEP IN SYNC: an identical copy lives in the extension folder and in the Library Viewer site.
//
//   EGLLogger.configure({ app: 'Viewer' });
//   const log = EGLLogger.scope('covers');
//   log.debug('lookup', { name });  log.warn('Wikidata is busy', { status: 429 });
//   const done = log.time('lookup'); … done({ result: 'hit' });
//
// Only warnings and errors are printed by default, so the console stays clean.
// For everything (debug and info too): add ?debug to the page URL, or run
//   localStorage.setItem('egl.debug', '1')
// The last 300 entries are always kept in memory: EGLLog.dump() prints them, EGLLog.copy() copies them.

(function (root) {
'use strict';

if (root.EGLLogger) return;

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const HISTORY_SIZE = 300;
const COLORS = { debug: '#6b7280', info: '#3b82f6', warn: '#d97706', error: '#dc2626' };

const debugEnabled = () => {
    try {
        if (root.location && /(?:^|[?&])debug(?:=|&|$)/.test(root.location.search || '')) return true;
    } catch { /* no location */ }
    try {
        return Boolean(root.localStorage && root.localStorage.getItem('egl.debug') === '1');
    } catch {
        return false;
    }
};

const config = { app: 'EGL', threshold: debugEnabled() ? LEVELS.debug : LEVELS.warn };
const history = [];

// Errors don't serialize well in the history table; keep their message and stack
const plain = (value) => {
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
    return value;
};

const write = (level, scope, message, data) => {
    const entry = { time: new Date().toISOString(), level, scope, message: String(message) };
    if (data !== undefined) entry.data = plain(data);
    history.push(entry);
    if (history.length > HISTORY_SIZE) history.shift();

    if (LEVELS[level] < config.threshold || typeof console === 'undefined') return;
    const method = level === 'debug' ? 'debug' : level === 'info' ? 'info' : level;
    const args = [`%c[EGL ${config.app}]%c ${scope} · ${entry.message}`, `color:${COLORS[level]};font-weight:600`, 'color:inherit'];
    if (data !== undefined) args.push(data);
    (console[method] || console.log).apply(console, args);
};

const scope = (name) => ({
    debug: (message, data) => write('debug', name, message, data),
    info: (message, data) => write('info', name, message, data),
    warn: (message, data) => write('warn', name, message, data),
    error: (message, data) => write('error', name, message, data),
    // Returns a function that logs how long the operation took
    time(label) {
        const started = (root.performance && root.performance.now) ? root.performance.now() : Date.now();
        return (extra = {}) => {
            const now = (root.performance && root.performance.now) ? root.performance.now() : Date.now();
            write('debug', name, label, { ms: Math.round(now - started), ...extra });
        };
    }
});

let globalHooksInstalled = false;

// Uncaught errors and rejections. Opt-in: inside a content script these events would also
// report the host page's own errors (e.g. Epic's), which aren't ours.
const installGlobalHooks = () => {
    if (globalHooksInstalled || typeof root.addEventListener !== 'function') return;
    globalHooksInstalled = true;
    const global = scope('global');
    root.addEventListener('error', (event) => {
        global.error(event.message || 'Uncaught error', event.error || { source: event.filename, line: event.lineno });
    });
    root.addEventListener('unhandledrejection', (event) => {
        global.error('Unhandled promise rejection', event.reason);
    });
};

const EGLLogger = {
    // options: { app: 'Viewer', level: 'debug'|'info'|'warn'|'error', captureGlobalErrors: true }
    configure(options = {}) {
        if (options.app) config.app = options.app;
        if (options.level && LEVELS[options.level]) config.threshold = LEVELS[options.level];
        if (options.captureGlobalErrors) installGlobalHooks();
    },
    scope,
    setDebug(on) {
        config.threshold = on ? LEVELS.debug : LEVELS.warn;
        try { root.localStorage && (on ? root.localStorage.setItem('egl.debug', '1') : root.localStorage.removeItem('egl.debug')); } catch { /* unavailable */ }
    },
    history: () => history.slice()
};

// Console helpers for bug reports
root.EGLLog = {
    dump(filter) {
        const rows = history.filter(e => !filter || e.level === filter || e.scope === filter)
            .map(e => ({ time: e.time.slice(11, 23), level: e.level, scope: e.scope, message: e.message, data: e.data === undefined ? '' : JSON.stringify(e.data) }));
        console.table(rows);
        return rows.length;
    },
    copy() {
        const text = JSON.stringify(history, null, 2);
        try {
            if (root.navigator && root.navigator.clipboard) return root.navigator.clipboard.writeText(text).then(() => `${history.length} entries copied`);
        } catch { /* fall through */ }
        return text;
    },
    debug: (on = true) => EGLLogger.setDebug(on)
};

root.EGLLogger = EGLLogger;
})(typeof globalThis !== 'undefined' ? globalThis : window);
