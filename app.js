// ===================================================
//  Luna & Elma 天気 & ニュースアプリ  —  app.js
//  天気: Open-Meteo（無料・APIキー不要）  |  ニュース: Yahoo Japan RSS + rss2json  |  犬の写真: Dog CEO API
// ===================================================

// ===== APIキー =====
// キーは config.js で定義されています（.gitignore により非公開）
// WEATHER_API_KEY / GEMINI_API_KEY

// ===== 保存キー =====
const LS = {
  theme:     'sora_theme',
  unit:      'sora_unit',
  history:   'sora_history',
  favorites: 'sora_favorites',
  category:  'sora_news_category',
  chat:      'sora_chat_history',
  volume:    'sora_volume',
  newsRead:  'sora_news_read',
  bookmarks: 'sora_bookmarks',
  notif:     'sora_notif',
  fontSize:  'sora_font_size',
  uiCustom:  'sora_ui_custom',
};

// ===== 人気都市（オートコンプリート候補） =====
const POPULAR_CITIES = [
  '東京', '大阪', '京都', '福岡', '札幌', '名古屋', '仙台', '広島', '神戸', '横浜',
  '和歌山', '奈良', '金沢', '那覇', '長崎', '熊本', '新潟', '静岡',
  'Tokyo', 'Osaka', 'London', 'New York', 'Paris', 'Sydney', 'Seoul', 'Beijing',
  'Bangkok', 'Singapore', 'Dubai', 'Los Angeles', 'Berlin', 'Toronto',
];

// ===== DOM要素 =====
const cityInput       = document.getElementById('city-input');
const searchBtn       = document.getElementById('search-btn');
const geoBtn          = document.getElementById('geo-btn');
const unitSelect      = document.getElementById('unit-select');
const themeBtn        = document.getElementById('theme-btn');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const historyBox      = document.getElementById('history');
const statusBar       = document.getElementById('status');
const statusText      = document.getElementById('status-text');
const errorBar        = document.getElementById('error-msg');
const errorText       = document.getElementById('error-text');
const weatherResult   = document.getElementById('weather-result');
const acBox           = document.getElementById('ac-box');
const newsContainer   = document.getElementById('news-container');
const newsTabs        = document.getElementById('news-tabs');
const particleCanvas  = document.getElementById('particle-canvas');

// ===== 状態 =====
let currentCategory = 'general';
let particles       = [];
let particleAnim    = null;
let pCtx            = null;
let lastCoords        = null; // { lat, lon }
let _cachedGeo        = null; // オートコンプリートで選択した lat/lon キャッシュ
let currentWeatherData = null;
let currentCity       = '';
let chartInstance     = null;
let leafletMap        = null;
let mapOverlayLayer   = null;
let mapMarker         = null;
let notificationsEnabled = false;
let lastNotifiedKey   = '';
let autoRefreshTimer  = null;
const AUTO_REFRESH_MS = 10 * 60 * 1000; // 10分

// ===== ユーティリティ =====
// iOS 15 以前では AbortSignal.timeout() 未対応のため互換ラッパーを使用
function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

function setLoading(on, text = '読み込み中...') {
  statusBar.classList.toggle('show', on);
  statusText.textContent = text;
  searchBtn.disabled = on;
  geoBtn.disabled    = on;
}
function showError(msg, retryable = true) {
  errorBar.classList.add('show');
  errorText.textContent = msg;
  const retryBtn = document.getElementById('error-retry-btn');
  if (retryBtn) retryBtn.style.display = retryable ? '' : 'none';
}
function clearError() {
  errorBar.classList.remove('show');
  const retryBtn = document.getElementById('error-retry-btn');
  if (retryBtn) retryBtn.style.display = 'none';
}
let _countdownTimer = null;
function showError429(seconds) {
  if (_countdownTimer) clearInterval(_countdownTimer);
  clearError();
  errorBar.classList.add('show');
  let remaining = seconds;
  // DOM を直接操作し innerHTML を使わない
  errorText.textContent = '';
  const countdownEl = document.createElement('span');
  countdownEl.className = 'countdown';
  errorText.appendChild(document.createTextNode('APIリクエスト制限中です。'));
  errorText.appendChild(countdownEl);
  errorText.appendChild(document.createTextNode('秒後に再試行できます。'));
  const update = () => {
    countdownEl.textContent = String(remaining);
    if (remaining-- <= 0) {
      clearInterval(_countdownTimer);
      _countdownTimer = null;
      errorBar.classList.remove('show');
    }
  };
  update();
  _countdownTimer = setInterval(update, 1000);
}
function showResult(on) {
  weatherResult.classList.toggle('show', on);
  weatherResult.style.display = on ? 'block' : 'none';
}
function showWeatherSkeleton() {
  weatherResult.classList.add('show', 'skeleton-loading');
}
function hideWeatherSkeleton() {
  weatherResult.classList.remove('skeleton-loading');
}
function safeText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function safeHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
function unixToTime(unix, offset = 0) {
  const d = new Date((unix + offset) * 1000);
  return String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0');
}
function degToDir(deg) {
  const d = ['北','北北東','北東','東北東','東','東南東','南東','南南東','南','南南西','南西','西南西','西','西北西','北西','北北西'];
  return d[Math.round(deg / 22.5) % 16];
}
function fmtTemp(v, unit) {
  if (v == null || isNaN(v)) return '—';
  return Math.round(v) + (unit === 'imperial' ? '℉' : '℃');
}
function fmtWind(v, unit) {
  if (v == null) return '—';
  return v + ' ' + (unit === 'imperial' ? 'mph' : 'm/s');
}
function fmtVis(m) {
  if (m == null) return '—';
  return m >= 1000 ? (m/1000).toFixed(1) + ' km' : m + ' m';
}
function fmtPct(p)  { return p == null ? '—' : p + '%'; }
function fmtHpa(h)  { return h == null ? '—' : h + ' hPa'; }
function tempColorStyle(tempVal, unit) {
  if (tempVal == null) return '';
  const c = unit === 'imperial' ? (tempVal - 32) * 5/9 : tempVal;
  const col = c <= 10 ? '#60a5fa' : c >= 20 ? '#fb923c' : '';
  return col ? ' style="color:' + col + ';"' : '';
}

async function fetchJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res  = await fetch(url, { signal: ctrl.signal });
    if (res.status === 429) {
      return { ok: false, status: 429, data: null };
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

// ===== テーマ =====
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(LS.theme, theme);
  themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  sbSaveSettings({ theme: next });
}

// ===== UIカスタマイズ =====
const UI_DEFAULTS = { hue: 239, radius: 'default', fontSize: 'md', bgTheme: 'cosmic' };

function applyUICustom(cfg) {
  const root = document.documentElement;
  const hue = cfg.hue ?? 239;
  root.style.setProperty('--hue', hue);
  root.style.setProperty('--accent',      `hsl(${hue}, 82%, 63%)`);
  root.style.setProperty('--accent2',     `hsl(${hue}, 82%, 72%)`);
  root.style.setProperty('--accent-dark', `hsl(${hue}, 74%, 50%)`);
  root.style.setProperty('--glow',        `0 0 40px hsl(${hue} 82% 63% / 0.18)`);
  const RADIUS = {
    sharp:   { r:'6px',  r2:'4px',  btn:'8px',   chip:'6px',   input:'8px'  },
    default: { r:'20px', r2:'14px', btn:'14px',  chip:'999px', input:'14px' },
    round:   { r:'32px', r2:'24px', btn:'999px', chip:'999px', input:'28px' }
  };
  const rv = RADIUS[cfg.radius ?? 'default'];
  root.style.setProperty('--radius',       rv.r);
  root.style.setProperty('--radius2',      rv.r2);
  root.style.setProperty('--radius-btn',   rv.btn);
  root.style.setProperty('--radius-chip',  rv.chip);
  root.style.setProperty('--radius-input', rv.input);
  const FONT_SIZE = { sm: '13px', md: '15px', lg: '17px' };
  document.body.style.fontSize = FONT_SIZE[cfg.fontSize ?? 'md'];
  root.dataset.bgTheme = cfg.bgTheme ?? 'cosmic';
}
function saveUICustom(cfg) {
  try { localStorage.setItem(LS.uiCustom, JSON.stringify(cfg)); } catch {}
}
function loadUICustom() {
  try { return JSON.parse(localStorage.getItem(LS.uiCustom) || '{}'); } catch { return {}; }
}

// ===== 単位 =====
function applyUnit(u) {
  unitSelect.value = u;
  localStorage.setItem(LS.unit, u);
}

// ===== 履歴 =====
function loadHistory() {
  try { const r = JSON.parse(localStorage.getItem(LS.history)||'[]'); return Array.isArray(r)?r:[]; }
  catch { return []; }
}
function saveHistory(city) {
  const c = city.trim(); if (!c) return;
  const next = [c, ...loadHistory().filter(x=>x!==c)].slice(0,8);
  localStorage.setItem(LS.history, JSON.stringify(next));
  renderHistory();
  // クラウド同期（ログイン中のみ）
  if (sbCurrentUser()) sbSaveSettings({ search_history: next });
}
function clearHistory() { localStorage.removeItem(LS.history); renderHistory(); }
function deleteHistoryItem(city) {
  const next = loadHistory().filter(x => x !== city);
  localStorage.setItem(LS.history, JSON.stringify(next));
  renderHistory();
}
function renderHistory() {
  historyBox.innerHTML = '';
  loadHistory().forEach(name => {
    const wrap = document.createElement('span');
    wrap.className = 'chip-wrap';
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = name;
    b.addEventListener('click', () => { cityInput.value = name; getWeatherByCity(name); });
    const del = document.createElement('button');
    del.className = 'chip-del'; del.textContent = '×'; del.title = '履歴から削除';
    del.addEventListener('click', e => { e.stopPropagation(); deleteHistoryItem(name); });
    wrap.appendChild(b); wrap.appendChild(del);
    historyBox.appendChild(wrap);
  });
}

// ===== お気に入り =====
function loadFavorites() {
  try { const r = JSON.parse(localStorage.getItem(LS.favorites)||'[]'); return Array.isArray(r)?r:[]; }
  catch { return []; }
}
function toggleFavorite(city) {
  const favs = loadFavorites();
  const idx  = favs.indexOf(city);
  if (idx >= 0) favs.splice(idx, 1);
  else { favs.unshift(city); if (favs.length > 10) favs.pop(); }
  localStorage.setItem(LS.favorites, JSON.stringify(favs));
  sbSaveSettings({ favorites: favs });
  renderFavorites();
  updateFavBtn(city);
}

// ===== ニュースブックマーク =====
function loadBookmarks() {
  try { const r = JSON.parse(localStorage.getItem(LS.bookmarks) || '[]'); return Array.isArray(r) ? r : []; }
  catch { return []; }
}
function isBookmarked(url) {
  return loadBookmarks().some(b => b.url === url);
}
function toggleBookmark(article) {
  const bmarks = loadBookmarks();
  const idx = bmarks.findIndex(b => b.url === article.url);
  if (idx >= 0) bmarks.splice(idx, 1);
  else { bmarks.unshift({ url: article.url, title: article.title, source: article.source || '', publishedAt: article.publishedAt || '', image: article.image || '' }); if (bmarks.length > 50) bmarks.pop(); }
  localStorage.setItem(LS.bookmarks, JSON.stringify(bmarks));
  sbSaveSettings({ news_bookmarks: bmarks });
}
function renderFavorites() {
  const section = document.getElementById('favorites-section');
  const box     = document.getElementById('favorites-box');
  if (!section || !box) return;
  const favs = loadFavorites();
  if (!favs.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  box.innerHTML = '';
  favs.forEach(name => {
    const wrap = document.createElement('div');
    wrap.className = 'chip-wrap';
    const b = document.createElement('button');
    b.className = 'chip fav-chip';
    b.textContent = '⭐ ' + name;
    b.addEventListener('click', () => { cityInput.value = name; getWeatherByCity(name); });
    const del = document.createElement('button');
    del.className = 'chip-del';
    del.textContent = '×';
    del.title = 'お気に入りから削除';
    del.addEventListener('click', e => { e.stopPropagation(); toggleFavorite(name); });
    wrap.appendChild(b);
    wrap.appendChild(del);
    box.appendChild(wrap);
  });
  renderFavWeatherDashboard();
}

async function renderFavWeatherDashboard() {
  const favs    = loadFavorites();
  const section = document.getElementById('fav-weather-section');
  const grid    = document.getElementById('fav-weather-grid');
  if (!section || !grid) return;
  if (!favs.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  grid.innerHTML = favs.map(() => '<div class="fav-weather-card skeleton"></div>').join('');

  const results = await Promise.all(favs.map(async city => {
    try {
      const geoResults = await geocodeOpenMeteo(buildGeoQuery(city));
      if (!geoResults.length) return null;
      const { lat, lon, country } = geoResults[0];
      // 日本語入力はそのまま表示名として使用（カタカナ変換を防ぐ）
      const displayName = /[\u3040-\u30ff\u3000-\u9fff\uff00-\uffef]/.test(city)
        ? city : geoResults[0].name;
      return await fetchWeatherOpenMeteo(lat, lon, 'metric', displayName, country);
    } catch { return null; }
  }));

  grid.innerHTML = '';
  results.forEach((d, i) => {
    const card = document.createElement('div');
    card.className = 'fav-weather-card';
    if (!d) {
      card.innerHTML =
        '<div class="fwc-city">' + escHtml(favs[i]) + '</div>' +
        '<div class="fwc-err">取得失敗</div>';
    } else {
      const icon = d.weather?.[0]?.icon || '01d';
      const temp = Math.round(d.main?.temp ?? 0);
      const desc = d.weather?.[0]?.description ?? '';
      card.innerHTML =
        '<div class="fwc-city">' + escHtml(d.name || favs[i]) + '</div>' +
        '<img class="fwc-icon" src="https://openweathermap.org/img/wn/' + icon + '@2x.png" alt="' + escHtml(desc) + '" loading="lazy">' +
        '<div class="fwc-temp">' + temp + '°</div>' +
        '<div class="fwc-desc">' + escHtml(desc) + '</div>';
    }
    card.addEventListener('click', () => { cityInput.value = favs[i]; getWeatherByCity(favs[i]); });
    grid.appendChild(card);
  });
}
function updateFavBtn(city) {
  const btn = document.getElementById('fav-btn');
  if (!btn) return;
  const isFav = loadFavorites().includes(city);
  btn.textContent = isFav ? '⭐' : '☆';
  btn.title = isFav ? 'お気に入りから削除' : 'お気に入りに追加';
}

// ===== URL共有 =====
let _shareUrl = '';
function setShareLink(city) {
  const u = new URL(location.href);
  u.searchParams.set('city', city);
  _shareUrl = u.toString();
  const btn = document.getElementById('share-btn');
  if (btn) btn.dataset.url = _shareUrl;
}

function showToast(msg) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===== AQI 大気質指数 =====
const AQI_LABELS = ['', '良好', '良い', '普通', '悪い', '非常に悪い'];
const AQI_CLASSES = ['', 'aqi-1', 'aqi-2', 'aqi-3', 'aqi-4', 'aqi-5'];

async function fetchAndRenderAQI(lat, lon) {
  const card = document.getElementById('aqi-card');
  const valEl = document.getElementById('aqi-value');
  const lblEl = document.getElementById('aqi-label');
  if (!card) return;
  try {
    const r = await fetchJson(
      'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + lat + '&longitude=' + lon +
      '&current=european_aqi,pm2_5',
      10000
    );
    if (!r.ok || r.data?.current?.european_aqi == null) { card.style.display = 'none'; return; }
    const eaqi = r.data.current.european_aqi;
    const pm25 = r.data.current.pm2_5;
    // European AQI (0-100+) → 1-5スケール
    const aqi = eaqi <= 20 ? 1 : eaqi <= 40 ? 2 : eaqi <= 60 ? 3 : eaqi <= 80 ? 4 : 5;
    valEl.textContent = aqi;
    valEl.className = 'kv-value ' + (AQI_CLASSES[aqi] || '');
    lblEl.textContent = (AQI_LABELS[aqi] || '—') +
      (pm25 != null ? '  PM2.5: ' + pm25.toFixed(1) + ' μg/m³' : '');
    card.style.display = '';
  } catch { card.style.display = 'none'; }
}

// ===== Open-Meteo 天気プロバイダー =====
const OM_WMO_MAP = {
  0:'晴れ',1:'おおむね晴れ',2:'一部曇り',3:'曇り',
  45:'霧',48:'着氷性の霧',51:'霧雨(弱)',53:'霧雨',55:'霧雨(強)',
  61:'雨(弱)',63:'雨',65:'雨(強)',71:'雪(弱)',73:'雪',75:'雪(強)',
  80:'にわか雨(弱)',81:'にわか雨',82:'にわか雨(強)',
  95:'雷雨',96:'雹を伴う雷雨',99:'強い雹を伴う雷雨'
};
const OM_WMO_ICON = {
  0:'01d',1:'01d',2:'02d',3:'04d',45:'50d',48:'50d',
  51:'09d',53:'09d',55:'09d',61:'10d',63:'10d',65:'10d',
  71:'13d',73:'13d',75:'13d',80:'09d',81:'09d',82:'09d',
  95:'11d',96:'11d',99:'11d'
};

// ジオコーディング（都市名 → 緯度経度）
async function geocodeOpenMeteo(query) {
  // OWM 形式の ",JP" サフィックスを除去し、日本かどうか判定
  const isJP = /,JP$/i.test(query);
  let name = query.replace(/,JP$/i, '').trim();
  // 市・区・町・村 サフィックスを除去（Open-Meteo は都市名のみで検索）
  name = name.replace(/[市区町村]$/, '').trim();

  let url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
    encodeURIComponent(name) + '&count=5&language=ja&format=json';
  if (isJP) url += '&country_id=JP'; // 日本都市は JP に絞る

  const r = await fetchJson(url, 10000);
  if (!r.ok || !r.data?.results?.length) return [];
  return r.data.results.map(d => ({
    lat: d.latitude,
    lon: d.longitude,
    name: d.name,
    country: d.country_code || '',
    state: d.admin1 || '',
    displayName: d.name,
  }));
}

async function fetchWeatherOpenMeteo(lat, lon, unit, cityName, countryCode) {
  const tempUnit = unit === 'imperial' ? 'fahrenheit' : 'celsius';
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m,is_day,visibility' +
    '&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min' +
    '&temperature_unit=' + tempUnit + '&wind_speed_unit=ms&timezone=auto&forecast_days=1';
  const r = await fetchJson(url, 12000);
  if (!r.ok || !r.data?.current) return null;
  const c     = r.data.current;
  const daily = r.data.daily;
  const wmo   = c.weather_code ?? 0;
  const isDay = c.is_day !== 0;
  const iconBase = OM_WMO_ICON[wmo] || '01d';
  const icon     = isDay ? iconBase : iconBase.replace('d', 'n');
  const sunriseTs = daily?.sunrise?.[0] ? Math.floor(new Date(daily.sunrise[0]).getTime() / 1000) : null;
  const sunsetTs  = daily?.sunset?.[0]  ? Math.floor(new Date(daily.sunset[0]).getTime()  / 1000) : null;
  return {
    name: cityName || '—',
    sys: { country: countryCode || '', sunrise: sunriseTs, sunset: sunsetTs },
    coord: { lat, lon },
    weather: [{ description: OM_WMO_MAP[wmo] || '—', icon }],
    main: {
      temp:       c.temperature_2m,
      feels_like: c.apparent_temperature,
      temp_min:   daily?.temperature_2m_min?.[0] ?? c.temperature_2m,
      temp_max:   daily?.temperature_2m_max?.[0] ?? c.temperature_2m,
      humidity:   c.relative_humidity_2m,
      pressure:   c.surface_pressure,
    },
    wind:       { speed: c.wind_speed_10m, deg: c.wind_direction_10m },
    rain:       c.precipitation > 0 ? { '1h': c.precipitation } : undefined,
    snow:       undefined,
    clouds:     { all: 0 },
    visibility: c.visibility != null ? Math.round(c.visibility) : null,
    dt:         Math.floor(new Date(c.time).getTime() / 1000),
    timezone:   r.data.utc_offset_seconds ?? 0,
  };
}

// ===== 予報（24h・週間） =====
async function fetchAndRenderForecast(lat, lon, unit) {
  try {
    const tempUnit = unit === 'imperial' ? 'fahrenheit' : 'celsius';
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&temperature_unit=' + tempUnit + '&wind_speed_unit=ms&timezone=auto&forecast_days=7';
    const r = await fetchJson(url, 12000);
    if (!r.ok || !r.data?.hourly || !r.data?.daily) return;

    const tzOffset = r.data.utc_offset_seconds ?? 0;
    const hourly   = r.data.hourly;
    const daily    = r.data.daily;
    const nowSec   = Date.now() / 1000;

    // 3時間間隔に間引いて OWM 互換リストを作成（現在〜48h）
    const hourlyList = hourly.time
      .map((t, i) => ({
        dt:      Math.floor(new Date(t).getTime() / 1000),
        main:    { temp: hourly.temperature_2m[i] },
        weather: [{ icon: OM_WMO_ICON[hourly.weather_code[i]] || '01d', description: OM_WMO_MAP[hourly.weather_code[i]] || '—' }],
        pop:     (hourly.precipitation_probability[i] || 0) / 100,
        wind:    { speed: hourly.wind_speed_10m[i] },
      }))
      .filter(item => item.dt >= nowSec - 1800) // 現在時刻以降のみ
      .filter((_, idx) => idx % 3 === 0)        // 3時間間隔
      .slice(0, 16);                             // 最大48h

    const WDAY = ['日','月','火','水','木','金','土'];
    const dailyList = daily.time.map((t, i) => {
      const d = new Date(t + 'T00:00:00Z');
      const wmo = daily.weather_code[i];
      return {
        dt:      Math.floor(d.getTime() / 1000) - tzOffset,
        label:   (d.getUTCMonth()+1) + '/' + d.getUTCDate() + '（' + WDAY[d.getUTCDay()] + '）',
        main:    { temp: (daily.temperature_2m_max[i] + daily.temperature_2m_min[i]) / 2 },
        temp_max: daily.temperature_2m_max[i],
        temp_min: daily.temperature_2m_min[i],
        weather: [{ icon: OM_WMO_ICON[wmo] || '01d', description: OM_WMO_MAP[wmo] || '—' }],
        pop:     (daily.precipitation_probability_max[i] || 0) / 100,
      };
    });

    const fd = { list: hourlyList, dailyList, city: { timezone: tzOffset } };
    renderHourlyForecast(fd, unit);
    renderWeeklyForecast(fd, unit);
    renderTempChart(fd, unit);
    checkRainBanner(fd);
  } catch { /* 予報取得失敗は無視（メイン天気は表示済み） */ }
}

// ===== 波状況ヘルパー =====
function waveStateLabel(h) {
  if (h === null || h === undefined || isNaN(h)) return '–';
  if (h < 0.1)  return '鏡のように穏やか';
  if (h < 0.5)  return 'さざ波';
  if (h < 1.25) return 'やや波あり';
  if (h < 2.5)  return '波あり';
  if (h < 4)    return 'やや荒れ';
  if (h < 6)    return '荒れ';
  return '大時化';
}
function waveStateColor(h) {
  if (h === null || h === undefined || isNaN(h)) return '#94a3b8';
  if (h < 0.5)  return '#4ade80';
  if (h < 1.25) return '#a3e635';
  if (h < 2.5)  return '#facc15';
  if (h < 4)    return '#fb923c';
  return '#f87171';
}
function waveStatePct(h) {
  if (h === null || h === undefined || isNaN(h)) return 0;
  return Math.min(100, Math.round((Number(h) / 6) * 100));
}
function degToCompass(deg) {
  if (deg === null || deg === undefined || isNaN(deg)) return '–';
  const dirs = ['北','北北東','北東','東北東','東','東南東','南東','南南東','南','南南西','南西','西南西','西','西北西','北西','北北西'];
  return dirs[Math.round(Number(deg) / 22.5) % 16];
}

// ===== 波情報レンダリング =====
function renderWave(c, h) {
  const card = document.getElementById('wave-card');
  if (!card) return;
  const wh    = c.wave_height;
  const color = waveStateColor(wh);
  const state = waveStateLabel(wh);
  const pct   = waveStatePct(wh);
  const fmtM  = v => (v !== null && v !== undefined && !isNaN(v)) ? Number(v).toFixed(1) + 'm' : '–';
  const fmtS  = v => (v !== null && v !== undefined && !isNaN(v)) ? Number(v).toFixed(1) + 's' : '–';
  const fmtT  = v => (v !== null && v !== undefined && !isNaN(v)) ? Number(v).toFixed(1) + '°C' : '–';

  // 24時間予報ストリップ
  let hourlyHTML = '';
  if (h?.time?.length) {
    const now = Date.now();
    let startIdx = 0;
    for (let i = 0; i < h.time.length; i++) {
      if (new Date(h.time[i]).getTime() >= now - 3600000) { startIdx = i; break; }
    }
    const items = h.time.slice(startIdx, startIdx + 24);
    items.forEach((t, i) => {
      const idx    = startIdx + i;
      const iH     = h.wave_height?.[idx];
      const iD     = h.wave_direction?.[idx];
      const iP     = h.wave_period?.[idx];
      const iColor = waveStateColor(iH);
      const timeStr = new Date(t).getHours().toString().padStart(2, '0') + ':00';
      const arrow = (iD !== null && iD !== undefined && !isNaN(iD))
        ? '<span style="display:inline-block;transform:rotate(' + Math.round(Number(iD)) + 'deg)">↑</span>'
        : '–';
      hourlyHTML +=
        '<div class="wave-hourly-item">' +
          '<span class="wave-hourly-time">' + timeStr + '</span>' +
          '<span class="wave-hourly-height" style="color:' + iColor + '">' +
            (iH !== null && !isNaN(iH) ? Number(iH).toFixed(1) + 'm' : '–') +
          '</span>' +
          '<span class="wave-hourly-dir">' + arrow + '</span>' +
          '<span class="wave-hourly-period">' +
            (iP !== null && !isNaN(iP) ? Number(iP).toFixed(0) + 's' : '') +
          '</span>' +
        '</div>';
    });
  }

  card.innerHTML =
    '<div class="wave-current-grid">' +
      '<div class="wave-kv">' +
        '<div class="wave-kv-label">🌊 波高</div>' +
        '<div class="wave-kv-value" style="color:' + color + '">' + fmtM(wh) + '</div>' +
        '<div class="wave-kv-sub">' + state + '</div>' +
      '</div>' +
      '<div class="wave-kv">' +
        '<div class="wave-kv-label">🕒 周期</div>' +
        '<div class="wave-kv-value">' + fmtS(c.wave_period) + '</div>' +
        '<div class="wave-kv-sub">ピーク: ' + fmtS(c.wave_peak_period) + '</div>' +
      '</div>' +
      '<div class="wave-kv">' +
        '<div class="wave-kv-label">🧭 波向</div>' +
        '<div class="wave-kv-value" style="font-size:17px;">' + degToCompass(c.wave_direction) + '</div>' +
        '<div class="wave-kv-sub">' + (c.wave_direction !== null && !isNaN(c.wave_direction) ? Math.round(c.wave_direction) + '°' : '–') + '</div>' +
      '</div>' +
      '<div class="wave-kv">' +
        '<div class="wave-kv-label">🌐 うねり</div>' +
        '<div class="wave-kv-value" style="color:' + waveStateColor(c.swell_wave_height) + '">' + fmtM(c.swell_wave_height) + '</div>' +
        '<div class="wave-kv-sub">' + degToCompass(c.swell_wave_direction) + ' / ' + fmtS(c.swell_wave_period) + '</div>' +
      '</div>' +
      '<div class="wave-kv">' +
        '<div class="wave-kv-label">💨 風波</div>' +
        '<div class="wave-kv-value">' + fmtM(c.wind_wave_height) + '</div>' +
        '<div class="wave-kv-sub">風による波</div>' +
      '</div>' +
      '<div class="wave-kv">' +
        '<div class="wave-kv-label">🌡 海水温</div>' +
        '<div class="wave-kv-value">' + fmtT(c.sea_surface_temperature) + '</div>' +
        '<div class="wave-kv-sub">海面水温</div>' +
      '</div>' +
    '</div>' +
    '<div class="wave-state-bar"><div class="wave-state-marker" style="left:' + pct + '%"></div></div>' +
    '<div class="wave-scale-labels"><span>穏やか</span><span>やや波あり</span><span>大時化</span></div>' +
    '<div class="wave-hourly-label">24時間予報</div>' +
    '<div class="wave-hourly-wrap"><div class="wave-hourly-strip">' + hourlyHTML + '</div></div>';
}

// ===== 波情報取得 =====
async function fetchAndRenderWave(lat, lon) {
  const section = document.getElementById('wave-section');
  if (!section) return;
  try {
    const currentVars = [
      'wave_height','wave_direction','wave_period','wave_peak_period',
      'swell_wave_height','swell_wave_direction','swell_wave_period',
      'wind_wave_height','sea_surface_temperature'
    ].join(',');
    const url =
      'https://marine-api.open-meteo.com/v1/marine' +
      '?latitude=' + lat + '&longitude=' + lon +
      '&current=' + currentVars +
      '&hourly=wave_height,wave_direction,wave_period,swell_wave_height' +
      '&timezone=auto&forecast_days=2';
    const r = await fetchJson(url, 10000);
    if (!r.ok || !r.data?.current) { section.style.display = 'none'; return; }
    const c = r.data.current;
    // 内陸判定：主要データがすべて null なら非表示
    if (c.wave_height === null && c.sea_surface_temperature === null) {
      section.style.display = 'none'; return;
    }
    section.style.display = '';
    renderWave(c, r.data.hourly);
  } catch {
    section.style.display = 'none';
  }
}

// ===== 雨予報バナー =====
function checkRainBanner(fd) {
  const banner = document.getElementById('rain-banner');
  if (!banner) return;
  // セッション内で閉じられていたら出さない
  if (sessionStorage.getItem('rain_banner_dismissed')) return;
  const upcoming = fd.list.slice(0, 3); // 次 ~9h
  const rainItem = upcoming.find(item => {
    const pop  = item.pop ?? 0;
    const icon = item.weather?.[0]?.icon ?? '';
    return pop >= 0.40 || icon.startsWith('09') || icon.startsWith('10') || icon.startsWith('11');
  });
  if (!rainItem) { banner.classList.remove('show'); return; }
  const tz   = fd.city?.timezone ?? 0;
  const time = unixToTime(rainItem.dt, tz);
  const pop  = Math.round((rainItem.pop ?? 0) * 100);
  const desc = rainItem.weather?.[0]?.description ?? '雨';
  const icon = rainItem.weather?.[0]?.icon ?? '';
  const emoji = icon.startsWith('11') ? '⛈' : '🌂';
  const textEl = banner.querySelector('.rain-banner-text');
  if (textEl) textEl.innerHTML =
    '<strong>' + time + '頃から' + desc + 'の予報</strong>（降水確率 ' + pop + '%）。傘をお忘れなく！';
  const iconEl = banner.querySelector('.rain-banner-icon');
  if (iconEl) iconEl.textContent = emoji;
  banner.classList.add('show');
}

function renderHourlyForecast(fd, unit) {
  const section = document.getElementById('hourly-section');
  const strip   = document.getElementById('hourly-strip');
  if (!section || !strip) return;
  const tz = fd.city?.timezone ?? 0;
  strip.innerHTML = fd.list.slice(0, 8).map(item => {
    const icon = item.weather?.[0]?.icon ?? '01d';
    const desc = item.weather?.[0]?.description ?? '';
    const pop  = item.pop ? Math.round(item.pop * 100) : 0;
    return '<div class="hourly-item">' +
      '<div class="hourly-time">' + unixToTime(item.dt, tz) + '</div>' +
      '<img src="https://openweathermap.org/img/wn/' + icon + '.png" alt="' + escHtml(desc) + '" title="' + escHtml(desc) + '">' +
      '<div class="hourly-temp"' + tempColorStyle(item.main?.temp, unit) + '>' + fmtTemp(item.main?.temp, unit) + '</div>' +
      '<div class="hourly-pop">' + (pop > 0 ? '<span class="pop-pill" style="--p:' + pop + '%">' + pop + '%</span>' : '') + '</div>' +
    '</div>';
  }).join('');
  section.style.display = 'block';
}

function renderWeeklyForecast(fd, unit) {
  const section = document.getElementById('weekly-section');
  const grid    = document.getElementById('weekly-grid');
  if (!section || !grid) return;
  const tUnit = unit === 'imperial' ? '℉' : '℃';

  // Open-Meteo dailyList を優先使用
  const dayValues = (fd.dailyList || []).slice(0, 7).map(d => ({
    label:  d.label,
    maxT:   d.temp_max ?? d.main?.temp,
    minT:   d.temp_min ?? d.main?.temp,
    avgT:   d.main?.temp,
    icon:   d.weather?.[0]?.icon || '01d',
    maxPop: Math.round((d.pop ?? 0) * 100),
  }));

  if (!dayValues.length) { section.style.display = 'none'; return; }

  grid.innerHTML = dayValues.map((d, i) => {
    let trend = '';
    if (i > 0) {
      const diff = (d.avgT ?? 0) - (dayValues[i-1].avgT ?? 0);
      if (diff > 1.5)       trend = '<span class="weekly-trend up">▲</span>';
      else if (diff < -1.5) trend = '<span class="weekly-trend down">▼</span>';
      else                  trend = '<span class="weekly-trend flat">→</span>';
    }
    return '<div class="weekly-card">' +
      '<div class="weekly-day">' + d.label + '</div>' +
      '<img src="https://openweathermap.org/img/wn/' + d.icon + '.png" alt="">' +
      '<div class="weekly-temps">' +
        '<span class="weekly-max"' + tempColorStyle(d.maxT, unit) + '>' + Math.round(d.maxT) + tUnit + '</span>' +
        trend +
        '<span class="weekly-min"' + tempColorStyle(d.minT, unit) + '>' + Math.round(d.minT) + tUnit + '</span>' +
      '</div>' +
      (d.maxPop > 0 ? '<div class="weekly-pop"><span class="pop-pill" style="--p:' + d.maxPop + '%">' + d.maxPop + '%</span></div>' : '') +
    '</div>';
  }).join('');
  section.style.display = 'block';
}

// ===== 気温グラフ（Chart.js） =====
function renderTempChart(fd, unit) {
  const section = document.getElementById('chart-section');
  const canvas  = document.getElementById('temp-chart');
  if (!section || !canvas || typeof Chart === 'undefined') return;
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const items   = fd.list.slice(0, 16); // 48h
  const tz      = fd.city?.timezone ?? 0;
  const labels  = items.map(item => unixToTime(item.dt, tz));
  const temps   = items.map(item => +(item.main?.temp ?? 0).toFixed(1));
  const pops    = items.map(item => Math.round((item.pop ?? 0) * 100));
  const tUnit   = unit === 'imperial' ? '℉' : '℃';
  const isDark  = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridClr = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const txtClr  = isDark ? 'rgba(238,242,255,0.55)' : 'rgba(15,23,42,0.5)';

  chartInstance = new Chart(canvas.getContext('2d'), {
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: '気温',
          data: temps,
          borderColor: '#818cf8',
          backgroundColor: 'rgba(99,102,241,0.12)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#818cf8',
          tension: 0.4,
          fill: true,
          yAxisID: 'yTemp',
        },
        {
          type: 'bar',
          label: '降水確率',
          data: pops,
          backgroundColor: 'rgba(59,130,246,0.22)',
          borderColor: 'rgba(59,130,246,0.45)',
          borderWidth: 1,
          yAxisID: 'yPop',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: txtClr, boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label === '気温'
              ? '  気温: ' + ctx.parsed.y + tUnit
              : '  降水確率: ' + ctx.parsed.y + '%',
          },
        },
      },
      scales: {
        x: {
          ticks: { color: txtClr, maxRotation: 0, maxTicksLimit: 8, font: { size: 11 } },
          grid:  { color: gridClr },
        },
        yTemp: {
          type: 'linear', position: 'left',
          ticks: { color: txtClr, callback: v => v + tUnit, font: { size: 11 } },
          grid:  { color: gridClr },
        },
        yPop: {
          type: 'linear', position: 'right',
          min: 0, max: 100,
          ticks: { color: '#60a5fa', callback: v => v + '%', font: { size: 11 } },
          grid:  { drawOnChartArea: false },
        },
      },
    },
  });
  section.style.display = 'block';
}

// ===== 雨雲レーダーマップ（Leaflet） =====
// RainViewer の最新タイムスタンプを取得
async function getRainViewerTimestamp() {
  try {
    const r = await fetchJson('https://api.rainviewer.com/public/weather-maps.json', 5000);
    if (!r.ok || !r.data?.radar?.past?.length) return null;
    const past = r.data.radar.past;
    return past[past.length - 1].time;
  } catch { return null; }
}

// ===== WINDY 埋め込みマップ =====
let windyCurrentOverlay = 'waves';
let windyLat = null, windyLon = null;

function buildWindyUrl(lat, lon, overlay) {
  return 'https://embed.windy.com/embed2.html' +
    '?lat=' + lat + '&lon=' + lon +
    '&detailLat=' + lat + '&detailLon=' + lon +
    '&zoom=7&level=surface' +
    '&overlay=' + overlay +
    '&product=ecmwf' +
    '&menu=&message=true&marker=true' +
    '&calendar=now&pressure=true' +
    '&type=map&location=coordinates' +
    '&detail=true&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1';
}

function initWindyMap(lat, lon) {
  windyLat = lat; windyLon = lon;
  const section = document.getElementById('windy-section');
  const iframe  = document.getElementById('windy-iframe');
  if (!section || !iframe) return;
  section.style.display = '';
  iframe.src = buildWindyUrl(lat, lon, windyCurrentOverlay);
}

// レイヤーボタンの切り替え
document.getElementById('windy-layer-btns')?.addEventListener('click', e => {
  const btn = e.target.closest('.windy-layer-btn');
  if (!btn) return;
  document.querySelectorAll('.windy-layer-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  windyCurrentOverlay = btn.dataset.overlay;
  if (windyLat !== null && windyLon !== null) {
    const iframe = document.getElementById('windy-iframe');
    if (iframe) iframe.src = buildWindyUrl(windyLat, windyLon, windyCurrentOverlay);
  }
});

function initOrUpdateMap(lat, lon) {
  const section = document.getElementById('map-section');
  if (!section || typeof L === 'undefined') return;
  section.style.display = 'block';

  if (!leafletMap) {
    leafletMap = L.map('weather-map', { zoomControl: true }).setView([lat, lon], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(leafletMap);
    // RainViewer 降水レーダー（対応ズーム 0–12）
    getRainViewerTimestamp().then(ts => {
      if (!ts) return;
      mapOverlayLayer = L.tileLayer(
        'https://tilecache.rainviewer.com/v2/radar/' + ts + '/512/{z}/{x}/{y}/2/1_1.png',
        { opacity: 0.6, attribution: '© RainViewer', minZoom: 0, maxZoom: 12 }
      ).addTo(leafletMap);
    });
  } else {
    leafletMap.setView([lat, lon], 7);
  }

  if (mapMarker) { leafletMap.removeLayer(mapMarker); }
  mapMarker = L.marker([lat, lon]).addTo(leafletMap);
  setTimeout(() => leafletMap.invalidateSize(), 150);
}


// ===== 天気アラート通知 =====
async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const p = await Notification.requestPermission();
  return p === 'granted';
}

function checkWeatherAlert(data, unit) {
  if (!notificationsEnabled || Notification.permission !== 'granted') return;
  const city  = data.name ?? '';
  const temp  = data.main?.temp;
  const tempC = unit === 'imperial' && temp != null ? (temp - 32) * 5/9 : temp;
  const icon  = data.weather?.[0]?.icon ?? '';
  const desc  = data.weather?.[0]?.description ?? '';
  const wind  = data.wind?.speed ?? 0;

  let alertTitle = '', alertBody = '';
  if (icon.startsWith('11')) {
    alertTitle = '⚡ 雷雨警報';
    alertBody  = city + 'で雷雨が発生中です。外出を控えてください。';
  } else if (tempC != null && tempC >= 35) {
    alertTitle = '🔥 高温注意報';
    alertBody  = city + 'の気温は ' + Math.round(tempC) + '℃ です。熱中症に注意！';
  } else if (tempC != null && tempC <= 0) {
    alertTitle = '❄️ 凍結注意報';
    alertBody  = city + 'の気温は ' + Math.round(tempC) + '℃ 。路面凍結に注意！';
  } else if (wind > 10) {
    alertTitle = '💨 強風注意報';
    alertBody  = city + ' で風速 ' + wind + ' m/s の強風が吹いています。';
  } else if (icon.startsWith('09') || icon.startsWith('10')) {
    alertTitle = '🌧 雨の情報';
    alertBody  = city + ' は現在 ' + desc + ' です。傘をお忘れなく！';
  }
  if (!alertTitle) return;

  const key = city + '|' + icon + '|' + Math.round(tempC ?? 0);
  if (key === lastNotifiedKey) return;
  lastNotifiedKey = key;

  new Notification(alertTitle, {
    body: alertBody,
    icon: 'https://openweathermap.org/img/wn/' + (data.weather?.[0]?.icon ?? '01d') + '@2x.png',
  });
}

// ===== 音声読み上げ（Google Cloud Text-to-Speech） =====
let ttsAudio = null; // 再生中の Audio インスタンス

function getVolume() {
  const v = parseFloat(localStorage.getItem(LS.volume));
  return isNaN(v) ? 0.8 : Math.min(1, Math.max(0, v));
}

// 音声キャッシュ（テキストをキーに base64 音声データを sessionStorage に保存）
function getTtsCache(text) {
  try { return sessionStorage.getItem('tts_' + text) || null; }
  catch { return null; }
}
function setTtsCache(text, base64) {
  try {
    // 古いキャッシュを削除して容量を節約
    Object.keys(sessionStorage)
      .filter(k => k.startsWith('tts_') && k !== 'tts_' + text)
      .forEach(k => sessionStorage.removeItem(k));
    sessionStorage.setItem('tts_' + text, base64);
  } catch { /* 容量不足時は無視 */ }
}

function buildWeatherText(data, unit) {
  const city     = data.name ?? '';
  const country  = data.sys?.country ?? '';
  const desc     = data.weather?.[0]?.description ?? '';
  const temp     = Math.round(data.main?.temp ?? 0);
  const tUnit    = unit === 'imperial' ? '華氏' : '度';
  const humid    = data.main?.humidity ?? '—';
  const wind     = data.wind?.speed ?? 0;
  const windUnit = unit === 'imperial' ? 'マイル毎時' : 'メートル毎秒';
  return city + '、' + country + 'の天気をお知らせします。' +
    '現在の天気は' + desc + 'です。' +
    '気温は' + temp + tUnit + '。' +
    '湿度' + humid + 'パーセント。' +
    '風速' + wind + windUnit + 'です。';
}

async function speakWeather() {
  const btn = document.getElementById('voice-btn');

  // 再生中なら停止（Google TTS / Web Speech API どちらも対応）
  if (ttsAudio && !ttsAudio.paused) {
    ttsAudio.pause();
    ttsAudio.currentTime = 0;
    ttsAudio = null;
    if (btn) btn.textContent = '🔊';
    return;
  }
  if (window.speechSynthesis?.speaking) {
    window.speechSynthesis.cancel();
    if (btn) btn.textContent = '🔊';
    return;
  }

  if (!currentWeatherData) return;
  if (!GOOGLE_TTS_KEY || GOOGLE_TTS_KEY === 'YOUR_GOOGLE_CLOUD_TTS_API_KEY') {
    // APIキー未設定時は Web Speech API にフォールバック
    _speakFallback();
    return;
  }

  if (btn) { btn.textContent = '🔇'; btn.disabled = true; }

  const { data, unit } = currentWeatherData;
  const text = buildWeatherText(data, unit);

  try {
    // キャッシュ確認（同一テキストなら API を叩かない）
    let audioBase64 = getTtsCache(text);
    if (audioBase64) {
      console.log('[TTS] キャッシュ使用');
    } else {
      const res = await fetch(
        'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + GOOGLE_TTS_KEY,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 },
          }),
          signal: timeoutSignal(15000),
        }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (!json.audioContent) throw new Error('音声データなし');
      audioBase64 = json.audioContent;
      setTtsCache(text, audioBase64);
    }

    ttsAudio = new Audio('data:audio/mp3;base64,' + audioBase64);
    ttsAudio.volume = getVolume();
    ttsAudio.onended = () => {
      ttsAudio = null;
      if (btn) { btn.textContent = '🔊'; btn.disabled = false; }
    };
    ttsAudio.onerror = () => {
      ttsAudio = null;
      if (btn) { btn.textContent = '🔊'; btn.disabled = false; }
    };
    if (btn) btn.disabled = false;
    ttsAudio.play();
  } catch(e) {
    console.error('[TTS]', e);
    if (btn) { btn.textContent = '🔊'; btn.disabled = false; }
    showError('音声の取得に失敗しました（HTTP ' + (e.message || '') + '）');
  }
}

function _speakFallback() {
  if (!window.speechSynthesis) { showError('音声読み上げに対応していません。'); return; }
  const btn = document.getElementById('voice-btn');
  if (!currentWeatherData) return;
  const { data, unit } = currentWeatherData;
  const text = buildWeatherText(data, unit);
  if (btn) btn.textContent = '🔇';
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'ja-JP';
  utt.rate = 0.9;
  utt.volume = getVolume();
  utt.onend = () => { if (btn) btn.textContent = '🔊'; };
  window.speechSynthesis.speak(utt);
}

// ===== オートコンプリート =====
// オートコンプリート用状態
let _acDebounceTimer = null;
let _acAbortCtrl = null;

function renderACItems(items, isFromApi) {
  if (!items.length) { acBox.classList.remove('show'); return; }
  acBox.innerHTML = items.map((item, i) =>
    '<div class="ac-item" data-idx="' + i + '">' +
    '<span class="ac-item-icon">' + (isFromApi ? '🔍' : '📍') + '</span>' +
    item.label + '</div>'
  ).join('');
  acBox.querySelectorAll('.ac-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      acBox.classList.remove('show');
      if (items[i].lat != null) {
        // API候補: lat/lon キャッシュを使って直接天気取得
        cityInput.value = items[i].displayName;
        _cachedGeo = { lat: items[i].lat, lon: items[i].lon, name: items[i].displayName };
        getWeatherByCity(items[i].displayName);
      } else {
        cityInput.value = items[i].label;
        getWeatherByCity(items[i].label);
      }
    });
  });
  acBox.classList.add('show');
}

async function renderAC(q) {
  clearTimeout(_acDebounceTimer);
  if (!q || q.length < 1) { acBox.classList.remove('show'); return; }

  // ローカルリストで即時表示
  const localMatches = POPULAR_CITIES
    .filter(c => c.toLowerCase().startsWith(q.toLowerCase()))
    .slice(0, 5)
    .map(c => ({ label: c, displayName: c, lat: null, lon: null }));
  if (localMatches.length) renderACItems(localMatches, false);

  // 2文字以上でAPIも叩く（デバウンス300ms）
  if (q.length < 2) return;
  _acDebounceTimer = setTimeout(async () => {
    if (_acAbortCtrl) _acAbortCtrl.abort();
    _acAbortCtrl = new AbortController();
    try {
      const gq = buildGeoQuery(q);
      const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(gq) + '&count=5&language=ja&format=json';
      const res = await fetch(url, { signal: _acAbortCtrl.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data?.results) || !data.results.length) return;
      const apiItems = data.results.map(d => {
        const parts = [d.name];
        if (d.admin1) parts.push(d.admin1);
        if (d.country_code) parts.push(d.country_code);
        return { label: parts.join(', '), displayName: d.name, lat: d.latitude, lon: d.longitude, country: d.country_code || '' };
      });
      renderACItems(apiItems, true);
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('[AC]', e.message);
    }
  }, 300);
}

// ===== 動的背景 =====
const WX_CLASS_MAP = {
  '01': 'wx-clear',  '02': 'wx-cloudy', '03': 'wx-cloudy',
  '04': 'wx-cloudy', '09': 'wx-rain',   '10': 'wx-rain',
  '11': 'wx-thunder','13': 'wx-snow',   '50': 'wx-cloudy',
};
function setWeatherTheme(iconCode) {
  const key = iconCode ? iconCode.slice(0,2) : '';
  const cls = WX_CLASS_MAP[key] || 'wx-clear';
  Object.values(WX_CLASS_MAP).forEach(c => document.body.classList.remove(c));
  document.body.classList.add(cls);
  startParticles(cls);
}

// ===== パーティクル（雨・雪） =====
function startParticles(wxCls) {
  stopParticles();
  if (wxCls === 'wx-rain' || wxCls === 'wx-thunder') initParticles('rain');
  else if (wxCls === 'wx-snow') initParticles('snow');
}
function stopParticles() {
  if (particleAnim) { cancelAnimationFrame(particleAnim); particleAnim = null; }
  particleCanvas.style.opacity = '0';
  particles = [];
}
const _isMobile = window.innerWidth < 768;
function initParticles(type) {
  const canvas = particleCanvas;
  pCtx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.opacity = '0.45';
  // モバイルはパーティクル数を大幅削減（発熱対策）
  const count = type === 'rain'
    ? (_isMobile ? 25 : 80)
    : (_isMobile ? 10 : 45);
  for (let i = 0; i < count; i++) {
    if (type === 'rain') {
      particles.push({ x: Math.random()*canvas.width, y: Math.random()*canvas.height,
        l: Math.random()*18+10, xs: Math.random()*2-1, ys: Math.random()*6+8, type:'rain' });
    } else {
      particles.push({ x: Math.random()*canvas.width, y: Math.random()*canvas.height,
        r: Math.random()*3+1, xs: Math.random()*1.5-0.75, ys: Math.random()*1.5+0.5,
        type:'snow', op: Math.random()*0.5+0.3 });
    }
  }
  animParticles();
}
let _particleLastTime = 0;
const _PARTICLE_INTERVAL = _isMobile ? 80 : 33; // mobile:12fps / desktop:30fps
function animParticles(ts = 0) {
  if (document.hidden) { particleAnim = null; return; } // タブ非表示時は停止
  if (ts - _particleLastTime < _PARTICLE_INTERVAL) {
    particleAnim = requestAnimationFrame(animParticles);
    return;
  }
  _particleLastTime = ts;
  const c = particleCanvas;
  pCtx.clearRect(0, 0, c.width, c.height);
  particles.forEach(p => {
    if (p.type === 'rain') {
      pCtx.beginPath(); pCtx.moveTo(p.x, p.y); pCtx.lineTo(p.x+p.xs, p.y+p.l);
      pCtx.strokeStyle = 'rgba(174,214,255,0.45)'; pCtx.lineWidth = 1; pCtx.stroke();
      p.x += p.xs; p.y += p.ys;
      if (p.y > c.height) { p.y = -p.l; p.x = Math.random()*c.width; }
    } else {
      pCtx.beginPath(); pCtx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      pCtx.fillStyle = 'rgba(220,235,255,' + p.op + ')'; pCtx.fill();
      p.x += p.xs; p.y += p.ys;
      if (p.y > c.height) { p.y = -p.r; p.x = Math.random()*c.width; }
    }
  });
  particleAnim = requestAnimationFrame(animParticles);
}
// タブ非表示時にCanvas停止
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (particleAnim) { cancelAnimationFrame(particleAnim); particleAnim = null; }
  } else if (particles.length && !particleAnim) {
    animParticles();
  }
});
let _resizeParticleTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeParticleTimer);
  _resizeParticleTimer = setTimeout(() => {
    particleCanvas.width  = window.innerWidth;
    particleCanvas.height = window.innerHeight;
  }, 200);
}, { passive: true });

// ===== 天気描画 =====
function renderWeather(data, unit) {
  const tz = typeof data.timezone === 'number' ? data.timezone : 0;

  safeText('city-name', data.name + '（' + (data.sys?.country ?? '—') + '）');
  safeText('observed-at', data.dt
    ? '観測：' + new Date(data.dt * 1000).toLocaleString('ja-JP') : '—');

  const icon = data.weather?.[0]?.icon;
  if (icon) {
    safeHTML('weather-icon', '<img src="https://openweathermap.org/img/wn/' + icon + '@2x.png" alt="天気" loading="lazy">');
    setWeatherTheme(icon);
  }

  const desc  = data.weather?.[0]?.description ?? '—';
  safeText('weather-desc', desc);
  const _tVal  = (data.main?.temp != null && !isNaN(data.main.temp)) ? Math.round(data.main.temp) : '—';
  const _tUnit = unit === 'imperial' ? '℉' : '℃';
  const _tempC = data.main?.temp != null ? (unit === 'imperial' ? (data.main.temp - 32) * 5/9 : data.main.temp) : null;
  const _tColor = _tempC == null ? '' : _tempC <= 10 ? '#60a5fa' : _tempC >= 20 ? '#fb923c' : '';
  const _tStyle = _tColor ? ' style="-webkit-text-fill-color:' + _tColor + ';background:none;color:' + _tColor + ';"' : '';
  safeHTML('temperature', '<span class="temp-num"' + _tStyle + '>' + _tVal + '</span><span class="temp-unit">' + _tUnit + '</span>');
  safeText('feels-like',  '体感温度 ' + fmtTemp(data.main?.feels_like, unit));
  safeText('temp-min-max','最低 ' + fmtTemp(data.main?.temp_min, unit) + ' / 最高 ' + fmtTemp(data.main?.temp_max, unit));

  safeText('humidity',   fmtPct(data.main?.humidity));
  safeText('wind-speed', fmtWind(data.wind?.speed, unit));
  const deg = data.wind?.deg;
  safeText('wind-deg', deg != null ? degToDir(deg) + ' (' + deg + '°)' : '—');
  safeText('pressure',   fmtHpa(data.main?.pressure));
  safeText('visibility', fmtVis(data.visibility));
  safeText('clouds',     fmtPct(data.clouds?.all));

  const rain = data.rain?.['1h']; const snow = data.snow?.['1h'];
  safeText('rain', rain != null ? rain + ' mm' : 'データなし');
  safeText('snow', snow != null ? snow + ' mm' : 'データなし');
  safeText('sunrise', data.sys?.sunrise ? unixToTime(data.sys.sunrise, tz) : '—');
  safeText('sunset',  data.sys?.sunset  ? unixToTime(data.sys.sunset,  tz) : '—');
  safeText('coordinates', (data.coord?.lat ?? '—') + ' / ' + (data.coord?.lon ?? '—'));

  const wind  = data.wind?.speed ?? 0;
  const humid = data.main?.humidity ?? 0;
  safeText('weather-summary-detail',
    desc + '。湿度' + humid + '%、風速' + wind + (unit==='imperial'?'mph':'m/s') + '。' +
    (rain ? '雨が降っています（' + rain + 'mm/h）。' : '') +
    (snow ? '雪が降っています（' + snow + 'mm/h）。' : '')
  );

  generateAdvice(data, unit);
  hideWeatherSkeleton();
  showResult(true);

  currentWeatherData = { data, unit };
  // currentCity は getWeatherByCity/getWeatherByGeo で設定済みのため上書きしない
  if (!currentCity) currentCity = data.name || '';
  updateFavBtn(currentCity);
  checkWeatherAlert(data, unit);
  _jmaWarningDismissed = false;
  fetchJMAWarnings(currentCity);

  // AI チャット
  initChatSection(data, unit);

  // Luna & Elma カード（天気連動）
  const wxKey = (icon ? icon.slice(0,2) : '');
  const wxCls = WX_CLASS_MAP[wxKey] || 'wx-cloudy';
  fetchPoodleCard(wxCls);

  // 気象庁 天気予報（日本の都市のみ）
  if (data.sys?.country === 'JP' && data.name) {
    fetchJMAForecast(data.name).then(renderJMAForecast);
  } else {
    const panel = document.getElementById('jma-panel');
    if (panel) panel.style.display = 'none';
  }

  // Supabase ログ・設定保存
  sbLog('weather_search', { city: data.name, country: data.sys?.country, unit });
  sbSaveSettings({ city: data.name });
}

// ===== 天気アドバイス =====
function generateAdvice(data, unit) {
  const temp     = data.main?.temp ?? null;
  const humidity = data.main?.humidity ?? null;
  const wind     = data.wind?.speed ?? 0;
  const clouds   = data.clouds?.all ?? 0;
  const rain1h   = data.rain?.['1h'] ?? 0;
  const snow1h   = data.snow?.['1h'] ?? 0;
  const icon     = data.weather?.[0]?.icon ?? '';
  const month    = new Date().getMonth() + 1;
  const tempC    = unit === 'imperial' && temp !== null ? (temp - 32) * 5 / 9 : temp;
  const advices  = [];

  const isRaining = rain1h > 0 || icon.startsWith('09') || icon.startsWith('10');
  const isSnowing = snow1h > 0 || icon.startsWith('13');
  const isThunder = icon.startsWith('11');
  const isClear   = icon.startsWith('01') || icon.startsWith('02');
  const isWindy   = wind > 7;

  // 1. お出かけ
  let outLabel, outText, outColor;
  if (isThunder)      { outLabel='⚠ 注意'; outColor='#ef4444'; outText='雷雨の予報です。外出は控えましょう。'; }
  else if (isSnowing) { outLabel='注意';   outColor='#60a5fa'; outText='積雪・路面凍結に注意。防寒・滑り止めを。'; }
  else if (isRaining) { outLabel='雨天';   outColor='#3b82f6'; outText='傘が必要です。足元に気をつけて。'; }
  else if (isWindy)   { outLabel='強風';   outColor='#f59e0b'; outText='風速 ' + wind + 'm/s。帽子・荷物に注意。'; }
  else if (isClear && tempC !== null && tempC >= 15 && tempC <= 28)
                       { outLabel='絶好調'; outColor='#34d399'; outText='晴れて気持ちの良い一日！お出かけ日和です。'; }
  else if (isClear)   { outLabel='晴れ';   outColor='#f59e0b'; outText='晴天ですが、気温に合わせた服装で。'; }
  else                 { outLabel='普通';   outColor='#94a3b8'; outText='特に大きな天気の崩れはありません。'; }
  advices.push({ emoji:'🚶', label:'お出かけ', badge:outLabel, text:outText, color:outColor });

  // 2. 洗濯
  let washLabel, washText, washColor;
  if (isRaining||isSnowing||isThunder) { washLabel='NG';     washColor='#ef4444'; washText='雨・雪のため外干しは避けましょう。室内干しを。'; }
  else if (clouds>70||humidity>80)     { washLabel='△ 注意'; washColor='#f59e0b'; washText='湿度' + humidity + '%・雲量' + clouds + '%。乾きにくいかも。'; }
  else if (isWindy&&isClear)           { washLabel='◎ 最適'; washColor='#34d399'; washText='風もあり乾きやすい！洗濯日和です。'; }
  else if (isClear)                    { washLabel='○ 良い'; washColor='#34d399'; washText='晴れで洗濯物がよく乾きます。'; }
  else                                 { washLabel='△ 普通'; washColor='#94a3b8'; washText='曇りがちですが外干しは可能です。'; }
  advices.push({ emoji:'👔', label:'洗濯', badge:washLabel, text:washText, color:washColor });

  // 3. 花粉
  const isPollenSeason = (month>=2&&month<=5)||(month>=8&&month<=10);
  const isPollenHigh   = isPollenSeason && isClear && isWindy;
  const isPollenMed    = isPollenSeason && (isClear || isWindy);
  let pollenLabel, pollenText, pollenColor;
  if (isRaining||isSnowing) { pollenLabel='低';     pollenColor='#34d399'; pollenText='雨・雪で花粉が少ない状態です。'; }
  else if (isPollenHigh)    { pollenLabel='多い';   pollenColor='#ef4444'; pollenText='花粉シーズン中。晴れ＋風で飛散多め。マスク推奨。'; }
  else if (isPollenMed)     { pollenLabel='やや多'; pollenColor='#f59e0b'; pollenText='花粉シーズン中。念のためマスクを。'; }
  else if (isPollenSeason)  { pollenLabel='普通';   pollenColor='#94a3b8'; pollenText='花粉シーズン中ですが飛散は少なめ。'; }
  else                      { pollenLabel='少ない'; pollenColor='#34d399'; pollenText='花粉シーズン外です。大気は良好。'; }
  advices.push({ emoji:'🌸', label:'花粉・大気', badge:pollenLabel, text:pollenText, color:pollenColor });

  // 4. 服装
  let clothLabel, clothText, clothColor;
  if (tempC===null)    { clothLabel='—';    clothColor='#94a3b8'; clothText='気温データなし。'; }
  else if (tempC>=30)  { clothLabel='猛暑'; clothColor='#ef4444'; clothText='真夏日。ノースリーブ・冷感素材推奨。熱中症に注意。'; }
  else if (tempC>=25)  { clothLabel='夏';   clothColor='#f97316'; clothText='半袖・薄着で。日焼け止めもお忘れなく。'; }
  else if (tempC>=20)  { clothLabel='快適'; clothColor='#34d399'; clothText='長袖シャツや薄手のジャケットが快適。'; }
  else if (tempC>=15)  { clothLabel='涼しめ'; clothColor='#60a5fa'; clothText='軽い上着があると安心。重ね着がおすすめ。'; }
  else if (tempC>=8)   { clothLabel='寒い'; clothColor='#818cf8'; clothText='コートやセーターが必要。しっかり防寒を。'; }
  else                  { clothLabel='極寒'; clothColor='#c084fc'; clothText='防寒必須。手袋・マフラー・厚手のコートで。'; }
  advices.push({ emoji:'👗', label:'服装', badge:clothLabel, text:clothText, color:clothColor });

  // 5. UV
  let uvLabel, uvText, uvColor;
  if (!isClear||(tempC!==null&&tempC<5)) { uvLabel='低';    uvColor='#34d399'; uvText='曇り・雨天のためUVは低め。日焼けリスク小。'; }
  else if (month>=4&&month<=9)           { uvLabel='強い';  uvColor='#ef4444'; uvText='日差しが強い季節。日焼け止め・帽子必須。'; }
  else if (isClear)                      { uvLabel='中程度'; uvColor='#f59e0b'; uvText='晴れているためUVあり。日焼け止め推奨。'; }
  else                                   { uvLabel='低';    uvColor='#34d399'; uvText='UV指数は低め。外出時は念のため対策を。'; }
  advices.push({ emoji:'☀️', label:'UV・日焼け', badge:uvLabel, text:uvText, color:uvColor });

  // 6. 体調
  let healthLabel, healthText, healthColor;
  if (tempC!==null&&tempC>=35)                    { healthLabel='危険';    healthColor='#ef4444'; healthText='危険な暑さ。水分補給を頻繁に。屋外活動は控えて。'; }
  else if (tempC!==null&&tempC>=30&&humidity>60)  { healthLabel='警戒';    healthColor='#f97316'; healthText='気温' + Math.round(tempC) + '℃・湿度' + humidity + '%。熱中症に注意。'; }
  else if (tempC!==null&&tempC<=0)                { healthLabel='凍結注意'; healthColor='#60a5fa'; healthText='氷点下。路面凍結・低体温症に注意。'; }
  else if (tempC!==null&&tempC<=5)                { healthLabel='防寒を';  healthColor='#818cf8'; healthText='気温が低いです。体を冷やさないよう注意。'; }
  else                                            { healthLabel='良好';    healthColor='#34d399'; healthText='体調管理に大きなリスクはありません。水分補給を忘れずに。'; }
  advices.push({ emoji:'💪', label:'体調・健康', badge:healthLabel, text:healthText, color:healthColor });

  renderAdvice(advices);
}

function renderAdvice(advices) {
  const section = document.getElementById('advice-section');
  const grid    = document.getElementById('advice-grid');
  if (!section || !grid) return;
  grid.innerHTML = advices.map(a =>
    '<div class="advice-card" style="--advice-color: ' + a.color + ';">' +
      '<div class="advice-icon-row">' +
        '<span class="advice-emoji">' + a.emoji + '</span>' +
        '<span class="advice-badge">' + a.badge + '</span>' +
      '</div>' +
      '<div class="advice-label">' + a.label + '</div>' +
      '<div class="advice-text">' + a.text + '</div>' +
    '</div>'
  ).join('');
  section.style.display = 'block';
}

// ===== AI チャット =====
let chatHistory = [];
let chatWeatherCtx = null;
let chatListenersAttached = false;

function saveChatHistory() {
  try { localStorage.setItem(LS.chat, JSON.stringify(chatHistory.slice(-20))); } catch (e) { console.warn('localStorage 書き込み失敗 (chat):', e); }
}
function loadChatHistory() {
  try { const s = JSON.parse(localStorage.getItem(LS.chat) || '[]'); return Array.isArray(s) ? s : []; }
  catch { return []; }
}
function clearChatHistory() {
  chatHistory = [];
  try { localStorage.removeItem(LS.chat); } catch {}
  const c = document.getElementById('chat-messages');
  if (c) c.innerHTML = '';
}

function initChatSection(data, unit) {
  const section = document.getElementById('ai-section');
  if (!section) return;

  // 天気コンテキストを保存
  const toC = v => unit === 'imperial' && v != null ? Math.round((v - 32) * 5 / 9) : Math.round(v ?? 0);
  chatWeatherCtx = {
    city: data.name ?? '',
    weather: {
      desc:   data.weather?.[0]?.description ?? '',
      temp:   toC(data.main?.temp),
      feels:  toC(data.main?.feels_like),
      humid:  data.main?.humidity ?? 0,
      wind:   data.wind?.speed ?? 0,
    },
  };

  section.style.display = 'block';
  // Show the AI tab panel (desktop: makes panel visible; mobile: tab-ai already controlled by nav)
  document.getElementById('tab-ai')?.classList.add('ai-loaded');

  if (!chatListenersAttached) {
    chatListenersAttached = true;
    const sendBtn  = document.getElementById('chat-send-btn');
    const input    = document.getElementById('chat-input');
    const clearBtn = document.getElementById('chat-clear-btn');
    if (sendBtn)  sendBtn.addEventListener('click', sendChatMessage);
    if (input)    input.addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });
    if (clearBtn) clearBtn.addEventListener('click', clearChatHistory);
  }

  // 保存済み履歴を復元（初回のみ）
  if (chatHistory.length === 0) {
    chatHistory = loadChatHistory();
    const container = document.getElementById('chat-messages');
    if (container && container.children.length === 0 && chatHistory.length > 0) {
      chatHistory.forEach(t => appendChatBubble(t.role === 'user' ? 'user' : 'ai', t.content));
    }
  }
}

function appendChatBubble(role, text, loading = false) {
  const container = document.getElementById('chat-messages');
  if (!container) return null;
  const div = document.createElement('div');
  div.className = 'chat-bubble ' + role + (loading ? ' loading' : '');
  if (loading) {
    div.innerHTML = '<span></span><span></span><span></span>';
  } else {
    div.textContent = text;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

async function sendChatMessage() {
  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  if (!input) return;
  const message = input.value.trim();
  if (!message) return;

  if (!CHAT_API_URL || CHAT_API_URL === 'YOUR_CHAT_WORKER_URL') {
    appendChatBubble('ai', 'チャット機能はまだ設定されていません。CHAT_API_URL を config.js に設定してください。');
    return;
  }

  input.value = '';
  if (sendBtn) sendBtn.disabled = true;
  appendChatBubble('user', message);
  const loadingBubble = appendChatBubble('ai', '', true);

  try {
    const res = await fetch(CHAT_API_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: chatHistory.slice(-10),
        city:    chatWeatherCtx?.city,
        weather: chatWeatherCtx?.weather,
      }),
      signal: timeoutSignal(45000),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'HTTP ' + res.status);

    const reply = json.reply;
    chatHistory.push({ role: 'user',  content: message });
    chatHistory.push({ role: 'model', content: reply });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    saveChatHistory();

    if (loadingBubble) {
      loadingBubble.classList.remove('loading');
      loadingBubble.textContent = reply;
      const container = document.getElementById('chat-messages');
      if (container) container.scrollTop = container.scrollHeight;
    }
  } catch(e) {
    console.error('[Chat]', e);
    if (loadingBubble) {
      loadingBubble.classList.remove('loading');
      loadingBubble.classList.add('error');
      loadingBubble.textContent = '送信に失敗しました。しばらくしてから再試行してください。';
    }
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    if (input) input.focus();
  }
}

// ===== Luna & Elma 🐩 ローカル写真ランダム表示 =====
const LUNA_ELMA_PHOTOS = [
  'images/luna-elma-01.jpeg',
  'images/luna-elma-02.jpeg',
  'images/luna-elma-03.jpeg',
  'images/luna-elma-04.jpeg',
  'images/luna-elma-05.jpeg',
  'images/luna-elma-06.jpeg',
  'images/luna-elma-07.jpeg',
  'images/luna-elma-08.jpeg',
  'images/luna-elma-09.jpeg',
  'images/luna-elma-10.jpeg',
  'images/luna-elma-11.jpeg',
  'images/luna-elma-12.jpeg',
  'images/luna-elma-13.jpeg',
  'images/luna-elma-14.jpeg',
  'images/luna-elma-15.jpeg',
  'images/luna-elma-16.jpeg',
  'images/luna-elma-17.jpeg',
  'images/luna-elma-18.jpeg',
];

// 前回と違う写真をランダムに選ぶ
let lastPhotoIndex = -1;
function pickPhoto() {
  let idx;
  do { idx = Math.floor(Math.random() * LUNA_ELMA_PHOTOS.length); }
  while (idx === lastPhotoIndex && LUNA_ELMA_PHOTOS.length > 1);
  lastPhotoIndex = idx;
  return LUNA_ELMA_PHOTOS[idx];
}

// 天気に連動したメッセージ
const POODLE_MESSAGES = {
  'wx-clear':   ['お散歩日和だよ！今日も一緒に出かけよう 🌞', '晴れてるね！公園に行こうよ〜 🎾', 'いい天気！フリスビーしようよ！'],
  'wx-rain':    ['雨だから今日はおうちで一緒にまったりしよう ☔', '外は雨…室内でおもちゃ遊びにしようか 🧸', 'びしょぬれになっちゃうから今日はおうちでゴロゴロ 🛋'],
  'wx-snow':    ['雪だ！！はしゃいじゃう〜！⛄', '雪の日のお散歩もたのしいね、でも足が冷たいよ〜 🐾', 'ふわふわ雪！においが変わってる！'],
  'wx-cloudy':  ['曇ってるね、涼しくてちょうどいいかも！', '今日は散歩しやすい気温かも 🐾', 'どんよりしてるけど一緒にいるから大丈夫！'],
  'wx-thunder': ['雷こわい！そばにいてね…⚡', 'ゴロゴロって聞こえる…だっこして 🫂', '外はこわいから今日はずっとおうちにいよう'],
};

function fetchPoodleCard(wxClass) {
  const wrap = document.getElementById('poodle-card');
  if (!wrap) return;

  const msgs = POODLE_MESSAGES[wxClass] || POODLE_MESSAGES['wx-cloudy'];
  const msg  = msgs[Math.floor(Math.random() * msgs.length)];
  const mainPhoto = pickPhoto();

  // メイン以外からサムネイルを3枚選ぶ
  const usedIdx = new Set([lastPhotoIndex]);
  const thumbs  = [];
  let tries = 0;
  while (thumbs.length < 3 && tries < 60) {
    const i = Math.floor(Math.random() * LUNA_ELMA_PHOTOS.length);
    if (!usedIdx.has(i)) { usedIdx.add(i); thumbs.push(LUNA_ELMA_PHOTOS[i]); }
    tries++;
  }

  wrap.style.display = 'flex';
  wrap.innerHTML =
    '<div class="poodle-img-wrap">' +
      '<img id="poodle-main-img" src="' + mainPhoto + '" alt="Luna & Elma" loading="lazy">' +
    '</div>' +
    '<div class="poodle-body">' +
      '<div class="poodle-names">Luna <span>&</span> Elma</div>' +
      '<div class="poodle-msg">' + msg + '</div>' +
      '<div class="poodle-thumbs">' +
        thumbs.map(p =>
          '<div class="poodle-thumb" tabindex="0" title="写真を切り替え">' +
            '<img src="' + p + '" alt="Luna & Elma" loading="lazy" data-photo="' + p + '">' +
          '</div>'
        ).join('') +
      '</div>' +
    '</div>';

  // サムネイルクリックでメイン写真を差し替え
  wrap.querySelectorAll('.poodle-thumb').forEach(thumb => {
    const swap = () => {
      const newSrc = thumb.querySelector('img').dataset.photo;
      const mainImg = document.getElementById('poodle-main-img');
      if (mainImg && newSrc) {
        mainImg.style.opacity = '0';
        setTimeout(() => { mainImg.src = newSrc; mainImg.style.opacity = '1'; }, 160);
      }
    };
    thumb.addEventListener('click', swap);
    thumb.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') swap(); });
  });
}

// 日本語都市名 → ローマ字変換テーブル（OWM は漢字クエリが不安定なため）
const JP_CITY_ROMAJI = {
  // 北海道・東北
  '札幌':'Sapporo','函館':'Hakodate','旭川':'Asahikawa','釧路':'Kushiro','帯広':'Obihiro',
  '青森':'Aomori','弘前':'Hirosaki','八戸':'Hachinohe',
  '盛岡':'Morioka','一関':'Ichinoseki',
  '仙台':'Sendai','石巻':'Ishinomaki',
  '秋田':'Akita','大館':'Odate',
  '山形':'Yamagata','鶴岡':'Tsuruoka','米沢':'Yonezawa',
  '福島':'Fukushima-shi','郡山':'Koriyama','いわき':'Iwaki',
  // 関東
  '水戸':'Mito','つくば':'Tsukuba','日立':'Hitachi',
  '宇都宮':'Utsunomiya','栃木':'Tochigi','小山':'Oyama',
  '前橋':'Maebashi','高崎':'Takasaki','太田':'Ota',
  'さいたま':'Saitama','川越':'Kawagoe','越谷':'Koshigaya','熊谷':'Kumagaya',
  '千葉':'Chiba','船橋':'Funabashi','松戸':'Matsudo','市川':'Ichikawa','柏':'Kashiwa',
  '東京':'Tokyo','新宿':'Shinjuku','渋谷':'Shibuya','池袋':'Ikebukuro',
  '横浜':'Yokohama','川崎':'Kawasaki','相模原':'Sagamihara','藤沢':'Fujisawa','横須賀':'Yokosuka',
  // 中部
  '新潟':'Niigata','長岡':'Nagaoka','上越':'Joetsu',
  '富山':'Toyama','高岡':'Takaoka',
  '金沢':'Kanazawa','小松':'Komatsu',
  '福井':'Fukui','敦賀':'Tsuruga',
  '甲府':'Kofu','富士吉田':'Fujiyoshida',
  '長野':'Nagano','松本':'Matsumoto','上田':'Ueda',
  '岐阜':'Gifu','大垣':'Ogaki','高山':'Takayama',
  '静岡':'Shizuoka','浜松':'Hamamatsu','沼津':'Numazu','富士':'Fuji',
  '名古屋':'Nagoya','豊橋':'Toyohashi','岡崎':'Okazaki','豊田':'Toyota',
  // 近畿
  '津':'Tsu','四日市':'Yokkaichi','松阪':'Matsusaka',
  '大津':'Otsu','草津':'Kusatsu','彦根':'Hikone',
  '京都':'Kyoto','宇治':'Uji','舞鶴':'Maizuru',
  '大阪':'Osaka','堺':'Sakai','東大阪':'Higashiosaka','枚方':'Hirakata',
  // 大阪市内（区名・繁華街）→ Osaka にマッピング
  '梅田':'Osaka','なんば':'Osaka','難波':'Osaka','心斎橋':'Osaka','天王寺':'Osaka',
  '難波':'Osaka','新世界':'Osaka','上本町':'Osaka','本町':'Osaka','肥後橋':'Osaka',
  '住之江区':'Osaka','阿倍野区':'Osaka','西成区':'Osaka','生野区':'Osaka',
  '東住吉区':'Osaka','平野区':'Osaka','住吉区':'Osaka','東淀川区':'Osaka',
  '淀川区':'Osaka','西淀川区':'Osaka','此花区':'Osaka','港区':'Osaka',
  '大正区':'Osaka','浪速区':'Osaka','西区':'Osaka','福島区':'Osaka',
  '都島区':'Osaka','旭区':'Osaka','城東区':'Osaka','鶴見区':'Osaka',
  '神戸':'Kobe','姫路':'Himeji','西宮':'Nishinomiya','尼崎':'Amagasaki','明石':'Akashi',
  '奈良':'Nara','橿原':'Kashihara',
  '和歌山':'Wakayama',
  // 中国・四国
  '鳥取':'Tottori','米子':'Yonago',
  '松江':'Matsue','出雲':'Izumo',
  '岡山':'Okayama','倉敷':'Kurashiki',
  '広島':'Hiroshima','福山':'Fukuyama','呉':'Kure',
  '山口':'Yamaguchi','下関':'Shimonoseki','宇部':'Ube',
  '徳島':'Tokushima',
  '高松':'Takamatsu','丸亀':'Marugame',
  '松山':'Matsuyama','今治':'Imabari',
  '高知':'Kochi',
  // 九州・沖縄
  '福岡':'Fukuoka','北九州':'Kitakyushu','久留米':'Kurume',
  '佐賀':'Saga','唐津':'Karatsu',
  '長崎':'Nagasaki','佐世保':'Sasebo',
  '熊本':'Kumamoto','八代':'Yatsushiro',
  '大分':'Oita','別府':'Beppu',
  '宮崎':'Miyazaki','都城':'Miyakonojo',
  '鹿児島':'Kagoshima','霧島':'Kirishima',
  '那覇':'Naha','沖縄市':'Okinawa City',
};

// ===== JMA 警報・注意報 =====
// OWM英語都市名 → JMA都道府県コード
const JMA_PREF_CODE = {
  'Sapporo':'011000','Asahikawa':'012000','Hakodate':'017000','Kushiro':'014100','Obihiro':'014030',
  'Aomori':'020000','Hachinohe':'020000','Hirosaki':'020000',
  'Morioka':'030000',
  'Sendai':'040000','Ishinomaki':'040000',
  'Akita':'050000',
  'Yamagata':'060000',
  'Fukushima-shi':'070000','Koriyama':'070000','Iwaki':'070000',
  'Mito':'080000',
  'Utsunomiya':'090000',
  'Maebashi':'100000',
  'Saitama':'110000',
  'Chiba':'120000',
  'Tokyo':'130000','Shinjuku':'130000','Shibuya':'130000',
  'Yokohama':'140000','Kawasaki':'140000',
  'Niigata':'150000',
  'Toyama':'160000',
  'Kanazawa':'170000',
  'Fukui':'180000',
  'Kofu':'190000',
  'Nagano':'200000','Matsumoto':'200000',
  'Gifu':'210000',
  'Shizuoka':'220000','Hamamatsu':'220000',
  'Nagoya':'230000',
  'Tsu':'240000',
  'Otsu':'250000',
  'Kyoto':'260000',
  'Osaka':'270000',
  'Kobe':'280000','Himeji':'280000',
  'Nara':'290000',
  'Wakayama':'300000',
  'Tottori':'310000',
  'Matsue':'320000',
  'Okayama':'330000',
  'Hiroshima':'340000',
  'Yamaguchi':'350000',
  'Tokushima':'360000',
  'Takamatsu':'370000',
  'Matsuyama':'380000',
  'Kochi':'390000',
  'Fukuoka':'400000','Kitakyushu':'400000',
  'Saga':'410000',
  'Nagasaki':'420000',
  'Kumamoto':'430000',
  'Oita':'440000',
  'Miyazaki':'450000',
  'Kagoshima':'460100',
  'Naha':'471000',
};

let _jmaWarningDismissed = false;

async function fetchJMAWarnings(owmCityName) {
  const prefCode = JMA_PREF_CODE[owmCityName];
  if (!prefCode) { hideWarningBanner(); return; }
  try {
    const res = await fetch(
      `https://www.jma.go.jp/bosai/warning/data/warning/${prefCode}.json`,
      { signal: timeoutSignal(8000) }
    );
    if (!res.ok) return;
    const data = await res.json();
    const warnings = parseJMAWarnings(data);
    renderWarningBanner(warnings);
  } catch {
    // 警報取得失敗は無視（非クリティカル）
  }
}

function parseJMAWarnings(data) {
  const active = [];
  const seen = new Set();
  // areaTypes → areas → warnings
  for (const at of (data.areaTypes || [])) {
    for (const area of (at.areas || [])) {
      for (const w of (area.warnings || [])) {
        const status = w.status || '';
        if (status !== '発表' && status !== '継続') continue;
        const name = w.type?.name || w.typeName || w.name || '';
        if (!name || seen.has(name)) continue;
        seen.add(name);
        // 特別警報 / 警報 / 注意報 の分類
        const level = name.includes('特別警報') ? 3 : name.includes('警報') ? 2 : 1;
        active.push({ name, level, area: area.name || '' });
      }
    }
  }
  return active.sort((a, b) => b.level - a.level);
}

function renderWarningBanner(warnings) {
  const banner = document.getElementById('jma-warning-banner');
  if (!banner) return;
  if (!warnings.length || _jmaWarningDismissed) { hideWarningBanner(); return; }
  const maxLevel = warnings[0].level;
  const cls = maxLevel === 3 ? 'warn-tokubetsu' : maxLevel === 2 ? 'warn-keiho' : 'warn-chuiho';
  const icon = maxLevel === 3 ? '🚨' : maxLevel === 2 ? '⚠️' : 'ℹ️';
  const names = [...new Set(warnings.map(w => w.name))].join('・');
  const area = warnings[0].area;
  banner.className = cls;
  banner.innerHTML =
    '<span class="warn-icon">' + icon + '</span>' +
    '<span class="warn-body">' + escHtml(area ? area + '：' : '') + escHtml(names) + 'が発令中です</span>' +
    '<button class="warn-close" aria-label="閉じる">✕</button>';
  banner.querySelector('.warn-close').addEventListener('click', dismissWarningBanner);
  banner.style.display = 'flex';
}

function hideWarningBanner() {
  const banner = document.getElementById('jma-warning-banner');
  if (banner) banner.style.display = 'none';
}

function dismissWarningBanner() {
  _jmaWarningDismissed = true;
  hideWarningBanner();
}

// 日本語都市名を Geocoding クエリに変換
// - テーブル登録済み → ローマ字 + ",JP"
// - 未登録の日本語 → 漢字 + ",JP"（フォールバック）
// - 英語/カンマ含む → そのまま
function buildGeoQuery(city) {
  if (city.includes(',')) return city;
  if (/[\u3000-\u9fff\uff00-\uffef\u3040-\u30ff]/.test(city)) {
    // 市・区・町・村・都・道・府・県 を除去してからロマジ変換を試みる
    const stripped = city.replace(/[市区町村都道府県]$/, '');
    return (JP_CITY_ROMAJI[stripped] || JP_CITY_ROMAJI[city] || stripped) + ',JP';
  }
  return city;
}

// ===== 都市名で天気取得 =====
async function getWeatherByCity(cityRaw) {
  const city = (cityRaw ?? cityInput.value).trim();
  const unit = unitSelect.value;
  clearError(); showResult(false); acBox.classList.remove('show');
  if (!city) { showError('都市名を入力してください。'); return; }

  // スケルトン表示
  showWeatherSkeleton();
  setLoading(true, '都市を検索しています...');
  try {
    // オートコンプリートで lat/lon がキャッシュされている場合はスキップ
    let lat, lon, geoName, geoCountry;
    if (_cachedGeo && _cachedGeo.name === city) {
      ({ lat, lon } = _cachedGeo);
      geoName    = _cachedGeo.displayName || city;
      geoCountry = _cachedGeo.country || '';
      _cachedGeo = null;
    } else {
      _cachedGeo = null;
      const geoResults = await geocodeOpenMeteo(buildGeoQuery(city));
      if (!geoResults.length) {
        showError('「' + city + '」は見つかりませんでした。別の都市名をお試しください。'); return;
      }
      ({ lat, lon, name: geoName, country: geoCountry } = geoResults[0]);
      // 日本語入力の場合は元の入力（サフィックス除去済み）を表示名として優先する
      if (/[\u3000-\u9fff\uff00-\uffef\u3040-\u30ff]/.test(city)) {
        geoName = city.replace(/[市区町村都道府県]$/, '');
      }
    }

    lastCoords = { lat, lon };
    // ユーザーの元の入力を currentCity として確定（renderWeather での上書きを防ぐ）
    currentCity = city;
    setLoading(true, '天気データを取得しています...');
    const w = await fetchWeatherOpenMeteo(lat, lon, unit, geoName, geoCountry);
    if (!w) { showError('天気情報の取得に失敗しました。'); return; }
    renderWeather(w, unit);
    startAutoRefresh();
    saveHistory(city);
    setShareLink(city);
    fetchAndRenderForecast(lat, lon, unit);
    fetchAndRenderAQI(lat, lon);
    fetchAndRenderWave(lat, lon);
    setTimeout(() => { initOrUpdateMap(lat, lon); initWindyMap(lat, lon); }, 500);
    fetchAndRenderNews(currentCategory);
  } catch(e) {
    if (String(e).includes('Abort') || String(e).includes('abort')) showError('通信がタイムアウトしました。ネットワークをご確認ください。');
    else showError('通信エラーが発生しました。ネットワークをご確認ください。');
  } finally { setLoading(false); }
}

// ===== 現在地で天気取得 =====
async function getWeatherByGeo() {
  clearError(); showResult(false);
  if (!navigator.geolocation) { showError('このブラウザは位置情報に対応していません。'); return; }
  setLoading(true, '現在地を取得しています...');
  showWeatherSkeleton();
  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      const unit = unitSelect.value;
      const { latitude: lat, longitude: lon } = pos.coords;
      lastCoords = { lat, lon };
      setLoading(true, '天気データを取得しています...');
      // Nominatim で逆ジオコーディング（都市名取得）
      let geoName = '', geoCountry = '';
      try {
        const rev = await fetchJson(
          'https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lon + '&format=json&accept-language=ja',
          8000
        );
        if (rev.ok && rev.data?.address) {
          geoName    = rev.data.address.city || rev.data.address.town || rev.data.address.village || rev.data.address.county || '';
          geoCountry = rev.data.address.country_code?.toUpperCase() || '';
        }
      } catch { /* 逆ジオコーディング失敗は無視 */ }

      const w = await fetchWeatherOpenMeteo(lat, lon, unit, geoName, geoCountry);
      if (!w) { showError('現在地の天気取得に失敗しました。'); return; }
      currentCity = geoName;
      renderWeather(w, unit);
      startAutoRefresh();
      if (geoName) { saveHistory(geoName); setShareLink(geoName); }
      fetchAndRenderForecast(lat, lon, unit);
      fetchAndRenderAQI(lat, lon);
      fetchAndRenderWave(lat, lon);
      setTimeout(() => { initOrUpdateMap(lat, lon); initWindyMap(lat, lon); }, 500);
      fetchAndRenderNews(currentCategory);
    } catch(e) {
      if (String(e).includes('Abort') || String(e).includes('abort')) showError('通信がタイムアウトしました。ネットワークをご確認ください。');
      else showError('通信エラーが発生しました。');
    }
    finally  { setLoading(false); }
  }, () => {
    setLoading(false);
    showError('位置情報の取得が許可されませんでした。ブラウザの設定をご確認ください。');
  }, { enableHighAccuracy: false, timeout: 8000 });
}

// ===== ニュース（Google News RSS） =====

const CATEGORY_LABEL = {
  general:'トップ', domestic:'国内', world:'国際', politics:'政治', economy:'経済',
  technology:'テクノロジー', science:'サイエンス', sports:'スポーツ',
  entertainment:'エンタメ', health:'健康', business:'ビジネス',
  gourmet:'グルメ', travel:'旅行', local:'地域', disaster:'🚨 災害',
};

const newsCache = {};
const CACHE_TTL = 15 * 60 * 1000;

// Google News RSS（rss2json.com 経由で CORS 回避）
const RSS_FEEDS = {
  general:       'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',
  domestic:      'https://news.google.com/rss/headlines/section/topic/NATION?hl=ja&gl=JP&ceid=JP:ja',
  world:         'https://news.google.com/rss/headlines/section/topic/WORLD?hl=ja&gl=JP&ceid=JP:ja',
  politics:      'https://news.google.com/rss/search?q=%E6%94%BF%E6%B2%BB+OR+%E5%9B%BD%E4%BC%9A&hl=ja&gl=JP&ceid=JP:ja',
  economy:       'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ja&gl=JP&ceid=JP:ja',
  technology:    'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=ja&gl=JP&ceid=JP:ja',
  science:       'https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=ja&gl=JP&ceid=JP:ja',
  sports:        'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=ja&gl=JP&ceid=JP:ja',
  entertainment: 'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=ja&gl=JP&ceid=JP:ja',
  health:        'https://news.google.com/rss/search?q=%E5%81%A5%E5%BA%B7+OR+%E5%8C%BB%E7%99%82&hl=ja&gl=JP&ceid=JP:ja',
  business:      'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ja&gl=JP&ceid=JP:ja',
  gourmet:       'https://news.google.com/rss/search?q=%E3%82%B0%E3%83%AB%E3%83%A1+OR+%E9%A3%B2%E9%A3%9F%E5%BA%97&hl=ja&gl=JP&ceid=JP:ja',
  travel:        'https://news.google.com/rss/search?q=%E6%97%85%E8%A1%8C+OR+%E8%A6%B3%E5%85%89&hl=ja&gl=JP&ceid=JP:ja',
  local:         'https://news.google.com/rss/headlines/section/topic/NATION?hl=ja&gl=JP&ceid=JP:ja',
  disaster:      'https://news.google.com/rss/search?q=%E7%81%BD%E5%AE%B3+OR+%E5%9C%B0%E9%9C%87+OR+%E5%8F%B0%E9%A2%A8+OR+%E6%B4%AA%E6%B0%B4&hl=ja&gl=JP&ceid=JP:ja',
};

// rss2json.com 経由で RSS を JSON に変換（CORS フリー）
async function tryRss2json(url) {
  const apiUrl = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(url);
  const res = await fetch(apiUrl, { signal: timeoutSignal(12000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.status !== 'ok' || !data.items?.length) throw new Error('記事なし');
  return data.items.map(item => ({
    title:       item.title || '',
    description: (item.description || '').replace(/<[^>]*>/g, '').trim(),
    url:         item.link || '',
    image:       item.thumbnail || item.enclosure?.link || '',
    source:      item.author || '',
    sourceIcon:  data.feed?.favicon || '',
    publishedAt: item.pubDate || '',
    lang:        'ja',
  }));
}

async function fetchRSSNews(category) {
  const url = RSS_FEEDS[category];
  if (!url) throw new Error('RSS未設定');
  return await tryRss2json(url);
}

async function fetchAndRenderNews(category) {
  const label = CATEGORY_LABEL[category] || category;
  const cached = newsCache[category];
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    renderNewsCards(cached.articles, label);
    updateNewsBadges();
    return;
  }
  renderNewsSkeleton();
  try {
    // フェッチチェーン: 1次 Yahoo RSS → 2次 Google RSS
    const articles = await fetchRSSNews(category);

    if (articles.length > 0) {
      newsCache[category] = { ts: Date.now(), articles };
      try { localStorage.setItem('sora_news_offline_' + category, JSON.stringify({ ts: Date.now(), articles })); } catch (e) { console.warn('localStorage 書き込み失敗 (news offline):', e); }
      renderNewsCards(articles, label); updateNewsBadges(); return;
    }
    showNewsMessage('📭', '「' + label + '」の記事が見つかりませんでした', 'しばらく後にお試しください。');
  } catch(e) {
    // オフラインキャッシュを確認
    try {
      const offline = JSON.parse(localStorage.getItem('sora_news_offline_' + category) || 'null');
      if (offline?.articles?.length) {
        renderNewsCards(offline.articles, label);
        const age = Math.round((Date.now() - offline.ts) / 60000);
        const offlineBar = document.createElement('div');
        offlineBar.style.cssText = 'text-align:center;font-size:11px;color:var(--text2);padding:6px 0 2px;';
        offlineBar.textContent = '📴 オフラインキャッシュ（' + age + '分前のデータ）';
        newsContainer.prepend(offlineBar);
        return;
      }
    } catch {}
    showNewsMessage('⚠️', 'ニュースの取得に失敗しました',
      String(e.message || e) + '<br><small style="opacity:.7">ニュース API</small>');
  }
}

function showNewsMessage(icon, title, body) {
  newsContainer.innerHTML =
    '<div style="padding:48px 20px;text-align:center;color:var(--text2);line-height:2;">' +
      '<div style="font-size:36px;margin-bottom:12px;">' + icon + '</div>' +
      '<div style="font-weight:700;font-size:16px;color:var(--text);margin-bottom:8px;">' + title + '</div>' +
      '<div style="font-size:13px;">' + body + '</div>' +
    '</div>';
}

function renderNewsSkeleton() {
  const skCard =
    '<div class="news-skeleton"><div class="sk-img"></div>' +
    '<div class="sk-body"><div class="sk-line s"></div><div class="sk-line"></div>' +
    '<div class="sk-line"></div><div class="sk-line s"></div></div></div>';
  newsContainer.innerHTML =
    '<div class="featured-news">' + skCard + skCard + '</div>' +
    '<div class="news-grid">' + Array(9).fill(skCard).join('') + '</div>';
}

function renderNewsCards(articles, categoryLabel) {
  categoryLabel = categoryLabel || '';
  const readSet = loadReadUrls();
  let filtered = articles;
  if (newsShowUnreadOnly) filtered = articles.filter(a => !readSet.has(a.url));
  if (!filtered.length) {
    newsContainer.innerHTML =
      '<div style="padding:40px;text-align:center;color:var(--text2);">' +
      (newsShowUnreadOnly ? '📭 未読の記事はありません。<br><small style="opacity:.7;margin-top:8px;display:block">「すべて」に切り替えると既読も表示されます</small>'
        : 'ニュースが見つかりませんでした。') +
      '</div>';
    return;
  }
  const displayed = filtered.slice(0, 20);
  const featured  = displayed.slice(0, 2);
  const rest      = displayed.slice(2);

  // 最初の6件（featured 2 + rest 4）を即時描画、残りは遅延ロード
  const immediateRest = rest.slice(0, 4);
  const deferredRest  = rest.slice(4);

  newsContainer.innerHTML =
    '<div class="featured-news">' + featured.map(a => newsCardHTML(a, true, categoryLabel, readSet)).join('') + '</div>' +
    (immediateRest.length || deferredRest.length
      ? '<div class="news-grid" id="news-grid-main">' +
          immediateRest.map(a => newsCardHTML(a, false, categoryLabel, readSet)).join('') +
        '</div>'
      : '');

  attachNewsListeners(newsContainer);

  // 残りを IntersectionObserver で遅延レンダリング
  if (deferredRest.length > 0) {
    const BATCH = 6;
    let queue = deferredRest.slice();
    const sentinel = document.createElement('div');
    sentinel.style.height = '4px';
    newsContainer.appendChild(sentinel);

    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      const batch = queue.splice(0, BATCH);
      if (!batch.length) { observer.disconnect(); sentinel.remove(); return; }
      const grid = document.getElementById('news-grid-main');
      if (grid) {
        const tempWrap = document.createElement('div');
        batch.forEach(a => {
          const tmp = document.createElement('div');
          tmp.innerHTML = newsCardHTML(a, false, categoryLabel, readSet);
          const card = tmp.firstElementChild;
          if (card) tempWrap.appendChild(card);
        });
        attachNewsListeners(tempWrap);
        while (tempWrap.firstChild) grid.appendChild(tempWrap.firstChild);
      }
      if (!queue.length) { observer.disconnect(); sentinel.remove(); }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
  }
}

// スワイプ状態をWeakMapで管理（メモリリーク防止）
const _swipeStateMap = new WeakMap();

// イベント委譲でコンテナ単位のスワイプを処理（カード個別リスナーを廃止）
function attachSwipeDelegation(container) {
  if (container.dataset.swipeAttached) return;
  container.dataset.swipeAttached = '1';

  container.addEventListener('touchstart', e => {
    const card = e.target.closest('.news-card');
    if (!card) return;
    _swipeStateMap.set(card, {
      startX: e.touches[0].clientX, startY: e.touches[0].clientY,
      moved: false, dx: 0, raf: null
    });
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    const card = e.target.closest('.news-card');
    if (!card) return;
    const s = _swipeStateMap.get(card);
    if (!s) return;
    const dx = e.touches[0].clientX - s.startX;
    const dy = e.touches[0].clientY - s.startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      s.moved = true; s.dx = dx;
      if (s.raf) return;
      s.raf = requestAnimationFrame(() => {
        s.raf = null;
        card.style.transform = 'translateX(' + (s.dx * 0.3) + 'px)';
        card.classList.toggle('swipe-left',  s.dx < -20);
        card.classList.toggle('swipe-right', s.dx > 20);
      });
    }
  }, { passive: true });

  container.addEventListener('touchend', e => {
    const card = e.target.closest('.news-card');
    if (!card) return;
    const s = _swipeStateMap.get(card);
    card.style.transform = '';
    card.classList.remove('swipe-left', 'swipe-right');
    _swipeStateMap.delete(card);
    if (!s || !s.moved) return;
    const dx = e.changedTouches[0].clientX - s.startX;
    const dy = e.changedTouches[0].clientY - s.startY;
    if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 60) return;
    const url = card.dataset.url;
    if (!url) return;
    if (dx < 0) {
      markAsRead(url); card.classList.add('is-read');
    } else {
      const articleData = {
        url,
        title: card.querySelector('.news-title')?.textContent || '',
        source: card.querySelector('.news-source')?.textContent || '',
        pubDate: '',
        thumbnail: card.querySelector('img')?.src || ''
      };
      toggleBookmark(articleData);
      card.querySelector('.news-bmark-btn')?.classList.toggle('bookmarked');
    }
  }, { passive: true });
}

function attachNewsListeners(container) {
  // 同一コンテナへの重複リスナー防止（ニュース再描画のたびに呼ばれるため）
  if (container.dataset.listenersAttached) {
    attachSwipeDelegation(container);
    return;
  }
  container.dataset.listenersAttached = '1';

  container.addEventListener('error', e => {
    if (e.target.matches('.news-img img')) e.target.parentElement.style.display = 'none';
  }, { capture: true });

  container.addEventListener('click', e => {
    const bmarkBtn = e.target.closest('.news-bmark-btn');
    if (bmarkBtn) {
      e.stopPropagation();
      toggleBookmark({ url: bmarkBtn.dataset.url, title: bmarkBtn.dataset.title, source: bmarkBtn.dataset.source, publishedAt: bmarkBtn.dataset.pub, image: bmarkBtn.dataset.img });
      const bmarked = isBookmarked(bmarkBtn.dataset.url);
      bmarkBtn.textContent = bmarked ? '★' : '☆';
      bmarkBtn.classList.toggle('bookmarked', bmarked);
      if (!bmarked && container.querySelector('[data-bmark-view]')) {
        bmarkBtn.closest('.news-card')?.remove();
        if (!container.querySelector('.news-card')) renderBookmarkCards();
      }
      return;
    }
    const summaryBtn = e.target.closest('.news-summary-btn');
    if (summaryBtn) { e.stopPropagation(); handleSummaryBtn(summaryBtn); return; }
    const card = e.target.closest('.news-card');
    if (card) {
      const h = card.dataset.url; if (!h) return;
      markAsRead(h); card.classList.add('is-read');
      window.open(h, '_blank', 'noopener');
    }
  });
  container.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.news-card');
    if (card) { const h = card.dataset.url; if (!h) return; markAsRead(h); card.classList.add('is-read'); window.open(h, '_blank', 'noopener'); }
  });
  attachSwipeDelegation(container);
}

async function handleSummaryBtn(btn) {
  const box = btn.closest('.news-body')?.querySelector('.news-summary-box');
  if (!box) return;
  if (box.classList.contains('visible') && !btn.dataset.isError) {
    box.classList.remove('visible'); btn.textContent = '✨ 要約'; delete btn.dataset.isError; return;
  }
  btn.disabled = true; btn.textContent = '…'; delete btn.dataset.isError;
  const summary = await summarizeArticle(btn.dataset.url, btn.dataset.title, btn.dataset.desc);
  box.textContent = summary; box.classList.add('visible'); btn.disabled = false;
  if (summary.startsWith('⚠️')) { btn.dataset.isError = '1'; btn.textContent = '↺ 再試行'; }
  else { btn.textContent = '✕ 閉じる'; }
}

function renderBookmarkCards() {
  const bmarks = loadBookmarks();
  if (!bmarks.length) {
    newsContainer.innerHTML =
      '<div style="padding:48px 20px;text-align:center;color:var(--text2);">' +
      '<div style="font-size:40px;margin-bottom:12px;">🔖</div>' +
      '<div style="font-weight:700;font-size:16px;color:var(--text);margin-bottom:8px;">ブックマークはありません</div>' +
      '<div style="font-size:13px;">記事カードの ☆ をクリックして保存できます</div>' +
      '</div>';
    return;
  }
  const readSet = loadReadUrls();
  // data-bmark-view でブックマーク表示中を示す（委譲ハンドラがカード除去に使用）
  newsContainer.innerHTML = '<div class="news-grid" data-bmark-view="1">' + bmarks.map(a => newsCardHTML(a, false, 'ブックマーク', readSet)).join('') + '</div>';
  attachNewsListeners(newsContainer);
}

function newsCardHTML(a, featured, categoryLabel, readSet) {
  const hasImage = !!a.image;
  const isRead   = readSet && readSet.has(a.url);
  const imgSection = hasImage
    ? '<div class="news-img"><img src="' + escHtml(a.image) + '" alt="" loading="lazy"></div>'
    : '';
  const timeStr  = relativeTime(a.publishedAt);
  const readBadge = isRead ? '<span class="news-read-badge">既読</span>' : '';
  return '<div class="news-card' + (featured ? ' featured' : '') + (hasImage ? '' : ' no-img') + (isRead ? ' is-read' : '') +
    '" data-url="' + escHtml(a.url) + '" tabindex="0" role="link" aria-label="' + escHtml(a.title) + '">' +
    imgSection +
    '<div class="news-body">' +
      '<div class="news-category">' + escHtml(categoryLabel || a.category || '') + '</div>' +
      '<div class="news-title">' + escHtml(a.title) + '</div>' +
      '<div class="news-meta">' +
        (a.source ? '<span class="news-source">📡 ' + escHtml(a.source) + '</span>' : '') +
        '<span style="display:flex;gap:6px;align-items:center;">' +
          (timeStr ? '<span class="news-time">' + timeStr + '</span>' : '') +
          readBadge +
          '<button class="news-summary-btn"' +
            ' data-url="' + escHtml(a.url) + '"' +
            ' data-title="' + escHtml(a.title) + '"' +
            ' data-desc="' + escHtml(a.description || '') + '"' +
            ' title="AIで要約" aria-label="AIで要約">✨ 要約</button>' +
          '<button class="news-bmark-btn' + (isBookmarked(a.url) ? ' bookmarked' : '') + '"' +
            ' data-url="' + escHtml(a.url) + '"' +
            ' data-title="' + escHtml(a.title) + '"' +
            ' data-source="' + escHtml(a.source || '') + '"' +
            ' data-pub="' + escHtml(a.publishedAt || '') + '"' +
            ' data-img="' + escHtml(a.image || '') + '"' +
            ' title="ブックマーク" aria-label="ブックマーク">' +
            (isBookmarked(a.url) ? '★' : '☆') +
          '</button>' +
        '</span>' +
      '</div>' +
      '<div class="news-summary-box"></div>' +
    '</div></div>';
}

// ===== Workers AI 要約 =====
function cleanSummaryText(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^[-•*#>]+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SUMMARY_TTL = 7 * 24 * 60 * 60 * 1000; // 7日

async function summarizeArticle(url, title, description) {
  const cacheKey = 'sora_summary_' + url;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const { text: t, ts } = JSON.parse(raw);
      if (Date.now() - ts < SUMMARY_TTL) return t;
      localStorage.removeItem(cacheKey);
    }
  } catch {}
  if (!CHAT_API_URL || CHAT_API_URL === 'YOUR_CHAT_WORKER_URL') return '⚠️ Worker URLが未設定です。';
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(CHAT_API_URL + '/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return `⚠️ 要約の取得に失敗しました（${res.status}）`;
    const data = await res.json();
    if (data.error) return `⚠️ ${data.error}`;
    const text = cleanSummaryText(data.summary || '');
    if (!text) return '⚠️ 要約を取得できませんでした。';
    try { localStorage.setItem(cacheKey, JSON.stringify({ text, ts: Date.now() })); } catch (e) { console.warn('localStorage 書き込み失敗 (summary):', e); }
    return text;
  } catch (e) {
    clearTimeout(tid);
    if (e.name === 'AbortError') return '⚠️ タイムアウトしました。';
    return '⚠️ 要約の取得中にエラーが発生しました。';
  }
}

function cleanSummaryCache() {
  const now = Date.now();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('sora_summary_')) continue;
    try {
      const { ts } = JSON.parse(localStorage.getItem(key));
      if (now - ts >= SUMMARY_TTL) localStorage.removeItem(key);
    } catch { localStorage.removeItem(key); }
  }
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== 相対時刻 =====
function relativeTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return m + '分前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + '時間前';
  const day = Math.floor(h / 24);
  if (day < 7) return day + '日前';
  return (d.getMonth() + 1) + '/' + d.getDate();
}

// ===== ニュース既読管理 =====
function loadReadUrls() {
  try { return new Set(JSON.parse(localStorage.getItem(LS.newsRead) || '[]')); }
  catch { return new Set(); }
}
let _syncReadTimer = null;
function markAsRead(url) {
  if (!url) return;
  const set = loadReadUrls();
  set.add(url);
  const arr = [...set].slice(-300);
  try { localStorage.setItem(LS.newsRead, JSON.stringify(arr)); } catch {}
  updateNewsBadges();
  // クラウドへの書き込みはデバウンスして過剰なAPIコールを防ぐ
  clearTimeout(_syncReadTimer);
  _syncReadTimer = setTimeout(() => sbSaveSettings({ news_read: arr.slice(-100) }), 3000);
}
function clearReadUrls() {
  try { localStorage.removeItem(LS.newsRead); } catch {}
  sbSaveSettings({ news_read: [] });
  updateNewsBadges();
}

let newsShowUnreadOnly = false;

// ===== スクロールトップボタン =====
(function initScrollTop() {
  const btn = document.createElement('button');
  btn.className = 'scroll-top-btn';
  btn.innerHTML = '↑';
  btn.title = 'トップへ戻る';
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.body.appendChild(btn);
  // IntersectionObserver でスクロールリスナーを排除（CPU負荷削減）
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'position:absolute;top:400px;height:1px;width:1px;pointer-events:none;aria-hidden:true;';
  document.body.appendChild(sentinel);
  new IntersectionObserver(entries => {
    btn.classList.toggle('visible', !entries[0].isIntersecting);
  }, { threshold: 0 }).observe(sentinel);
})();

// ===== イベントリスナー =====
document.getElementById('fav-btn').addEventListener('click', () => { if (currentCity) toggleFavorite(currentCity); });
document.getElementById('voice-btn').addEventListener('click', speakWeather);

// ===== 音量スライダー =====
let _volSyncTimer = null;
(function initVolumeSlider() {
  const slider = document.getElementById('volume-slider');
  const label  = document.getElementById('volume-label');
  if (!slider || !label) return;
  const saved = localStorage.getItem(LS.volume);
  const pct   = saved != null ? Math.round(parseFloat(saved) * 100) : 80;
  slider.value = pct;
  label.textContent = pct + '%';
  // ボリュームアイコン SVG を音量に合わせて切り替え
  const VOL_SVGS = {
    mute: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
    low:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
    high: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
  };
  const updateIcon = v => {
    const wrap = document.getElementById('vol-icon-wrap');
    if (!wrap) return;
    wrap.innerHTML = v === 0 ? VOL_SVGS.mute : v < 60 ? VOL_SVGS.low : VOL_SVGS.high;
  };
  updateIcon(pct);
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    label.textContent = v + '%';
    updateIcon(v);
    localStorage.setItem(LS.volume, (v / 100).toFixed(2));
    // 再生中なら即時反映
    if (ttsAudio && !ttsAudio.paused) ttsAudio.volume = v / 100;
    // クラウド同期（debounce 1.5s）
    clearTimeout(_volSyncTimer);
    _volSyncTimer = setTimeout(() => {
      if (sbCurrentUser()) sbSaveSettings({ volume: (v / 100).toFixed(2) });
    }, 1500);
  });
})();
searchBtn.addEventListener('click', () => getWeatherByCity());
cityInput.addEventListener('keydown', e => { if (e.key === 'Enter') getWeatherByCity(); });
let _acDebounce;
cityInput.addEventListener('input', e => {
  clearTimeout(_acDebounce);
  _acDebounce = setTimeout(() => renderAC(e.target.value), 250);
});
cityInput.addEventListener('blur',   () => setTimeout(() => acBox.classList.remove('show'), 180));
geoBtn.addEventListener('click', getWeatherByGeo);
themeBtn.addEventListener('click', toggleTheme);
clearHistoryBtn.addEventListener('click', clearHistory);
unitSelect.addEventListener('change', () => {
  localStorage.setItem(LS.unit, unitSelect.value);
  sbSaveSettings({ unit: unitSelect.value });
  unitSelect.classList.remove('unit-changed');
  void unitSelect.offsetWidth; // reflow で再発火
  unitSelect.classList.add('unit-changed');
  unitSelect.addEventListener('animationend', () => unitSelect.classList.remove('unit-changed'), { once: true });
  const mobileSelect = document.getElementById('unit-select-mobile');
  if (mobileSelect) mobileSelect.value = unitSelect.value;
  const c = cityInput.value.trim();
  if (c) getWeatherByCity(c);
});

// モバイル設定メニュー
const settingsMenuBtn = document.getElementById('settings-menu-btn');
const settingsDropdown = document.getElementById('settings-dropdown');
if (settingsMenuBtn && settingsDropdown) {
  settingsMenuBtn.addEventListener('click', e => {
    e.stopPropagation();
    settingsDropdown.classList.toggle('open');
  });
  document.addEventListener('click', () => settingsDropdown.classList.remove('open'));
}
const unitSelectMobile = document.getElementById('unit-select-mobile');
if (unitSelectMobile) {
  unitSelectMobile.value = unitSelect.value;
  unitSelectMobile.addEventListener('change', () => {
    unitSelect.value = unitSelectMobile.value;
    localStorage.setItem(LS.unit, unitSelectMobile.value);
    sbSaveSettings({ unit: unitSelectMobile.value });
    unitSelectMobile.classList.remove('unit-changed');
    void unitSelectMobile.offsetWidth;
    unitSelectMobile.classList.add('unit-changed');
    unitSelectMobile.addEventListener('animationend', () => unitSelectMobile.classList.remove('unit-changed'), { once: true });
    const c = cityInput.value.trim();
    if (c) getWeatherByCity(c);
  });
}
document.getElementById('clear-history-btn-mobile')?.addEventListener('click', () => {
  clearHistory();
  settingsDropdown?.classList.remove('open');
});
newsTabs.querySelectorAll('.news-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    newsTabs.querySelectorAll('.news-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCategory = tab.dataset.cat;
    localStorage.setItem(LS.category, currentCategory);
    sbSaveSettings({ news_category: currentCategory });
    sbLog('news_category', { category: currentCategory });
    fetchAndRenderNews(currentCategory);
  });
});


// 共有ボタン
document.getElementById('share-btn')?.addEventListener('click', async () => {
  const url = _shareUrl || location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title: (currentCity || '') + 'の天気 - Luna & Elma', url });
    } catch {}
  } else {
    try {
      await navigator.clipboard.writeText(url);
      showToast('✅ URLをコピーしました！');
    } catch {
      prompt('URLをコピーしてください:', url);
    }
  }
});

// 雨バナー閉じるボタン
document.getElementById('rain-banner-close')?.addEventListener('click', () => {
  const banner = document.getElementById('rain-banner');
  if (banner) banner.classList.remove('show');
  sessionStorage.setItem('rain_banner_dismissed', '1');
});

// エラー再試行ボタン
document.getElementById('error-retry-btn')?.addEventListener('click', () => {
  clearError();
  const city = cityInput.value.trim() || currentCity;
  if (city) getWeatherByCity(city);
  else if (lastCoords) getWeatherByGeo();
});

// ニュースフィルター
function setFilterActive(id) {
  ['news-filter-all','news-filter-unread','news-filter-bookmark'].forEach(i =>
    document.getElementById(i)?.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}
document.getElementById('news-filter-all')?.addEventListener('click', () => {
  newsShowUnreadOnly = false;
  setFilterActive('news-filter-all');
  fetchAndRenderNews(currentCategory);
});
document.getElementById('news-filter-unread')?.addEventListener('click', () => {
  newsShowUnreadOnly = true;
  setFilterActive('news-filter-unread');
  fetchAndRenderNews(currentCategory);
});
document.getElementById('news-filter-bookmark')?.addEventListener('click', () => {
  newsShowUnreadOnly = false;
  setFilterActive('news-filter-bookmark');
  renderBookmarkCards();
});
document.getElementById('news-filter-clear-read')?.addEventListener('click', () => {
  clearReadUrls();
  newsShowUnreadOnly = false;
  setFilterActive('news-filter-all');
  fetchAndRenderNews(currentCategory);
});

// 通知ボタン
document.getElementById('notif-btn').addEventListener('click', async () => {
  const btn = document.getElementById('notif-btn');
  if (!notificationsEnabled) {
    const granted = await requestNotificationPermission();
    if (granted) {
      notificationsEnabled = true;
      localStorage.setItem(LS.notif, '1');
      btn.classList.remove('notif-btn-off');
      btn.title = '通知ON（クリックでOFF）';
      if (sbCurrentUser()) sbSaveSettings({ notifications_enabled: 1 });
    } else {
      showError('ブラウザの通知が許可されていません。アドレスバー左のアイコンから通知を許可してください。');
    }
  } else {
    notificationsEnabled = false;
    localStorage.removeItem(LS.notif);
    btn.classList.add('notif-btn-off');
    btn.title = '天気アラート通知をONにする';
    if (sbCurrentUser()) sbSaveSettings({ notifications_enabled: 0 });
  }
});

// ===== 自動リロード =====
async function autoRefreshWeather() {
  if (!lastCoords || document.hidden) return; // タブ非表示時はスキップ
  const unit = unitSelect.value;
  try {
    const w = await fetchWeatherOpenMeteo(lastCoords.lat, lastCoords.lon, unit, currentCity);
    if (!w) return;
    renderWeather(w, unit);
    fetchAndRenderForecast(lastCoords.lat, lastCoords.lon, unit);
    fetchAndRenderWave(lastCoords.lat, lastCoords.lon);
  } catch { /* 自動更新失敗は無視 */ }
}

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(autoRefreshWeather, AUTO_REFRESH_MS);
}

// ===== 気象庁 API =====
const JMA_AREA_CODE = {
  'Tokyo':'130000','東京':'130000','Osaka':'270000','大阪':'270000',
  'Kyoto':'260000','京都':'260000','Nagoya':'230000','名古屋':'230000',
  'Fukuoka':'400000','福岡':'400000','Sapporo':'016000','札幌':'016000',
  'Sendai':'040000','仙台':'040000','Hiroshima':'340000','広島':'340000',
  'Kobe':'280000','神戸':'280000','Yokohama':'140000','横浜':'140000',
  'Wakayama':'300000','和歌山':'300000','Nara':'290000','奈良':'290000',
  'Kanazawa':'170000','金沢':'170000','Naha':'471000','那覇':'471000',
  'Nagasaki':'420000','長崎':'420000','Kumamoto':'430000','熊本':'430000',
  'Niigata':'150000','新潟':'150000','Shizuoka':'220000','静岡':'220000',
  'Okayama':'330000','岡山':'330000','Saitama':'110000','埼玉':'110000',
  'Chiba':'120000','千葉':'120000','Nagano':'200000','長野':'200000',
  'Kagoshima':'460100','鹿児島':'460100','Miyazaki':'450000','宮崎':'450000',
  'Oita':'440000','大分':'440000','Saga':'410000','佐賀':'410000',
  'Gifu':'210000','岐阜':'210000','Kawasaki':'140000','川崎':'140000',
};

async function fetchJMAForecast(cityName) {
  const code = JMA_AREA_CODE[cityName];
  if (!code) return null;
  try {
    const result = await fetchJson('https://www.jma.go.jp/bosai/forecast/data/forecast/' + code + '.json', 10000);
    if (!result.ok || !Array.isArray(result.data)) return null;
    const overview = result.data[0];
    const ts0 = overview.timeSeries[0];
    const ts1 = overview.timeSeries[1];
    const area = ts0.areas[0];
    const days = ts0.timeDefines.slice(0, 3).map((d, i) => {
      const dt = new Date(d);
      return {
        label: i === 0 ? '今日' : i === 1 ? '明日' : '明後日',
        date: (dt.getMonth() + 1) + '/' + dt.getDate(),
        weather: (area.weathers?.[i] || '').replace(/\s+/g, ' '),
        weatherCode: area.weatherCodes?.[i] || '',
      };
    });
    const pops = ts1?.areas[0]?.pops || [];
    return { days, pops, areaName: area.area.name };
  } catch { return null; }
}

function renderJMAForecast(jmaData) {
  const panel = document.getElementById('jma-panel');
  if (!panel) return;
  if (!jmaData || !jmaData.days.length) { panel.style.display = 'none'; return; }
  const dayCards = jmaData.days.map((d, i) => {
    const pop = jmaData.pops[i * 2] != null ? jmaData.pops[i * 2] + '%' : '-';
    const iconUrl = d.weatherCode
      ? 'https://www.jma.go.jp/bosai/forecast/img/' + d.weatherCode + '.png'
      : '';
    return '<div class="jma-day">' +
      '<div class="jma-day-label">' + d.label + ' ' + d.date + '</div>' +
      (iconUrl ? '<img class="jma-day-icon" src="' + iconUrl + '" alt="">' : '') +
      '<div class="jma-day-weather">' + d.weather + '</div>' +
      '<div class="jma-day-pop">☂ ' + pop + '</div>' +
      '</div>';
  }).join('');
  panel.innerHTML =
    '<div class="jma-header">' +
      '<span class="jma-title">📡 気象庁 天気予報</span>' +
      '<span class="jma-area">' + jmaData.areaName + '</span>' +
    '</div>' +
    '<div class="jma-days">' + dayCards + '</div>';
  panel.querySelectorAll('.jma-day-icon').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
  });
  panel.style.display = 'block';
}

// ===== Supabase 認証 UI =====
let _userBadgeCloseListenerAdded = false;
function updateAuthUI(user) {
  const area = document.getElementById('auth-area');
  if (!area) return;
  if (!user) {
    area.innerHTML = '<button class="btn" id="login-btn" style="font-size:13px;">ログイン</button>';
    document.getElementById('login-btn')?.addEventListener('click', () => {
      document.getElementById('auth-backdrop')?.classList.add('show');
    });
  } else {
    // Google OAuth は full_name、メール登録は email のプレフィックスを表示
    const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || '?';
    const initial = escHtml(displayName[0].toUpperCase());
    area.innerHTML =
      '<div class="user-badge" id="user-badge">' +
        '<div class="user-avatar">' + initial + '</div>' +
        '<span class="user-email">' + escHtml(displayName) + '</span>' +
        '<div class="user-dropdown">' +
          '<div class="user-dd-item" id="user-email-dd" style="font-size:11px;color:var(--text2);padding-bottom:4px;border-bottom:1px solid var(--border);">' + escHtml(user.email || '') + '</div>' +
          '<div class="user-dd-item danger" id="signout-btn">ログアウト</div>' +
        '</div>' +
      '</div>';
    document.getElementById('user-badge')?.addEventListener('click', function(e) {
      e.stopPropagation();
      this.classList.toggle('open');
    });
    if (!_userBadgeCloseListenerAdded) {
      document.addEventListener('click', () => {
        document.getElementById('user-badge')?.classList.remove('open');
      });
      _userBadgeCloseListenerAdded = true;
    }
    document.getElementById('signout-btn')?.addEventListener('click', async () => {
      await sbSignOut();
    });
  }
}

function initAuthModal() {
  // タブ切替
  document.querySelectorAll('[data-auth-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-auth-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const pane = tab.dataset.authTab;
      document.getElementById('auth-google-pane').style.display = pane === 'google' ? '' : 'none';
      document.getElementById('auth-email-pane').style.display  = pane === 'email'  ? '' : 'none';
    });
  });

  // モーダルを閉じる
  document.getElementById('auth-close')?.addEventListener('click', () => {
    document.getElementById('auth-backdrop')?.classList.remove('show');
  });
  document.getElementById('auth-backdrop')?.addEventListener('click', e => {
    if (e.target === document.getElementById('auth-backdrop'))
      document.getElementById('auth-backdrop').classList.remove('show');
  });

  // Google サインイン
  document.getElementById('auth-google-btn')?.addEventListener('click', async () => {
    try { await sbSignInGoogle(); }
    catch(e) { setAuthMsg('error', 'Googleログインに失敗しました'); }
  });

  // メール サインイン / サインアップ
  let authMode = 'signin';
  document.getElementById('auth-toggle-mode')?.addEventListener('click', () => {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    document.getElementById('auth-submit-btn').textContent = authMode === 'signin' ? 'ログイン' : '新規登録';
    document.getElementById('auth-toggle-mode').textContent = authMode === 'signin' ? '新規登録' : 'ログインへ戻る';
    setAuthMsg('', '');
  });

  document.getElementById('auth-submit-btn')?.addEventListener('click', async () => {
    const email    = document.getElementById('auth-email')?.value.trim();
    const password = document.getElementById('auth-password')?.value;
    if (!email || !password) { setAuthMsg('error', 'メールとパスワードを入力してください'); return; }
    setAuthMsg('', '処理中...');
    const fn = authMode === 'signin' ? sbSignInEmail : sbSignUpEmail;
    const { error } = await fn(email, password);
    if (error) {
      setAuthMsg('error', error.message || 'エラーが発生しました');
    } else if (authMode === 'signup') {
      setAuthMsg('success', '確認メールを送信しました。メールを確認してください。');
    } else {
      document.getElementById('auth-backdrop')?.classList.remove('show');
    }
  });
}

function setAuthMsg(type, msg) {
  const el = document.getElementById('auth-msg');
  if (!el) return;
  el.className = 'auth-msg' + (type ? ' ' + type : '');
  el.textContent = msg;
}

// ===== プルトゥリフレッシュ =====
(function initPullToRefresh() {
  const indicator = document.getElementById('ptr-indicator');
  const ptrIcon   = document.getElementById('ptr-icon');
  const ptrLabel  = document.getElementById('ptr-label');
  if (!indicator) return;

  let startY = 0;
  let pulling = false;
  const THRESHOLD = 80;

  document.addEventListener('touchstart', e => {
    if (window.scrollY === 0) { startY = e.touches[0].clientY; pulling = true; }
  }, { passive: true });

  let _ptrDy = 0, _ptrRaf = null;
  document.addEventListener('touchmove', e => {
    if (!pulling) return;
    _ptrDy = e.touches[0].clientY - startY;
    if (_ptrRaf) return;
    _ptrRaf = requestAnimationFrame(() => {
      _ptrRaf = null;
      if (_ptrDy > 10) {
        indicator.classList.add('ptr-pulling');
        ptrIcon.textContent  = _ptrDy >= THRESHOLD ? '↺' : '↓';
        ptrLabel.textContent = _ptrDy >= THRESHOLD ? '放して更新' : '引いて更新';
      }
    });
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!pulling) return;
    const dy = e.changedTouches[0].clientY - startY;
    pulling = false;
    if (dy >= THRESHOLD) {
      ptrIcon.textContent  = '';
      ptrLabel.textContent = '更新中...';
      indicator.classList.remove('ptr-pulling');
      indicator.classList.add('ptr-refreshing');
      indicator.querySelector('.ptr-spinner')?.remove();
      const spinner = document.createElement('span');
      spinner.className = 'ptr-spinner';
      indicator.insertBefore(spinner, ptrIcon);
      const done = () => {
        indicator.classList.remove('ptr-refreshing');
        spinner.remove();
        ptrIcon.textContent  = '↓';
        ptrLabel.textContent = '引いて更新';
      };
      const tasks = [fetchAndRenderNews(currentCategory)];
      if (lastCoords) tasks.push(getWeatherByGeo());
      else if (currentCity) tasks.push(getWeatherByCity(currentCity));
      Promise.allSettled(tasks).then(done);
    } else {
      indicator.classList.remove('ptr-pulling');
      ptrIcon.textContent  = '↓';
      ptrLabel.textContent = '引いて更新';
    }
  }, { passive: true });
})();

// ===== ニュース未読バッジ =====
function updateNewsBadges() {
  const readSet = loadReadUrls();
  newsTabs.querySelectorAll('.news-tab').forEach(tab => {
    const cat = tab.dataset.cat;
    const cached = newsCache[cat];
    let existing = tab.querySelector('.tab-badge');
    if (!cached?.articles?.length) { existing?.remove(); return; }
    const count = cached.articles.filter(a => a.url && !readSet.has(a.url)).length;
    if (count <= 0) { existing?.remove(); return; }
    if (!existing) { existing = document.createElement('span'); existing.className = 'tab-badge'; tab.appendChild(existing); }
    existing.textContent = count > 99 ? '99+' : String(count);
  });
}

// ===== プライバシーポリシー =====
(function initPrivacyModal() {
  const modal = document.getElementById('privacy-modal');
  const closeBtn = document.getElementById('privacy-modal-close');
  const link = document.getElementById('privacy-link');
  if (!modal) return;
  link?.addEventListener('click', () => modal.classList.add('show'));
  closeBtn?.addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
})();

// ===== オンボーディング =====
function initOnboarding() {
  const ONBOARDING_KEY = 'sora_onboarding_v1';
  if (localStorage.getItem(ONBOARDING_KEY)) return;
  const modal   = document.getElementById('onboarding-modal');
  const nextBtn = document.getElementById('ob-next');
  const prevBtn = document.getElementById('ob-prev');
  const dots    = modal?.querySelectorAll('.ob-dot');
  const steps   = modal?.querySelectorAll('.ob-step');
  if (!modal || !steps?.length) return;
  let current = 0;
  const total = steps.length;

  const show = idx => {
    steps.forEach((s, i) => s.classList.toggle('active', i === idx));
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    prevBtn.style.display = idx === 0 ? 'none' : '';
    nextBtn.textContent = idx === total - 1 ? 'はじめる ✓' : '次へ →';
    current = idx;
  };

  nextBtn?.addEventListener('click', () => {
    if (current < total - 1) { show(current + 1); }
    else {
      modal.classList.remove('show');
      localStorage.setItem(ONBOARDING_KEY, '1');
    }
  });
  prevBtn?.addEventListener('click', () => { if (current > 0) show(current - 1); });

  show(0);
  modal.classList.add('show');
}

// ===== 初期化 =====
(function init() {
  cleanSummaryCache();
  initOnboarding();
  const savedTheme = localStorage.getItem(LS.theme);
  if (savedTheme === 'dark' || savedTheme === 'light') applyTheme(savedTheme);
  else applyTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const savedUnit = localStorage.getItem(LS.unit);
  if (savedUnit === 'metric' || savedUnit === 'imperial') applyUnit(savedUnit);
  renderHistory();
  renderFavorites();
  // 前回選択したニュースカテゴリを復元
  const validCategories = Object.keys(CATEGORY_LABEL);
  const savedCategory = localStorage.getItem(LS.category);
  if (savedCategory && validCategories.includes(savedCategory)) {
    currentCategory = savedCategory;
  }
  const activeTab = newsTabs.querySelector('.news-tab[data-cat="' + currentCategory + '"]');
  if (activeTab) {
    newsTabs.querySelectorAll('.news-tab').forEach(t => t.classList.remove('active'));
    activeTab.classList.add('active');
  }
  fetchAndRenderNews(currentCategory);
  const urlCity = new URL(location.href).searchParams.get('city');
  if (urlCity) { cityInput.value = urlCity; getWeatherByCity(urlCity); }

  // Supabase 認証初期化
  // onAuthStateChange のみで管理（getSession との競合を防ぐ）
  initAuthModal();
  document.getElementById('login-btn')?.addEventListener('click', () => {
    document.getElementById('auth-backdrop')?.classList.add('show');
  });
  // 通知状態を復元
  if (localStorage.getItem(LS.notif) === '1' && Notification.permission === 'granted') {
    notificationsEnabled = true;
    const nb = document.getElementById('notif-btn');
    if (nb) { nb.classList.remove('notif-btn-off'); nb.title = '通知ON（クリックでOFF）'; }
  }

  // フォントサイズ調整
  const fontSizes = ['font-sm', 'font-md', 'font-lg'];
  let fontSizeIdx = parseInt(localStorage.getItem(LS.fontSize) || '1');
  function applyFontSize(idx) {
    fontSizes.forEach(c => document.body.classList.remove(c));
    document.body.classList.add(fontSizes[idx]);
    const labels = ['ａ', 'Ａ', '𝐀'];
    const titles = ['小', '中', '大'];
    ['font-size-btn', 'font-size-btn-mobile'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) { btn.textContent = labels[idx] || 'Ａ'; btn.title = titles[idx] + ' フォントサイズ'; }
    });
  }
  applyFontSize(fontSizeIdx);
  ['font-size-btn', 'font-size-btn-mobile'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      fontSizeIdx = (fontSizeIdx + 1) % 3;
      applyFontSize(fontSizeIdx);
      localStorage.setItem(LS.fontSize, fontSizeIdx);
      // zoom変更でドロップダウンがずれるため閉じる
      document.getElementById('settings-dropdown')?.classList.remove('open');
    });
  });

  // ===== UIカスタマイズ初期化 =====
  const savedCustom = { ...UI_DEFAULTS, ...loadUICustom() };
  applyUICustom(savedCustom);

  // カスタマイズモーダル
  (function initCustomizeModal() {
    const backdrop  = document.getElementById('customize-backdrop');
    const closeBtn  = document.getElementById('customize-close');
    const hueSlider = document.getElementById('hue-slider');
    const resetBtn  = document.getElementById('customize-reset');
    if (!backdrop) return;

    let cfg = { ...UI_DEFAULTS, ...loadUICustom() };

    function syncUI() {
      if (hueSlider) hueSlider.value = cfg.hue;
      document.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('active', parseInt(s.dataset.hue) === cfg.hue);
      });
      document.querySelectorAll('[data-radius]').forEach(b => {
        b.classList.toggle('active', b.dataset.radius === cfg.radius);
      });
      document.querySelectorAll('[data-fontsize]').forEach(b => {
        b.classList.toggle('active', b.dataset.fontsize === cfg.fontSize);
      });
      document.querySelectorAll('[data-bg-theme]').forEach(b => {
        b.classList.toggle('active', b.dataset.bgTheme === (cfg.bgTheme ?? 'cosmic'));
      });
    }
    syncUI();

    function openModal() { backdrop.classList.add('show'); syncUI(); }
    function closeModal() { backdrop.classList.remove('show'); }

    ['customize-btn', 'customize-btn-mobile'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', openModal);
    });
    closeBtn?.addEventListener('click', closeModal);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });

    hueSlider?.addEventListener('input', () => {
      cfg.hue = parseInt(hueSlider.value);
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      applyUICustom(cfg); saveUICustom(cfg);
    });

    document.getElementById('color-swatches')?.addEventListener('click', e => {
      const sw = e.target.closest('.color-swatch');
      if (!sw) return;
      cfg.hue = parseInt(sw.dataset.hue);
      syncUI(); applyUICustom(cfg); saveUICustom(cfg);
    });

    backdrop.addEventListener('click', e => {
      const rb = e.target.closest('[data-radius]');
      if (rb) { cfg.radius = rb.dataset.radius; syncUI(); applyUICustom(cfg); saveUICustom(cfg); return; }
      const fb = e.target.closest('[data-fontsize]');
      if (fb) { cfg.fontSize = fb.dataset.fontsize; syncUI(); applyUICustom(cfg); saveUICustom(cfg); return; }
      const bb = e.target.closest('#bg-theme-swatches [data-bg-theme]');
      if (bb) { cfg.bgTheme = bb.dataset.bgTheme; syncUI(); applyUICustom(cfg); saveUICustom(cfg); }
    });

    resetBtn?.addEventListener('click', () => {
      cfg = { ...UI_DEFAULTS };
      syncUI(); applyUICustom(cfg); saveUICustom(cfg);
    });
  })();

  // ===== リップルエフェクト（ボタン・ニュースタブ共通） =====
  document.addEventListener('click', e => {
    const btn = e.target.closest('.btn, .news-tab, .chip');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const el = document.createElement('span');
    el.className = 'ripple';
    el.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size/2}px;top:${e.clientY - rect.top - size/2}px`;
    btn.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, { capture: true });

  // ===== 検索ボタン パーティクルバースト =====
  searchBtn?.addEventListener('click', () => {
    const rect = searchBtn.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const count = 10;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist  = 28 + Math.random() * 22;
      const el = document.createElement('span');
      el.className = 'search-spark';
      el.style.cssText = `left:${cx}px;top:${cy}px;--sdx:${(Math.cos(angle)*dist).toFixed(1)}px;--sdy:${(Math.sin(angle)*dist).toFixed(1)}px`;
      searchBtn.appendChild(el);
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }
  });

  // manifest の ?action=geo / ?tab=news 対応
  const urlAction = new URL(location.href).searchParams.get('action');
  const urlTab    = new URL(location.href).searchParams.get('tab');
  if (urlAction === 'geo') getWeatherByGeo();
  if (urlTab === 'news') {
    document.querySelector('.news-tab[data-cat="general"]')?.scrollIntoView({ behavior: 'smooth' });
  }

  sbOnAuthChange((event, user) => {
    // OAuthリダイレクト後の初回読み込み:
    // PKCE code exchange が非同期のため INITIAL_SESSION が先に null で来ることがある。
    // ?code= が残っている間はログアウト表示をスキップし SIGNED_IN を待つ。
    const hasPkceCode = new URL(location.href).searchParams.has('code');
    if (event === 'INITIAL_SESSION' && !user && hasPkceCode) return;
    updateAuthUI(user);
    // INITIAL_SESSION: ページ読み込み時の既存セッション検出
    // SIGNED_IN: 新規ログイン完了
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && user) {
      sbLoadSettings().then(settings => {
        // settings が null = DB行未作成。ローカルデータをクラウドへ初期アップロード
        const s = settings || {};
        if (s.theme && (s.theme === 'dark' || s.theme === 'light')) applyTheme(s.theme);
        if (s.unit  && (s.unit  === 'metric' || s.unit === 'imperial')) applyUnit(s.unit);
        if (s.news_category && validCategories.includes(s.news_category)) {
          currentCategory = s.news_category;
          newsTabs.querySelectorAll('.news-tab').forEach(t => t.classList.remove('active'));
          newsTabs.querySelector('.news-tab[data-cat="' + currentCategory + '"]')?.classList.add('active');
          fetchAndRenderNews(currentCategory);
        }
        if (s.city) { cityInput.value = s.city; getWeatherByCity(s.city); }

        // お気に入り: クラウド ↔ ローカル 双方向マージ
        // ローカルにあってクラウドにないものも含めて統合し、クラウドへ書き戻す
        // カタカナのみの文字列（旧APIが返す誤データ例:「ワカヤマシ」）を除外
        const sanitizeFavs = arr => arr.filter(c => !/^[\u30A0-\u30FF\s]+$/.test(c));
        const rawCloudFavs = Array.isArray(s.favorites) ? s.favorites : [];
        const cloudFavs    = sanitizeFavs(rawCloudFavs);
        const cloudWasDirty = rawCloudFavs.length !== cloudFavs.length;
        const localFavs    = loadFavorites();
        const mergedFavs   = [...cloudFavs, ...localFavs.filter(c => !cloudFavs.includes(c))].slice(0, 10);
        localStorage.setItem(LS.favorites, JSON.stringify(mergedFavs));
        renderFavorites();
        // クラウドにない項目がローカルにある、またはサニタイズで不正データを除去した場合は Supabase を更新
        if (cloudWasDirty || localFavs.some(c => !cloudFavs.includes(c))) {
          sbSaveSettings({ favorites: mergedFavs });
        }

        // ニュース既読クラウド同期（ローカルとマージ）
        if (Array.isArray(s.news_read) && s.news_read.length) {
          const local = loadReadUrls();
          s.news_read.forEach(u => local.add(u));
          try { localStorage.setItem(LS.newsRead, JSON.stringify([...local].slice(-300))); } catch {}
        }
        // ニュースブックマーク復元（双方向マージ）
        const cloudBmarks = Array.isArray(s.news_bookmarks) ? s.news_bookmarks : [];
        const localBmarks = loadBookmarks();
        const localBUrls  = new Set(localBmarks.map(b => b.url));
        const mergedBmarks = [...localBmarks, ...cloudBmarks.filter(b => !localBUrls.has(b.url))].slice(0, 50);
        if (mergedBmarks.length) {
          localStorage.setItem(LS.bookmarks, JSON.stringify(mergedBmarks));
          if (cloudBmarks.some(b => !localBUrls.has(b.url))) sbSaveSettings({ news_bookmarks: mergedBmarks });
        }

        // 検索履歴クラウド同期
        if (Array.isArray(s.search_history) && s.search_history.length) {
          const local = loadHistory();
          const merged = [...s.search_history, ...local.filter(c => !s.search_history.includes(c))].slice(0, 8);
          localStorage.setItem(LS.history, JSON.stringify(merged));
          renderHistory();
          if (local.some(c => !s.search_history.includes(c))) sbSaveSettings({ search_history: merged });
        }

        // 音量設定復元
        if (s.volume != null) {
          const pct = Math.round(parseFloat(s.volume) * 100);
          const sl = document.getElementById('volume-slider');
          const lb = document.getElementById('volume-label');
          if (sl) { sl.value = pct; localStorage.setItem(LS.volume, s.volume); }
          if (lb) lb.textContent = pct + '%';
        }
        // 通知設定復元（既存の notif 復元と統合）
        if (s.notifications_enabled === 1 && Notification.permission === 'granted') {
          notificationsEnabled = true;
          const nb = document.getElementById('notif-btn');
          if (nb) { nb.classList.remove('notif-btn-off'); nb.title = '通知ON（クリックでOFF）'; }
          localStorage.setItem(LS.notif, '1');
        }
      });
      document.getElementById('auth-backdrop')?.classList.remove('show');
    }

    // SIGNED_OUT: ローカルのユーザーデータを全消去（セキュリティ対応）
    if (event === 'SIGNED_OUT') {
      [LS.favorites, LS.history, LS.chat, LS.bookmarks, LS.newsRead].forEach(k => {
        localStorage.removeItem(k);
      });
      renderFavorites();
      renderHistory();
      clearChatHistory();
      const chatContainer = document.getElementById('chat-messages');
      if (chatContainer) chatContainer.innerHTML = '';
    }
  });
})();

// ===== SEASONAL PARTICLE SYSTEM =====
(function initSeasonalParticles() {
  const canvas = document.getElementById('season-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const month = new Date().getMonth() + 1;
  const season =
    month >= 3 && month <= 5 ? 'spring' :
    month >= 6 && month <= 8 ? 'summer' :
    month >= 9 && month <= 11 ? 'autumn' : 'winter';

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  let _resizeTimer = null;
  window.addEventListener('resize', () => {
    if (_resizeTimer) clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(resize, 150);
  }, { passive: true });

  // ===== 季節ごとのパーティクル設定 =====
  const SEASON_CFG = {
    spring: {
      count: 16,
      colors: ['#ffb7c5', '#ff9eb5', '#ffd6e0', '#ff85a1', '#fce4ec'],
      create() {
        const c = SEASON_CFG.spring.colors;
        return {
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: 5 + Math.random() * 8,
          vy: 0.25 + Math.random() * 0.35,
          vx: (Math.random() - 0.5) * 0.3,
          rot: Math.random() * Math.PI * 2,
          dRot: (Math.random() - 0.5) * 0.02,
          swayA: 25 + Math.random() * 35,
          swayS: 0.005 + Math.random() * 0.004,
          swayO: Math.random() * Math.PI * 2,
          color: c[Math.floor(Math.random() * c.length)],
          alpha: 0.45 + Math.random() * 0.4,
        };
      },
      update(p, t) {
        p.x += p.vx + Math.sin(t * p.swayS + p.swayO) * 0.9;
        p.y += p.vy;
        p.rot += p.dRot;
        if (p.y > canvas.height + 20) { p.y = -20; p.x = Math.random() * canvas.width; }
      },
      draw(p) {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        // 花びら：2枚の楕円を重ねる
        ctx.beginPath();
        ctx.ellipse(0, -p.size * 0.3, p.size * 0.38, p.size * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, p.size * 0.3, p.size * 0.38, p.size * 0.7, 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      },
    },

    summer: {
      count: 16,
      colors: ['#ccff66', '#b8e44d', '#e0ff80', '#a5d62d'],
      // グラジエントをパーティクル生成時に一度だけオフスクリーン Canvas にキャッシュ
      _makeGlowCache(color, glow) {
        const size = glow * 2 + 2;
        const oc = document.createElement('canvas');
        oc.width = oc.height = size;
        const octx = oc.getContext('2d');
        const g = octx.createRadialGradient(glow, glow, 0, glow, glow, glow);
        g.addColorStop(0, color);
        g.addColorStop(0.5, color + '88');
        g.addColorStop(1, 'transparent');
        octx.fillStyle = g;
        octx.beginPath();
        octx.arc(glow, glow, glow, 0, Math.PI * 2);
        octx.fill();
        return oc;
      },
      create() {
        const c = SEASON_CFG.summer.colors;
        const color = c[Math.floor(Math.random() * c.length)];
        const glow  = 10 + Math.random() * 14;
        return {
          x: Math.random() * canvas.width,
          y: canvas.height + Math.random() * 100,
          vy: -(0.25 + Math.random() * 0.45),
          vx: (Math.random() - 0.5) * 0.35,
          glow,
          alpha: 0,
          targetAlpha: 0.35 + Math.random() * 0.45,
          fadeIn: true,
          fadeSpd: 0.006 + Math.random() * 0.008,
          glowCache: SEASON_CFG.summer._makeGlowCache(color, glow),
        };
      },
      update(p) {
        p.x += p.vx; p.y += p.vy;
        if (p.fadeIn) {
          p.alpha += p.fadeSpd;
          if (p.alpha >= p.targetAlpha) { p.alpha = p.targetAlpha; p.fadeIn = false; }
        } else {
          p.alpha -= p.fadeSpd * 0.6;
        }
        if (p.alpha <= 0 || p.y < -30) {
          p.x = Math.random() * canvas.width;
          p.y = canvas.height + 10;
          p.alpha = 0; p.fadeIn = true;
        }
      },
      draw(p) {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.drawImage(p.glowCache, p.x - p.glow - 1, p.y - p.glow - 1);
        ctx.restore();
      },
    },

    autumn: {
      count: 16,
      colors: ['#ff7043', '#ff5722', '#ffa726', '#ef6c00', '#d84315', '#ffcc02'],
      create() {
        const c = SEASON_CFG.autumn.colors;
        return {
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: 6 + Math.random() * 9,
          vy: 0.25 + Math.random() * 0.35,
          vx: (Math.random() - 0.5) * 0.4,
          rot: Math.random() * Math.PI * 2,
          dRot: (Math.random() - 0.5) * 0.02,
          swayA: 18 + Math.random() * 28,
          swayS: 0.005 + Math.random() * 0.004,
          swayO: Math.random() * Math.PI * 2,
          color: c[Math.floor(Math.random() * c.length)],
          alpha: 0.45 + Math.random() * 0.4,
        };
      },
      update(p, t) {
        p.x += p.vx + Math.sin(t * p.swayS + p.swayO) * 0.7;
        p.y += p.vy;
        p.rot += p.dRot;
        if (p.y > canvas.height + 20) { p.y = -20; p.x = Math.random() * canvas.width; }
      },
      draw(p) {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        // 葉：楕円 + 先端の三角
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 0.38, p.size * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, -p.size * 0.72);
        ctx.lineTo(-p.size * 0.15, -p.size * 0.55);
        ctx.lineTo(p.size * 0.15, -p.size * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      },
    },

    winter: {
      count: 24,
      colors: ['#ffffff', '#e8f4fd', '#cce5f6', '#ddeeff'],
      create() {
        const c = SEASON_CFG.winter.colors;
        return {
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: 1.5 + Math.random() * 3.5,
          vy: 0.3 + Math.random() * 0.4,
          vx: (Math.random() - 0.5) * 0.25,
          swayA: 12 + Math.random() * 18,
          swayS: 0.004 + Math.random() * 0.005,
          swayO: Math.random() * Math.PI * 2,
          color: c[Math.floor(Math.random() * c.length)],
          alpha: 0.4 + Math.random() * 0.5,
        };
      },
      update(p, t) {
        p.x += p.vx + Math.sin(t * p.swayS + p.swayO) * 0.5;
        p.y += p.vy;
        if (p.y > canvas.height + 10) { p.y = -10; p.x = Math.random() * canvas.width; }
      },
      // shadowBlur の代わりに 2重円で柔らかい輝きを表現（GPU 負荷を削減）
      draw(p) {
        ctx.save();
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha * 0.25;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      },
    },
  };

  const cfg = SEASON_CFG[season];
  const _sMobile = window.innerWidth < 768;
  // モバイルはパーティクル数を1/3に削減（発熱対策）
  const _mobileCount = Math.max(3, Math.floor(cfg.count / 3));
  const particles = Array.from({ length: _sMobile ? _mobileCount : cfg.count }, () => cfg.create());

  let t = 0;
  let raf = null;
  let _sLastTime = 0;
  const _S_INTERVAL = _sMobile ? 120 : 40; // mobile:8fps / desktop:25fps

  function animate(ts = 0) {
    if (document.hidden) { raf = null; return; } // タブ非表示時は停止
    if (ts - _sLastTime < _S_INTERVAL) {
      raf = requestAnimationFrame(animate);
      return;
    }
    _sLastTime = ts;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    t += 0.016;
    particles.forEach(p => { cfg.update(p, t); cfg.draw(p); });
    raf = requestAnimationFrame(animate);
  }
  animate();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = null;
    } else if (!raf) {
      animate();
    }
  });
})();

/* ===== MOBILE BOTTOM NAVIGATION ===== */
(function initMobileNav() {
  const nav = document.getElementById('mobile-bottom-nav');
  if (!nav) return;

  const PANELS = { weather: 'tab-weather', news: 'tab-news', ai: 'tab-ai' };
  const LS_TAB = 'sora_active_tab';

  function isMobile() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function switchTab(tab) {
    if (!isMobile()) return;

    // Settings tab → open settings dropdown (unit, font, history, customize)
    if (tab === 'settings') {
      const dd = document.getElementById('settings-dropdown');
      if (!dd) return;
      const isOpen = dd.classList.contains('open');
      // Close first if open, otherwise open from-bottom
      if (isOpen) {
        dd.classList.remove('open', 'from-bottom');
      } else {
        dd.classList.add('open', 'from-bottom');
      }
      return;
    }

    // Close settings dropdown when switching to other tabs
    const dd = document.getElementById('settings-dropdown');
    dd?.classList.remove('open', 'from-bottom');

    // Update nav button states
    nav.querySelectorAll('.mobile-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Show/hide panels
    Object.entries(PANELS).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('active', key === tab);
    });

    localStorage.setItem(LS_TAB, tab);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // Attach click listeners
  nav.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation(); // prevent global click listener from closing dropdown
      switchTab(btn.dataset.tab);
    });
  });

  // On resize: ensure desktop shows all panels
  window.addEventListener('resize', () => {
    if (!isMobile()) {
      Object.values(PANELS).forEach(id => {
        document.getElementById(id)?.classList.add('active');
      });
    }
  });

  // Restore saved tab (mobile only)
  const saved = isMobile() ? (localStorage.getItem(LS_TAB) || 'weather') : 'weather';
  if (isMobile()) switchTab(saved);
  else {
    // Desktop: ensure all panels active
    Object.values(PANELS).forEach(id => {
      document.getElementById(id)?.classList.add('active');
    });
  }
})();
