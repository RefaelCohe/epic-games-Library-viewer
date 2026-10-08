// pages.js — shared behavior for the About and Privacy pages:
// theme toggle (same setting as the Library Viewer), the Back button, and version numbers from versions.js.

(() => {
'use strict';

const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* unavailable */ } }
};

// ---- Theme ----
const THEMES = ['dark', 'light', 'system'];
const THEME_ICONS = {
    dark: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8A9.3 9.3 0 0 0 12 3Z"/></svg>',
    light: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM11 1h2v3h-2V1Zm0 19h2v3h-2v-3ZM3.51 4.93l1.42-1.42 2.12 2.13-1.41 1.41L3.5 4.93Zm12.95 12.95 1.41-1.41 2.13 2.12-1.42 1.42-2.12-2.13ZM1 11h3v2H1v-2Zm19 0h3v2h-3v-2ZM4.93 20.49l-1.42-1.42 2.13-2.12 1.41 1.41-2.12 2.13ZM17.88 7.05l-1.41-1.41 2.12-2.13 1.42 1.42-2.13 2.12Z"/></svg>',
    system: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 3H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h6v2H8v2h8v-2h-2v-2h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 13H4V5h16v11Z"/></svg>'
};
const currentTheme = () => (THEMES.includes(storage.get('egv.theme')) ? storage.get('egv.theme') : 'dark');
const applyTheme = (theme) => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-btn');
    if (btn) {
        btn.innerHTML = THEME_ICONS[theme];
        btn.title = `Theme: ${theme[0].toUpperCase()}${theme.slice(1)}`;
        btn.setAttribute('aria-label', `Theme: ${theme}. Click to change`);
    }
};

// ---- Back button ----
// Goes back when the visitor came from another page (the library, the store, a search…);
// otherwise, e.g. when the page was opened in a new tab, it goes to the library.
const setupBackLink = () => {
    const back = document.getElementById('back-link');
    if (!back) return;
    back.addEventListener('click', (event) => {
        if (document.referrer && window.history.length > 1) {
            event.preventDefault();
            window.history.back();
        }
        // Otherwise the link's href (the library) is followed
    });
};

// ---- Versions (from versions.js) ----
const formatMonth = (isoDate) => {
    const [year, month, day] = isoDate.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1).toLocaleDateString('en-US',
        day ? { year: 'numeric', month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long' });
};

const renderVersions = () => {
    const versions = window.EGL_VERSIONS;
    if (!versions) return;

    document.querySelectorAll('[data-version]').forEach(el => {
        const product = versions[el.dataset.version];
        if (product) el.textContent = product.version;
    });
    document.querySelectorAll('[data-updated]').forEach(el => {
        const product = versions[el.dataset.updated];
        const date = product && (product.updated || product.released);
        if (date) el.textContent = formatMonth(date);
    });
    document.querySelectorAll('[data-store-link]').forEach(el => {
        if (versions.exporter && versions.exporter.storeUrl) el.href = versions.exporter.storeUrl;
    });
    document.querySelectorAll('[data-history]').forEach(el => {
        const product = versions[el.dataset.history];
        if (!product) return;
        el.replaceChildren(...product.history.map(release => {
            const item = document.createElement('li');
            const head = document.createElement('div');
            head.className = 'release-head';
            const version = document.createElement('strong');
            version.textContent = `Version ${release.version}`;
            const date = document.createElement('span');
            date.textContent = formatMonth(release.date);
            head.append(version, date);
            const notes = document.createElement('ul');
            release.notes.forEach(note => {
                const li = document.createElement('li');
                li.textContent = note;
                notes.appendChild(li);
            });
            item.append(head, notes);
            return item;
        }));
    });
};

document.addEventListener('DOMContentLoaded', () => {
    applyTheme(currentTheme());
    const themeBtn = document.getElementById('theme-btn');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
            storage.set('egv.theme', next);
            applyTheme(next);
        });
    }
    setupBackLink();
    renderVersions();
    const year = document.getElementById('current-year');
    if (year) year.textContent = String(new Date().getFullYear());
});
})();
