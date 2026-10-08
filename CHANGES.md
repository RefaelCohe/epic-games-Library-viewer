# Epic Games Library Viewer — v2.0.0

**This folder is the updated site.** Upload its contents to the `epic-games-Library-viewer` GitHub Pages
repo, replacing the old files. There is no build step; every file is served as-is.
Publish it **before** releasing Exporter 1.3.0, because the extension's "Open in Library Viewer" depends on it.

## Files
| File | Role |
|---|---|
| `index.html`, `styles.css`, `app.js` | The Library Viewer |
| `egl-export-core.js` | Shared export formats. **Identical copy of the extension's file; keep them in sync** |
| `egl-logger.js` | Console logger. **Identical copy of the extension's file; keep them in sync** |
| `versions.js` | **Single source of truth for version numbers** shown on every page |
| `exporter_about_page.html`, `Viewer_about_page.html`, `Privacy policy/Extension-privacy-policy.html` | Site pages (same URLs as before) |
| `pages.css`, `pages.js` | Shared look and behavior of the site pages (theme, Back button, versions) |

## New in 2.0.0
- **Receives the library from the extension.** When the Exporter opens the Viewer with `#import=…&ext=…`, the
  page asks the extension for the data through Chrome's messaging (`chrome.runtime.sendMessage`). The token is then removed from the address bar.
  If it fails, a clear message explains why: the export was already opened, or the extension wasn't found.
- **Export dialog**: JSON / CSV / TXT with the same 11 fields, defaults and date filter as the extension, and
  **byte-for-byte the same output** (tested). Fields that aren't in the loaded file are disabled.
  The last choice is remembered.
- **The library survives reloads and page visits in the same tab** (`sessionStorage`, cleared when the tab closes,
  or with "Close library" in the menu). The menu pages now open in the same tab.
- **No Google Fonts.** The site uses the system font, which removes a third-party request.
- The menu shows the Viewer version and links to the privacy policy.
- **Pages of 48 games** with Previous / page numbers / Next at the bottom (like a search engine).
  - The toolbar shows "49–96 of 594".
  - Browser Back steps through pages, because the page is in the URL (`?page=3`).
  - Changing the search, filters or sort goes back to page 1.
- **Covers load by page:**
  - The page you're on loads first, in grid order, and the next page is fetched in the background.
  - Waiting lookups for pages you left are dropped, so a big library never loads all at once.
  - **Search results' covers start immediately**, ahead of anything else.
  - If Wikidata or Wikipedia answers "too many requests", lookups pause for 10s, 30s or 60s instead of failing.
- **Wikipedia fallback for covers:** for games that aren't on Steam (e.g. Epic exclusives), the lead image of
  the game's English Wikipedia article is used. It's accepted only when the article title matches the
  game name exactly. Box art is portrait, so it's shown whole over a blurred copy that fills the frame.
  The details panel links to the Wikipedia article.
- Cover cache v2 (`egv.covers.v2`). Old entries are migrated once, and old misses are retried with the fallback.
- **Console logging** (`egl-logger.js`, identical copy of the extension's):
  - By default only warnings and errors are printed.
  - Add `?debug` to the URL for everything: lookups with timings, parsing, import and export.
  - `EGLLog.dump()` and `EGLLog.copy()` give the last 300 entries for bug reports.
- Cover art: when Wikidata marks a game's only Steam ID as outdated (e.g. Disco Elysium, whose page became
  "The Final Cut"), that ID is still used. Before, those games got no cover.

## Site pages
- Rewritten in the Viewer's design (dark/light, responsive). They share the same theme setting.
- **Back button**: if you came from another page (the library, the store, a search), it goes back. If the page
  was opened directly (e.g. from the extension), it goes to the library.
- Fixed:
  - Duplicate `<head>`.
  - Placeholder links (`your-library-viewer-url.html`, `Chrome.com/store/link`).
  - `javascript:window.close()` back button.
  - Typos and a stray `</a>`.
  - "Version 1.0" hard-coded.
- **Privacy policy 2.0** is accurate for Exporter 1.3.0 and Viewer 2.0.0, and covers both. It describes:
  - What's read and where it goes.
  - The one-time hand-off.
  - `storage.sync` and `storage.local`.
  - Every permission.
  - Wikidata, Steam and GitHub requests.
  - It doesn't claim the extension is open source; only the Viewer's code is public.

## Release checklist
1. Update `versions.js`: version, date and `history` notes for the product you're releasing; `privacy` if the policy changed.
2. Bump the extension's `manifest.json` to match.
3. If `egl-export-core.js` or `egl-logger.js` changed in one place, copy it to the other.

## User guides (PDF)
- `user-guide.pdf` is now the **Library Viewer** guide (8 pages, sample data). Before, it was an
  unfinished copy of the extension guide.
- `Exporter-User-guide.pdf` is **not replaced yet**. It's waiting for screenshots of the real Epic page;
  a preview is in `../guides/out/exporter-preview.pdf`.
- Sources and build steps are in `../guides/README.md`.

---

# Previous: v2 (first redesign)

## Why files failed to load
The viewer looked for the old labels (`Game:`, `Date:`, `Total Paid:`), but the exporter writes
`gameName:`, `purchaseDate:`, `totalPrice:`. No line matched, so the viewer showed
"No valid game data found".

## Supported files
| Format | Exporter version | Notes |
|---|---|---|
| JSON (structured, `schemaVersion: 2`) | 1.2.4+ | Recommended. Orders → items, numeric amounts, IDs |
| JSON (classic flat array) | ≤ 1.2.3 | |
| TXT (`key: value, …`) | all | Old labels (`Game:`, `Total Paid:`) are supported too |
| CSV | 1.2.4+ | |

All formats become one model of **orders that contain items**. Rows with the same order ID are grouped.
In 1.2.4 TXT/CSV files, a `totalPrice: -` row joins the order above it.
"Paid" for an item in a multi-item order is the order total split by list price, so bundle totals are never counted twice.

## Bugs fixed
- Exporter files were rejected (label mismatch, see above).
- Dates such as `1.10.2026` were not parsed and silently became *today*.
- Game names containing commas (e.g. "I Have No Mouth, and I Must Scream") were cut off.
- Mixed currencies (ILS + USD) were summed together, and `₪` was hardcoded. Totals are now per currency.
- Multi-item orders counted the order total once per item.
- **Cover images didn't load at all:** the third-party CORS proxy (`cors.eu.org`) is down, and Steam's
  search API blocks direct browser requests. Images were also re-requested for every game on every "Apply".
- Game names were inserted as raw HTML (XSS). All file data is now escaped.
- The date "To" filter excluded the selected day.
- Discounts such as `-₪10.00` were hidden (the check was `includes('0.00')`).
- Only `.txt` was accepted, and there was no way to load another file after the first.
- The "Extension" button linked to `YOUR_EXTENSION_ID`. It now opens the exporter's about page.

## Cover images
Lookups go **directly from the user's browser**. There is no proxy and no server, and GitHub only serves the static files.
1. Wikidata search API (CORS-enabled, no key) → the game whose name matches exactly → its Steam app ID.
2. Steam's public CDN header image (`shared.akamai.steamstatic.com`), loaded as a plain `<img>`.

To keep the load light, covers load only for cards that scroll into view, with at most 3 lookups at a time.
Results are cached in `localStorage`, so a reload makes no new lookups, and misses are retried after 7 days.
A cover is only shown on an exact name match, so you never get a wrong cover. Games that aren't on
Steam (Epic exclusives) show their initials instead.

## Design
- New "game launcher" look. It is dark by default, and the theme button cycles Dark → Light → System. It uses SVG icons, with no emoji.
- A sticky top bar has search, Load file and a menu. A stats strip shows games, free games, spent and saved (per currency), and games per year.
- Chips filter All / Purchased / Free / Gifts. The Filters popover holds the date range and amount paid. You can sort by date, amount or name. Everything updates instantly.
- Clicking a card opens a details drawer with the full order: items, list price, discount, tax, total, order ID (copy), payment method, gift recipient, and links to the Epic Store and Steam pages.
- Responsive down to phone width, where the drawer becomes full-screen. Press `/` to focus search and `Esc` to close panels.
