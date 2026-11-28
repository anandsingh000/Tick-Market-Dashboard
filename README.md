# Trading Tick-style website clone

A multi-page Trading Tick clone built from the uploaded screenshots and the public site's visible menu structure. Each menu feature has a separate local route/page (PCR, Call vs Put OI, Futures OI, option chains, charts, research, stock pages, backtest previews, calculators, and contact). It is a visual/interaction clone, not a copy of Trading Tick’s private PHP or database implementation.

## Run locally

Requires Node.js 18 or newer. No npm packages are needed.

```bash
npm start
```

Open `http://localhost:4173`. The server binds to `0.0.0.0`, serves the registered website routes from `assets/site-pages.json`, and provides same-origin API routes. `PORT` can be overridden.

## Pages and interactions

- The top navigation and quick-link bar follow the public site's visible menu. A collapsible left sidebar includes the site's Nifty, Bank Nifty, Sensex, futures/OI, history, research, stock, backtest, tools and Contact sections. The sidebar starts collapsed to preserve the wide screenshot content; use the hamburger to open it.
- The Nifty PCR page has symbol, date, strike-range and interval filters, Indian-number formatting, and pagination.
- The Call vs Put OI page has index/date/six-strike controls, a six-series chart, timestamped rows and pagination. Its historical navigation strip appears between the chart and table, as in the supplied captures.
- Futures OI Buildup has symbol, expiry, date and interval controls with the screenshot-matched purple header, metadata strip and interpretation table.
- Other routes are separate pages with their own controls. Scenario/backtest pages calculate theoretical option payoff only; local calculators operate in the browser.
- Page-level Refresh buttons reload the selected page's endpoint. Dated samples are never described as verified live data.

## Data and important limitations

The original site's private database and PHP endpoints are not included. Historical examples saved in `data/` are dated public responses used to match the screenshots:

- `data/pcr-snapshot.json` — NIFTY W, 20 Nov 2026, 5-minute rows.
- `data/callput-snapshot.json` — NIFTY W, 20 Nov 2026, strikes 25750 / 25800 / 25850.
- `data/futures-snapshot.json` — NIFTY, 20 Nov 2026, expiry 23 Nov 2026, 10-minute rows.
- `data/market-snapshot.json` — earlier dated demo option-chain and index examples.

These are **demo samples, not a live feed or an endorsement of any signal**. Alternate dates/symbols without a matching saved sample show an unavailable state rather than invented values. Stock/screener pages and the original historical backtest/research database are not backed by the demo data. Calculator and strategy pages show user-input calculations only and do not recreate historical returns.

## API routes

JSON responses use `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.

- `GET /api/health` — server/data mode.
- `GET /api/oi-meta?symbol=NIFTY%20W` — supported demo or provider expiries.
- `GET /api/oi?symbol=NIFTY%20W&expiry=YYYY-MM-DD` — OI chain/strike snapshot.
- `GET /api/intraday?symbol=NIFTY` — intraday candles where the configured provider or local demo supports the symbol.
- `GET /api/futures` — aggregate buildup snapshot; it is demo data.
- `GET /api/demo/pcr?symbol=NIFTY%20W&date=2026-11-20` — dated PCR rows.
- `GET /api/demo/callput?symbol=NIFTY%20W&date=2026-11-20&strikes=25750,25800,25850,25750,25800,25850` — dated six-series Call vs Put example.
- `GET /api/demo/futures?symbol=NIFTY&date=2026-11-20&expiry=2026-11-23&interval=10min` — dated futures table.
- `GET /api/market-data` — combined snapshot for inspection.

## Optional Upstox adapter

An optional server-side read-only Upstox adapter remains in `upstox-provider.js`. If `UPSTOX_ACCESS_TOKEN` or `UPSTOX_ANALYTICS_TOKEN` is configured in the server environment, eligible `/api/oi`, `/api/oi-meta` and `/api/intraday` calls can use the provider. Credentials are not sent to the browser. This does **not** convert the saved historical PCR, Call vs Put OI, or futures tables to a live feed; those routes remain explicitly dated samples unless a separately authorized historical source is implemented.

For Render, use the supplied `render.yaml` Blueprint or configure a Node Web Service with `npm start`. Store any provider token only in Render's environment settings. Never put credentials in frontend files or commit them to source control.

## Safety and attribution

This clone is for software demonstration and educational analytics only, not investment advice or an order-entry system. Follow provider access, licensing and rate-limit terms. The Trading Tick name and screenshots are used here as the user's requested visual reference; the original private backend is not included.
