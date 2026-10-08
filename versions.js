// versions.js — single source of truth for version numbers shown across the site.
// Release checklist: bump the extension's manifest.json "version" AND the matching entry here.

window.EGL_VERSIONS = {
    exporter: {
        name: 'Epic Games Library Exporter',
        version: '1.3.0',
        released: '2026-10-08',
        storeUrl: 'https://chromewebstore.google.com/detail/gfhbpoeikkjapjbnfnjceikdfolcgcln',
        history: [
            {
                version: '1.3.0',
                date: '2026-10-08',
                notes: [
                    'Open your export straight in the Library Viewer, with no file to save or upload',
                    'Export options open in a centered window on the Epic page, in the same look as the Library Viewer',
                    'Clicking the extension on another site shows the way to your Epic account page',
                    'Live progress that follows Epic’s real pace, with time remaining',
                    'Clear in-page messages instead of browser pop-ups, with automatic retry when Epic is busy',
                    'Works again after Epic moved account pages to accounts.epicgames.com',
                    'New CSV format and a structured JSON format',
                    'New optional fields: gift recipient and order type',
                    'Order totals no longer repeat for every game in a multi-game order'
                ]
            }
        ]
    },
    viewer: {
        name: 'Epic Games Library Viewer',
        version: '2.0.0',
        released: '2026-10-08',
        url: 'https://refaelcohe.github.io/epic-games-Library-viewer/',
        history: [
            {
                version: '2.0.0',
                date: '2026-10-08',
                notes: [
                    'Receives your library directly from the extension',
                    'Export to JSON, CSV or TXT, in the same formats as the extension',
                    'Reads every export format (JSON, CSV and TXT, old and new)',
                    'Your library in pages of 48 games; covers load for the page you\u2019re on, and search results come first',
                    'Cover art works again, from Steam or Wikipedia for games that aren\u2019t on Steam',
                    'New design with stats, filters and full order details',
                    'Your library stays loaded while you browse the site in the same tab'
                ]
            }
        ]
    },
    privacy: {
        version: '2.0',
        updated: '2026-10-09'
    }
};
