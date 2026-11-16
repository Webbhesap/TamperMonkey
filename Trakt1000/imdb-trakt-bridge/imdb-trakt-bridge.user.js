// ==UserScript==
// @name         IMDb ↔ Trakt Köprüsü (canlı)
// @namespace    https://github.com/Webbhesap/TamperMonkey
// @version      0.1.0
// @description  Trakt'tan canlı okur (kendi oturumun, bağlı uygulama slotu harcamaz) ve IMDb'ye yazar: liste, watchlist, izlendi, puan. İki sayfalı: app.trakt.tv'de çek, imdb.com'da bas.
// @author       Webbhesap
// @match        https://app.trakt.tv/*
// @match        https://www.imdb.com/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.trakt.tv
// @connect      apiz.trakt.tv
// @connect      www.imdb.com
// @connect      api.graphql.imdb.com
// @license      MIT
// ==/UserScript==

/*
  NEDEN İKİ SAYFA?
  Trakt token'ı app.trakt.tv'nin localStorage'ında durur; imdb.com'dan okunamaz.
  Bu yüzden betik iki yerde çalışır ve veriyi GM deposu ile taşır:

    1) app.trakt.tv  → token'ı bulur, Trakt API'sinden okur, satırları kaydeder
    2) www.imdb.com  → kayıtlı satırları IMDb'ye yazar (liste/watchlist/izlendi/puan)

  GM deposu yoksa elle taşıma da var: Trakt sayfasında "JSON indir",
  IMDb sayfasında "JSON yükle".

  DOĞRULANMIŞ UÇLAR (kaynak kodundan):
    IMDb  POST https://api.graphql.imdb.com/
          createList(input:{name,listDescription,allowDuplicates,listType,visibility}) { listId }
          addItemToList(input:{listId,item:{itemElementId}})                          { listId }
          rateTitle(input:{rating,titleId})                                           { rating{value} }
          addWatchedTitle(titleId)                                                    { success }
    IMDb  PUT https://www.imdb.com/watchlist/tt1234567   (watchlist'e ekleme, REST)
    Trakt GET /users/me/usage          → {total_list_items:{current,free,vip}, ...}
    Trakt GET /users/me/watched/shows/plays?limit=all
    Trakt token: localStorage anahtarı "oidc.user:https://auth.trakt.tv:<client_id>"
*/

(function () {
  'use strict';

  /* __PURE_START__ */

  const VERSION = '0.1.0';
  const STORE_PREFIX = 'imdbTraktBridge.v1.';
  const TRAKT_OIDC_PREFIX = 'oidc.user:https://auth.trakt.tv:';
  const TRAKT_HOSTS = ['https://api.trakt.tv', 'https://apiz.trakt.tv'];
  const IMDB_GRAPHQL = 'https://api.graphql.imdb.com/';
  const IMDB_HOST = 'https://www.imdb.com';
  const IMDB_CONSENT_INFO = 'eyJhZ2VTaWduYWwiOiJBRFVMVCIsImlzR2RwciI6ZmFsc2V9';
  const TARGETS = ['list', 'watchlist', 'watched', 'rating'];
  const TYPES = ['movie', 'show', 'episode', 'season', 'person'];
  const IMDB_LIST_CAP = 12000;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function isTtId(value) {
    return typeof value === 'string' && /^tt\d{7,9}$/.test(value);
  }

  function isNmId(value) {
    return typeof value === 'string' && /^nm\d{5,9}$/.test(value);
  }

  // IMDb "Title Type" / Trakt "type" değerlerini iç tür adımıza indirger.
  function typeFromToken(raw) {
    const t = String(raw || '').toLowerCase().replace(/[\s_-]/g, '');
    if (t === 'movie' || t === 'tvmovie' || t === 'film') return 'movie';
    if (t === 'tvseries' || t === 'tvminiseries' || t === 'show' || t === 'series') return 'show';
    if (t === 'tvepisode' || t === 'episode') return 'episode';
    if (t === 'season' || t === 'tvseason') return 'season';
    if (t === 'person' || t === 'name') return 'person';
    if (t === 'tvspecial' || t === 'special') return 'movie';
    if (t === 'tvshort' || t === 'short') return 'movie';
    if (t === 'video' || t === 'videogame') return 'movie';
    return 'unknown';
  }

  // ---------- Trakt oturumu (canlı okuma) ----------

  // localStorage anahtarından client_id'yi çıkarır.
  function parseOidcKey(key) {
    if (typeof key !== 'string' || !key.startsWith(TRAKT_OIDC_PREFIX)) return null;
    const clientId = key.slice(TRAKT_OIDC_PREFIX.length);
    if (!clientId) return null;
    return { authority: 'https://auth.trakt.tv', clientId };
  }

  // Verilen anahtar listesinde Trakt OIDC anahtarını bulur.
  function findOidcKey(keys) {
    const list = Array.isArray(keys) ? keys : Object.keys(keys || {});
    for (const key of list) {
      const parsed = parseOidcKey(key);
      if (parsed) return key;
    }
    return null;
  }

  // localStorage benzeri bir nesneden erişim token'ını çıkarır.
  function extractTraktToken(storageLike, now = Date.now()) {
    const key = findOidcKey(storageLike);
    if (!key) return { ok: false, reason: 'no-key', clientId: null };
    let parsed;
    try {
      parsed = JSON.parse(storageLike[key]);
    } catch (err) {
      return { ok: false, reason: 'bad-json', clientId: parseOidcKey(key).clientId };
    }
    const clientId = parseOidcKey(key).clientId;
    const token = parsed && typeof parsed.access_token === 'string' ? parsed.access_token : null;
    if (!token) return { ok: false, reason: 'no-token', clientId };
    const expiresAt = Number(parsed.expires_at) || 0;
    return {
      ok: true,
      token,
      clientId,
      tokenType: parsed.token_type || 'Bearer',
      expiresAt,
      expired: expiresAt > 0 && expiresAt * 1000 <= now,
      scope: parsed.scope || null,
      userLogin: (parsed.profile && (parsed.profile.username || parsed.profile.name)) || null,
    };
  }

  function traktHeaders(token, clientId) {
    const h = {
      'content-type': 'application/json',
      'trakt-api-version': '2',
    };
    if (token) h.authorization = `Bearer ${token}`;
    if (clientId) h['trakt-api-key'] = clientId;
    return h;
  }

  // Trakt REST yolları. path döner (host çağıranda eklenir).
  function traktPath(kind, opts = {}) {
    const type = opts.type && opts.type !== 'all' ? `/${opts.type}` : '';
    const user = opts.user || 'me';
    switch (kind) {
      case 'usage': return '/users/me/usage';
      case 'settings': return '/users/me/settings';
      case 'lists': return `/users/${user}/lists`;
      case 'listItems': return `/users/${user}/lists/${opts.listId}/items`;
      case 'watchlist': return `/users/${user}/watchlist${type}`;
      case 'watched': return `/sync/watched${type}`;
      case 'plays': return `/users/${user}/watched/shows/plays?limit=all`;
      case 'ratings': return `/sync/ratings${type}`;
      case 'collection': return `/sync/collection${type}`;
      default: return null;
    }
  }

  // /users/me/usage yanıtını {current, free, vip} kovalarına göre özetler.
  function usageSummary(usage) {
    const out = [];
    if (!usage || typeof usage !== 'object') return out;
    for (const [name, bucket] of Object.entries(usage)) {
      if (!bucket || typeof bucket !== 'object') continue;
      const current = Number(bucket.current);
      const free = Number(bucket.free);
      const vip = Number(bucket.vip);
      if (!Number.isFinite(current)) continue;
      out.push({
        name,
        current,
        free: Number.isFinite(free) ? free : null,
        vip: Number.isFinite(vip) ? vip : null,
        remainingFree: Number.isFinite(free) ? Math.max(0, free - current) : null,
        pctFree: Number.isFinite(free) && free > 0 ? Math.round((current / free) * 100) : null,
      });
    }
    return out;
  }

  // ---------- Trakt yanıtını ortak satır biçimine çevirme ----------

  // Tek bir Trakt kaydından (movie/show/episode/season/person) satır üretir.
  // target: 'list' | 'watchlist' | 'watched' | 'rating'
  function normalizeTraktRecord(record, opts = {}) {
    const target = opts.target || 'list';
    const source = opts.source || null;
    if (!record || typeof record !== 'object') return null;

    const typeRaw = record.type || null;
    let kind = null;
    let entity = null;
    let parent = null;
    // Trakt kayıtlarında bölüm kaydı hem `episode` hem `show` taşır; doğru varlığı
    // seçmek için önce record.type ipucu, yoksa "en özelden en genele" sıra kullanılır.
    const typeHint = typeRaw ? typeFromToken(typeRaw) : null;
    const precedence = (typeHint && ['episode', 'season', 'movie', 'show', 'person'].includes(typeHint))
      ? [typeHint, 'episode', 'season', 'movie', 'show', 'person']
      : ['episode', 'season', 'movie', 'show', 'person'];
    for (const candidate of precedence) {
      if (record[candidate] && typeof record[candidate] === 'object') {
        kind = candidate;
        entity = record[candidate];
        break;
      }
    }
    if (!entity) return null;
    if (record.show && record.show !== entity) parent = record.show;

    const ids = entity.ids || {};
    const imdb = typeof ids.imdb === 'string' ? ids.imdb.replace(/^\/?(tt\d{7,9})\/?$/, '$1') : null;
    const type = kind === 'movie' ? 'movie'
      : kind === 'show' ? 'show'
        : kind === 'episode' ? 'episode'
          : kind === 'season' ? 'season'
            : 'person';
    const typeGuess = typeRaw ? typeFromToken(typeRaw) : type;

    let label = entity.title || (parent && parent.title) || '';
    if (type === 'episode') {
      const s = Number(entity.season);
      const e = Number(entity.number);
      if (Number.isFinite(s) && Number.isFinite(e) && (s || e)) {
        label = `${parent && parent.title ? parent.title + ' ' : ''}S${pad2(s)}E${pad2(e)}`.trim();
      }
    }
    if (entity.year) label = `${label} (${entity.year})`;

    const row = {
      const: imdb && isTtId(imdb) ? imdb : null,
      nm: imdb && isNmId(imdb) ? imdb : null,
      type,
      typeGuess,
      label,
      target,
      source,
      rating: ratingClamp(record.rating),
      date: record.rated_at || record.last_watched_at || record.listed_at || record.watched_at || null,
      traktId: Number(ids.trakt) || null,
      tmdbId: Number(ids.tmdb) || null,
      parentConst: parent && parent.ids && isTtId(parent.ids.imdb) ? parent.ids.imdb : null,
    };
    return row;
  }

  // Bir dizinin tamamını satırlara çevirir; IMDb'ye yazılamayacakları atlar.
  function normalizeTraktRecords(records, opts = {}) {
    const rows = [];
    const skipped = { count: 0, reasons: {} };
    const bump = (reason) => {
      skipped.count += 1;
      skipped.reasons[reason] = (skipped.reasons[reason] || 0) + 1;
    };
    const list = Array.isArray(records) ? records : [];
    for (const record of list) {
      const row = normalizeTraktRecord(record, opts);
      if (!row) { bump('taninmayan-kayit'); continue; }
      if (row.nm && !row.const) { bump('kisi-nm'); continue; }
      if (!row.const) { bump('imdb-yok'); continue; }
      rows.push(row);
    }
    return { rows, skipped };
  }

  // Trakt /users/me/lists yanıtından liste kimlikleri çıkarır.
  function normalizeTraktLists(lists) {
    const out = [];
    for (const item of Array.isArray(lists) ? lists : []) {
      if (!item || typeof item !== 'object') continue;
      const ids = item.ids || {};
      out.push({
        name: item.name || '(adsız)',
        slug: ids.slug || null,
        traktId: Number(ids.trakt) || null,
        listId: ids.slug || String(Number(ids.trakt) || ''),
        privacy: item.privacy || null,
        itemCount: Number(item.item_count) || null,
        type: item.type || null,
      });
    }
    return out;
  }

  function ratingClamp(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    const rounded = Math.round(n);
    return Math.min(10, Math.max(1, rounded));
  }

  // ---------- Satır yardımcıları ----------

  function rowKey(row) {
    return `${row.const}|${row.target}`;
  }

  // İki satır kümesini birleştirir, (const + target) temelinde tekilleştirir.
  function mergeRows(a, b) {
    const seen = new Map();
    for (const row of [...(a || []), ...(b || [])]) {
      if (!row || !row.const) continue;
      const key = rowKey(row);
      const prev = seen.get(key);
      if (!prev) { seen.set(key, row); continue; }
      // Puanı/tarihi olanı yeğle.
      const next = Object.assign({}, prev);
      if (row.rating && !next.rating) next.rating = row.rating;
      if (row.date && !next.date) next.date = row.date;
      if (row.label && !next.label) next.label = row.label;
      seen.set(key, next);
    }
    return [...seen.values()];
  }

  function applyTargetFilter(rows, enabled) {
    const on = new Set(Object.keys(enabled || {}).filter((k) => enabled[k]));
    if (!on.size) return [];
    return (rows || []).filter((r) => on.has(r.target));
  }

  function applyTypeFilter(rows, enabled) {
    const on = new Set(Object.keys(enabled || {}).filter((k) => enabled[k]));
    if (!on.size) return [];
    return (rows || []).filter((r) => on.has(r.type) || (r.type === 'unknown' && on.has('unknown')));
  }

  function countBy(rows, field) {
    const out = {};
    for (const row of rows || []) {
      const k = row[field] || 'unknown';
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }

  function countByType(rows) { return countBy(rows, 'type'); }
  function countByTarget(rows) { return countBy(rows, 'target'); }

  // Dizi gövdesi ve bölümleri aynı hedefte birlikte sıradaysa uyar.
  function overlapWarning(rows) {
    const types = countByType(rows || []);
    const body = (types.show || 0) + (types.movie || 0);
    const eps = types.episode || 0;
    if (body > 0 && eps > 0) {
      return `Uyarı: sırada ${body} gövde (film/dizi) ve ${eps} bölüm birlikte var. ` +
        'IMDb\'de gövdeyi işaretlemek bölümlerini işaretlemez (tersi de geçerli); ' +
        'aynı içeriği iki kez yazmış olursun.';
    }
    return null;
  }

  // Satırları kaynak (Trakt listesi adı) bazında gruplar.
  function groupBySource(rows) {
    const map = new Map();
    for (const row of rows || []) {
      const key = row.source || '(kaynaksız)';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return [...map.entries()].map(([source, items]) => ({ source, items }));
  }

  // Hedef başına satır sayısı IMDB_LIST_CAP'i aşıyor mu?
  function capWarnings(rows, cap = IMDB_LIST_CAP) {
    const out = [];
    const byTarget = {};
    for (const row of rows || []) {
      byTarget[row.target] = (byTarget[row.target] || 0) + 1;
    }
    for (const [target, n] of Object.entries(byTarget)) {
      if (target === 'watched' || target === 'rating') continue;
      if (n > cap) {
        out.push(`Uyarı: "${target}" hedefine ${n} öğe gidecek; IMDb kap tavanı ${cap}. ` +
          'Fazlası reddedilir, listeleri böl.');
      }
    }
    return out;
  }

  function sanitizeListName(name, max = 255) {
    let out = String(name || '').replace(/\s+/g, ' ').trim();
    if (out.length > max) out = out.slice(0, max).trimEnd();
    return out;
  }

  // Metin/URL içinden IMDb liste kimliğini (ls...) bulur.
  function parseImdbListId(text) {
    const m = String(text || '').match(/ls\d{6,12}/);
    return m ? m[0] : null;
  }

  // ---------- IMDb GraphQL gövdeleri ----------

  const GQL_OPS = {
    createList: {
      operationName: 'CreateList',
      query: 'mutation CreateList($input: CreateListInput!) { createList(input: $input) { listId __typename } }',
    },
    addItemToList: {
      operationName: 'AddItemToList',
      query: 'mutation AddItemToList($input: AddItemToListInput!) { addItemToList(input: $input) { listId __typename } }',
    },
    rateTitle: {
      operationName: 'UpdateTitleRating',
      query: 'mutation UpdateTitleRating($rating: Int!, $titleId: ID!) { rateTitle(input: {rating: $rating, titleId: $titleId}) { rating { value __typename } __typename } }',
    },
    addWatchedTitle: {
      operationName: 'AddWatchedTitle',
      query: 'mutation AddWatchedTitle($titleId: ID!) { addWatchedTitle(titleId: $titleId) { success } }',
    },
  };

  function imdbGraphqlBody(op, vars) {
    const spec = GQL_OPS[op];
    if (!spec) return null;
    return { query: spec.query, operationName: spec.operationName, variables: vars || {} };
  }

  function createListVariables(name, opts = {}) {
    return {
      input: {
        name: sanitizeListName(name),
        listDescription: String(opts.description || '').slice(0, 10000),
        allowDuplicates: false,
        listType: 'TITLES',
        visibility: opts.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
      },
    };
  }

  function addItemVariables(listId, constId) {
    return { input: { listId, item: { itemElementId: constId } } };
  }

  function rateVariables(constId, rating) {
    return { rating: ratingClamp(rating), titleId: constId };
  }

  function watchedVariables(constId) {
    return { titleId: constId };
  }

  function imdbGraphqlHeaders() {
    return {
      'content-type': 'application/json',
      accept: 'application/graphql+json, application/json',
      'x-imdb-client-name': 'imdb-web-next',
      'x-imdb-consent-info': IMDB_CONSENT_INFO,
    };
  }

  // Watchlist GraphQL değil, düz REST: PUT https://www.imdb.com/watchlist/tt...
  function watchlistUrl(constId, host = IMDB_HOST) {
    return `${String(host).replace(/\/$/, '')}/watchlist/${constId}`;
  }

  function gqlErrorMessage(json) {
    if (!json) return null;
    const errs = json.errors;
    if (!Array.isArray(errs) || !errs.length) return null;
    return errs.map((e) => (e && e.message) || JSON.stringify(e)).join(' | ');
  }

  function looksLikeAuthError(text) {
    return /unauthor|login|sign ?in|session|forbidden|csrf|token|not authenticated/i.test(String(text || ''));
  }

  function looksLikeDuplicate(text) {
    return /duplicate|already (exists|in|added|on)|present in|exists in/i.test(String(text || ''));
  }

  function classifyHttpStatus(status) {
    if (status >= 200 && status < 300) return 'ok';
    if (status === 401 || status === 403) return 'auth';
    if (status === 429 || status === 420) return 'rate';
    if (status >= 500) return 'server';
    return 'error';
  }

  function backoffFor(attempt, table = [5000, 15000, 30000]) {
    const i = Math.max(0, Math.min(table.length - 1, attempt - 1));
    return table[i];
  }

  function formatEta(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}s ${pad2(m)}dk`;
    if (m > 0) return `${m}dk ${pad2(s)}sn`;
    return `${s}sn`;
  }

  // ---------- CSV ----------

  const CSV_COLS = ['const', 'type', 'target', 'label', 'rating', 'date', 'source', 'listId'];

  function csvEscape(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(rows, cols = CSV_COLS) {
    const header = cols.join(',');
    const body = (rows || []).map((r) => cols.map((c) => csvEscape(r[c])).join(','));
    return [header, ...body].join('\n');
  }

  function parseCsv(text) {
    const rows = [];
    let field = '';
    let row = [];
    let inQuotes = false;
    const src = String(text || '').replace(/\r\n?/g, '\n');
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
        } else { field += ch; }
        continue;
      }
      if (ch === '"') { inQuotes = true; continue; }
      if (ch === ',') { row.push(field); field = ''; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
      field += ch;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const out = [];
    for (const line of rows.slice(1)) {
      if (!line.some((c) => String(c).trim())) continue;
      const obj = {};
      header.forEach((h, idx) => { obj[h] = line[idx] !== undefined ? line[idx].trim() : ''; });
      out.push(obj);
    }
    return out;
  }

  // CSV'den (kendi dışa aktarımımız veya IMDb CSV) satır üretir.
  function rowsFromCsv(text, opts = {}) {
    const target = opts.target || 'list';
    const records = parseCsv(text);
    const rows = [];
    const skipped = { count: 0, reasons: {} };
    const bump = (reason) => {
      skipped.count += 1;
      skipped.reasons[reason] = (skipped.reasons[reason] || 0) + 1;
    };
    for (const rec of records) {
      const rawId = rec.const || rec.imdb || rec['imdb id'] || rec.id || '';
      const constId = String(rawId).replace(/^\/?(tt\d{7,9})\/?$/, '$1');
      if (!isTtId(constId)) { bump('tt-yok'); continue; }
      const type = typeFromToken(rec['title type'] || rec.type || '');
      // Kendi dışa aktarımımızda satırın kendi hedefi vardır; o önceliklidir.
      const ownTarget = TARGETS.includes(String(rec.target || '').trim().toLowerCase())
        ? String(rec.target).trim().toLowerCase()
        : null;
      rows.push({
        const: constId,
        nm: null,
        type: type === 'unknown' ? 'movie' : type,
        typeGuess: type,
        label: rec.title || rec.label || rec.description || '',
        target: ownTarget || target,
        source: opts.source || rec.source || rec.list || null,
        rating: ratingClamp(rec.rating || rec['your rating']),
        date: rec.date || rec['date rated'] || rec.listed_at || rec.created || null,
        traktId: null,
        tmdbId: null,
        parentConst: null,
        listId: rec.listid || null,
      });
    }
    return { rows, skipped };
  }

  // Düz metin: satır başına bir tt kimliği.
  function rowsFromText(text, opts = {}) {
    const target = opts.target || 'list';
    const found = [];
    const seen = new Set();
    const re = /tt\d{7,9}/g;
    let m;
    const src = String(text || '');
    while ((m = re.exec(src)) !== null) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      found.push({
        const: m[0], nm: null, type: 'unknown', typeGuess: 'unknown', label: '',
        target, source: opts.source || null, rating: null, date: null,
        traktId: null, tmdbId: null, parentConst: null,
      });
    }
    return { rows: found, skipped: { count: 0, reasons: {} } };
  }

  /* __PURE_END__ */

  // ---------- Ortam köprüleri ----------

  const HOST = (typeof location !== 'undefined' && location.hostname) || '';
  const IS_TRAKT = /(^|\.)trakt\.tv$/.test(HOST);
  const IS_IMDB = /(^|\.)imdb\.com$/.test(HOST);

  // GM deposu (iki origin arasında paylaşılır). Yoksa yerel localStorage'a düşer;
  // o zaman sayfalar arası taşıma JSON dosyası ile yapılır.
  const hasGmStore = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  const gmFetch = (typeof unsafeWindow !== 'undefined' && unsafeWindow && unsafeWindow.fetch)
    ? unsafeWindow.fetch.bind(unsafeWindow)
    : (typeof fetch === 'function' ? fetch.bind(typeof window !== 'undefined' ? window : globalThis) : null);

  const store = {
    shared: hasGmStore,
    get(key, fallback = null) {
      try {
        const raw = hasGmStore
          ? GM_getValue(STORE_PREFIX + key, null)
          : (typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_PREFIX + key) : null);
        if (raw === null || raw === undefined || raw === '') return fallback;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (err) {
        return fallback;
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      try {
        if (hasGmStore) { GM_setValue(STORE_PREFIX + key, raw); return true; }
        if (typeof localStorage !== 'undefined') { localStorage.setItem(STORE_PREFIX + key, raw); return true; }
      } catch (err) {
        try {
          // Kota dolarsa tarih/etiket alanlarını atarak yeniden dene.
          const lite = JSON.stringify(liteRows(value));
          if (hasGmStore) { GM_setValue(STORE_PREFIX + key, lite); return true; }
          if (typeof localStorage !== 'undefined') { localStorage.setItem(STORE_PREFIX + key, lite); return true; }
        } catch (err2) { /* aşağıda false */ }
      }
      return false;
    },
    del(key) {
      try {
        if (hasGmStore && typeof GM_deleteValue === 'function') GM_deleteValue(STORE_PREFIX + key);
        else if (typeof localStorage !== 'undefined') localStorage.removeItem(STORE_PREFIX + key);
      } catch (err) { /* yoksay */ }
    },
  };

  // Satırları küçült: önce tarih/etiket at, sonra yalnız zorunlu alanlar.
  function liteRows(value) {
    if (!Array.isArray(value)) return value;
    const step1 = value.map((r) => ({ const: r.const, type: r.type, target: r.target, rating: r.rating, source: r.source }));
    return step1;
  }

  // Tek tip HTTP çağrısı: GM_xmlhttpRequest varsa CORS'u atlar, yoksa sayfa fetch'i.
  function httpRequest(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const headers = Object.assign({}, opts.headers || {});
    const body = opts.body === undefined ? undefined
      : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    const timeout = Number(opts.timeout) || 30000;

    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve) => {
        let done = false;
        const finish = (result) => { if (!done) { done = true; resolve(result); } };
        try {
          GM_xmlhttpRequest({
            method,
            url,
            headers,
            data: body,
            timeout,
            anonymous: false,
            onload: (res) => {
              const text = res.responseText || '';
              finish({
                ok: res.status >= 200 && res.status < 300,
                status: res.status,
                text,
                json: safeJson(text),
                headers: res.responseHeaders || '',
                via: 'gm',
              });
            },
            onerror: () => finish({ ok: false, status: 0, text: '', json: null, error: 'network', via: 'gm' }),
            ontimeout: () => finish({ ok: false, status: 0, text: '', json: null, error: 'timeout', via: 'gm' }),
          });
        } catch (err) {
          finish({ ok: false, status: 0, text: '', json: null, error: String(err && err.message || err), via: 'gm' });
        }
      });
    }

    if (!gmFetch) return Promise.resolve({ ok: false, status: 0, text: '', json: null, error: 'fetch-yok' });
    return gmFetch(url, {
      method,
      headers,
      body,
      credentials: opts.credentials || 'include',
      cache: 'no-store',
    }).then(async (res) => {
      const text = await res.text();
      return { ok: res.ok, status: res.status, text, json: safeJson(text), via: 'fetch' };
    }).catch((err) => ({ ok: false, status: 0, text: '', json: null, error: String(err && err.message || err), via: 'fetch' }));
  }

  function safeJson(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (err) { return null; }
  }

  // NDJSON (satır başına bir JSON nesnesi) desteği.
  function parseNdjson(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const obj = safeJson(t);
      if (obj) out.push(obj);
    }
    return out;
  }

  // ---------- Trakt istemcisi ----------

  const trakt = {
    token: null,
    clientId: null,
    host: TRAKT_HOSTS[0],
    userLogin: null,

    readFromStorage() {
      if (typeof localStorage === 'undefined') return { ok: false, reason: 'localstorage-yok' };
      const snap = {};
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith(TRAKT_OIDC_PREFIX)) snap[k] = localStorage.getItem(k);
      }
      const res = extractTraktToken(snap);
      if (res.ok) {
        this.token = res.token;
        this.clientId = res.clientId;
        this.userLogin = res.userLogin;
      }
      return res;
    },

    setToken(token, clientId) {
      this.token = token || null;
      this.clientId = clientId || null;
    },

    async call(kind, opts = {}) {
      if (!this.token || !this.clientId) {
        return { ok: false, status: 0, error: 'token-yok', message: 'Trakt token\'ı bulunamadı. app.trakt.tv\'de oturum açıkken "Token\'ı oku" de.' };
      }
      const path = traktPath(kind, opts);
      if (!path) return { ok: false, status: 0, error: 'bilinmeyen-uc', message: `Bilinmeyen uç: ${kind}` };
      const sep = path.includes('?') ? '&' : '?';
      const query = [];
      if (opts.extended) query.push(`extended=${opts.extended}`);
      if (opts.limit) query.push(`limit=${opts.limit}`);
      if (opts.page) query.push(`page=${opts.page}`);
      const url = `${this.host}${path}${query.length ? sep + query.join('&') : ''}`;
      const res = await httpRequest(url, {
        method: 'GET',
        headers: traktHeaders(this.token, this.clientId),
        timeout: 45000,
      });
      if (res.error) return { ok: false, status: res.status, error: res.error, url, message: res.error };
      if (!res.ok) {
        const cls = classifyHttpStatus(res.status);
        return {
          ok: false, status: res.status, url, kind: cls,
          message: cls === 'auth'
            ? 'Trakt 401/403: token geçersiz veya süresi dolmuş. app.trakt.tv\'de yenile (sayfayı yenile ya da çık/gir).'
            : cls === 'rate'
              ? `Trakt hız sınırı (${res.status}). Biraz bekle ve tekrar dene.`
              : `Trakt HTTP ${res.status}: ${res.text.slice(0, 200)}`,
        };
      }
      return { ok: true, status: res.status, url, data: res.json, headers: res.headers };
    },

    // Sayfalı uçlar için: yeni tekil kayıt gelmeyene kadar ilerle.
    async callPaged(kind, opts = {}) {
      const perPage = Number(opts.limit) || 1000;
      const maxPages = Number(opts.maxPages) || 80;
      const all = [];
      const seen = new Set();
      let page = 1;
      let lastError = null;
      while (page <= maxPages) {
        const res = await this.call(kind, Object.assign({}, opts, { limit: perPage, page }));
        if (!res.ok) { lastError = res; break; }
        const chunk = Array.isArray(res.data) ? res.data : [];
        let added = 0;
        for (const item of chunk) {
          const key = itemKey(item);
          if (seen.has(key)) continue;
          seen.add(key);
          all.push(item);
          added += 1;
        }
        if (chunk.length < perPage || added === 0) break;
        page += 1;
      }
      return { ok: !lastError || all.length > 0, data: all, pages: page, error: lastError };
    },

    async usage() { return this.call('usage'); },
    async lists() { return this.call('lists'); },
    async listItems(listId) { return this.callPaged('listItems', { listId, extended: 'full', user: 'me' }); },
    async watchlist(type) { return this.callPaged('watchlist', { type: type || 'all', extended: 'full' }); },
    async watched(type) { return this.callPaged('watched', { type: type || 'shows' }); },
    async ratings(type) { return this.callPaged('ratings', { type: type || 'movies' }); },
  };

  function itemKey(item) {
    if (!item || typeof item !== 'object') return `raw:${Math.random()}`;
    for (const kind of ['movie', 'show', 'episode', 'season', 'person']) {
      const e = item[kind];
      if (e && e.ids) {
        const id = e.ids.trakt || e.ids.slug || e.ids.imdb;
        if (id) return `${kind}:${id}`;
      }
    }
    if (item.ids && (item.ids.trakt || item.ids.slug)) return `list:${item.ids.trakt || item.ids.slug}`;
    return `obj:${JSON.stringify(item).slice(0, 80)}`;
  }

  // ---------- IMDb istemcisi ----------

  const imdb = {
    captured: [],

    async graphql(op, vars) {
      const body = imdbGraphqlBody(op, vars);
      if (!body) return { ok: false, status: 0, message: `Bilinmeyen işlem: ${op}` };
      const res = await httpRequest(IMDB_GRAPHQL, {
        method: 'POST',
        headers: imdbGraphqlHeaders(),
        body,
        timeout: 30000,
      });
      if (res.error) return { ok: false, status: res.status, message: `ağ hatası: ${res.error}`, op };
      const msg = gqlErrorMessage(res.json);
      const cls = classifyHttpStatus(res.status);
      if (!res.ok) {
        return {
          ok: false, status: res.status, kind: cls, op,
          message: msg || `HTTP ${res.status}: ${res.text.slice(0, 200)}`,
          auth: cls === 'auth' || looksLikeAuthError(msg || res.text),
          rate: cls === 'rate',
        };
      }
      if (msg) {
        return {
          ok: false, status: res.status, kind: 'gql-error', op, message: msg,
          duplicate: looksLikeDuplicate(msg),
          auth: looksLikeAuthError(msg),
        };
      }
      return { ok: true, status: res.status, op, json: res.json };
    },

    createList(name, opts = {}) { return this.graphql('createList', createListVariables(name, opts)); },
    addToList(listId, constId) { return this.graphql('addItemToList', addItemVariables(listId, constId)); },
    rate(constId, rating) { return this.graphql('rateTitle', rateVariables(constId, rating)); },
    watch(constId) { return this.graphql('addWatchedTitle', watchedVariables(constId)); },

    // Watchlist REST: PUT ekle, DELETE çıkar (DELETE doğrulanmadı, dry-run ile dene).
    async watchlist(constId, remove = false) {
      const res = await httpRequest(watchlistUrl(constId), {
        method: remove ? 'DELETE' : 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        timeout: 30000,
      });
      if (res.error) return { ok: false, status: res.status, message: `ağ hatası: ${res.error}` };
      const cls = classifyHttpStatus(res.status);
      if (!res.ok) {
        return {
          ok: false, status: res.status, kind: cls,
          message: cls === 'auth' ? 'IMDb oturumu yok (401/403): imdb.com\'da giriş yap.' : `HTTP ${res.status}: ${res.text.slice(0, 160)}`,
          rate: cls === 'rate',
        };
      }
      return { ok: true, status: res.status };
    },

    async whoami() {
      const res = await httpRequest(`${IMDB_HOST}/`, { method: 'GET', timeout: 20000 });
      const text = res.text || '';
      return {
        ok: res.ok,
        status: res.status,
        loggedIn: /imdb-header__account-toggle--logged-in/.test(text) || /"isLoggedIn":true/.test(text),
      };
    },

    // Sayfanın kendi GraphQL çağrılarını dinle (mutation adı değişirse öğrenmek için).
    installCapture(onRecord) {
      if (typeof window === 'undefined') return false;
      if (this.captureInstalled) return true;
      this.captureInstalled = true;
      const record = (entry) => {
        this.captured.unshift(entry);
        if (this.captured.length > 60) this.captured.length = 60;
        if (typeof onRecord === 'function') onRecord(entry);
      };
      const note = (url, bodyText) => {
        if (!bodyText || typeof bodyText !== 'string') return;
        if (!/api\.graphql\.imdb\.com|\/watchlist\//.test(String(url || '')) && !/mutation/.test(bodyText)) return;
        const parsed = safeJson(bodyText);
        if (parsed && (parsed.operationName || parsed.query)) {
          record({ at: Date.now(), url: String(url || ''), operationName: parsed.operationName || null, query: parsed.query || null, variables: parsed.variables || null });
        } else {
          record({ at: Date.now(), url: String(url || ''), raw: bodyText.slice(0, 400) });
        }
      };

      const origFetch = window.fetch;
      if (typeof origFetch === 'function') {
        window.fetch = function (input, init) {
          try {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            const body = (init && init.body) || (input && input.body) || '';
            if (typeof body === 'string') note(url, body);
          } catch (err) { /* yoksay */ }
          return origFetch.apply(this, arguments);
        };
      }

      const OrigOpen = XMLHttpRequest.prototype.open;
      const OrigSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__bridgeUrl = url;
        return OrigOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function (body) {
        try { if (typeof body === 'string') note(this.__bridgeUrl, body); } catch (err) { /* yoksay */ }
        return OrigSend.apply(this, arguments);
      };
      return true;
    },
  };

  // ---------- Durum ve ayarlar ----------

  const DEFAULTS = {
    dryRun: true,
    delayMs: 650,
    jitterMs: 250,
    maxConsecutiveFailures: 5,
    targets: { list: false, watchlist: false, watched: false, rating: false },
    types: { movie: true, show: true, episode: true, season: false, person: false, unknown: false },
    listMode: 'existing',      // 'existing' | 'create-one' | 'per-source'
    listId: '',
    newListName: 'Trakt taşıma',
    listVisibility: 'PRIVATE',
    removeDuplicatesOnly: false,
  };

  const state = {
    cfg: Object.assign({}, DEFAULTS, store.get('cfg', {})),
    rows: store.get('rows', []) || [],
    meta: store.get('meta', null),
    progress: store.get('progress', null),
    queue: store.get('queue', null),
    results: [],
    failures: [],
    running: false,
    paused: false,
    stopFlag: false,
    consecutiveFailures: 0,
    listIdCache: {},   // kaynak adı → IMDb ls kimliği
    startedAt: 0,
    doneCount: 0,
    failCount: 0,
    skipCount: 0,
  };

  function saveCfg() { store.set('cfg', state.cfg); }
  function saveRows() {
    const ok = store.set('rows', state.rows);
    return ok;
  }
  function saveMeta() { store.set('meta', state.meta); }

  function setRows(rows, meta) {
    state.rows = mergeRows(state.rows, rows || []);
    if (meta) state.meta = Object.assign({}, state.meta || {}, meta);
    saveRows();
    saveMeta();
  }

  function clearAll() {
    state.rows = [];
    state.meta = null;
    state.progress = null;
    state.queue = null;
    state.results = [];
    state.failures = [];
    state.listIdCache = {};
    ['rows', 'meta', 'progress', 'queue'].forEach((k) => store.del(k));
  }

  // ---------- Sıra kurma ----------

  function buildQueue() {
    const byTarget = applyTargetFilter(state.rows, state.cfg.targets);
    const byType = applyTypeFilter(byTarget, state.cfg.types);
    // Puan hedefi puansız satırları yazamaz.
    const usable = byType.filter((r) => {
      if (r.target === 'rating') return Number.isFinite(r.rating) && r.rating > 0;
      if (r.target === 'list') return Boolean(state.cfg.listId) || state.cfg.listMode !== 'existing';
      return true;
    });
    return usable.map((r) => ({
      const: r.const,
      type: r.type,
      target: r.target,
      label: r.label || '',
      rating: r.rating || null,
      date: r.date || null,
      source: r.source || null,
      listId: r.target === 'list' && state.cfg.listMode === 'existing' ? state.cfg.listId : null,
      status: 'bekliyor',
      message: null,
      attempts: 0,
    }));
  }

  // Hedef liste kimliğini çöz: mevcut ls, tek yeni liste veya kaynak başına liste.
  async function resolveListTarget(item, log) {
    if (state.cfg.listMode === 'existing') {
      const id = parseImdbListId(state.cfg.listId);
      if (!id) return { ok: false, message: 'Geçerli bir IMDb liste kimliği (ls...) gir.' };
      return { ok: true, listId: id };
    }
    if (state.cfg.listMode === 'create-one') {
      const key = '__single__';
      if (state.listIdCache[key]) return { ok: true, listId: state.listIdCache[key] };
      const res = await imdb.createList(state.cfg.newListName || 'Trakt taşıma', { visibility: state.cfg.listVisibility });
      const id = res.ok && res.json && res.json.data && res.json.data.createList && res.json.data.createList.listId;
      if (!id) return { ok: false, message: `Liste oluşturulamadı: ${res.message || 'listId yok'}` };
      state.listIdCache[key] = id;
      if (log) log(`Yeni liste oluşturuldu: ${state.cfg.newListName} → ${id}`);
      return { ok: true, listId: id };
    }
    // per-source: Trakt listesi başına bir IMDb listesi
    const src = item.source || '(kaynaksız)';
    if (state.listIdCache[src]) return { ok: true, listId: state.listIdCache[src] };
    const res = await imdb.createList(src, { visibility: state.cfg.listVisibility });
    const id = res.ok && res.json && res.json.data && res.json.data.createList && res.json.data.createList.listId;
    if (!id) return { ok: false, message: `"${src}" listesi oluşturulamadı: ${res.message || 'listId yok'}` };
    state.listIdCache[src] = id;
    if (log) log(`Kaynak "${src}" → yeni IMDb listesi ${id}`);
    return { ok: true, listId: id };
  }

  // ---------- Tek öğe yazma ----------

  async function writeItem(item, log) {
    switch (item.target) {
      case 'watched': return imdb.watch(item.const);
      case 'rating': return imdb.rate(item.const, item.rating);
      case 'watchlist': return imdb.watchlist(item.const, false);
      case 'list': {
        const t = await resolveListTarget(item, log);
        if (!t.ok) return { ok: false, status: 0, message: t.message };
        return imdb.addToList(t.listId, item.const);
      }
      default:
        return { ok: false, status: 0, message: `Bilinmeyen hedef: ${item.target}` };
    }
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ---------- Çalıştırıcı ----------

  async function runQueue(hooks = {}) {
    const log = hooks.log || (() => {});
    const onProgress = hooks.onProgress || (() => {});
    if (state.running) { log('Zaten çalışıyor.'); return; }

    let queue = buildQueue();
    if (state.queue && Array.isArray(state.queue) && state.queue.length) {
      // Yarım kalan işi sürdür: bekleyenleri koru.
      const pending = state.queue.filter((q) => q.status === 'bekliyor' || q.status === 'basarisiz');
      if (pending.length && hooks.resume) {
        queue = pending;
        log(`Kaldığı yerden devam: ${pending.length} öğe.`);
      }
    }
    if (!queue.length) { log('Sırada yazılacak öğe yok. Kaynak/hedef seçimlerini kontrol et.'); return; }

    const warn = overlapWarning(queue);
    if (warn) log(warn);
    capWarnings(queue).forEach((w) => log(w));

    state.running = true;
    state.paused = false;
    state.stopFlag = false;
    state.consecutiveFailures = 0;
    state.queue = queue;
    state.startedAt = Date.now();
    state.doneCount = 0;
    state.failCount = 0;
    state.skipCount = 0;
    store.set('queue', queue);
    log(`Sıra: ${queue.length} öğe · kuru çalıştırma ${state.cfg.dryRun ? 'AÇIK' : 'KAPALI'}`);

    const total = queue.length;
    for (let i = 0; i < total; i += 1) {
      const item = queue[i];
      if (state.stopFlag) { log(`Durduruldu (${i}/${total}).`); break; }
      while (state.paused && !state.stopFlag) { await sleep(300); }
      if (state.stopFlag) break;

      item.attempts += 1;
      if (state.cfg.dryRun) {
        item.status = 'kuru';
        item.message = `yazılacaktı: ${item.target} → ${item.const}`;
        state.skipCount += 1;
      } else {
        let res = await writeItem(item, log);
        // Hız sınırı / sunucu hatası: kademeli bekle ve en fazla 3 kez dene.
        let tries = 0;
        while (!res.ok && (res.rate || res.kind === 'server') && tries < 3 && !state.stopFlag) {
          tries += 1;
          const wait = backoffFor(tries);
          log(`${item.const}: ${res.rate ? 'hız sınırı' : 'sunucu hatası'} → ${wait / 1000}sn bekleniyor (${tries}/3)`);
          await sleep(wait);
          res = await writeItem(item, log);
        }
        if (res.ok) {
          item.status = 'ok';
          item.message = null;
          state.doneCount += 1;
          state.consecutiveFailures = 0;
        } else if (res.duplicate) {
          item.status = 'atlandi';
          item.message = 'zaten var';
          state.skipCount += 1;
          state.consecutiveFailures = 0;
        } else {
          item.status = 'basarisiz';
          item.message = res.message || `HTTP ${res.status}`;
          state.failCount += 1;
          state.consecutiveFailures += 1;
          state.failures.push({ const: item.const, target: item.target, label: item.label, message: item.message, status: res.status });
          if (res.auth) {
            log('Oturum hatası: IMDb\'de giriş yapılı değil ya da oturum düştü. Durduruluyor.');
            state.stopFlag = true;
          }
          if (state.consecutiveFailures >= state.cfg.maxConsecutiveFailures) {
            log(`Art arda ${state.consecutiveFailures} hata → otomatik durduruldu. Sıra kayıtlı, sonra devam edebilirsin.`);
            state.stopFlag = true;
          }
        }
      }

      if (i % 25 === 0 || i === total - 1) store.set('queue', queue);
      const elapsed = Date.now() - state.startedAt;
      const perItem = elapsed / Math.max(1, i + 1);
      onProgress({
        index: i + 1, total,
        done: state.doneCount, failed: state.failCount, skipped: state.skipCount,
        eta: formatEta(perItem * (total - i - 1)),
        current: item,
      });

      if (!state.cfg.dryRun && i < total - 1 && !state.stopFlag) {
        await sleep(state.cfg.delayMs + Math.floor(Math.random() * state.cfg.jitterMs));
      }
    }

    state.running = false;
    store.set('queue', queue);
    store.set('progress', {
      at: Date.now(), total, done: state.doneCount, failed: state.failCount, skipped: state.skipCount,
      dryRun: state.cfg.dryRun,
    });
    log(`Bitti: ${state.doneCount} başarılı · ${state.failCount} başarısız · ${state.skipCount} atlanan/kuru.`);
    if (hooks.onDone) hooks.onDone();
  }

  // Tek öğe denemesi (hedef başına bağlantı testi).
  async function runOne(item, log) {
    if (state.cfg.dryRun) { log(`Kuru deneme: ${item.target} → ${item.const} (yazılmadı)`); return { ok: true, dry: true }; }
    const res = await writeItem(item, log);
    if (res.ok) log(`Tek deneme BAŞARILI: ${item.target} → ${item.const}`);
    else log(`Tek deneme BAŞARISIZ: ${item.target} → ${item.const} · ${res.message || res.status}`);
    return res;
  }

  // ---------- Arayüz yardımcıları ----------

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  const CSS = `
    :host { all: initial; }
    .wrap { position: fixed; z-index: 2147483647; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .fab { right: 16px; bottom: 16px; width: 46px; height: 46px; border-radius: 50%;
           background: #f5c518; color: #111; border: 0; cursor: pointer; font-size: 20px;
           box-shadow: 0 4px 14px rgba(0,0,0,.35); }
    .panel { right: 16px; bottom: 16px; width: 460px; max-width: calc(100vw - 24px);
             max-height: calc(100vh - 32px); overflow: auto; background: #fff; color: #111;
             border: 1px solid #d0d0d0; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.3); }
    .hd { position: sticky; top: 0; background: #f5c518; padding: 10px 12px; font-weight: 700;
          display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .bd { padding: 10px 12px 14px; }
    fieldset { border: 1px solid #ddd; border-radius: 8px; margin: 0 0 10px; padding: 8px 10px; }
    legend { font-weight: 700; padding: 0 4px; font-size: 12px; color: #444; }
    button { background: #111; color: #fff; border: 0; border-radius: 6px; padding: 6px 10px;
             cursor: pointer; font: inherit; }
    button.sec { background: #eee; color: #111; }
    button.warn { background: #b3261e; }
    button:disabled { opacity: .5; cursor: default; }
    input[type=text], input[type=number], select, textarea {
      font: inherit; padding: 5px 6px; border: 1px solid #ccc; border-radius: 6px; background: #fff; color: #111; }
    textarea { width: 100%; box-sizing: border-box; }
    label { display: inline-flex; align-items: center; gap: 5px; margin: 2px 8px 2px 0; cursor: pointer; }
    .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0; }
    .log { background: #111; color: #d7ffd7; padding: 8px; border-radius: 8px; height: 130px;
           overflow: auto; white-space: pre-wrap; font: 11.5px/1.45 ui-monospace, Menlo, Consolas, monospace; }
    .bar { height: 8px; background: #eee; border-radius: 4px; overflow: hidden; margin: 6px 0; }
    .bar > i { display: block; height: 100%; background: #2e7d32; width: 0%; }
    .muted { color: #666; font-size: 12px; }
    .ok { color: #2e7d32; } .bad { color: #b3261e; } .warnTx { color: #a06000; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    td, th { border-bottom: 1px solid #eee; padding: 3px 4px; text-align: left; }
    .pill { display: inline-block; background: #eee; border-radius: 10px; padding: 1px 7px; margin: 1px; font-size: 11.5px; }
    .hide { display: none; }
  `;

  function buildPanel() {
    const host = document.createElement('div');
    host.className = 'wrap';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(h('style', { text: CSS }));

    const logBox = h('div', { class: 'log' });
    const bar = h('i');
    const barWrap = h('div', { class: 'bar' }, [bar]);
    const statusLine = h('div', { class: 'muted' });
    const progLine = h('div', { class: 'muted' });
    const storeLine = h('div', { class: 'muted' });

    function log(msg) {
      const line = h('div', { text: `[${new Date().toLocaleTimeString('tr-TR')}] ${msg}` });
      logBox.appendChild(line);
      logBox.scrollTop = logBox.scrollHeight;
      while (logBox.childNodes.length > 400) logBox.removeChild(logBox.firstChild);
    }

    const refs = { logBox, bar, barWrap, statusLine, progLine, storeLine, log, shadow, host };
    const body = h('div', { class: 'bd' });
    const panel = h('div', { class: 'panel hide' }, [
      h('div', { class: 'hd' }, [
        h('span', { text: `IMDb ↔ Trakt Köprüsü v${VERSION}` }),
        h('button', { class: 'sec', text: 'kapat', onClick: () => toggle(false) }),
      ]),
      body,
    ]);
    const fab = h('button', { class: 'fab', title: 'IMDb ↔ Trakt Köprüsü', text: '⇄', onClick: () => toggle(true) });
    shadow.appendChild(fab);
    shadow.appendChild(panel);

    function toggle(show) {
      const want = show === undefined ? panel.classList.contains('hide') : show;
      panel.classList.toggle('hide', !want);
      fab.style.display = want ? 'none' : '';
      // Panel her açıldışta depoyu tazele: veri başka sekmeden gelmiş olabilir.
      if (want && typeof refs.onOpen === 'function') refs.onOpen();
    }

    refs.toggle = toggle;
    refs.body = body;
    refs.panel = panel;
    return refs;
  }

  // Ortak: depo/satır özeti + dışa aktarma düğmeleri
  function buildStoreSection(refs, side) {
    const log = refs.log;
    const box = h('fieldset', {}, [h('legend', { text: 'Depo' })]);
    const summary = h('div', { class: 'muted' });

    function refresh(opts = {}) {
      // Depoyu yeniden oku: veri başka bir sekmeden (app.trakt.tv) gelmiş olabilir.
      const stored = store.get('rows', null);
      if (Array.isArray(stored) && stored.length) {
        if (state.rows.length !== stored.length && opts.log) {
          opts.log(`Depo yenilendi: ${stored.length} satır (önceki ${state.rows.length}).`);
        }
        state.rows = stored;
      }
      const storedMeta = store.get('meta', null);
      if (storedMeta) state.meta = storedMeta;
      const rows = state.rows || [];
      const byTarget = countByTarget(rows);
      const byType = countByType(rows);
      const targets = TARGETS.map((t) => (byTarget[t] ? `${t}: ${byTarget[t]}` : null)).filter(Boolean).join(' · ') || '—';
      const types = Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—';
      summary.textContent = `${rows.length} satır · hedef → ${targets} · tür → ${types}` +
        (store.shared ? '' : ' · (GM deposu yok: sayfalar arası taşıma JSON ile)');
      if (refs.metaLine) refs.metaLine.textContent = state.meta ? describeMeta(state.meta) : '';
    }

    function download(name, text, mime = 'text/plain') {
      const blob = new Blob([text], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    const fileInput = h('input', { type: 'file', accept: '.json,.csv,.txt,.ndjson', multiple: true, style: { display: 'none' } });
    fileInput.addEventListener('change', async () => {
      const files = [...fileInput.files];
      for (const f of files) {
        const text = await f.text();
        const loaded = loadAnyText(text, f.name);
        log(`${f.name}: ${loaded.rows.length} satır eklendi` +
          (loaded.skipped.count ? ` · ${loaded.skipped.count} atlandı (${Object.entries(loaded.skipped.reasons).map(([k, v]) => `${k}:${v}`).join(', ')})` : ''));
      }
      fileInput.value = '';
      refresh();
    });

    box.appendChild(summary);
    box.appendChild(h('div', { class: 'row' }, [
      h('button', { class: 'sec', text: 'Yenile', onClick: () => refresh({ log: true }) }),
      h('button', { class: 'sec', text: 'JSON indir', onClick: () => download(`trakt-bridge-${Date.now()}.json`, JSON.stringify({ version: VERSION, meta: state.meta, rows: state.rows }, null, 1), 'application/json') }),
      h('button', { class: 'sec', text: 'CSV indir', onClick: () => download(`trakt-bridge-${Date.now()}.csv`, toCsv(state.rows), 'text/csv') }),
      h('button', { class: 'sec', text: 'JSON/CSV yükle', onClick: () => fileInput.click() }),
      h('button', { class: 'warn', text: 'Depoyu temizle', onClick: () => { clearAll(); log('Depo temizlendi.'); refresh(); } }),
    ]));
    box.appendChild(fileInput);
    refs.refreshStore = refresh;
    refs.download = download;
    return box;
  }

  function describeMeta(meta) {
    if (!meta) return '';
    const bits = [];
    if (meta.capturedAt) bits.push(`çekim: ${new Date(meta.capturedAt).toLocaleString('tr-TR')}`);
    if (meta.traktUser) bits.push(`trakt: ${meta.traktUser}`);
    if (meta.counts) bits.push(Object.entries(meta.counts).map(([k, v]) => `${k}=${v}`).join(', '));
    return bits.join(' · ');
  }

  // JSON / CSV / NDJSON / düz metin → satırlar
  function loadAnyText(text, name = '') {
    const lower = String(name).toLowerCase();
    let rows = [];
    const skipped = { count: 0, reasons: {} };
    const bump = (r) => { skipped.count += 1; skipped.reasons[r] = (skipped.reasons[r] || 0) + 1; };

    const add = (res, source) => {
      for (const r of (res.rows || [])) rows.push(r);
      if (res.skipped) {
        skipped.count += res.skipped.count;
        for (const [k, v] of Object.entries(res.skipped.reasons || {})) skipped.reasons[k] = (skipped.reasons[k] || 0) + v;
      }
      if (source) rows.forEach((r) => { if (!r.source) r.source = source; });
    };

    const json = safeJson(text);
    if (json) {
      if (Array.isArray(json)) {
        // Trakt dışa aktarma biçimi mi, kendi JSON'umuz mu?
        const isMine = json.length && json[0] && json[0].const && json[0].target;
        if (isMine) { rows = json.filter((r) => r && r.const); }
        else {
          const target = /ratings/i.test(lower) ? 'rating'
            : /watchlist/i.test(lower) ? 'watchlist'
              : /watched|history/i.test(lower) ? 'watched' : 'list';
          add(normalizeTraktRecords(json, { target, source: name.replace(/\.[a-z]+$/i, '') }));
        }
      } else if (json.rows && Array.isArray(json.rows)) {
        rows = json.rows.filter((r) => r && r.const);
        if (json.meta) state.meta = Object.assign({}, state.meta || {}, json.meta);
      } else {
        bump('json-bicimsiz');
      }
      if (rows.length) { setRows(rows, { loadedFrom: name, capturedAt: Date.now() }); return { rows, skipped }; }
    }

    const nd = parseNdjson(text);
    if (nd.length > 1) {
      const target = /ratings/i.test(lower) ? 'rating' : /watchlist/i.test(lower) ? 'watchlist' : /watched|history/i.test(lower) ? 'watched' : 'list';
      add(normalizeTraktRecords(nd, { target, source: name }));
      if (rows.length) { setRows(rows, { loadedFrom: name, capturedAt: Date.now() }); return { rows, skipped }; }
    }

    if (lower.endsWith('.csv') || /[,;]/.test(text.slice(0, 400))) {
      const target = /ratings/i.test(lower) ? 'rating' : /watchlist/i.test(lower) ? 'watchlist' : 'list';
      add(rowsFromCsv(text, { target, source: name }));
      if (rows.length) { setRows(rows, { loadedFrom: name, capturedAt: Date.now() }); return { rows, skipped }; }
    }

    add(rowsFromText(text, { target: 'list', source: name }));
    if (rows.length) setRows(rows, { loadedFrom: name, capturedAt: Date.now() });
    return { rows, skipped };
  }

  // ---------- TRAKT TARAFI ----------

  function buildTraktSide(refs) {
    const log = refs.log;
    const tokenState = h('div', { class: 'muted', text: 'Token okunmadı.' });
    const usageBox = h('div');
    const listsBox = h('div');
    const manualToken = h('input', { type: 'text', placeholder: 'elle access_token (isteğe bağlı)', style: { width: '220px' } });
    const manualClient = h('input', { type: 'text', placeholder: 'client_id', style: { width: '180px' } });
    const hostSel = h('select', {}, TRAKT_HOSTS.map((u) => h('option', { value: u, text: u })));
    const busy = (on) => { refs.body.style.opacity = on ? '0.6' : '1'; };

    function showToken(res) {
      if (res && res.ok) {
        tokenState.textContent = `✓ Token bulundu · client_id: ${res.clientId.slice(0, 8)}… · kullanıcı: ${res.userLogin || '?'} · süre: ${res.expiresAt ? new Date(res.expiresAt * 1000).toLocaleString('tr-TR') : 'bilinmiyor'}${res.expired ? ' (DOLMUŞ!)' : ''}`;
        tokenState.className = res.expired ? 'bad' : 'ok';
        if (res.expired) log('Token süresi dolmuş görünüyor. app.trakt.tv sayfasını yenile, gerekiyorsa çık/gir yap.');
      } else {
        tokenState.textContent = `✗ Token bulunamadı (${res && res.reason}). app.trakt.tv'de oturum açık mı? Sayfayı yenile ya da token'ı elle yapıştır.`;
        tokenState.className = 'bad';
      }
    }

    function readToken() {
      const res = trakt.readFromStorage();
      showToken(res);
      if (res.ok) {
        store.set('traktAuth', { clientId: res.clientId, at: Date.now() });
        log(`Token okundu (client_id ${res.clientId.slice(0, 8)}…). Bu, Trakt'ın kendi oturumu: yeni "bağlı uygulama" slotu harcamaz.`);
      }
      return res;
    }

    async function probe() {
      busy(true);
      log('Kapasite sorgulanıyor: GET /users/me/usage');
      const res = await trakt.usage();
      busy(false);
      usageBox.textContent = '';
      if (!res.ok) { log(res.message || 'usage alınamadı'); usageBox.appendChild(h('div', { class: 'bad', text: res.message || 'usage alınamadı' })); return; }
      const summary = usageSummary(res.data);
      if (!summary.length) { log('usage yanıtı boş/okunamadı.'); return; }
      const table = h('table', {}, [
        h('tr', {}, [h('th', { text: 'kova' }), h('th', { text: 'şu an' }), h('th', { text: 'ücretsiz tavan' }), h('th', { text: 'kalan' }), h('th', { text: 'VIP tavan' })]),
        ...summary.map((s) => h('tr', {}, [
          h('td', { text: s.name }),
          h('td', { text: String(s.current) }),
          h('td', { text: s.free === null ? '—' : String(s.free) }),
          h('td', { text: s.remainingFree === null ? '—' : String(s.remainingFree), class: s.remainingFree !== null && s.remainingFree <= 0 ? 'bad' : 'ok' }),
          h('td', { text: s.vip === null ? '—' : String(s.vip) }),
        ])),
      ]);
      usageBox.appendChild(table);
      const tli = summary.find((s) => s.name === 'total_list_items');
      if (tli) {
        log(`total_list_items: ${tli.current} / ${tli.free} (kalan ${tli.remainingFree}) — IMDb'ye taşımak için sebep bu.`);
        if (tli.remainingFree <= 0) log('Liste kotan dolu: Trakt\'a yeni öğe eklenemez. IMDb tarafı bu yüzden gerekli.');
      }
      store.set('usage', { at: Date.now(), data: res.data });
    }

    async function fetchLists() {
      busy(true);
      log('Listeler çekiliyor: GET /users/me/lists');
      const res = await trakt.lists();
      busy(false);
      listsBox.textContent = '';
      if (!res.ok) { log(res.message || 'listeler alınamadı'); listsBox.appendChild(h('div', { class: 'bad', text: res.message || 'alınamadı' })); return; }
      const lists = normalizeTraktLists(res.data);
      log(`${lists.length} liste bulundu.`);
      if (!lists.length) return;
      const boxes = lists.map((l) => {
        const cb = h('input', { type: 'checkbox' });
        return { cb, list: l };
      });
      listsBox.appendChild(h('div', { class: 'muted', text: 'İçe aktarılacak Trakt listelerini seç (öğe sayısı parantez içinde):' }));
      boxes.forEach(({ cb, list }) => {
        listsBox.appendChild(h('label', {}, [
          cb,
          h('span', { text: `${list.name} (${list.itemCount === null ? '?' : list.itemCount}) · ${list.privacy || ''}` }),
        ]));
      });
      listsBox.appendChild(h('div', { class: 'row' }, [
        h('button', { class: 'sec', text: 'Tümünü seç', onClick: () => boxes.forEach((b) => { b.cb.checked = true; }) }),
        h('button', { class: 'sec', text: 'Seçimi temizle', onClick: () => boxes.forEach((b) => { b.cb.checked = false; }) }),
        h('button', { text: 'Seçilen listeleri çek → depoya', onClick: async () => {
          const chosen = boxes.filter((b) => b.cb.checked).map((b) => b.list);
          if (!chosen.length) { log('Hiç liste seçilmedi.'); return; }
          busy(true);
          for (const l of chosen) {
            log(`"${l.name}" öğeleri çekiliyor (${l.listId})…`);
            const r = await trakt.listItems(l.listId);
            if (r.error && !r.data.length) { log(`  ✗ ${r.error.message || 'hata'}`); continue; }
            const norm = normalizeTraktRecords(r.data, { target: 'list', source: l.name });
            setRows(norm.rows, { capturedAt: Date.now(), traktUser: trakt.userLogin });
            log(`  ✓ ${norm.rows.length} satır eklendi` + (norm.skipped.count ? ` · ${norm.skipped.count} atlandı (${Object.entries(norm.skipped.reasons).map(([k, v]) => `${k}:${v}`).join(', ')})` : ''));
            await sleep(250);
          }
          busy(false);
          refs.refreshStore();
        } }),
      ]));
    }

    async function pull(kindLabel, fn, target) {
      busy(true);
      log(`${kindLabel} çekiliyor…`);
      const res = await fn();
      busy(false);
      if (!res || (!res.ok && !(res.data && res.data.length))) {
        log(`✗ ${kindLabel}: ${(res && (res.message || (res.error && res.error.message))) || 'alınamadı'}`);
        return;
      }
      const data = res.data !== undefined ? res.data : res;
      const norm = normalizeTraktRecords(data, { target, source: kindLabel });
      setRows(norm.rows, { capturedAt: Date.now(), traktUser: trakt.userLogin });
      log(`✓ ${kindLabel}: ${norm.rows.length} satır` + (norm.skipped.count ? ` · atlanan ${norm.skipped.count} (${Object.entries(norm.skipped.reasons).map(([k, v]) => `${k}:${v}`).join(', ')})` : ''));
      if (!norm.rows.length) log('  Not: 0 satır geldi. Uç doğru olabilir ama veri yok, ya da IMDb kimliği (ids.imdb) boş.');
      refs.refreshStore();
    }

    const watchedTypeSel = h('select', {}, ['movies', 'shows', 'episodes'].map((t) => h('option', { value: t, text: t })));
    const ratingsTypeSel = h('select', {}, ['movies', 'shows', 'episodes', 'all'].map((t) => h('option', { value: t, text: t })));

    const box = h('div');
    box.appendChild(h('fieldset', {}, [
      h('legend', { text: '1 · Trakt bağlantısı (kendi oturumun)' }),
      tokenState,
      h('div', { class: 'row' }, [
        h('button', { text: "Token'ı oku", onClick: () => readToken() }),
        h('button', { class: 'sec', text: 'Kapasiteyi göster (/users/me/usage)', onClick: probe }),
        hostSel,
      ]),
      h('div', { class: 'row' }, [
        manualToken, manualClient,
        h('button', { class: 'sec', text: 'Elle ayarla', onClick: () => {
          if (!manualToken.value.trim()) { log('Token alanı boş.'); return; }
          trakt.setToken(manualToken.value.trim(), manualClient.value.trim());
          log('Token elle ayarlandı (bu sekme için geçerli).');
        } }),
      ]),
      h('div', { class: 'muted', text: 'Token, tarayıcının localStorage\'ındaki Trakt oturumundan okunur; hiçbir yere gönderilmez, yalnızca api.trakt.tv isteklerinde kullanılır.' }),
      usageBox,
    ]));

    box.appendChild(h('fieldset', {}, [
      h('legend', { text: '2 · Kaynaklar' }),
      h('div', { class: 'row' }, [
        h('button', { text: 'Listeleri getir', onClick: fetchLists }),
        h('button', { class: 'sec', text: 'Watchlist → depoya', onClick: () => pull('watchlist', () => trakt.watchlist('all'), 'watchlist') }),
      ]),
      h('div', { class: 'row' }, [
        h('span', { text: 'İzlenenler:' }), watchedTypeSel,
        h('button', { class: 'sec', text: 'Çek → depoya (izlendi)', onClick: () => pull(`watched/${watchedTypeSel.value}`, () => trakt.watched(watchedTypeSel.value), 'watched') }),
        h('span', { class: 'muted', text: 'episodes = denenmemiş' }),
      ]),
      h('div', { class: 'row' }, [
        h('span', { text: 'Puanlar:' }), ratingsTypeSel,
        h('button', { class: 'sec', text: 'Çek → depoya (puan)', onClick: () => pull(`ratings/${ratingsTypeSel.value}`, () => trakt.ratings(ratingsTypeSel.value), 'rating') }),
      ]),
      h('div', { class: 'row' }, [
        h('button', { text: 'Hepsini çek (liste+watchlist+izlenen+puan)', onClick: async () => {
          await fetchLists();
          await pull('watchlist', () => trakt.watchlist('all'), 'watchlist');
          await pull('watched/movies', () => trakt.watched('movies'), 'watched');
          await pull('watched/shows', () => trakt.watched('shows'), 'watched');
          await pull('ratings/all', () => trakt.ratings('all'), 'rating');
          log('Toplu çekim bitti. Şimdi imdb.com sekmesine geç ve 3. adımdan yazdır.');
        } }),
      ]),
      h('div', { class: 'muted', text: 'Bölüm (episode) düzeyinde izlenme geçmişi için en güvenilir kaynak Trakt ZIP dışa aktarmasıdır: app.trakt.tv → Settings → Export → watched-history-*.json. Bu dosyaları "JSON/CSV yükle" ile verebilirsin; hedef "izlendi" olarak işlenir.' }),
      listsBox,
    ]));

    refs.metaLine = h('div', { class: 'muted' });
    const storeBox = buildStoreSection(refs, 'trakt');
    storeBox.insertBefore(refs.metaLine, storeBox.children[1] || null);
    const wrapField = h('fieldset', {}, [h('legend', { text: '3 · Depo (IMDb sayfasına taşınacak)' }), storeBox]);
    box.appendChild(wrapField);
    box.appendChild(h('div', { class: 'muted', text: 'Sonraki adım: www.imdb.com\'u aç → aynı panelde "IMDb\'ye yaz" bölümü.' }));
    refs.body.appendChild(box);

    // Açılışta token'ı kendiliğinden oku.
    const saved = store.get('traktAuth', null);
    const res = readToken();
    if (!res.ok && saved && saved.clientId) {
      log('Otomatik token okunamadı; sayfa yenilendikten sonra tekrar dene.');
    }
    hostSel.addEventListener('change', () => { trakt.host = hostSel.value; log(`Trakt host: ${trakt.host}`); });
    refs.refreshStore();
  }

  // ---------- IMDb TARAFI ----------

  function buildImdbSide(refs) {
    const log = refs.log;
    const sess = h('div', { class: 'muted', text: 'IMDb oturumu kontrol ediliyor…' });
    const listIdInput = h('input', { type: 'text', value: state.cfg.listId || '', placeholder: 'ls123456789', style: { width: '150px' } });
    const listNameInput = h('input', { type: 'text', value: state.cfg.newListName || '', style: { width: '200px' } });
    const visSel = h('select', {}, ['PRIVATE', 'PUBLIC'].map((v) => h('option', { value: v, text: v === 'PRIVATE' ? 'gizli' : 'herkese açık', selected: state.cfg.listVisibility === v })));
    const delayInput = h('input', { type: 'number', value: String(state.cfg.delayMs), min: '150', max: '5000', step: '50', style: { width: '72px' } });
    const jitterInput = h('input', { type: 'number', value: String(state.cfg.jitterMs), min: '0', max: '2000', step: '50', style: { width: '72px' } });
    const oneConst = h('input', { type: 'text', placeholder: 'tt1234567', style: { width: '120px' } });
    const oneTarget = h('select', {}, TARGETS.map((t) => h('option', { value: t, text: t })));
    const captureBox = h('pre', { class: 'log', style: { height: '90px' }, text: '(yakalama kapalı)' });
    const queueLine = h('div', { class: 'muted', text: 'Sıra: —' });

    const targetBoxes = {};
    const typeBoxes = {};

    function readCfgFromUi() {
      state.cfg.listId = listIdInput.value.trim();
      state.cfg.newListName = listNameInput.value.trim() || 'Trakt taşıma';
      state.cfg.listVisibility = visSel.value;
      state.cfg.delayMs = Math.max(150, Number(delayInput.value) || 650);
      state.cfg.jitterMs = Math.max(0, Number(jitterInput.value) || 0);
      for (const t of TARGETS) state.cfg.targets[t] = targetBoxes[t].checked;
      for (const t of Object.keys(state.cfg.types)) if (typeBoxes[t]) state.cfg.types[t] = typeBoxes[t].checked;
      const mode = refs.body.querySelector('input[name=listmode]:checked');
      if (mode) state.cfg.listMode = mode.value;
      saveCfg();
    }

    // Kutu seçimlerine göre sıra özeti (ayarı kaydetmeden, günlük basmadan).
    // buildQueue ile aynı kuralları uygular ki iki sayı birbirini tutsun.
    function queueSummaryText() {
      const tg = {};
      TARGETS.forEach((t) => { tg[t] = targetBoxes[t] && targetBoxes[t].checked; });
      const ty = {};
      Object.keys(typeBoxes).forEach((t) => { ty[t] = typeBoxes[t].checked; });
      const rows = applyTypeFilter(applyTargetFilter(state.rows || [], tg), ty);
      const modeEl = refs.body.querySelector('input[name=listmode]:checked');
      const mode = modeEl ? modeEl.value : state.cfg.listMode;
      const listReady = Boolean(parseImdbListId(listIdInput.value)) || mode !== 'existing';
      let noRating = 0;
      let noList = 0;
      const usable = rows.filter((r) => {
        if (r.target === 'rating') {
          if (Number.isFinite(r.rating) && r.rating > 0) return true;
          noRating += 1;
          return false;
        }
        if (r.target === 'list') {
          if (listReady) return true;
          noList += 1;
          return false;
        }
        return true;
      });
      const byTarget = countByTarget(usable);
      const parts = Object.entries(byTarget).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—';
      const notes = [];
      if (noRating) notes.push(`${noRating} satır puansız`);
      if (noList) notes.push(`${noList} satır için liste kimliği (ls…) yok`);
      return `Sıra: ${usable.length} öğe (${parts})` + (notes.length ? ` · yazılamayacak: ${notes.join(', ')}` : '');
    }

    function queuePreview() {
      readCfgFromUi();
      const q = buildQueue();
      const byTarget = countByTarget(q);
      const byType = countByType(q);
      log(`Sıra önizleme: ${q.length} öğe · hedef → ${Object.entries(byTarget).map(([k, v]) => `${k}:${v}`).join(', ') || '—'} · tür → ${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(', ') || '—'}`);
      const w = overlapWarning(q);
      if (w) log(w);
      capWarnings(q).forEach((x) => log(x));
      if (state.cfg.dryRun) log('Kuru çalıştırma AÇIK: hiçbir şey yazılmaz.');
      refs.refreshStore();
    }

    const box = h('div');

    box.appendChild(h('fieldset', {}, [
      h('legend', { text: '1 · Durum' }),
      sess,
      h('div', { class: 'muted', text: `GM deposu: ${store.shared ? 'var (Trakt sayfasıyla paylaşılıyor)' : 'YOK → Trakt sayfasından JSON indirip burada yükle'}` }),
      h('div', { class: 'row' }, [
        h('button', { class: 'sec', text: 'Oturumu yeniden kontrol et', onClick: async () => {
          const r = await imdb.whoami();
          sess.textContent = r.loggedIn ? '✓ IMDb oturumu açık.' : `✗ IMDb oturumu kapalı görünüyor (HTTP ${r.status}). Yazmadan önce giriş yap.`;
          sess.className = r.loggedIn ? 'ok' : 'bad';
        } }),
        h('button', { class: 'sec', text: 'Bu sayfadaki ls kimliğini al', onClick: () => {
          const id = parseImdbListId(location.href);
          if (id) { listIdInput.value = id; state.cfg.listId = id; saveCfg(); log(`Liste kimliği alındı: ${id}`); }
          else log('Bu sayfanın adresinde ls… kimliği yok. Bir liste sayfasındayken dene.');
        } }),
      ]),
    ]));

    TARGETS.forEach((t) => { targetBoxes[t] = h('input', { type: 'checkbox', checked: Boolean(state.cfg.targets[t]) }); });
    Object.keys(state.cfg.types).forEach((t) => { typeBoxes[t] = h('input', { type: 'checkbox', checked: Boolean(state.cfg.types[t]) }); });

    box.appendChild(h('fieldset', {}, [
      h('legend', { text: '2 · Hedefler' }),
      h('div', { class: 'row' }, [
        h('label', {}, [targetBoxes.list, 'liste']),
        h('label', {}, [targetBoxes.watchlist, 'watchlist']),
        h('label', {}, [targetBoxes.watched, 'izlendi (Watched)']),
        h('label', {}, [targetBoxes.rating, 'puan (Watched da olur)']),
      ]),
      h('div', { class: 'muted', text: 'Türler:' }),
      h('div', { class: 'row' }, [
        h('label', {}, [typeBoxes.movie, 'film']),
        h('label', {}, [typeBoxes.show, 'dizi gövdesi']),
        h('label', {}, [typeBoxes.episode, 'bölüm']),
        h('label', {}, [typeBoxes.season, 'sezon (IMDb desteklemez)']),
        h('label', {}, [typeBoxes.person, 'kişi (nm, yazılamaz)']),
      ]),
      h('div', { class: 'row' }, [h('button', { class: 'sec', text: 'Sırayı önizle', onClick: queuePreview })]),
      queueLine,
      h('div', { class: 'muted', text: 'Puan hedefi: IMDb\'de puan vermek öğeyi otomatik "izlendi" yapar, tarih ise bugünün tarihi olur (IMDb geriye tarih yazdırmaz).' }),
    ]));

    box.appendChild(h('fieldset', {}, [
      h('legend', { text: '3 · Liste hedefi' }),
      h('div', { class: 'row' }, [
        h('label', {}, [h('input', { type: 'radio', name: 'listmode', value: 'existing', checked: state.cfg.listMode === 'existing' }), 'mevcut liste']),
        h('label', {}, [h('input', { type: 'radio', name: 'listmode', value: 'create-one', checked: state.cfg.listMode === 'create-one' }), 'tek yeni liste']),
        h('label', {}, [h('input', { type: 'radio', name: 'listmode', value: 'per-source', checked: state.cfg.listMode === 'per-source' }), 'Trakt listesi başına yeni liste']),
      ]),
      h('div', { class: 'row' }, [h('span', { text: 'ls…:' }), listIdInput, h('span', { text: 'yeni liste adı:' }), listNameInput, visSel]),
      h('div', { class: 'row' }, [
        h('button', { class: 'sec', text: 'Yeni listeyi şimdi oluştur', onClick: async () => {
          readCfgFromUi();
          const r = await imdb.createList(state.cfg.newListName, { visibility: state.cfg.listVisibility });
          const id = r.ok && r.json && r.json.data && r.json.data.createList && r.json.data.createList.listId;
          if (id) { listIdInput.value = id; state.cfg.listId = id; state.cfg.listMode = 'existing'; saveCfg(); log(`Liste oluşturuldu: ${id}`); }
          else log(`Oluşturulamadı: ${r.message || 'bilinmeyen hata'}`);
        } }),
      ]),
      h('div', { class: 'muted', text: 'Yeni listeler allowDuplicates:false ile oluşturulur (IMDb yinelemeyi kendisi reddeder) ve varsayılan olarak gizlidir. Kap: liste başına 12.000 öğe.' }),
    ]));

    const dryBox = h('input', { type: 'checkbox', checked: state.cfg.dryRun });
    box.appendChild(h('fieldset', {}, [
      h('legend', { text: '4 · Çalıştır' }),
      h('div', { class: 'row' }, [
        h('label', {}, [dryBox, 'kuru çalıştırma (hiçbir şey yazmaz)']),
        h('span', { text: 'gecikme ms:' }), delayInput,
        h('span', { text: 'rastgele ek ms:' }), jitterInput,
      ]),
      h('div', { class: 'row' }, [
        h('span', { text: 'tek deneme:' }), oneConst, oneTarget,
        h('button', { class: 'sec', text: 'Dene', onClick: async () => {
          const c = oneConst.value.trim();
          if (!isTtId(c)) { log('Geçerli bir tt kimliği gir (örn. tt0111161).'); return; }
          readCfgFromUi();
          state.cfg.dryRun = dryBox.checked;
          await runOne({ const: c, target: oneTarget.value, label: '', rating: 8, source: null, listId: state.cfg.listId }, log);
        } }),
      ]),
      h('div', { class: 'row' }, [
        h('button', { text: 'Başlat', onClick: () => {
          readCfgFromUi();
          state.cfg.dryRun = dryBox.checked;
          saveCfg();
          runQueue({
            log,
            resume: true,
            onProgress: (p) => {
              refs.progLine.textContent = `${p.index}/${p.total} · başarılı ${p.done} · hata ${p.failed} · atlanan ${p.skipped} · kalan ~${p.eta}`;
              refs.bar.style.width = `${Math.round((p.index / p.total) * 100)}%`;
            },
            onDone: () => { refs.refreshStore(); },
          });
        } }),
        h('button', { class: 'sec', text: 'Duraklat', onClick: () => { state.paused = true; log('Duraklatıldı.'); } }),
        h('button', { class: 'sec', text: 'Devam', onClick: () => { state.paused = false; log('Devam ediliyor.'); } }),
        h('button', { class: 'warn', text: 'Durdur', onClick: () => { state.stopFlag = true; state.paused = false; log('Durdurma istendi; geçerli öğeden sonra durur. Sıra kayıtlı.'); } }),
      ]),
      h('div', { class: 'muted', text: `Art arda ${state.cfg.maxConsecutiveFailures} hata olursa kendiliğinden durur. 429/5xx için 5-15-30 sn bekleme uygulanır.` }),
    ]));

    box.appendChild(h('fieldset', {}, [
      h('legend', { text: '5 · Dışa aktar' }),
      h('div', { class: 'row' }, [
        h('button', { class: 'sec', text: 'Kuyruk CSV', onClick: () => refs.download(`kopru-kuyruk-${Date.now()}.csv`, toCsv(state.queue || [], ['const', 'type', 'target', 'label', 'rating', 'date', 'source', 'listId', 'status', 'message']), 'text/csv') }),
        h('button', { class: 'sec', text: 'Başarısızlar CSV', onClick: () => refs.download(`kopru-basarisiz-${Date.now()}.csv`, toCsv(state.failures, ['const', 'target', 'label', 'status', 'message']), 'text/csv') }),
        h('button', { class: 'sec', text: 'Kayıt günlüğü', onClick: () => refs.download(`kopru-gunluk-${Date.now()}.txt`, refs.logBox.textContent) }),
      ]),
    ]));

    box.appendChild(h('fieldset', {}, [
      h('legend', { text: '6 · Yakalama modu (mutation adı değişirse)' }),
      h('div', { class: 'muted', text: 'Dinlemeyi aç, IMDb arayüzünde aynı işlemi bir kez elle yap (ör. watchlist\'e ekle). Betik çağrıyı kaydeder; doğru mutation/gövde buradan okunur.' }),
      h('div', { class: 'row' }, [
        h('button', { class: 'sec', text: 'Dinlemeyi başlat', onClick: () => {
          imdb.installCapture((entry) => {
            captureBox.textContent = JSON.stringify(imdb.captured.slice(0, 6), null, 1);
            log(`Yakalandı: ${entry.operationName || entry.url}`);
          });
          log('Dinleme açık. Sayfayı yenilersen kapanır.');
        } }),
        h('button', { class: 'sec', text: 'Yakalananları indir', onClick: () => refs.download(`imdb-yakalanan-${Date.now()}.json`, JSON.stringify(imdb.captured, null, 1), 'application/json') }),
        h('button', { class: 'sec', text: 'Temizle', onClick: () => { imdb.captured = []; captureBox.textContent = '(yakalama kapalı)'; } }),
      ]),
      captureBox,
    ]));

    refs.metaLine = h('div', { class: 'muted' });
    const storeBox = buildStoreSection(refs, 'imdb');
    storeBox.insertBefore(refs.metaLine, storeBox.children[1] || null);
    box.appendChild(h('fieldset', {}, [h('legend', { text: '0 · Depo (Trakt\'tan gelen)' }), storeBox]));
    box.insertBefore(box.lastChild, box.firstChild);
    refs.body.appendChild(box);

    // Depo her tazelendiğinde (Yenile, sekme değişimi, dosya yükleme) sıra
    // sayısını da güncelle; böylece Trakt sekmesinden gelen veri burada görünür.
    const baseRefreshStore = refs.refreshStore;
    refs.refreshStore = (opts) => {
      baseRefreshStore(opts);
      queueLine.textContent = queueSummaryText();
    };
    TARGETS.forEach((t) => targetBoxes[t].addEventListener('change', () => { queueLine.textContent = queueSummaryText(); }));
    Object.keys(typeBoxes).forEach((t) => typeBoxes[t].addEventListener('change', () => { queueLine.textContent = queueSummaryText(); }));
    listIdInput.addEventListener('input', () => { queueLine.textContent = queueSummaryText(); });
    Array.prototype.forEach.call(refs.body.querySelectorAll('input[name=listmode]'), (r) => {
      r.addEventListener('change', () => { queueLine.textContent = queueSummaryText(); });
    });

    imdb.whoami().then((r) => {
      sess.textContent = r.loggedIn ? '✓ IMDb oturumu açık.' : `✗ IMDb oturumu kapalı görünüyor (HTTP ${r.status}).`;
      sess.className = r.loggedIn ? 'ok' : 'bad';
    });
    const pageList = parseImdbListId(location.href);
    if (pageList && !listIdInput.value) { listIdInput.value = pageList; log(`Sayfadaki liste kimliği alındı: ${pageList}`); }
    refs.refreshStore();
    queuePreview();
  }

  // ---------- Açılış ----------

  function boot() {
    if (!IS_TRAKT && !IS_IMDB) return;
    if (!document.body) { setTimeout(boot, 300); return; }
    const refs = buildPanel();
    document.body.appendChild(refs.host);

    const footer = h('fieldset', {}, [
      h('legend', { text: IS_TRAKT ? 'İlerleme ve günlük (Trakt tarafı)' : 'İlerleme ve günlük (IMDb tarafı)' },
      ),
      refs.progLine,
      refs.barWrap,
      refs.logBox,
      h('div', { class: 'row' }, [
        h('button', { class: 'sec', text: 'Günlüğü temizle', onClick: () => { refs.logBox.textContent = ''; } }),
        h('button', { class: 'sec', text: 'Günlüğü indir', onClick: () => {
          const blob = new Blob([refs.logBox.textContent], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = h('a', { href: url, download: `kopru-gunluk-${Date.now()}.txt` });
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
        } }),
      ]),
    ]);

    if (IS_TRAKT) buildTraktSide(refs);
    else buildImdbSide(refs);
    refs.body.appendChild(footer);

    // Sekmeye geri dönünce depoyu tazele: Trakt sekmesinde çekilen satırlar
    // IMDb sekmesinde kendiliğinden görünsün diye.
    refs.onOpen = () => { if (refs.refreshStore) refs.refreshStore(); };
    window.addEventListener('focus', () => { if (refs.refreshStore) refs.refreshStore(); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && refs.refreshStore) refs.refreshStore();
    });

    const prev = store.get('progress', null);
    if (prev) refs.log(`Önceki çalıştırma: ${new Date(prev.at).toLocaleString('tr-TR')} · ${prev.done} başarılı / ${prev.failed} hata / ${prev.skipped} atlanan (kuru: ${prev.dryRun ? 'evet' : 'hayır'})`);
    if (!store.shared) refs.log('GM deposu bulunamadı: iki sayfa arasında veriyi JSON indir/yükle ile taşı.');
    refs.log(`Hazır (${IS_TRAKT ? 'app.trakt.tv' : 'www.imdb.com'}) · v${VERSION}`);
  }

  // Testler ve elle kullanım için saf çekirdeği dışa aç.
  const api = {
    version: VERSION,
    state, store, trakt, imdb,
    extractTraktToken, findOidcKey, parseOidcKey, traktHeaders, traktPath, usageSummary,
    normalizeTraktRecord, normalizeTraktRecords, normalizeTraktLists, ratingClamp,
    rowKey, mergeRows, applyTargetFilter, applyTypeFilter, countByType, countByTarget,
    overlapWarning, groupBySource, capWarnings, sanitizeListName, parseImdbListId,
    imdbGraphqlBody, createListVariables, addItemVariables, rateVariables, watchedVariables,
    imdbGraphqlHeaders, watchlistUrl, gqlErrorMessage, looksLikeAuthError, looksLikeDuplicate,
    classifyHttpStatus, backoffFor, formatEta, pad2, isTtId, isNmId, typeFromToken,
    toCsv, parseCsv, rowsFromCsv, rowsFromText, loadAnyText, buildQueue, TARGETS, TYPES,
    IMDB_LIST_CAP, IMDB_GRAPHQL, TRAKT_OIDC_PREFIX,
  };
  if (typeof window !== 'undefined') window.ImdbTraktBridge = api;
  if (typeof globalThis !== 'undefined') globalThis.ImdbTraktBridge = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
