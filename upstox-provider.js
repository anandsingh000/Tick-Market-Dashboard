'use strict';

/* Upstox read-only market-data adapter. Tokens are read only from Render/server env. */
const BASE_URL = 'https://api.upstox.com';
const TIMEOUT_MS = 9000;
const TOKEN_ENV_NAMES = ['UPSTOX_ACCESS_TOKEN', 'UPSTOX_ANALYTICS_TOKEN'];

const OI_UNDERLYINGS = {
  'NIFTY W': 'NSE_INDEX|Nifty 50',
  'NIFTY WN': 'NSE_INDEX|Nifty 50',
  'NIFTY M': 'NSE_INDEX|Nifty 50',
  'BANKNIFTY': 'NSE_INDEX|Nifty Bank'
};

const INTRADAY_INSTRUMENTS = {
  'NIFTY': { key: 'NSE_INDEX|Nifty 50', name: 'NIFTY 50' },
  'BANKNIFTY': { key: 'NSE_INDEX|Nifty Bank', name: 'BANK NIFTY' },
  'FINNIFTY': { key: 'NSE_INDEX|Nifty Fin Service', name: 'FIN NIFTY' },
  'MIDCPNIFTY': { key: 'NSE_INDEX|Nifty Midcap Select', name: 'MIDCAP NIFTY' },
  'NIFTYNXT50': { key: 'NSE_INDEX|Nifty Next 50', name: 'NIFTY NEXT 50' }
};

const contractCache = new Map();
const CONTRACT_TTL_MS = 5 * 60 * 1000;

class UpstoxError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'UpstoxError';
    this.status = status;
  }
}

function getToken() {
  for (const name of TOKEN_ENV_NAMES) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return '';
}

function hasToken() {
  return Boolean(getToken());
}

function indiaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function indiaTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

async function apiGet(endpoint, params = {}) {
  const token = getToken();
  if (!token) throw new UpstoxError('Set UPSTOX_ACCESS_TOKEN in Render environment variables.', 503);

  const url = new URL(endpoint, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      signal: controller.signal
    });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = null; }

    if (!response.ok) {
      if (response.status === 401) {
        throw new UpstoxError('Upstox rejected the token (401). Refresh the token in Render.', 502);
      }
      if (response.status === 403) {
        throw new UpstoxError('Upstox denied this data endpoint (403). Check token permissions and market-data access.', 502);
      }
      if (response.status === 429) {
        throw new UpstoxError('Upstox rate limit reached. Wait before retrying.', 429);
      }
      throw new UpstoxError(`Upstox API returned HTTP ${response.status}.`, 502);
    }
    if (!payload || payload.status === 'error') {
      throw new UpstoxError('Upstox returned an unreadable or error response.', 502);
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new UpstoxError('Upstox request timed out. Try again shortly.', 504);
    if (error instanceof UpstoxError) throw error;
    throw new UpstoxError('Could not reach Upstox. Check the server network and token.', 502);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeContracts(payload) {
  const records = Array.isArray(payload && payload.data) ? payload.data : [];
  const unique = new Map();
  for (const row of records) {
    if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.expiry || '')) continue;
    const old = unique.get(row.expiry) || { expiry: row.expiry, weekly: Boolean(row.weekly) };
    old.weekly = old.weekly || Boolean(row.weekly);
    unique.set(row.expiry, old);
  }
  return Array.from(unique.values()).sort((a, b) => a.expiry.localeCompare(b.expiry));
}

async function getContracts(symbol) {
  const key = OI_UNDERLYINGS[symbol];
  if (!key) throw new UpstoxError('Unknown option-chain symbol.', 400);
  const cached = contractCache.get(symbol);
  if (cached && (Date.now() - cached.savedAt) < CONTRACT_TTL_MS) return cached.contracts;
  const payload = await apiGet('/v2/option/contract', { instrument_key: key });
  const contracts = normalizeContracts(payload);
  if (!contracts.length) throw new UpstoxError('Upstox returned no active option expiries for this symbol.', 502);
  contractCache.set(symbol, { savedAt: Date.now(), contracts });
  return contracts;
}

function chooseExpiry(symbol, contracts) {
  const today = indiaDate();
  const active = contracts.filter((item) => item.expiry >= today);
  const list = active.length ? active : contracts;
  const weekly = list.filter((item) => item.weekly);
  const monthly = list.filter((item) => !item.weekly);
  if (symbol === 'NIFTY M') return (monthly[0] || list[0]).expiry;
  if (symbol === 'NIFTY WN') return (weekly[1] || weekly[0] || list[1] || list[0]).expiry;
  return (weekly[0] || list[0]).expiry;
}

async function getOiMeta(symbol) {
  const contracts = await getContracts(symbol);
  const expiryList = contracts.map((item) => item.expiry);
  const defaultExpiry = chooseExpiry(symbol, contracts);
  return {
    status: 'ok',
    mode: 'live',
    symbol,
    symbols: Object.keys(OI_UNDERLYINGS),
    expiries: expiryList,
    expiry_details: contracts,
    default_expiry: defaultExpiry,
    meta: { symbol, expiry: defaultExpiry },
    fetched_at: new Date().toISOString()
  };
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function optionMarketData(option) {
  return option && option.market_data ? option.market_data : {};
}

function calcPcr(putOi, callOi) {
  return callOi > 0 ? putOi / callOi : null;
}

function sentiment(pcr) {
  if (pcr == null) return 'Unavailable';
  if (pcr >= 1.5) return 'Strong Bullish';
  if (pcr >= 1.1) return 'Bullish';
  if (pcr >= 0.9) return 'Neutral';
  if (pcr >= 0.6) return 'Bearish';
  return 'Strong Bearish';
}

async function getOiData(symbol, requestedExpiry) {
  const underlyingKey = OI_UNDERLYINGS[symbol];
  if (!underlyingKey) throw new UpstoxError('Unknown option-chain symbol.', 400);
  const contracts = await getContracts(symbol);
  const expiry = requestedExpiry || chooseExpiry(symbol, contracts);
  if (!contracts.some((item) => item.expiry === expiry)) {
    throw new UpstoxError(`Expiry ${expiry} is not available for ${symbol}. Reload the expiry list.`, 400);
  }

  const payload = await apiGet('/v2/option/chain', {
    instrument_key: underlyingKey,
    expiry_date: expiry
  });
  const rawRows = Array.isArray(payload && payload.data) ? payload.data : [];
  if (!rawRows.length) throw new UpstoxError('Upstox returned an empty option chain for this expiry.', 502);

  const rows = rawRows.map((row) => {
    const call = optionMarketData(row.call_options);
    const put = optionMarketData(row.put_options);
    const ceOi = number(call.oi);
    const peOi = number(put.oi);
    const cePrevOi = number(call.prev_oi);
    const pePrevOi = number(put.prev_oi);
    const ceLtp = number(call.ltp);
    const peLtp = number(put.ltp);
    const ceClose = number(call.close_price);
    const peClose = number(put.close_price);
    const strike = number(row.strike_price);
    return {
      strike,
      is_atm: false,
      ce_oi: ceOi,
      call_oi_change: ceOi - cePrevOi,
      ce_ltp: ceLtp,
      ce_change: ceLtp - ceClose,
      ce_volume: number(call.volume),
      pe_oi: peOi,
      pe_oi_change: peOi - pePrevOi,
      pe_ltp: peLtp,
      pe_change: peLtp - peClose,
      pe_volume: number(put.volume),
      pcr: calcPcr(peOi, ceOi),
      sentiment_label: sentiment(calcPcr(peOi, ceOi)),
      sentiment_css: peOi / Math.max(1, ceOi) >= 1 ? 'badge-soft-success' : 'badge-soft-danger'
    };
  }).sort((a, b) => a.strike - b.strike);

  const spot = number(rawRows.find((row) => row.underlying_spot_price != null)?.underlying_spot_price);
  const atmRow = rows.reduce((best, row) => Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? row : best, rows[0]);
  rows.forEach((row) => { row.is_atm = row.strike === atmRow.strike; });

  const totalCallOi = rows.reduce((sum, row) => sum + row.ce_oi, 0);
  const totalPutOi = rows.reduce((sum, row) => sum + row.pe_oi, 0);
  const callOiChange = rows.reduce((sum, row) => sum + row.call_oi_change, 0);
  const putOiChange = rows.reduce((sum, row) => sum + row.pe_oi_change, 0);
  const maxCall = rows.reduce((a, b) => b.ce_oi > a.ce_oi ? b : a, rows[0]);
  const maxPut = rows.reduce((a, b) => b.pe_oi > a.pe_oi ? b : a, rows[0]);
  const maxCallChange = rows.reduce((a, b) => b.call_oi_change > a.call_oi_change ? b : a, rows[0]);
  const maxPutChange = rows.reduce((a, b) => b.pe_oi_change > a.pe_oi_change ? b : a, rows[0]);
  const overallPcr = calcPcr(totalPutOi, totalCallOi);
  const changePcr = callOiChange !== 0 ? putOiChange / callOiChange : null;
  const snapshotTime = indiaTimestamp();
  const summary = {
    total_call_oi: totalCallOi,
    total_put_oi: totalPutOi,
    overall_pcr: overallPcr,
    oi_change_pcr: changePcr,
    call_oi_change_abs: callOiChange,
    put_oi_change_abs: putOiChange,
    max_call_oi_strike: maxCall.strike,
    max_call_oi_value: maxCall.ce_oi,
    max_put_oi_strike: maxPut.strike,
    max_put_oi_value: maxPut.pe_oi,
    max_call_oi_chg_strike: maxCallChange.strike,
    max_call_oi_chg_value: maxCallChange.call_oi_change,
    max_put_oi_chg_strike: maxPutChange.strike,
    max_put_oi_chg_value: maxPutChange.pe_oi_change
  };
  const meta = {
    symbol,
    expiry,
    spot,
    atm: atmRow.strike,
    snapshot_time: snapshotTime,
    snapshot_id: `${symbol}-${Date.now()}`,
    server_time: snapshotTime
  };

  return {
    status: 'ok',
    mode: 'live',
    as_of: snapshotTime,
    fetched_at: new Date().toISOString(),
    meta,
    summary,
    strikes: rows,
    insights: {
      put_support: `Largest Put OI at ${maxPut.strike} (${Math.round(maxPut.pe_oi).toLocaleString('en-IN')}).`,
      call_resist: `Largest Call OI at ${maxCall.strike} (${Math.round(maxCall.ce_oi).toLocaleString('en-IN')}).`,
      bias: overallPcr >= 1 ? 'Put OI is higher than Call OI.' : 'Call OI is higher than Put OI.'
    }
  };
}

async function getIntradayData(symbol) {
  const instrument = INTRADAY_INSTRUMENTS[symbol];
  if (!instrument) throw new UpstoxError('Unknown intraday index.', 400);
  const encodedKey = encodeURIComponent(instrument.key);
  const candlePath = `/v3/historical-candle/intraday/${encodedKey}/minutes/1`;
  const candlePayload = await apiGet(candlePath);
  const rawCandles = candlePayload && candlePayload.data && candlePayload.data.candles;
  if (!Array.isArray(rawCandles) || !rawCandles.length) {
    throw new UpstoxError('Upstox did not return intraday candles for this index.', 502);
  }

  const candles = rawCandles.slice().sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
  const visible = candles.slice(-75);
  const labels = visible.map((candle) => new Date(candle[0]).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false
  }));
  const prices = visible.map((candle) => number(candle[4]));
  const open = number(candles[0][1]);
  const high = Math.max(...candles.map((candle) => number(candle[2])));
  const low = Math.min(...candles.map((candle) => number(candle[3])));
  const current = prices[prices.length - 1];

  let previousClose = 0;
  try {
    const quotePayload = await apiGet('/v3/market-quote/quotes', { instrument_key: instrument.key });
    const quoteMap = quotePayload && quotePayload.data ? quotePayload.data : {};
    const quote = quoteMap[instrument.key.replace('|', ':')] || Object.values(quoteMap)[0] || {};
    previousClose = number(quote.prev_close_price || (quote.ohlc && quote.ohlc.close));
  } catch {
    // Candles can still render if the separate quote call is temporarily unavailable.
  }

  const priceChange = previousClose > 0 ? current - previousClose : 0;
  return {
    success: true,
    mode: 'live',
    symbol,
    name: instrument.name,
    labels,
    prices,
    open,
    high,
    low,
    current_price: current,
    price_change: priceChange,
    percentage_change: previousClose > 0 ? (priceChange / previousClose) * 100 : 0,
    prev_close: previousClose,
    trading_date: candles[candles.length - 1][0].slice(0, 10),
    as_of: candles[candles.length - 1][0],
    fetched_at: new Date().toISOString()
  };
}

module.exports = {
  hasToken,
  getOiMeta,
  getOiData,
  getIntradayData,
  UpstoxError
};
