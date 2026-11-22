'use strict';

/*
 * TradingTick-style dashboard API.
 *
 * Serves a dated demo snapshot by default. If UPSTOX_ACCESS_TOKEN (or
 * UPSTOX_ANALYTICS_TOKEN) is present in the server environment, read-only
 * Upstox market-data routes are enabled. Credentials never go to the browser.
 * The original site's PHP/database implementation is private and is not copied.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const upstox = require('./upstox-provider');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const SNAPSHOT_PATH = path.join(ROOT, 'data', 'market-snapshot.json');
const SNAPSHOT = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
const MODE = 'demo';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function latestAsOf() {
  return Object.values(SNAPSHOT.OI_META)
    .map((item) => item.snapshot_time)
    .sort()
    .at(-1) || 'unknown';
}

/*
 * Provider boundary: replace this demo snapshot with an authorized provider.
 * Keep API keys on the server (environment variables), never in browser JS.
 * The frontend expects the same OI / intraday data shapes returned below.
 */
async function getSnapshot() {
  return SNAPSHOT;
}

function sendJson(res, status, payload, headOnly = false) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  res.end(headOnly ? undefined : body);
}

function sendError(res, status, message, extra = {}, mode = MODE) {
  sendJson(res, status, {
    status: 'error',
    mode,
    error: message,
    ...extra
  });
}

function getOiMeta(snapshot, url) {
  const symbol = url.searchParams.get('symbol') || 'NIFTY W';
  const record = snapshot.OI[symbol];
  if (!record) {
    return {
      status: 400,
      body: { status: 'error', mode: MODE, error: 'Unknown OI symbol', allowed_symbols: Object.keys(snapshot.OI) }
    };
  }
  return {
    status: 200,
    body: {
      status: 'ok',
      mode: MODE,
      symbols: Object.keys(snapshot.OI),
      expiries: [record.meta.expiry],
      default_expiry: record.meta.expiry,
      expiry_details: [{ expiry: record.meta.expiry, weekly: true }],
      meta: record.meta,
      fetched_at: new Date().toISOString()
    }
  };
}

function getOiData(snapshot, url) {
  const symbol = url.searchParams.get('symbol') || 'NIFTY W';
  const record = snapshot.OI[symbol];
  if (!record) {
    return {
      status: 400,
      body: { status: 'error', mode: MODE, error: 'Unknown OI symbol', allowed_symbols: Object.keys(snapshot.OI) }
    };
  }

  const expiry = url.searchParams.get('expiry') || record.meta.expiry;
  if (expiry !== record.meta.expiry) {
    return {
      status: 404,
      body: {
        status: 'error',
        mode: MODE,
        error: 'This demo snapshot does not contain the requested expiry.',
        symbol,
        requested_expiry: expiry,
        available_expiries: [record.meta.expiry]
      }
    };
  }

  return {
    status: 200,
    body: {
      status: 'ok',
      mode: MODE,
      as_of: record.meta.snapshot_time,
      fetched_at: new Date().toISOString(),
      meta: { ...record.meta, expiry },
      summary: record.baseSummary,
      strikes: record.strikes,
      insights: record.insights
    }
  };
}

function getIntradayData(snapshot, url) {
  const symbol = url.searchParams.get('symbol') || 'NIFTY';
  const record = snapshot.INTRADAY[symbol];
  if (!record) {
    return {
      status: 400,
      body: { status: 'error', mode: MODE, error: 'Unknown intraday symbol', allowed_symbols: Object.keys(snapshot.INTRADAY) }
    };
  }
  const current = record.prices[record.prices.length - 1];
  const previous = record.prev_close;
  return {
    status: 200,
    body: {
      success: true,
      mode: MODE,
      symbol,
      name: record.name,
      labels: record.labels,
      prices: record.prices,
      open: record.open,
      high: record.high,
      low: record.low,
      current_price: current,
      price_change: current - previous,
      percentage_change: previous ? ((current - previous) / previous) * 100 : 0,
      prev_close: previous,
      trading_date: record.trading_date,
      as_of: record.trading_date + ' ' + (record.labels.at(-1) || ''),
      fetched_at: new Date().toISOString()
    }
  };
}

async function handleUpstoxApi(url, res) {
  try {
    switch (url.pathname) {
      case '/api/health':
        return sendJson(res, 200, {
          status: 'ok',
          mode: 'upstox',
          token_configured: true,
          message: 'Upstox token is configured; provider calls are made server-side.'
        });
      case '/api/oi-meta': {
        const symbol = url.searchParams.get('symbol') || 'NIFTY W';
        return sendJson(res, 200, await upstox.getOiMeta(symbol));
      }
      case '/api/oi': {
        const symbol = url.searchParams.get('symbol') || 'NIFTY W';
        const expiry = url.searchParams.get('expiry') || '';
        return sendJson(res, 200, await upstox.getOiData(symbol, expiry));
      }
      case '/api/intraday': {
        const symbol = url.searchParams.get('symbol') || 'NIFTY';
        try {
          return sendJson(res, 200, await upstox.getIntradayData(symbol));
        } catch (error) {
          // A non-trading day or provider-specific index limitation should not
          // take the whole dashboard offline. Keep this panel clearly marked DEMO.
          console.error('Upstox intraday fallback:', error.message);
          const fallback = getIntradayData(SNAPSHOT, url).body;
          return sendJson(res, 200, {
            ...fallback,
            mode: 'demo',
            source: 'sample-fallback',
            warning: 'Upstox returned no intraday candles; showing the dated sample series.'
          });
        }
      }
      case '/api/futures':
        // This card remains labelled DEMO until a futures instrument feed is configured.
        return sendJson(res, 200, {
          status: 'ok',
          mode: 'demo',
          as_of: latestAsOf(),
          fetched_at: new Date().toISOString(),
          data: SNAPSHOT.BUILDUP
        });
      case '/api/market-data':
        return sendJson(res, 200, {
          status: 'ok',
          mode: 'mixed',
          as_of: latestAsOf(),
          fetched_at: new Date().toISOString(),
          message: 'Use /api/oi, /api/intraday, and /api/futures for per-widget source modes.',
          demo_futures: SNAPSHOT.BUILDUP
        });
      default:
        return sendError(res, 404, 'API route not found.', {}, 'upstox');
    }
  } catch (error) {
    console.error('Upstox API error:', error.message);
    const status = Number.isInteger(error.status) ? error.status : 502;
    return sendError(res, status, error.message || 'Upstox request failed.', {}, 'upstox');
  }
}

async function handleApi(url, res) {
  if (upstox.hasToken()) return handleUpstoxApi(url, res);

  const snapshot = await getSnapshot();
  let result;
  switch (url.pathname) {
    case '/api/health':
      result = {
        status: 200,
        body: {
          status: 'ok',
          mode: MODE,
          as_of: latestAsOf(),
          message: 'Demo snapshot API. Set UPSTOX_ACCESS_TOKEN in Render for Upstox data.'
        }
      };
      break;
    case '/api/oi-meta':
      result = getOiMeta(snapshot, url);
      break;
    case '/api/oi':
      result = getOiData(snapshot, url);
      break;
    case '/api/intraday':
      result = getIntradayData(snapshot, url);
      break;
    case '/api/futures':
      result = {
        status: 200,
        body: {
          status: 'ok',
          mode: MODE,
          as_of: latestAsOf(),
          fetched_at: new Date().toISOString(),
          data: snapshot.BUILDUP
        }
      };
      break;
    case '/api/market-data':
      result = {
        status: 200,
        body: {
          status: 'ok',
          mode: MODE,
          as_of: latestAsOf(),
          fetched_at: new Date().toISOString(),
          data: snapshot
        }
      };
      break;
    default:
      return sendError(res, 404, 'API route not found. See README.md for available endpoints.');
  }
  sendJson(res, result.status, result.body);
}

function serveStatic(pathname, res, headOnly = false) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendError(res, 400, 'Invalid URL path.');
  }

  if (decoded !== '/' && decoded !== '/index.html' && !decoded.startsWith('/assets/')) {
    return sendError(res, 404, 'File not found.');
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relative);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return sendError(res, 403, 'Forbidden.');
  }

  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) return sendError(res, 404, 'File not found.');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    if (headOnly) return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  } catch {
    return sendError(res, 400, 'Invalid request URL.');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendError(res, 405, 'Only GET and HEAD are supported.');
  }
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'HEAD') return sendJson(res, 200, { status: 'ok' }, true);
    handleApi(url, res).catch((error) => {
      console.error('API error:', error);
      sendError(res, 500, 'Internal API error.');
    });
    return;
  }
  serveStatic(url.pathname, res, req.method === 'HEAD');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard ready on http://0.0.0.0:${PORT}`);
  console.log(`Data mode: ${upstox.hasToken() ? 'upstox' : MODE}; latest sample timestamp: ${latestAsOf()}`);
});
