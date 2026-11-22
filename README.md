# Tick Market Dashboard

A close rebuild of the public TradingTick homepage layout, with a same-origin API, a 60-second auto-refresh, and an optional **server-side Upstox read-only market-data adapter**. It does not include the original site's private PHP/database code.

## Run locally

Requires Node.js 18 or newer. No npm packages are needed.

```bash
npm start
```

Open `http://localhost:4173`. The server binds to `0.0.0.0` and serves both the site and its API.

## Deploy on Render

1. Push this project to a GitHub repository you control.
2. In Render, create a **Blueprint** from that repository; Render will read `render.yaml`. You can also create a Node Web Service with `npm install --omit=dev` as the build command and `npm start` as the start command.
3. In the Render service's **Environment** settings, add `UPSTOX_ANALYTICS_TOKEN` and paste the analytics token there. Do not put the token into `index.html`, `assets/app.js`, `data/market-snapshot.json`, or GitHub.
4. Deploy, then open `/api/health`. For a data test, open `/api/oi-meta?symbol=NIFTY%20W` and check the Render logs if Upstox rejects the request.

The server reads `PORT` from Render automatically. `.gitignore` excludes local `.env` files. `UPSTOX_ACCESS_TOKEN` is also accepted as an alternate name.

## Upstox integration

When a token is configured, the server makes requests from the backend (the browser never sees the token):

- Option contracts and expiries: Upstox `/v2/option/contract`.
- Call/put OI chain: Upstox `/v2/option/chain`.
- Intraday chart: Upstox V3 intraday candles and market quotes. On weekends/holidays, the adapter tries the latest trading session; if Upstox has no candles, the API falls back to the clearly marked demo series instead of taking the whole dashboard offline.

The active option-chain and intraday cards use the Upstox API. **The futures buildup card remains DEMO** until a futures instrument/contract data source is configured; the dashboard marks this as `MIXED` instead of presenting it as fully live. Demo mode uses the dated sample in `data/market-snapshot.json` (latest sample timestamp: 2026-11-20).

Upstox documents that a standard access token expires at **3:30 AM the following day**; if yours is that token type, you will need to refresh the Render environment secret when it expires. An extended/read-only token may have different validity and permissions—confirm that it can access the option-chain and market-data endpoints. See the official docs: [Option Chain](https://upstox.com/developer/api-documentation/get-pc-option-chain/), [Option Contracts](https://upstox.com/developer/api-documentation/get-option-contracts/), [Intraday Candle V3](https://upstox.com/developer/api-documentation/v3/get-intra-day-candle-data/), and [Get Token](https://upstox.com/developer/api-documentation/get-token/).

## Auto-refresh

- Default polling interval: **60 seconds**.
- Toolbar choices: 30 seconds, 1 minute, or 5 minutes; pause/resume and manual refresh are available.
- Refresh uses same-origin `fetch()` calls and updates the dashboard without reloading the page.
- The page shows the source snapshot time separately from the time the API was checked.

## API routes

JSON responses use `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.

- `GET /api/health` — server/data mode.
- `GET /api/oi-meta?symbol=NIFTY%20W` — supported expiries.
- `GET /api/oi?symbol=NIFTY%20W&expiry=YYYY-MM-DD` — option chain, OI totals, and strike rows.
- `GET /api/intraday?symbol=NIFTY` — index candles and current-session summary.
- `GET /api/futures` — futures buildup (currently demo data).
- `GET /api/market-data` — combined demo snapshot for inspection.

## Important

This dashboard is for software demonstration and analytics only, not investment advice or an order-entry system. Use an authorized Upstox token and follow the provider's access, data-licensing, and rate-limit terms. Never share your token in chat or commit it to source control.
