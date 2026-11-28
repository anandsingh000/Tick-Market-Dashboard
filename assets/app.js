'use strict';

/* Trading Tick clone front-end. Historical examples are explicitly dated demo samples. */
const DATE_SAMPLE = '2026-11-20';
const ROWS_PER_PAGE = 20;
const INDIA = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
let SITE = null;
let currentPage = null;
let activePageRefresh = async () => {};
let activeChart = null;
let currentPcrRows = [];
let currentCallput = null;
let currentFutures = null;
let toolbarInterval = 60;
let toolbarRemaining = 60;
let toolbarPaused = false;
let toolbarTimer = null;
let refreshBusy = false;

const byId = (id) => document.getElementById(id);
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtInt = (value) => Number.isFinite(Number(value)) ? INDIA.format(Number(value)) : '—';
const fmtNum = (value, decimals = 2) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-IN', {minimumFractionDigits: decimals, maximumFractionDigits: decimals}).format(Number(value)) : '—';
const num = (value) => {
  if (typeof value === 'number') return value;
  const parsed = Number(String(value ?? '').replace(/,/g, '').replace(/[^\d.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : NaN;
};
const getPath = () => {
  try { return decodeURIComponent(window.location.pathname); } catch { return window.location.pathname; }
};

async function getJSON(url) {
  const response = await fetch(url, {headers: {'Accept':'application/json'}, cache:'no-store'});
  let data;
  try { data = await response.json(); } catch { throw new Error('The server returned an unreadable response.'); }
  if (!response.ok && !data.mode) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function setSource(mode, description) {
  const pill = byId('modePill');
  const text = byId('modeText');
  const desc = byId('modeDescription');
  const brand = byId('brandMode');
  const key = String(mode || 'demo').toLowerCase();
  let label = 'DEMO DATA';
  if (['live','upstox','market-live'].includes(key)) label = key === 'upstox' ? 'UPSTOX LIVE' : 'LIVE';
  else if (key === 'mixed') label = 'MIXED DATA';
  else if (key === 'unavailable') label = 'UNAVAILABLE';
  if (text) text.textContent = label;
  if (desc) desc.textContent = description || (key === 'unavailable' ? 'No matching data source or dated local sample is available.' : 'Dated public sample · not a verified live feed.');
  if (pill) {
    pill.classList.toggle('mode-live', ['live','upstox','market-live'].includes(key));
    pill.classList.toggle('mode-unavailable', key === 'unavailable');
  }
  if (brand) brand.textContent = label === 'UPSTOX LIVE' ? 'UPSTOX' : label.replace(' DATA','');
}

function navAnchor(item, extraClass='') {
  if (item.disabled) return `<span class="nav-disabled" aria-disabled="true">${esc(item.label)}</span>`;
  const ext = item.external || /^https:\/\//i.test(item.href || '');
  return `<a class="${extraClass}" href="${esc(item.href || '#')}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(item.label)}</a>`;
}

function buildNavigation() {
  const mainNav = byId('mainNav');
  if (!mainNav || !SITE) return;
  mainNav.innerHTML = (SITE.navigation || []).map((group) => {
    if (!group.items || group.items.length === 0) return `<a class="nav-simple" href="/">${esc(group.label)}</a>`;
    return `<details class="nav-group" data-group="${esc(group.label)}"><summary>${esc(group.label)} <span class="chevron">▾</span></summary><div class="nav-dropdown">${group.items.map((item) => navAnchor(item)).join('')}</div></details>`;
  }).join('');
  const secondary = byId('secondaryNav');
  if (secondary) {
    const shortcuts = [...(SITE.externalLinks || []), ...(SITE.secondaryNavigation || [])];
    secondary.innerHTML = shortcuts.map((item) => {
      const ext = /^https:\/\//i.test(item.href || '');
      return `<a href="${esc(item.href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(item.label)}</a>`;
    }).join('');
  }
  buildSidebar();
  const menuToggle = byId('menuToggle');
  if (menuToggle) menuToggle.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('toggle-sidebar');
    menuToggle.setAttribute('aria-expanded', String(!collapsed));
    menuToggle.setAttribute('aria-label', collapsed ? 'Open sidebar' : 'Close sidebar');
    menuToggle.querySelector('span').textContent = collapsed ? '☰' : '×';
  });
  mainNav.addEventListener('toggle', (event) => {
    const opened = event.target;
    if (opened.tagName === 'DETAILS' && opened.open) {
      mainNav.querySelectorAll('details[open]').forEach((other) => { if (other !== opened) other.open = false; });
    }
  }, true);
  document.addEventListener('click', (event) => {
    if (!mainNav.contains(event.target)) mainNav.querySelectorAll('details[open]').forEach((d) => { d.open = false; });
  });
}

function buildSidebar() {
  const host=byId('sidebarNav');
  if(!host||!SITE)return;
  const path=getPath();
  const quick=(SITE.quickLinks||[]).map((item)=>`<li class="sidebar-top-item">${navAnchor(item,`side-top-link${item.href===path?' active':''}`)}</li>`).join('');
  const groups=(SITE.sidebarNavigation||[]).map((group,index)=>{
    if(group.href) return `<li class="sidebar-top-item">${navAnchor(group,`side-top-link${group.href===path?' active':''}`)}</li>`;
    const items=(group.items||[]).map((item)=>{
      const active=item.href===path;
      return `<div class="sidebar-content-item">${navAnchor(item,`side-page-link${active?' active':''}`)}</div>`;
    }).join('');
    const open=(group.items||[]).some(item=>item.href===path);
    return `<li class="sidebar-group"><details${open?' open':''}><summary><span class="side-icon" style="color:${esc(group.color||'#4154f1')}">${esc(group.icon||'•')}</span><span class="side-group-name">${esc(group.label)}</span><span class="side-chevron">⌄</span></summary><div class="sidebar-content">${items}</div></details></li>`;
  }).join('');
  host.innerHTML=quick+groups;
  host.querySelectorAll('.sidebar-group details').forEach((detail)=>detail.addEventListener('toggle',()=>{
    if(detail.open)host.querySelectorAll('.sidebar-group details[open]').forEach(other=>{if(other!==detail)other.open=false;});
  }));
}

function breadcrumb(page) {
  const market = page.market || 'Market data';
  return `<div class="breadcrumbs"><a href="/">Home</a> <span>›</span> ${esc(market)} <span>›</span> ${esc(page.title)}</div>`;
}

function pageHeading(page, subtitle='') {
  return `<div class="page-heading"><div class="heading-row"><div>${breadcrumb(page)}<h1>${esc(page.title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><span class="source-badge" id="pageSourceBadge">DEMO SAMPLE</span></div></div>`;
}

function compactHeading(page, titleOverride, subtitle='') {
  const title = titleOverride || page.title;
  return `<div class="page-heading compact-heading"><div class="heading-row"><div>${breadcrumb(page)}<h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><span class="source-badge" id="pageSourceBadge">DEMO SAMPLE</span></div></div>`;
}

function historyFeatureNav() {
  const links = [
    ['▶','Option Simulator','/nifty/nifty-option-simulator-free.php'],
    ['◢','Historical CE vs PE OI','/nifty/nifty-historical-call-vs-put-oi-charts.php'],
    ['◎','Max Pain History','/max-pain-today/'],
    ['⬇','Old Option Chain','/nifty/download-nifty-option-chain-historical-data.php'],
    ['↗','Old OI Charts','/nifty/nifty-compare-oi-with-previous-expiry.php'],
    ['ϟ','Old IV Charts','/nifty/nifty-standard-deviation-and-volatality.php'],
    ['⇄','Compare Expiry OI','/nifty/nifty-compare-oi-with-previous-expiry.php'],
    ['◆','Compare Option Price','/nifty/nifty-compare-option-price-with-previous-expiry'],
    ['♥','Historical PCR Data','/nifty/nifty-banknifty-finnifty-intraday-pcr-live.php'],
    ['◫','Futures Basis History','/futures/future-oi-analysis.php'],
    ['⬆','Buy & Hold Call Option','/nifty/nifty-buy-and-hold-call-option-until-expiry.php'],
    ['⬇','Buy & Hold Put Option','/nifty/nifty-buy-and-hold-put-option-until-expiry.php']
  ];
  return `<div class="historical-tag">NIFTY HISTORICAL F&amp;O</div><nav class="feature-strip" aria-label="Nifty historical F&O pages">${links.map(([icon,label,href]) => `<a href="${esc(href)}"><span class="feature-icon">${esc(icon)}</span><span>${esc(label)}</span></a>`).join('')}</nav>`;
}

function sourceNote(text='Dated public sample; this is not a verified live feed.') {
  return `<div class="source-note" id="sourceNote">${esc(text)}</div>`;
}

function featureCard(label, title, text, href, eyebrow='MARKET ANALYTICS') {
  return `<a class="feature-card" href="${esc(href)}"><span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(title)}</h2><p>${esc(text)}</p><span class="card-link">Open page →</span></a>`;
}

function renderHome(page) {
  const ext = (SITE.externalLinks || []).map((x) => `<a class="button light" href="${esc(x.href)}" target="_blank" rel="noopener noreferrer">${esc(x.label)} ↗</a>`).join('');
  return `<section class="home-hero"><div class="hero-kicker">TRADING TICK · OPTION & FUTURES ANALYTICS</div><h1>Market analysis, one page at a time.</h1><p>Explore Nifty and Sensex option data, futures OI, historical charts, research, strategy payoffs and trading tools. Each feature opens on its own page.</p><div class="hero-actions"><a class="button" href="/nifty/nifty-banknifty-finnifty-option-dashboard.php">Nifty Option Dashboard</a><a class="button orange" href="/futures/future-oi-analysis.php">Futures OI Analysis</a><a class="button light" href="/tools/index.php">Trading Tools</a></div></section>
    <div class="home-stats"><div><b>DEMO MODE</b><span>dated sample data</span></div><div><b>NIFTY · SENSEX</b><span>options & research</span></div><div><b>FUTURES</b><span>OI buildup analysis</span></div><div><b>TOOLS</b><span>calculators & scenarios</span></div></div>
    <section class="home-section"><div class="section-heading"><div><span class="eyebrow">QUICK ACCESS</span><h2>Popular market pages</h2></div><a href="/tools/index.php">Browse tools →</a></div><div class="card-grid">
      ${featureCard('NIFTY','Option Dashboard','Option analytics, OI summaries and index controls.','/nifty/nifty-banknifty-finnifty-option-dashboard.php','NIFTY')}
      ${featureCard('NIFTY','Live PCR','Historical intraday PCR table with date, range and interval controls.','/nifty/nifty-banknifty-finnifty-intraday-pcr-live.php','NIFTY')}
      ${featureCard('NIFTY','Call vs Put OI','Six-strike CE/PE comparison chart and timestamped table.','/nifty/nifty-banknifty-finnifty-call-vs-put-oi.php','NIFTY')}
      ${featureCard('BANK NIFTY','Open Interest Charts','Bank Nifty OI page with its own symbol and source status.','/banknifty/bank-nifty-open-interest-charts-live.php','BANK NIFTY')}
      ${featureCard('FUTURES','Futures OI Buildup','Symbol, expiry, date and interval filters with OI interpretation.','/futures/future-oi-analysis.php','FUTURES')}
      ${featureCard('SENSEX','Option Chain','Browse the Sensex option-chain page and its filters.','/sensex/bse-sensex-option-chain-live.php','SENSEX')}
      ${featureCard('RESEARCH','Zero to Hero','Nifty expiry-day history and research pages.','/nifty/nifty-expiry-day-historical-data-analysis.php','RESEARCH')}
      ${featureCard('STRATEGIES','Backtest Scenarios','Preview expiry payoff profiles for individual option strategies.','/nifty/option-backtesting/nifty-bull-call-spread-strategy-backtest-results.php','BACKTEST')}
      ${featureCard('STOCKS','Stock Option Chain','Open the stock options page; live stock-chain data is not bundled.','/stock/option-chain/','STOCKS')}
      ${featureCard('TOOLS','Trading Calculators','Position sizing, risk/reward, SIP, Gann and other calculators.','/tools/index.php','TOOLS')}
    </div></section><section class="panel home-disclaimer"><h2>Data note</h2><p>This is a local Trading Tick-style clone. The original private market-data database is not included. Saved historical rows are dated public examples (including 20 Nov 2026) and are labelled as demo; pages without a matching sample say so rather than inventing live values.</p></section><div class="external-home-links">${ext}</div>`;
}

function renderOverview(page) {
  if (page.market === 'Global') return renderGlobal(page);
  const sensex = page.market === 'Sensex';
  const prefix = sensex ? '/sensex/' : '/nifty/';
  const marketLabel = page.market || 'Nifty';
  const cards = sensex ? [
    featureCard('SENSEX','Option Chain','Individual option-chain page and local availability status.','/sensex/bse-sensex-option-chain-live.php','SENSEX'),
    featureCard('SENSEX','Live PCR','PCR page with date and symbol filters.','/sensex/bse-sensex-pcr-live.php','SENSEX'),
    featureCard('SENSEX','Option Screener','Screener controls; no verified local feed is included.','/sensex/bse-sensex-option-screener.php','SENSEX'),
    featureCard('SENSEX','Call vs Put OI','CE/PE OI comparison page.','/sensex/bse-sensex-call-vs-put-oi.php','SENSEX')
  ].join('') : [
    featureCard('OPTIONS','All Option Chain','Open the separate index option-chain page.','/option/all-option-chain-live.php','OPTIONS'),
    featureCard('PCR','Live PCR','Intraday PCR history, filters and pagination.','/nifty/nifty-banknifty-finnifty-intraday-pcr-live.php','NIFTY'),
    featureCard('OI','Call vs Put OI','Compare six CE/PE strike series over the session.','/nifty/nifty-banknifty-finnifty-call-vs-put-oi.php','NIFTY'),
    featureCard('OI','Trending OI','Review the dated option OI sample.','/nifty/nifty-banknifty-finnifty-trending-oi.php','NIFTY'),
    featureCard('OI','Highest OI','Open the separate highest-OI page.','/nifty/nifty-banknifty-finnifty-highest-oi.php','NIFTY'),
    featureCard('OI','Open Interest Charts','Chart the option OI snapshot by strike.','/nifty/nifty-banknifty-finnifty-open-interest-charts-live.php','NIFTY'),
    featureCard('OI','Multi Strike OI','Compare OI across selected strikes.','/nifty/nifty-banknifty-finnifty-multi-strike-oi.php','NIFTY')
  ].join('');
  return `${pageHeading(page, `${marketLabel} analytics and separate research pages.`)}<div class="source-note">A page index only—each feature opens separately. Market values shown by individual pages are labelled with their source mode and as-of date.</div><div class="card-grid">${cards}</div><div class="page-subnav"><a href="${prefix}">Market home</a><a href="/futures/future-oi-analysis.php">Futures OI</a><a href="/contact-us.php">Contact</a></div>`;
}

function renderPCR(page) {
  const heading = page.market === 'Sensex' ? 'Sensex PCR Live Data Today' : page.market === 'Bank Nifty' ? 'Bank Nifty PCR Live Data Today' : 'Nifty Nse Pcr Live Data Today';
  const symbols = ['NIFTY W','BANKNIFTY','NIFTY M','FINNIFTY'];
  const selected = page.symbol || 'NIFTY W';
  return `${compactHeading(page, heading)}${historyFeatureNav()}<div class="control-row pcr-controls">
    <div class="control"><label for="pcrSymbol">INDEX</label><select id="pcrSymbol">${symbols.map((s) => `<option value="${s}"${s===selected?' selected':''}>${s==='NIFTY W'?'NIFTY WEEKLY':esc(s)}</option>`).join('')}</select></div>
    <div class="control"><label for="pcrRange">STRIKE RANGE</label><select id="pcrRange"><option value="6" selected>6 Strikes</option><option value="8">8 Strikes</option><option value="10">10 Strikes</option><option value="12">12 Strikes</option></select></div>
    <div class="control"><label for="pcrInterval">INTERVAL</label><select id="pcrInterval"><option value="5" selected>5 Minutes</option><option value="15">15 Minutes</option><option value="30">30 Minutes</option><option value="60">60 Minutes</option></select></div>
    <div class="control"><label for="pcrDate">DATE</label><input id="pcrDate" type="date" value="${DATE_SAMPLE}" max="${DATE_SAMPLE}"></div>
    <button class="button" id="pcrApply" type="button">Refresh</button>
  </div><div id="pcrMessage"></div><h2 class="page-section-title">${esc(heading)}</h2><div class="table-wrap" id="pcrTableHost"></div><div class="pagination" id="pcrPagination"></div><div class="pagination-note" id="pcrPaginationNote"></div>${sourceNote('Dated public sample · 20 Nov 2026 · 5-minute source rows · not a verified live feed.')}`;
}

function renderCallput(page) {
  const selected = page.symbol || 'NIFTY W';
  const strikes = [25750,25800,25850];
  return `${compactHeading(page,'Trading Tick Call vs Put OI Charts Live')}<section class="panel callput-panel"><div class="control-row call-control-row">
    <div class="control"><label for="cpSymbol">INDEX</label><select id="cpSymbol"><option value="NIFTY W"${selected==='NIFTY W'?' selected':''}>NIFTY WEEKLY</option><option value="BANKNIFTY"${selected==='BANKNIFTY'?' selected':''}>BANKNIFTY</option><option value="FINNIFTY"${selected==='FINNIFTY'?' selected':''}>FINNIFTY</option><option value="NIFTY M"${selected==='NIFTY M'?' selected':''}>NIFTY MONTHLY</option><option value="SENSEX"${selected==='SENSEX'?' selected':''}>SENSEX</option></select></div>
    <div class="control"><label for="cpDate">DATE</label><input id="cpDate" type="date" value="${DATE_SAMPLE}" max="${DATE_SAMPLE}"></div>
  </div><div class="select-strikes">${['CE','CE','CE','PE','PE','PE'].map((side,i)=>`<div class="control"><label for="cp${side}${i%3+1}">${side} STRIKE ${i%3+1}</label><input id="cp${side}${i%3+1}" type="number" value="${strikes[i%3]}" step="50"></div>`).join('')}</div><button class="button" type="button" id="cpApply">Refresh Chart &amp; Table</button>
    <h2 class="callput-chart-title"><span class="emoji">📊</span>OI Change - CE &amp; PE (6 Strikes Comparison)</h2><div id="cpMessage"></div><div class="chart-panel"><canvas id="cpChart" aria-label="Call and put open interest comparison chart"></canvas></div>
  </section>${historyFeatureNav()}<h2 class="page-section-title">Trading Tick Call vs Put OI Data Live</h2><div class="table-wrap" id="cpTableHost"></div><div class="pagination" id="cpPagination"></div><div class="pagination-note" id="cpPaginationNote"></div>${sourceNote('Dated public sample · NIFTY W · 20 Nov 2026 · strikes 25750 / 25800 / 25850 · not a verified live feed.')}`;
}

function renderFutures(page) {
  const symbol = page.symbol || 'NIFTY';
  return `<div class="futures-page"><section class="futures-banner"><span class="futures-banner-icon">↗</span><h1>Futures BUILTUP Analysis</h1><span class="trading-day-badge">● Trading Day</span></section>
    <div class="control-row futures-controls"><div class="control"><label for="futSymbol">SYMBOL</label><select id="futSymbol"><option value="NIFTY"${symbol==='NIFTY'?' selected':''}>NIFTY</option><option value="BANKNIFTY">BANKNIFTY</option><option value="FINNIFTY">FINNIFTY</option></select></div><div class="control"><label for="futExpiry">EXPIRY</label><select id="futExpiry"><option value="2026-11-23" selected>Mon, 23 Nov, 2026</option><option value="2026-12-29">Tue, 29 Dec, 2026</option><option value="2027-01-25">Mon, 25 Jan, 2027</option></select></div><div class="control"><label for="futDate">DATE</label><input id="futDate" type="date" value="${DATE_SAMPLE}" max="${DATE_SAMPLE}"></div><div class="control"><label for="futInterval">INTERVAL</label><select id="futInterval"><option value="10min" selected>10 Minutes</option><option value="30min">30 Minutes</option><option value="1hour">1 Hour</option></select></div><button class="button futures-refresh" type="button" id="futApply">↻ &nbsp;Refresh</button></div>
    <div class="futures-meta" id="futMeta">▦ &nbsp; 20 Nov 2026 &nbsp;　 ◇ &nbsp; NIFTY &nbsp;　 ▢ &nbsp; Expiry: 23 Nov 2026 &nbsp;　 ◷ &nbsp; 10 min</div><div id="futMessage"></div><div class="table-wrap"><table class="data-table futures-table"><thead><tr><th>Time</th><th>Symbol</th><th>LTP</th><th>Change</th><th>OI</th><th>OI Change</th><th>Interpretation</th></tr></thead><tbody id="futRows"><tr><td colspan="7" class="muted">Loading sample…</td></tr></tbody></table></div><div class="data-stamp" id="futStamp"></div></div>`;
}

function renderIntraday(page) {
  const symbols = ['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','NIFTYNXT50','SENSEX'];
  const selected = page.symbol || 'NIFTY';
  return `${pageHeading(page,'Intraday index chart and session OHLC context.')}${sourceNote()}<div class="control-row"><div class="control"><label for="intraSymbol">INDEX</label><select id="intraSymbol">${symbols.map((s)=>`<option value="${s}"${s===selected?' selected':''}>${s}</option>`).join('')}</select></div><div class="control"><label for="intraDate">TRADING DATE</label><input id="intraDate" type="date" value="${DATE_SAMPLE}" max="${DATE_SAMPLE}"></div><button class="button" type="button" id="intraApply">Load Chart</button></div><div id="intraMessage"></div><div class="summary-grid" id="intraStats"></div><div class="panel"><h2 class="panel-title">${esc(page.market || 'Index')} Intraday Price</h2><div class="chart-panel"><canvas id="intraChart"></canvas></div></div>`;
}

function renderOIChart(page) {
  const selected=page.symbol||'NIFTY W';
  return `${pageHeading(page,'Open interest distribution by strike from the dated snapshot.')}${historyFeatureNav()}<div class="control-row"><div class="control"><label for="oiSymbol">INDEX</label><select id="oiSymbol"><option value="NIFTY W"${selected==='NIFTY W'?' selected':''}>NIFTY WEEKLY</option><option value="BANKNIFTY"${selected==='BANKNIFTY'?' selected':''}>BANKNIFTY</option><option value="NIFTY M">NIFTY MONTHLY</option><option value="SENSEX">SENSEX</option></select></div><div class="control"><label for="oiExpiry">EXPIRY</label><select id="oiExpiry"><option value="2026-11-23">23 Nov 2026</option><option value="2026-12-29">29 Dec 2026</option></select></div><button class="button" id="oiApply" type="button">Refresh</button></div>${sourceNote()}<div id="oiMessage"></div><div class="summary-grid" id="oiStats"></div><div class="panel"><h2 class="panel-title">Open Interest by Strike</h2><div class="chart-panel"><canvas id="oiChart"></canvas></div></div><h2 class="page-section-title">Option OI Snapshot</h2><div class="table-wrap" id="oiTableHost"></div>`;
}

function renderOptionChain(page) {
  const isSensex=page.market==='Sensex';
  const symbol=page.symbol || (isSensex?'SENSEX':'NIFTY W');
  return `${pageHeading(page,'Option chain view for the selected index and expiry.')}${sourceNote()}<div class="control-row"><div class="control"><label for="chainSymbol">INDEX</label><select id="chainSymbol"><option value="NIFTY W"${symbol==='NIFTY W'?' selected':''}>NIFTY WEEKLY</option><option value="NIFTY M">NIFTY MONTHLY</option><option value="BANKNIFTY"${symbol==='BANKNIFTY'?' selected':''}>BANKNIFTY</option><option value="FINNIFTY"${symbol==='FINNIFTY'?' selected':''}>FINNIFTY</option><option value="SENSEX"${symbol==='SENSEX'?' selected':''}>SENSEX</option></select></div><div class="control"><label for="chainExpiry">EXPIRY</label><select id="chainExpiry"><option value="2026-11-23">23 Nov 2026</option><option value="2026-12-29">29 Dec 2026</option></select></div><button class="button" id="chainApply" type="button">Load Chain</button></div><div id="chainMessage"></div><div class="summary-grid" id="chainStats"></div><div class="table-wrap" id="chainTableHost"></div>`;
}

function renderOIList(page) {
  const title=page.title;
  return `${pageHeading(page,`${title} ranked by the saved option OI sample.`)}<div class="control-row"><div class="control"><label for="rankSymbol">INDEX</label><select id="rankSymbol"><option value="NIFTY W">NIFTY WEEKLY</option><option value="BANKNIFTY">BANKNIFTY</option><option value="SENSEX">SENSEX</option></select></div><div class="control"><label for="rankSide">CONTRACT SIDE</label><select id="rankSide"><option value="ce_oi">Call Open Interest</option><option value="pe_oi">Put Open Interest</option><option value="call_oi_change">Call OI Change</option><option value="pe_oi_change">Put OI Change</option></select></div><button class="button" id="rankApply">Show Ranking</button></div>${sourceNote()}<div id="rankMessage"></div><div class="table-wrap" id="rankTable"></div>`;
}

function renderMultiStrike(page) {
  const selected=page.market==='Sensex'?'SENSEX':(page.market==='Bank Nifty'?'BANKNIFTY':'NIFTY W');
  return `${pageHeading(page,'Choose up to three strikes to compare the dated call/put OI snapshot.')}${sourceNote()}<div class="control-row"><div class="control"><label for="multiSymbol">INDEX</label><select id="multiSymbol"><option value="NIFTY W"${selected==='NIFTY W'?' selected':''}>NIFTY WEEKLY</option><option value="BANKNIFTY"${selected==='BANKNIFTY'?' selected':''}>BANKNIFTY</option><option value="SENSEX"${selected==='SENSEX'?' selected':''}>SENSEX</option></select></div><div class="control"><label for="multiStrike1">STRIKE 1</label><input id="multiStrike1" type="number" value="25750" step="50"></div><div class="control"><label for="multiStrike2">STRIKE 2</label><input id="multiStrike2" type="number" value="25800" step="50"></div><div class="control"><label for="multiStrike3">STRIKE 3</label><input id="multiStrike3" type="number" value="25850" step="50"></div><button class="button" id="multiApply">Compare</button></div><div id="multiMessage"></div><div class="panel"><h2 class="panel-title">Selected strikes · Call vs Put OI</h2><div class="chart-panel"><canvas id="multiChart"></canvas></div></div><div class="table-wrap" id="multiTable"></div>`;
}

function renderHistory(page) {
  const isCompare=(page.title||'').toLowerCase().includes('compare');
  const controls = `<div class="control-row"><div class="control"><label for="histSymbol">INDEX</label><select id="histSymbol"><option>NIFTY</option><option>BANKNIFTY</option><option>SENSEX</option></select></div><div class="control"><label for="histFrom">FROM DATE</label><input id="histFrom" type="date" value="${DATE_SAMPLE}" max="${DATE_SAMPLE}"></div><div class="control"><label for="histTo">TO DATE</label><input id="histTo" type="date" value="${DATE_SAMPLE}" max="${DATE_SAMPLE}"></div><button class="button" type="button" id="histApply">${isCompare?'Compare':'Show Data'}</button></div>`;
  return `${pageHeading(page,`${page.title} filters and historical data view.`)}${historyFeatureNav()}${controls}<div id="histMessage" class="notice warn">This page's original historical database is not bundled in the clone. The only locally saved public examples are PCR, six-strike OI, and futures OI for 20 Nov 2026.</div><div class="panel history-empty"><h2 class="panel-title">${esc(page.title)}</h2><div class="empty-state">Select filters and press “${isCompare?'Compare':'Show Data'}”. No matching historical rows are available in the local sample.</div></div>`;
}

function renderBacktest(page) {
  const k2Default=(page.strategy||'').toLowerCase().includes('straddle')?'25800':'26000';
  return `${pageHeading(page,`${page.strategy || 'Option strategy'} — hypothetical expiry payoff preview.`)}<div class="notice warn"><b>Scenario preview only.</b> The original historical backtest engine/database is not included. This page calculates a theoretical expiry payoff from the premiums and strikes you enter; it does not claim historical performance.</div><div class="panel"><h2 class="panel-title">${esc(page.strategy || 'Strategy')} parameters</h2><form id="backtestForm"><div class="form-grid"><div class="control"><label for="btFrom">FROM DATE (REFERENCE)</label><input id="btFrom" type="date" value="2026-01-01"></div><div class="control"><label for="btTo">TO DATE (REFERENCE)</label><input id="btTo" type="date" value="${DATE_SAMPLE}"></div><div class="control"><label for="btUnderlying">SPOT REFERENCE</label><input id="btUnderlying" name="spot" type="number" value="25800" step="0.05"></div><div class="control"><label for="btStrike1">STRIKE 1</label><input id="btStrike1" name="strike1" type="number" value="25800" step="50"></div><div class="control"><label for="btPremium1">LEG 1 PREMIUM</label><input id="btPremium1" name="premium1" type="number" value="120" step="0.05"></div><div class="control"><label for="btStrike2">STRIKE 2</label><input id="btStrike2" name="strike2" type="number" value="${k2Default}" step="50"></div><div class="control"><label for="btPremium2">LEG 2 PREMIUM</label><input id="btPremium2" name="premium2" type="number" value="45" step="0.05"></div><div class="control"><label for="btQuantity">QUANTITY</label><input id="btQuantity" name="quantity" type="number" value="75" min="1" step="1"></div></div><button class="button" type="submit">Calculate Payoff</button></form></div><div class="summary-grid" id="btSummary"></div><div class="panel"><h2 class="panel-title">Theoretical expiry payoff</h2><div class="chart-panel"><canvas id="btChart"></canvas></div></div>`;
}

function renderBacktestIndex(page) {
  const entries=Object.entries(SITE.pages).filter(([,p])=>p.type==='backtest' && (page.market==='Bank Nifty' ? p.market==='Bank Nifty' : p.market==='Nifty'));
  const cards=entries.map(([href,p])=>featureCard('STRATEGY',p.title,`Local theoretical payoff preview for ${p.strategy||'the strategy'}.`,href,'BACKTEST')).join('');
  return `${pageHeading(page,'Choose one strategy to open its own payoff page.')}<div class="notice warn">Historical trade logs and the original strategy engine are not included; individual strategy pages provide local theoretical payoff previews only.</div><div class="card-grid">${cards || featureCard('STRATEGY','Nifty Bull Call Spread','Open a separate strategy preview.','/nifty/option-backtesting/nifty-bull-call-spread-strategy-backtest-results.php','BACKTEST')}</div>`;
}

function renderSimulator(page) {
  return `${pageHeading(page,'Option payoff simulator for a single expiry scenario.')}${sourceNote('Theoretical calculation from your inputs only; no market quote or live option price is requested.')}<div class="panel"><h2 class="panel-title">Option Simulator</h2><form id="simForm"><div class="form-grid"><div class="control"><label>OPTION TYPE</label><select name="type"><option value="call">Call</option><option value="put">Put</option></select></div><div class="control"><label>SPOT PRICE</label><input name="spot" type="number" value="25800" step="0.05" required></div><div class="control"><label>STRIKE</label><input name="strike" type="number" value="25800" step="50" required></div><div class="control"><label>PREMIUM</label><input name="premium" type="number" value="120" step="0.05" required></div><div class="control"><label>QUANTITY</label><input name="quantity" type="number" value="75" step="1" required></div><button class="button" type="submit">Calculate Payoff</button></div></form></div><div class="summary-grid" id="simStats"></div><div class="panel"><h2 class="panel-title">Expiry payoff</h2><div class="chart-panel"><canvas id="simChart"></canvas></div></div>`;
}

const TOOL_DEFS = [
  {slug:'gann-square-of-nine',name:'Gann Square of 9',desc:'Explore a square-root-based Gann level.'},
  {slug:'position-size-calculator',name:'Position Size',desc:'Size a trade from account risk and stop distance.'},
  {slug:'risk-reward-calculator',name:'Risk-Reward',desc:'Compare target reward with stop risk.'},
  {slug:'stop-loss-calculator',name:'Stop Loss',desc:'Set a stop price from entry and risk percentage.'},
  {slug:'lot-size-calculator',name:'Lot Size',desc:'Estimate lots from a defined risk budget.'},
  {slug:'win-rate-calculator',name:'Win Rate',desc:'Calculate win rate and simple expectancy.'},
  {slug:'average-down-calculator',name:'Average Down',desc:'Calculate a blended entry after adding quantity.'},
  {slug:'average-target-calculator',name:'Average Target',desc:'Estimate a target from average entry and return.'},
  {slug:'sip-calculator',name:'SIP Calculator',desc:'Project a recurring monthly investment.'},
  {slug:'lumpsum-calculator',name:'Lumpsum Calculator',desc:'Project an investment with compound growth.'},
  {slug:'swp-calculator',name:'SWP Calculator',desc:'Estimate balance after periodic withdrawals.'}
];

function renderTools(page) {
  return `${pageHeading(page,'Calculators for analysis and risk planning.')}${sourceNote('All tools calculate locally from inputs. Outputs are illustrative, not investment advice.')}<div class="tool-grid">${TOOL_DEFS.map((tool)=>`<a class="tool-card" href="/tools/${tool.slug}.php"><span class="eyebrow">CALCULATOR</span><h3>${esc(tool.name)}</h3><p>${esc(tool.desc)}</p></a>`).join('')}</div>`;
}

function calculatorSpec(name) {
  const n=(name||'').toLowerCase();
  if(n.includes('gann')) return {fields:[['price','Current price',25800],['angle','Angle (45 / 90 / 180 / 360)',90],['direction','Direction','up','select']],calc:v=>{let root=Math.sqrt(v.price);let step=v.angle/180;let level=Math.pow(root+(v.direction==='down'?-step:step),2);return [['Square-root step',fmtNum(step,4)],['Indicative level',INR.format(level)]];}};
  if(n.includes('position')) return {fields:[['equity','Account equity',100000],['risk','Risk per trade (%)',1],['entry','Entry price',25800],['stop','Stop price',25650]],calc:v=>{let riskCash=v.equity*v.risk/100,perUnit=Math.abs(v.entry-v.stop),qty=perUnit?Math.floor(riskCash/perUnit):0;return [['Risk budget',INR.format(riskCash)],['Risk per unit',INR.format(perUnit)],['Suggested quantity',fmtInt(qty)],['Notional value',INR.format(qty*v.entry)]];}};
  if(n.includes('risk-reward')) return {fields:[['entry','Entry price',100],['target','Target price',120],['stop','Stop price',90]],calc:v=>{let reward=Math.abs(v.target-v.entry),risk=Math.abs(v.entry-v.stop);return [['Potential reward',INR.format(reward)],['Potential risk',INR.format(risk)],['Reward : Risk',risk?`1 : ${fmtNum(reward/risk,2)}`:'—']];}};
  if(n.includes('stop loss')) return {fields:[['entry','Entry price',100],['risk','Risk (%)',2],['direction','Position direction','long','select']],calc:v=>{let stop=v.direction==='short'?v.entry*(1+v.risk/100):v.entry*(1-v.risk/100);return [['Stop price',INR.format(stop)],['Price distance',INR.format(Math.abs(stop-v.entry))],['Risk percentage',`${fmtNum(v.risk,2)}%`]];}};
  if(n.includes('lot size')) return {fields:[['budget','Risk budget',5000],['entry','Entry price',1000],['stop','Stop price',980],['lot','Units per lot',25]],calc:v=>{let perLot=Math.abs(v.entry-v.stop)*v.lot,lots=perLot?Math.floor(v.budget/perLot):0;return [['Risk per lot',INR.format(perLot)],['Suggested lots',fmtInt(lots)],['Total units',fmtInt(lots*v.lot)],['Estimated risk',INR.format(lots*perLot)]];}};
  if(n.includes('win rate')) return {fields:[['wins','Winning trades',6],['losses','Losing trades',4],['avgWin','Average win (optional)',1000],['avgLoss','Average loss (optional)',600]],calc:v=>{let total=v.wins+v.losses,wr=total?v.wins/total*100:0,exp=total?(v.wins/total*v.avgWin-v.losses/total*v.avgLoss):0;return [['Total trades',fmtInt(total)],['Win rate',`${fmtNum(wr,2)}%`],['Simple expectancy / trade',INR.format(exp)]];}};
  if(n.includes('average down')) return {fields:[['qty1','Existing quantity',10],['price1','Existing average price',250],['qty2','Additional quantity',10],['price2','Additional price',220]],calc:v=>{let q=v.qty1+v.qty2,avg=q?(v.qty1*v.price1+v.qty2*v.price2)/q:0;return [['Combined quantity',fmtInt(q)],['New average cost',INR.format(avg)],['Additional investment',INR.format(v.qty2*v.price2)]];}};
  if(n.includes('average target')) return {fields:[['average','Average entry price',250],['targetPct','Target return (%)',10],['direction','Direction','long','select']],calc:v=>{let p=v.average*(1+(v.direction==='short'?-1:1)*v.targetPct/100);return [['Indicative target',INR.format(p)],['Move from average',`${fmtNum(v.targetPct,2)}%`]];}};
  if(n.toLowerCase().includes('sip')) return {fields:[['monthly','Monthly investment',5000],['years','Duration (years)',10],['rate','Expected annual return (%)',12]],calc:v=>{let r=v.rate/1200,n=v.years*12,fv=r? v.monthly*((Math.pow(1+r,n)-1)/r)*(1+r):v.monthly*n,invest=v.monthly*n;return [['Invested amount',INR.format(invest)],['Projected value',INR.format(fv)],['Illustrative gain',INR.format(fv-invest)]];}};
  if(n.includes('lumpsum')) return {fields:[['principal','Investment amount',100000],['years','Duration (years)',10],['rate','Expected annual return (%)',12]],calc:v=>{let fv=v.principal*Math.pow(1+v.rate/100,v.years);return [['Invested amount',INR.format(v.principal)],['Projected value',INR.format(fv)],['Illustrative gain',INR.format(fv-v.principal)]];}};
  if(n.includes('swp')) return {fields:[['principal','Starting balance',1000000],['withdrawal','Monthly withdrawal',10000],['years','Duration (years)',10],['rate','Expected annual return (%)',8]],calc:v=>{let balance=v.principal,r=Math.pow(1+v.rate/100,1/12)-1,months=Math.max(0,Math.floor(v.years*12)),depleted=null;for(let i=1;i<=months;i++){balance=balance*(1+r)-v.withdrawal;if(balance<=0){balance=0;depleted=i;break;}}return [['Withdrawn (approx.)',INR.format(v.withdrawal*(depleted||months))],['Estimated ending balance',INR.format(balance)],['Balance exhausted',depleted?`Month ${depleted}`:'No']];}};
  return {fields:[['high','High',105],['low','Low',95],['close','Close',100]],calc:v=>{let p=(v.high+v.low+v.close)/3;return [['Pivot point',INR.format(p)],['Resistance 1',INR.format(2*p-v.low)],['Support 1',INR.format(2*p-v.high)],['Resistance 2',INR.format(p+(v.high-v.low))],['Support 2',INR.format(p-(v.high-v.low))]];}};
}

function renderCalculator(page) {
  const spec=calculatorSpec(page.tool||page.title);
  const fields=spec.fields.map(([id,label,value,type])=>{
    const options=id==='direction'?`<select name="${id}" id="calc-${id}"><option value="long">Long</option><option value="short">Short</option></select>`:id==='angle'?`<select name="${id}" id="calc-${id}"><option value="45">45°</option><option value="90" selected>90°</option><option value="180">180°</option><option value="360">360°</option></select>`:`<input type="number" name="${id}" id="calc-${id}" value="${esc(value)}" step="any" required>`;
    return `<div class="control"><label for="calc-${id}">${esc(label)}</label>${options}</div>`;
  }).join('');
  return `${pageHeading(page,`${page.tool || page.title} · local calculator`)}${sourceNote('Calculation is performed in this browser from your inputs; projected results are illustrative only.')}<div class="panel"><form id="calculatorForm"><div class="form-grid">${fields}</div><button class="button" type="submit">Calculate</button><button class="button light" type="reset">Reset</button></form></div><div id="calculatorResult" class="result-box"><span class="muted">Enter your figures and select Calculate.</span></div>`;
}

function renderReturns(page) {
  const title=page.title||'Nifty Returns';
  return `${pageHeading(page,`${title}: projection calculator and data note.`)}<div class="notice warn">Verified historical index return rows are not included in this local build. The projection below is a user-input compound-growth calculation, not historical Nifty performance.</div><div class="panel"><h2 class="panel-title">Investment return projection</h2><form id="returnForm"><div class="form-grid"><div class="control"><label>Investment amount</label><input name="principal" type="number" value="100000" step="any" required></div><div class="control"><label>Annual return (%)</label><input name="rate" type="number" value="12" step="any" required></div><div class="control"><label>Duration (years)</label><input name="years" type="number" value="5" step="any" required></div></div><button class="button" type="submit">Calculate Projection</button></form></div><div id="returnResult" class="result-box"></div>`;
}

function renderResearch(page) {
  const hero=page.type==='zerohero';
  return `${pageHeading(page,hero?'Expiry-day historical analysis and research.':'Historical research view with date and session filters.')}${sourceNote('Research text and controls are local. No historical market database is bundled, so no unverified predictions or performance figures are shown.')}<div class="control-row"><div class="control"><label for="researchDate">DATE</label><input id="researchDate" type="date" value="${DATE_SAMPLE}" max="${DATE_SAMPLE}"></div><div class="control"><label for="researchIndex">INDEX</label><select id="researchIndex"><option>NIFTY</option><option>BANKNIFTY</option><option>SENSEX</option></select></div><button class="button" id="researchApply">Show Research</button></div><div class="two-column"><section class="panel"><h2 class="panel-title">${hero?'Zero to Hero · expiry-day analysis':esc(page.title)}</h2><p class="muted">Use the page navigation and date control to explore this topic. The clone does not have the original site's private historical records or research engine.</p><div id="researchMessage" class="notice warn">No matching research sample is available for the selected date.</div></section><section class="panel"><h2 class="panel-title">Related pages</h2><div class="related-links"><a href="/nifty/nifty-expiry-day-historical-charts.php">Nifty Expiry Day Charts</a><a href="/nifty/nifty-historical-intraday-charts.php">Nifty Intraday Charts</a><a href="/nifty/nifty-standard-deviation-and-volatality.php">Nifty Standard Deviation</a><a href="/nifty/nifty-historical-returns-with-cagr.php">Nifty Historical Returns</a></div></section></div>`;
}

function renderStock(page) {
  let label=page.market||'Stocks';
  return `${pageHeading(page,`${page.title} · symbol and date filters.`)}<div class="control-row"><div class="control"><label for="stockSymbol">SYMBOL</label><input id="stockSymbol" type="search" placeholder="Enter stock symbol, e.g. RELIANCE"></div><div class="control"><label for="stockDate">DATE</label><input id="stockDate" type="date" value="${DATE_SAMPLE}" max="${DATE_SAMPLE}"></div><div class="control"><label for="stockExpiry">EXPIRY / SERIES</label><select id="stockExpiry"><option>Nearest available</option><option>Current month</option><option>Next month</option></select></div><button class="button" id="stockApply">Search ${esc(label)}</button></div><div id="stockMessage" class="notice warn">This local clone has no verified stock-specific option or futures feed. No market values are fabricated.</div><div class="panel"><h2 class="panel-title">${esc(page.title)}</h2><div class="empty-state">Results for a selected stock will appear here when a supported data source is configured.</div></div>`;
}

function renderScreener(page) {
  return `${pageHeading(page,'Filter and scan option data.')}${sourceNote('The original screener backend is private and no matching local screener dataset is available.')}<div class="panel"><div class="control-row"><div class="control"><label>UNDERLYING</label><select><option>${esc(page.market==='Sensex'?'SENSEX':'NIFTY')}</option><option>BANKNIFTY</option></select></div><div class="control"><label>EXPIRY</label><select><option>Nearest expiry</option></select></div><div class="control"><label>OPTION SIDE</label><select><option>Calls and puts</option><option>Calls</option><option>Puts</option></select></div><div class="control"><label>MIN OI</label><input type="number" value="0"></div><button class="button" id="screenApply">Apply Filters</button></div><div id="screenMessage" class="empty-state">No screener rows available in the local sample.</div></div>`;
}

function renderMood(page) {
  return `${pageHeading(page,`${page.title} · dated sentiment snapshot.`)}${sourceNote('Snapshot counts are demo-only; they are not a live futures feed or a predictive signal.')}<div id="moodMessage"></div><div class="buildup-grid" id="moodCards"></div><div class="panel"><h2 class="panel-title">How to read the four futures buckets</h2><div class="two-column"><p>Long buildup: price and open interest rise. Short buildup: price falls while open interest rises.</p><p>Long unwinding: price and open interest fall. Short covering: price rises while open interest falls. These labels are descriptive, not trading advice.</p></div></div>`;
}

function renderLiveFutures(page) {
  return `${pageHeading(page,'Futures market page. This clone shows only the saved buildup summary.')}${sourceNote('No timestamped live-futures instrument rows are bundled. A local demo snapshot may include aggregate buildup counts only.')}<div id="liveFutMessage"></div><div class="buildup-grid" id="liveFutCards"></div><div class="panel"><h2 class="panel-title">Live Future</h2><div class="empty-state">Detailed live prices, expiries and contract-level OI are unavailable in this offline clone.</div></div>`;
}

function renderZeroHero(page) { return renderResearch(page); }

function renderContact(page) {
  return `${pageHeading(page,'Questions, feedback, data issues or partnership enquiries.')}
    <div class="contact-layout"><section class="panel"><span class="contact-icon">✉</span><h2 class="panel-title">How to reach us</h2><p>For questions about market data, historical charts, tools or to share feedback, email Trading Tick.</p><a class="contact-email" href="mailto:tradingtick.in@gmail.com">tradingtick.in@gmail.com</a><p class="muted">The original website indicates an expected response within 24–48 hours on business days.</p><a class="button" href="mailto:tradingtick.in@gmail.com?subject=Trading%20Tick%20enquiry">Compose email</a></section><section class="panel"><h2 class="panel-title">Common reasons to contact</h2><ul class="contact-reasons"><li>Questions about market data or historical charting</li><li>Suggestions for tools and improvements</li><li>Technical issues or bug reports</li><li>Affiliate or partnership enquiries</li><li>General feedback</li></ul><div class="notice warn">This local clone does not submit messages to Trading Tick; use the email link above.</div></section></div>`;
}

function renderGlobal(page) {
  return `${pageHeading(page,'Global futures and index links.')}${sourceNote('External destinations open separately and are not cloned here.')}<div class="card-grid">${(SITE.externalLinks||[]).map((x)=>featureCard('EXTERNAL',x.label,'Open the original external destination in a new tab.',x.href,'GLOBAL')).join('')}</div>`;
}

function renderPage(page) {
  switch(page.type) {
    case 'home': return renderHome(page);
    case 'overview': case 'index': return renderOverview(page);
    case 'pcr': return renderPCR(page);
    case 'callput': return renderCallput(page);
    case 'futures-build': return renderFutures(page);
    case 'intraday': return renderIntraday(page);
    case 'oi-chart': return renderOIChart(page);
    case 'option-chain': return renderOptionChain(page);
    case 'oi-list': return renderOIList(page);
    case 'multi-strike': return renderMultiStrike(page);
    case 'history': return renderHistory(page);
    case 'backtest': return renderBacktest(page);
    case 'backtest-index': return renderBacktestIndex(page);
    case 'simulator': return renderSimulator(page);
    case 'tools': return renderTools(page);
    case 'calculator': return renderCalculator(page);
    case 'returns': return renderReturns(page);
    case 'research': case 'zerohero': return renderZeroHero(page);
    case 'stock-chain': case 'stock-futures': case 'stock-target': return renderStock(page);
    case 'screener': return renderScreener(page);
    case 'mood': return renderMood(page);
    case 'live-futures': return renderLiveFutures(page);
    case 'contact': return renderContact(page);
    default: return `${pageHeading(page)}<div class="empty-state">This route is listed in the site menu. Historical/live page data is not available in this local clone.</div>`;
  }
}

function markBadge(mode) {
  const badge=byId('pageSourceBadge');
  if (!badge) return;
  const k=String(mode||'demo').toLowerCase();
  badge.textContent=['upstox','live','market-live'].includes(k)?'LIVE SOURCE':k==='unavailable'?'UNAVAILABLE':'DEMO SAMPLE';
  badge.classList.toggle('live',['upstox','live','market-live'].includes(k));
  badge.classList.toggle('unavailable',k==='unavailable');
}
function updateSourceNote(message, mode='demo') {
  const box=byId('sourceNote');
  if(box){box.textContent=message;box.classList.toggle('live',['upstox','live','market-live'].includes(String(mode).toLowerCase()));box.classList.toggle('error',mode==='unavailable');}
  markBadge(mode);
  setSource(mode,message);
}
function showMessage(id, message, cls='notice warn') {
  const node=byId(id); if(node) node.innerHTML=message?`<div class="${cls}">${esc(message)}</div>`:'';
}
function setActiveRefresh(fn) { activePageRefresh = typeof fn==='function' ? fn : async()=>{}; }

function paginationControls(hostId, noteId, total, pageNumber, onChoose, perPage=ROWS_PER_PAGE) {
  const host=byId(hostId), note=byId(noteId); if(!host||!note)return;
  const pages=Math.max(1,Math.ceil(total/perPage));
  const buttons=[];
  buttons.push(`<button type="button" data-page="${pageNumber-1}" ${pageNumber<=1?'disabled':''}>« Prev</button>`);
  for(let n=1;n<=pages;n++) buttons.push(`<button type="button" data-page="${n}" class="${n===pageNumber?'active':''}">${n}</button>`);
  buttons.push(`<button type="button" data-page="${pageNumber+1}" ${pageNumber>=pages?'disabled':''}>Next »</button>`);
  host.innerHTML=buttons.join('');
  host.querySelectorAll('button[data-page]').forEach((button)=>button.addEventListener('click',()=>{const next=Number(button.dataset.page);if(next>=1&&next<=pages)onChoose(next);}));
  note.textContent=`Page ${pageNumber} of ${pages} (${total} rows · ${perPage} rows per page)`;
}

function renderPcrTable(pageNo=1) {
  const host=byId('pcrTableHost'); if(!host)return;
  if(!currentPcrRows.length){host.innerHTML='<div class="empty-state">No rows for this selection.</div>';byId('pcrPagination').innerHTML='';byId('pcrPaginationNote').textContent='';return;}
  const start=(pageNo-1)*ROWS_PER_PAGE, rows=currentPcrRows.slice(start,start+ROWS_PER_PAGE);
  const body=rows.map((r)=>{
    const ce=num(r.ce_oi_change),pe=num(r.pe_oi_change),diff=num(r.diff_oi),pcr=num(r.coi_pcr),total=num(r.pcr);
    const signal=Number.isFinite(diff)&&diff>=0?'BUY':'SELL';
    return `<tr><td>${esc(r.time)}</td><td>${Number.isFinite(ce)?fmtInt(ce):esc(r.ce_oi_change)}</td><td>${Number.isFinite(pe)?fmtInt(pe):esc(r.pe_oi_change)}</td><td class="${diff>=0?'positive':'negative'}">${Number.isFinite(diff)?fmtInt(diff):esc(r.diff_oi)}</td><td>${Number.isFinite(pcr)?fmtNum(pcr,2):'—'}</td><td class="signal ${signal==='SELL'?'negative':''}">${signal}</td><td>${fmtNum(r.spot_price,2)}</td><td>${Number.isFinite(total)?fmtNum(total,2):'—'}</td></tr>`;
  }).join('');
  host.innerHTML=`<table class="data-table pcr-table"><thead><tr><th>TIME</th><th>CALLS CHNG OI</th><th>PUTS CHNG OI</th><th>DIFF. IN OI</th><th>OI CHNG PCR</th><th>OPTION SIGNAL</th><th>SPOT PRICE</th><th>TOTAL PCR</th></tr></thead><tbody>${body}</tbody></table>`;
  paginationControls('pcrPagination','pcrPaginationNote',currentPcrRows.length,pageNo,renderPcrTable);
}

async function loadPCR() {
  const symbol=byId('pcrSymbol')?.value||'NIFTY W';
  const date=byId('pcrDate')?.value||DATE_SAMPLE;
  const interval=Number(byId('pcrInterval')?.value||5);
  const range=Number(byId('pcrRange')?.value||6);
  showMessage('pcrMessage','Loading dated public sample…');
  try {
    const data=await getJSON(`/api/demo/pcr?symbol=${encodeURIComponent(symbol)}&date=${encodeURIComponent(date)}&range=${range}`);
    if(data.mode==='unavailable'||!Array.isArray(data.rows)){
      currentPcrRows=[];showMessage('pcrMessage',data.error||'No sample is available for that symbol and date.');updateSourceNote('No matching local PCR sample.','unavailable');renderPcrTable();return;
    }
    const factor=Math.max(1,Math.round(interval/5));
    currentPcrRows=data.rows.filter((_,i)=>i%factor===0);
    if(range!==6) showMessage('pcrMessage',`The saved sample contains the 6-strike view. Requested range ${range} was not separately saved; showing the dated 6-strike sample.`);
    else showMessage('pcrMessage','');
    updateSourceNote(`Dated public sample · ${data.date} · ${data.symbol} · 5-minute source rows · not a verified live feed.`,data.mode||'demo');
    renderPcrTable(1);
  } catch(error) { currentPcrRows=[];showMessage('pcrMessage',error.message,'notice error');updateSourceNote(error.message,'unavailable');renderPcrTable(); }
}

function callputStrikeInputs() {
  return [Number(byId('cpCE1')?.value),Number(byId('cpCE2')?.value),Number(byId('cpCE3')?.value),Number(byId('cpPE1')?.value),Number(byId('cpPE2')?.value),Number(byId('cpPE3')?.value)];
}

async function loadCallput() {
  const symbol=byId('cpSymbol')?.value||'NIFTY W';
  const date=byId('cpDate')?.value||DATE_SAMPLE;
  const strikes=callputStrikeInputs();
  showMessage('cpMessage','Loading chart and table…');
  try {
    const params=new URLSearchParams({symbol,date,strikes:strikes.join(',')});
    const data=await getJSON(`/api/demo/callput?${params}`);
    if(data.mode==='unavailable'||!data.call||!data.put){currentCallput=null;if(activeChart){activeChart.destroy();activeChart=null;}showMessage('cpMessage',data.error||'No matching call/put sample is available.','notice error');updateSourceNote('No matching local Call vs Put OI sample.','unavailable');renderCallputData(1);return;}
    currentCallput=data;
    showMessage('cpMessage','');
    updateSourceNote(`Dated public sample · ${data.date} · ${data.symbol} · six strike series · not a verified live feed.`,data.mode||'demo');
    drawCallputChart();renderCallputData(1);
  } catch(error){currentCallput=null;if(activeChart){activeChart.destroy();activeChart=null;}showMessage('cpMessage',error.message,'notice error');updateSourceNote(error.message,'unavailable');renderCallputData(1);}
}

function drawCallputChart() {
  if(!currentCallput||!window.Chart)return;
  const canvas=byId('cpChart');if(!canvas)return;
  if(activeChart){activeChart.destroy();activeChart=null;}
  const labels=currentCallput.call.chart.times;
  const strikeLabels=currentCallput.strikes;
  const colors=['#78f36c','#00ae3a','#006c16','#ffa1a1','#ff5757','#f00b2b'];
  const series=[...currentCallput.call.chart.series,...currentCallput.put.chart.series];
  const datasets=series.map((s,i)=>({label:`${i<3?'CE':'PE'} ${strikeLabels[i%3]}`,data:s.data,borderColor:colors[i],backgroundColor:colors[i]+'22',borderWidth:1.8,pointRadius:0,tension:.24,fill:false}));
  activeChart=new Chart(canvas,{type:'line',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'top',labels:{boxWidth:38,usePointStyle:false,font:{size:11}}},tooltip:{callbacks:{label:(ctx)=>`${ctx.dataset.label}: ${fmtInt(ctx.parsed.y)}`}}},scales:{x:{title:{display:true,text:'Time'},ticks:{autoSkip:true,maxTicksLimit:24,maxRotation:55,minRotation:45}},y:{title:{display:true,text:'OI Change'},ticks:{callback:(v)=>`${(v/100000).toFixed(0)} Lakh`},grid:{color:'rgba(40,50,70,.12)'}}}}});
}

function renderCallputData(pageNo=1) {
  const host=byId('cpTableHost');if(!host)return;
  if(!currentCallput){host.innerHTML='<div class="empty-state">No chart or table rows for this selection.</div>';byId('cpPagination').innerHTML='';byId('cpPaginationNote').textContent='';return;}
  const {call,put}=currentCallput;const times=call.chart.times;const order=Array.from({length:times.length},(_,i)=>times.length-1-i);
  const start=(pageNo-1)*ROWS_PER_PAGE, chosen=order.slice(start,start+ROWS_PER_PAGE);
  const rows=chosen.map((i)=>`<tr><td>${esc(times[i])}</td><td>${fmtNum(call.spot[i],2)}</td>${call.chart.series.map((s)=>`<td class="positive num">${fmtInt(s.data[i])}</td>`).join('')}${put.chart.series.map((s)=>`<td class="positive num">${fmtInt(s.data[i])}</td>`).join('')}</tr>`).join('');
  host.innerHTML=`<table class="data-table compact callput-data-table"><thead><tr><th>TIME</th><th>SPOT</th><th>CE S1 CHANGE</th><th>CE S2 CHANGE</th><th>CE S3 CHANGE</th><th>PE S1 CHANGE</th><th>PE S2 CHANGE</th><th>PE S3 CHANGE</th></tr></thead><tbody>${rows}</tbody></table>`;
  paginationControls('cpPagination','cpPaginationNote',times.length,pageNo,renderCallputData);
}

function timeMinute(t){const [h,m]=String(t||'0:0').split(':').map(Number);return h*60+m;}
async function loadFutures() {
  const symbol=byId('futSymbol')?.value||'NIFTY';
  const expiry=byId('futExpiry')?.value||'2026-11-23';
  const date=byId('futDate')?.value||DATE_SAMPLE;
  const interval=byId('futInterval')?.value||'10min';
  showMessage('futMessage','Loading dated futures sample…');
  try{
    const qs=new URLSearchParams({symbol,expiry,date,interval});const data=await getJSON(`/api/demo/futures?${qs}`);
    if(data.mode==='unavailable'||!Array.isArray(data.rows)){currentFutures=null;updateSourceNote(data.error||'No matching futures sample.','unavailable');showMessage('futMessage',data.error||'No matching futures sample.','notice error');byId('futRows').innerHTML='<tr><td colspan="7">No data</td></tr>';return;}
    currentFutures=data;let rows=data.rows;
    const step=interval==='30min'?3:interval==='1hour'?6:1;
    if(step>1) rows=rows.filter(r=>timeMinute(r.time)%(step*10)===0);
    renderFuturesRows(rows);
    const intr=interval==='10min'?'10 min':interval==='30min'?'30 min':'1 hour';
    byId('futMeta').textContent=`▦  ${date}　 ◇  ${symbol}　 ▢  Expiry: ${expiry}　 ◷  ${intr}`;
    byId('futStamp').textContent=`Sample source: ${data.source||'dated public sample'} · ${data.date} · Base interval: 10 min`;
    showMessage('futMessage','');
    updateSourceNote(`Dated public sample · ${date} · ${symbol} · ${interval==='10min'?'10-minute rows':'view derived from saved 10-minute rows'} · not a verified live feed.`,data.mode||'demo');
  }catch(error){currentFutures=null;showMessage('futMessage',error.message,'notice error');updateSourceNote(error.message,'unavailable');byId('futRows').innerHTML='<tr><td colspan="7">Unavailable</td></tr>';}
}

function renderFuturesRows(rows) {
  const tbody=byId('futRows');if(!tbody)return;
  if(!rows||!rows.length){tbody.innerHTML='<tr><td colspan="7">No rows for the selected interval.</td></tr>';return;}
  tbody.innerHTML=rows.map((r)=>{
    const change=num(r.change),oiChange=num(r.oi_change);
    const className=String(r.interpretation||'').toLowerCase().replace(/\s+/g,'-');
    const displayClass=className==='short-covering'?'short-covering':className==='long-unwinding'?'long-unwinding':className==='short-buildup'?'short-buildup':className==='long-buildup'?'long-buildup':'';
    const arrow=change>0?'▲':change<0?'▼':'●';
    const oiArrow=oiChange>0?'▲':oiChange<0?'▼':'●';
    return `<tr><td><b>${esc(r.time)}</b></td><td class="row-symbol">${esc(r.symbol)}</td><td class="num"><b>${fmtNum(r.ltp,2)}</b></td><td class="${change>=0?'positive':'negative'}">${change>0?'+':''}${fmtNum(change,2)} <span class="direction-icon">${arrow}</span></td><td class="num">${fmtInt(r.oi)}</td><td class="${oiChange>=0?'positive':'negative'}">${oiChange>0?'+':''}${fmtInt(oiChange)} <span class="direction-icon">${oiArrow}</span></td><td><span class="interpretation ${displayClass}">${esc(r.interpretation)}</span></td></tr>`;
  }).join('');
}

async function loadIntraday() {
  const symbol=byId('intraSymbol')?.value||'NIFTY';
  const date=byId('intraDate')?.value||DATE_SAMPLE;
  showMessage('intraMessage','Loading intraday data…');
  try{
    const data=await getJSON(`/api/intraday?symbol=${encodeURIComponent(symbol)}&date=${encodeURIComponent(date)}`);
    if(data.success===false){showMessage('intraMessage',data.error||'Intraday data unavailable.','notice error');updateSourceNote(data.error||'No intraday sample for this symbol.','unavailable');byId('intraStats').innerHTML='';if(activeChart){activeChart.destroy();activeChart=null;}return;}
    showMessage('intraMessage','');updateSourceNote(data.mode==='upstox'?`Upstox data · as of ${data.as_of||'latest'}.`:`Dated sample · ${data.trading_date||DATE_SAMPLE} · not a verified live feed.`,data.mode||'demo');
    const change=num(data.price_change),pct=num(data.percentage_change);
    const stats=[['OPEN',data.open],['HIGH',data.high],['LOW',data.low],['LAST',data.current_price],['CHANGE',change],['CHANGE %',pct]];
    byId('intraStats').innerHTML=stats.map(([l,v])=>`<div class="summary-card"><div class="label">${l}</div><div class="value ${Number(v)>=0&&l.startsWith('CHANGE')?'up':Number(v)<0&&l.startsWith('CHANGE')?'down':''}">${l==='CHANGE %'?fmtNum(v,2)+'%':fmtNum(v,2)}</div></div>`).join('');
    drawLineChart('intraChart',data.labels||[],data.prices||[],`${symbol} price`, '#2463eb', 'Price');
  }catch(error){showMessage('intraMessage',error.message,'notice error');updateSourceNote(error.message,'unavailable');}
}

async function loadOI() {
  const symbol=byId('oiSymbol')?.value||'NIFTY W';
  const expiry=byId('oiExpiry')?.value||'';
  showMessage('oiMessage','Loading open interest snapshot…');
  try{
    const data=await getJSON(`/api/oi?symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`);
    if(data.status!=='ok'||!Array.isArray(data.strikes)){showMessage('oiMessage',data.error||'No matching OI sample.','notice error');updateSourceNote(data.error||'No matching OI sample.','unavailable');byId('oiStats').innerHTML='';byId('oiTableHost').innerHTML='<div class="empty-state">No OI rows for this selection.</div>';if(activeChart){activeChart.destroy();activeChart=null;}return;}
    showMessage('oiMessage','');updateSourceNote(`Dated option OI sample · ${data.as_of||'unknown'} · not a verified live feed.`,data.mode||'demo');
    const s=data.summary||{};
    byId('oiStats').innerHTML=[['SPOT',fmtNum(data.meta?.spot,2)],['TOTAL PCR',fmtNum(s.overall_pcr,2)],['CALL OI',fmtInt(s.total_call_oi)],['PUT OI',fmtInt(s.total_put_oi)]].map(([l,v])=>`<div class="summary-card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
    const labels=data.strikes.map(r=>r.strike);
    if(activeChart){activeChart.destroy();activeChart=null;}
    if(window.Chart&&byId('oiChart')) activeChart=new Chart(byId('oiChart'),{type:'bar',data:{labels,datasets:[{label:'Call OI',data:data.strikes.map(r=>r.ce_oi),backgroundColor:'#49a2ff99',borderColor:'#1776db',borderWidth:1},{label:'Put OI',data:data.strikes.map(r=>r.pe_oi),backgroundColor:'#ff9a6999',borderColor:'#f36937',borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{x:{title:{display:true,text:'Strike'}},y:{ticks:{callback:(v)=>`${(v/100000).toFixed(0)} L`} }}}});
    renderOptionOiTable('oiTableHost',data.strikes,data.as_of);
  }catch(error){showMessage('oiMessage',error.message,'notice error');updateSourceNote(error.message,'unavailable');byId('oiStats').innerHTML='';byId('oiTableHost').innerHTML='<div class="empty-state">No OI rows available.</div>';if(activeChart){activeChart.destroy();activeChart=null;}}
}

function renderOptionOiTable(hostId,strikes,asof) {
  const host=byId(hostId);if(!host)return;
  const body=strikes.map(r=>`<tr class="${r.is_atm?'atm-row':''}"><td>${fmtInt(r.strike)}${r.is_atm?' <b>ATM</b>':''}</td><td class="num">${fmtInt(r.ce_oi)}</td><td class="${r.call_oi_change>=0?'positive':'negative'} num">${fmtInt(r.call_oi_change)}</td><td class="num">${fmtNum(r.ce_ltp,2)}</td><td class="num">${fmtNum(r.pe_ltp,2)}</td><td class="${r.pe_oi_change>=0?'positive':'negative'} num">${fmtInt(r.pe_oi_change)}</td><td class="num">${fmtInt(r.pe_oi)}</td><td>${fmtNum(r.pcr,2)}</td><td>${esc(r.sentiment_label||'—')}</td></tr>`).join('');
  host.innerHTML=`<table class="data-table compact"><thead><tr><th>STRIKE</th><th>CE OI</th><th>CE OI CHANGE</th><th>CE LTP</th><th>PE LTP</th><th>PE OI CHANGE</th><th>PE OI</th><th>PCR</th><th>SENTIMENT</th></tr></thead><tbody>${body}</tbody></table><div class="data-stamp">As of ${esc(asof||'—')}</div>`;
}

async function loadOptionChain() {
  const symbol=byId('chainSymbol')?.value||'NIFTY W';
  const expiry=byId('chainExpiry')?.value||'';
  showMessage('chainMessage','Loading option-chain sample…');
  try{
    const data=await getJSON(`/api/oi?symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`);
    if(data.status!=='ok'||!Array.isArray(data.strikes)){showMessage('chainMessage',data.error||'No local chain data for the selected index.','notice error');updateSourceNote(data.error||'No local option-chain sample.','unavailable');byId('chainStats').innerHTML='';byId('chainTableHost').innerHTML='<div class="empty-state">No matching option-chain rows.</div>';return;}
    showMessage('chainMessage','');updateSourceNote(`Dated option-chain sample · ${data.as_of||'unknown'} · not a verified live feed.`,data.mode||'demo');
    const s=data.summary||{};byId('chainStats').innerHTML=[['SPOT',fmtNum(data.meta?.spot,2)],['EXPIRY',data.meta?.expiry||expiry],['OVERALL PCR',fmtNum(s.overall_pcr,2)],['ATM',fmtInt(data.meta?.atm)]].map(([l,v])=>`<div class="summary-card"><div class="label">${l}</div><div class="value">${esc(v)}</div></div>`).join('');
    renderOptionOiTable('chainTableHost',data.strikes,data.as_of);
  }catch(error){showMessage('chainMessage',error.message,'notice error');updateSourceNote(error.message,'unavailable');}
}

async function loadRanking() {
  const symbol=byId('rankSymbol')?.value||'NIFTY W', side=byId('rankSide')?.value||'ce_oi';
  showMessage('rankMessage','Loading OI sample…');
  try{
    const data=await getJSON(`/api/oi?symbol=${encodeURIComponent(symbol)}`);
    if(data.status!=='ok'||!Array.isArray(data.strikes)){showMessage('rankMessage',data.error||'No OI sample for this index.','notice error');updateSourceNote(data.error||'Unavailable.','unavailable');byId('rankTable').innerHTML='<div class="empty-state">No ranking rows available.</div>';return;}
    const rows=[...data.strikes].sort((a,b)=>num(b[side])-num(a[side]));
    const label=side==='ce_oi'?'CALL OI':side==='pe_oi'?'PUT OI':side==='call_oi_change'?'CALL OI CHANGE':'PUT OI CHANGE';
    byId('rankTable').innerHTML=`<table class="data-table"><thead><tr><th>RANK</th><th>STRIKE</th><th>${label}</th><th>CE OI</th><th>PE OI</th><th>PCR</th><th>BIAS</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${fmtInt(r.strike)}</td><td class="num">${fmtInt(r[side])}</td><td class="num">${fmtInt(r.ce_oi)}</td><td class="num">${fmtInt(r.pe_oi)}</td><td>${fmtNum(r.pcr,2)}</td><td>${esc(r.sentiment_label||'—')}</td></tr>`).join('')}</tbody></table>`;
    showMessage('rankMessage','');updateSourceNote(`Dated option OI snapshot · ${data.as_of||'unknown'} · ranked locally.`,data.mode||'demo');
  }catch(error){showMessage('rankMessage',error.message,'notice error');updateSourceNote(error.message,'unavailable');}
}

async function loadMultiStrike() {
  const symbol=byId('multiSymbol')?.value||'NIFTY W';
  const wanted=[1,2,3].map(i=>Number(byId(`multiStrike${i}`)?.value));
  showMessage('multiMessage','Loading selected strike data…');
  try{
    const data=await getJSON(`/api/oi?symbol=${encodeURIComponent(symbol)}`);
    if(data.status!=='ok'||!Array.isArray(data.strikes)){showMessage('multiMessage',data.error||'No OI sample for this index.','notice error');updateSourceNote(data.error||'Unavailable.','unavailable');byId('multiTable').innerHTML='<div class="empty-state">No selected strikes available.</div>';if(activeChart){activeChart.destroy();activeChart=null;}return;}
    const found=wanted.map(x=>data.strikes.find(r=>Number(r.strike)===x)).filter(Boolean);
    if(!found.length){showMessage('multiMessage','None of those strikes exists in the saved snapshot.','notice error');byId('multiTable').innerHTML='<div class="empty-state">No selected strikes available.</div>';if(activeChart){activeChart.destroy();activeChart=null;}return;}
    if(found.length<wanted.length)showMessage('multiMessage',`Only ${found.length} selected strike(s) exist in this snapshot.`);else showMessage('multiMessage','');
    if(activeChart){activeChart.destroy();activeChart=null;}
    if(window.Chart&&byId('multiChart'))activeChart=new Chart(byId('multiChart'),{type:'bar',data:{labels:found.map(r=>r.strike),datasets:[{label:'Call OI',data:found.map(r=>r.ce_oi),backgroundColor:'#58a4f080',borderColor:'#1766bf',borderWidth:1},{label:'Put OI',data:found.map(r=>r.pe_oi),backgroundColor:'#fa835f80',borderColor:'#d64326',borderWidth:1},{label:'Call OI Change',data:found.map(r=>r.call_oi_change),backgroundColor:'#2ab76480',borderColor:'#14793c',borderWidth:1},{label:'Put OI Change',data:found.map(r=>r.pe_oi_change),backgroundColor:'#d153a380',borderColor:'#9a286e',borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{y:{ticks:{callback:v=>`${(v/100000).toFixed(0)} L`}}}}});
    renderOptionOiTable('multiTable',found,data.as_of);updateSourceNote(`Dated OI sample · ${data.as_of||'unknown'} · not a verified live feed.`,data.mode||'demo');
  }catch(error){showMessage('multiMessage',error.message,'notice error');updateSourceNote(error.message,'unavailable');}
}

function drawLineChart(canvasId,labels,values,label,color,yTitle='Value') {
  const canvas=byId(canvasId);if(!canvas||!window.Chart)return;
  if(activeChart){activeChart.destroy();activeChart=null;}
  activeChart=new Chart(canvas,{type:'line',data:{labels,datasets:[{label,data:values,borderColor:color,backgroundColor:color+'22',borderWidth:2,pointRadius:2,tension:.25,fill:true}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true,position:'top'}},scales:{x:{title:{display:true,text:'Time'},ticks:{autoSkip:true,maxTicksLimit:18}},y:{title:{display:true,text:yTitle},beginAtZero:false}}}});
}

function renderScenarioChart(canvasId,labels,values,label) {
  drawLineChart(canvasId,labels,values,label,'#275fe7','P&L (per unit)');
  if(activeChart){activeChart.data.datasets[0].borderColor='#0e9c55';activeChart.data.datasets[0].backgroundColor='rgba(14,156,85,.12)';activeChart.update();}
}

async function loadMood() {
  try{
    const data=await getJSON('/api/futures');
    const counts=data.data||{};
    const rows=[['long','LONG BUILDUP','Price up · OI up','long'],['short','SHORT BUILDUP','Price down · OI up','short'],['long_unwind','LONG UNWINDING','Price down · OI down','unwind'],['short_cover','SHORT COVERING','Price up · OI down','cover']];
    byId('moodCards').innerHTML=rows.map(([key,name,rule,cls])=>`<div class="buildup-card ${cls}"><div class="name">${name}</div><div class="rule">${rule}</div><div class="count">${fmtInt(counts[key])}</div><div class="rule">sample count</div></div>`).join('');
    showMessage('moodMessage',`Dated buildup snapshot · ${data.as_of||'unknown'} · aggregate counts only.`);
    updateSourceNote(`Dated aggregate buildup sample · ${data.as_of||'unknown'} · not a live mood signal.`,data.mode||'demo');
  }catch(error){showMessage('moodMessage',error.message,'notice error');updateSourceNote(error.message,'unavailable');}
}
async function loadLiveFutures() {
  try{
    const data=await getJSON('/api/futures');const counts=data.data||{};
    byId('liveFutCards').innerHTML=[['LONG BUILDUP','long','long'],['SHORT BUILDUP','short','short'],['LONG UNWINDING','long_unwind','unwind'],['SHORT COVERING','short_cover','cover']].map(([l,k,c])=>`<div class="buildup-card ${c}"><div class="name">${l}</div><div class="count">${fmtInt(counts[k])}</div><div class="rule">dated snapshot count</div></div>`).join('');
    showMessage('liveFutMessage',`Demo snapshot · ${data.as_of||'unknown'} · counts only, not contract-level market data.`);
    updateSourceNote(`Dated aggregate demo sample · ${data.as_of||'unknown'} · detailed futures feed unavailable.`,data.mode||'demo');
  }catch(error){showMessage('liveFutMessage',error.message,'notice error');updateSourceNote(error.message,'unavailable');}
}

function attachCalculator() {
  const form=byId('calculatorForm');if(!form)return;
  const tool=currentPage.tool||currentPage.title;const spec=calculatorSpec(tool);
  form.addEventListener('submit',(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form));const values={};Object.entries(data).forEach(([k,v])=>values[k]===undefined&&(values[k]=k==='direction'?v:num(v)));const results=spec.calc(values);const host=byId('calculatorResult');host.innerHTML=`<div class="result-inner"><h2>Result · ${esc(tool)}</h2><div class="result-list">${results.map(([l,v])=>`<div><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div><p class="muted">Illustrative output only. Verify assumptions and applicable charges independently.</p></div>`;});
  form.addEventListener('reset',()=>setTimeout(()=>{byId('calculatorResult').innerHTML='<span class="muted">Enter your figures and select Calculate.</span>';},0));
}
function attachReturns() {
  const form=byId('returnForm');if(!form)return;
  form.addEventListener('submit',(e)=>{e.preventDefault();const v=Object.fromEntries(new FormData(form));const p=num(v.principal),r=num(v.rate)/100,y=num(v.years);const fv=p*Math.pow(1+r,y);byId('returnResult').innerHTML=`<div class="result-inner"><h2>Illustrative compound projection</h2><div class="result-list"><div><span>Invested amount</span><b>${INR.format(p)}</b></div><div><span>Projected value</span><b>${INR.format(fv)}</b></div><div><span>Projected gain</span><b>${INR.format(fv-p)}</b></div></div><p class="muted">This is a mathematical projection, not historical index performance.</p></div>`;});
}
function strategyKind(strategy) {const s=(strategy||'').toLowerCase();if(s.includes('bull call'))return 'bull-call';if(s.includes('bear call'))return 'bear-call';if(s.includes('bull put'))return 'bull-put';if(s.includes('bear put'))return 'bear-put';if(s.includes('short straddle'))return 'short-straddle';if(s.includes('long straddle'))return 'long-straddle';if(s.includes('short strangle'))return 'short-strangle';if(s.includes('long strangle'))return 'long-strangle';if(s.includes('long put'))return 'long-put';if(s.includes('short put'))return 'short-put';if(s.includes('short call'))return 'short-call';return 'long-call';}
function strategyPayoff(kind,spot,k1,p1,k2,p2) {
  const c1=Math.max(spot-k1,0),payout1=Math.max(k1-spot,0),c2=Math.max(spot-k2,0),payout2=Math.max(k2-spot,0);
  switch(kind){
    case 'bull-call': return c1-c2-(p1-p2);
    case 'bear-call': return -c1+c2+(p1-p2);
    case 'bull-put': return -(payout1)+(payout2)+(p1-p2);
    case 'bear-put': return payout1-payout2-(p1-p2);
    case 'short-straddle': return p1+p2-Math.abs(spot-k1);
    case 'long-straddle': return Math.abs(spot-k1)-p1-p2;
    case 'short-strangle': return p1+p2-Math.max(k1-spot,0)-Math.max(spot-k2,0);
    case 'long-strangle': return Math.max(k1-spot,0)+Math.max(spot-k2,0)-p1-p2;
    case 'long-put': return payout1-p1;
    case 'short-put': return p1-payout1;
    case 'short-call': return p1-c1;
    default: return c1-p1;
  }
}
function attachBacktest(page) {
  const form=byId('backtestForm');if(!form)return;
  const kind=strategyKind(page.strategy);const leg2Needed=!['long-call','long-put','short-call','short-put'].includes(kind);
  if(!leg2Needed){byId('btStrike2').parentElement.classList.add('hidden');byId('btPremium2').parentElement.classList.add('hidden');}
  const update=(event)=>{
    if(event)event.preventDefault();const fd=new FormData(form);const spot=num(fd.get('spot')),k1=num(fd.get('strike1')),p1=num(fd.get('premium1')),k2=num(fd.get('strike2')),p2=num(fd.get('premium2')),qty=Math.max(1,num(fd.get('quantity'))||1);
    const span=Math.max(spot*.08,500),prices=Array.from({length:31},(_,i)=>spot-span+(2*span*i/30));const perUnit=prices.map(s=>strategyPayoff(kind,s,k1,p1,k2,p2));
    const total=perUnit.map(v=>v*qty),maxProfit=Math.max(...perUnit),maxLoss=Math.min(...perUnit),breakevens=[];
    for(let i=1;i<perUnit.length;i++){if(perUnit[i-1]===0)breakevens.push(prices[i-1]);else if(perUnit[i-1]*perUnit[i]<0){const frac=Math.abs(perUnit[i-1])/(Math.abs(perUnit[i-1])+Math.abs(perUnit[i]));breakevens.push(prices[i-1]+frac*(prices[i]-prices[i-1]));}}
    byId('btSummary').innerHTML=[['MAX PROFIT (PREVIEW)',INR.format(maxProfit*qty)],['MAX LOSS (PREVIEW)',INR.format(maxLoss*qty)],['BREAK-EVEN ESTIMATE',breakevens.length?breakevens.map(x=>fmtNum(x,2)).join(' / '):'Not in range'],['REFERENCE SPOT',fmtNum(spot,2)]].map(([l,v])=>`<div class="summary-card"><div class="label">${esc(l)}</div><div class="value">${esc(v)}</div></div>`).join('');
    renderScenarioChart('btChart',prices.map(x=>fmtNum(x,0)),perUnit,`${page.strategy} · per unit`);
  };
  form.addEventListener('submit',update);update();
}
function attachSimulator() {
  const form=byId('simForm');if(!form)return;
  const update=(e)=>{if(e)e.preventDefault();const v=Object.fromEntries(new FormData(form));const type=v.type,spot=num(v.spot),strike=num(v.strike),premium=num(v.premium),qty=num(v.quantity);const xs=Array.from({length:31},(_,i)=>spot*.88+spot*.24*i/30);const ys=xs.map(s=>((type==='call'?Math.max(s-strike,0):Math.max(strike-s,0))-premium)*qty);const breakeven=type==='call'?strike+premium:strike-premium;byId('simStats').innerHTML=[['BREAK-EVEN',fmtNum(breakeven,2)],['PREMIUM RISK',INR.format(premium*qty)],['MAX LOSS',INR.format(-premium*qty)],['OPTION TYPE',type.toUpperCase()]].map(([l,v])=>`<div class="summary-card"><div class="label">${esc(l)}</div><div class="value">${esc(v)}</div></div>`).join('');renderScenarioChart('simChart',xs.map(x=>fmtNum(x,0)),ys.map(y=>y/qty),`${type} payoff per unit`);};form.addEventListener('submit',update);update();
}
function attachContact() { /* mailto link is intentionally the only submission path; no messages are stored here. */ }
function attachBasicPage(page) {
  const type=page.type;
  if(type==='pcr'){const load=()=>loadPCR();byId('pcrApply')?.addEventListener('click',load);for(const id of ['pcrSymbol','pcrRange','pcrInterval','pcrDate'])byId(id)?.addEventListener('change',load);setActiveRefresh(load);load();}
  else if(type==='callput'){const load=()=>loadCallput();byId('cpApply')?.addEventListener('click',load);setActiveRefresh(load);load();}
  else if(type==='futures-build'){const load=()=>loadFutures();byId('futApply')?.addEventListener('click',load);for(const id of ['futSymbol','futExpiry','futDate','futInterval'])byId(id)?.addEventListener('change',load);setActiveRefresh(load);load();}
  else if(type==='intraday'){const load=()=>loadIntraday();byId('intraApply')?.addEventListener('click',load);byId('intraSymbol')?.addEventListener('change',load);setActiveRefresh(load);load();}
  else if(type==='oi-chart'){const load=()=>loadOI();byId('oiApply')?.addEventListener('click',load);byId('oiSymbol')?.addEventListener('change',load);setActiveRefresh(load);load();}
  else if(type==='option-chain'){const load=()=>loadOptionChain();byId('chainApply')?.addEventListener('click',load);byId('chainSymbol')?.addEventListener('change',load);setActiveRefresh(load);load();}
  else if(type==='oi-list'){const load=()=>loadRanking();byId('rankApply')?.addEventListener('click',load);byId('rankSymbol')?.addEventListener('change',load);byId('rankSide')?.addEventListener('change',load);setActiveRefresh(load);load();}
  else if(type==='multi-strike'){const load=()=>loadMultiStrike();byId('multiApply')?.addEventListener('click',load);setActiveRefresh(load);load();}
  else if(type==='mood'){const load=()=>loadMood();setActiveRefresh(load);load();}
  else if(type==='live-futures'){const load=()=>loadLiveFutures();setActiveRefresh(load);load();}
  else if(type==='calculator'){attachCalculator();setActiveRefresh(async()=>byId('calculatorForm')?.requestSubmit());}
  else if(type==='returns'){attachReturns();setActiveRefresh(async()=>byId('returnForm')?.requestSubmit());}
  else if(type==='backtest'){attachBacktest(page);setActiveRefresh(async()=>byId('backtestForm')?.requestSubmit());}
  else if(type==='simulator'){attachSimulator();setActiveRefresh(async()=>byId('simForm')?.requestSubmit());}
  else if(type==='backtest-index'||type==='tools'||type==='overview'||type==='index'||type==='home'){ setActiveRefresh(async()=>{setSource('demo','Static local page · sample data only.');});}
  else if(type==='contact'){attachContact();setActiveRefresh(async()=>{});}
  else if(type==='research'||type==='zerohero'||type==='history'){
    const msg=byId('histMessage')||byId('researchMessage');
    const btn=byId('histApply')||byId('researchApply');
    const fn=()=>{if(msg)msg.textContent='No matching private historical series is bundled for the selected page/date. The saved public examples remain dated demo data.';};
    btn?.addEventListener('click',fn);setActiveRefresh(async()=>fn());
  } else if(type==='stock-chain'||type==='stock-futures'||type==='stock-target'||type==='screener'){
    const fn=()=>{const node=byId('stockMessage')||byId('screenMessage');if(node)node.textContent='No stock or screener feed is connected; no result rows were fabricated.';};
    byId('stockApply')?.addEventListener('click',fn);byId('screenApply')?.addEventListener('click',fn);setActiveRefresh(async()=>fn());
  }
}

function setupFooterLinks() {
  const footer=document.querySelector('.footer-inner');if(!footer)return;
  footer.innerHTML=`<div class="footer-about"><a href="/" class="footer-brand"><img src="/assets/img/trading-tick-logo.webp" alt="Trading Tick"></a><p>Option analytics, historical charts, futures OI, research and tools—on separate pages.</p><p class="footer-mode-note">Local clone · demo data identified where used</p></div><div><h2>Nifty &amp; Sensex</h2><a href="/nifty/nifty-banknifty-finnifty-option-dashboard.php">Nifty Option Dashboard</a><a href="/nifty/nifty-banknifty-finnifty-intraday-pcr-live.php">Nifty Live PCR</a><a href="/nifty/nifty-banknifty-finnifty-call-vs-put-oi.php">Call vs Put OI</a><a href="/sensex/bse-sensex-option-chain-live.php">Sensex Option Chain</a></div><div><h2>Futures &amp; Research</h2><a href="/futures/future-oi-analysis.php">Future OI</a><a href="/futures/nifty-mood-indicator.php">Nifty Mood</a><a href="/nifty/nifty-expiry-day-historical-data-analysis.php">Zero to Hero</a><a href="/nifty/option-backtesting/nifty-bull-call-spread-strategy-backtest-results.php">Backtest Scenarios</a></div><div><h2>More</h2><a href="/stock/option-chain/">Stock Option Chain</a><a href="/tools/index.php">Trading Tools</a><a href="/contact-us.php">Contact us</a><a href="mailto:tradingtick.in@gmail.com">Email Trading Tick</a></div>`;
}

function setupToolbar() {
  const interval=byId('refreshInterval');const count=byId('refreshCount');const pause=byId('pauseRefresh');const now=byId('refreshNow');
  interval?.addEventListener('change',()=>{toolbarInterval=Math.max(10,Number(interval.value)||60);toolbarRemaining=toolbarInterval;if(count)count.textContent=`${toolbarRemaining}s`;});
  now?.addEventListener('click',async()=>{if(refreshBusy)return;refreshBusy=true;try{await activePageRefresh();showToast('Page refreshed. Check this page’s source badge and as-of note.');}finally{refreshBusy=false;}});
  pause?.addEventListener('click',()=>{toolbarPaused=!toolbarPaused;pause.textContent=toolbarPaused?'Resume':'Pause';pause.setAttribute('aria-pressed',String(toolbarPaused));});
  if(toolbarTimer)clearInterval(toolbarTimer);
  toolbarTimer=setInterval(async()=>{if(toolbarPaused)return;toolbarRemaining-=1;if(count)count.textContent=`${toolbarRemaining}s`;if(toolbarRemaining<=0){toolbarRemaining=toolbarInterval;if(!refreshBusy){refreshBusy=true;try{await activePageRefresh();}catch{}finally{refreshBusy=false;}}}},1000);
}
let toastTimer;
function showToast(message){const toast=byId('toast');if(!toast)return;toast.textContent=message;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),2800);}

async function boot() {
  try { const response=await fetch('/assets/site-pages.json',{cache:'no-store'});SITE=await response.json(); }
  catch(error){byId('mainContent').innerHTML=`<div class="notice error">Could not load the local page map: ${esc(error.message)}</div>`;return;}
  buildNavigation();setupFooterLinks();
  const path=getPath();
  const page=SITE.pages[path]||SITE.pages[path.replace(/\/$/,'/')]||null;
  if(!page){byId('mainContent').innerHTML=`<div class="page-heading"><h1>Page not found</h1></div><div class="empty-state">This local route is not in the clone's page map. <a href="/">Return home</a>.</div>`;return;}
  currentPage=page;
  document.title=`${page.title||'Trading Tick'} | Trading Tick`;
  byId('mainContent').innerHTML=renderPage(page);
  attachBasicPage(page);
  window.scrollTo(0,0);
}

document.addEventListener('DOMContentLoaded',boot);
