// ==UserScript==
// @name         IMDb Watched Marker — Trakt geçmişini puansız "izlendi" yap
// @namespace    https://github.com/Webbhesap/TamperMonkey
// @version      0.1.0
// @description  Trakt yedeğinden (JSON/CSV) ya da yapıştırdığın tt listesinden IMDb "Watched" işaretini toplu koyar. Puan ve check-in kullanmaz; IMDb'nin kendi addWatchedTitle çağrısını senin oturumunla yapar.
// @author       Webbhesap
// @match        https://www.imdb.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

/*
 * Ne yapar
 * --------
 * IMDb'de "Mark as watched" düğmesinin arkasındaki GraphQL çağrısını
 * (mutation AddWatchedTitle) senin oturumunla, verdiğin tt kimlikleri için
 * sırayla çalıştırır. Böylece:
 *   - puan vermeden "izlendi" işareti konur,
 *   - check-ins konteyneri kullanılmadığı için 12.000 öğe tavanına takılmaz,
 *   - filmler, diziler ve BÖLÜMLER (tt kimliği olan her başlık) işaretlenebilir.
 *
 * Ne yapamaz (IMDb tarafının sınırı, betiğin değil)
 * -------------------------------------------------
 *   - İzlenme TARİHİ yazamaz. IMDb'de Watched tarihi = düğmeye basılan andır;
 *     alan salt okunurdur (advancedTitleSearch'te MY_WATCHED_DATE olarak görünür
 *     ama dışarıdan set edilemez). Trakt'taki watched_at değerleri burada kaybolur.
 *   - Sezon düzeyinde işaret koyamaz (IMDb'de sezon öğesi/tt'si yok).
 *   - Tekrar izleme sayısı tutamaz (Watched bir kez işaretlenir; tekrarlar
 *     Check-ins'e gider ve orası 12.000 ile sınırlıdır).
 *
 * Girdi biçimleri
 * ---------------
 * 1) Trakt ZIP'inden çıkardığın JSON dosyaları (watched-movies-*.json,
 *    watched-shows-*.json, watched-history-*.json, ratings-*.json,
 *    lists-list-*.json ...) — birden çok dosya seçebilirsin.
 * 2) IMDb'nin kendi CSV dışa aktarımları (`Const` kolonlu: ratings, watchlist,
 *    liste export'ları).
 * 3) Düz metin / alt alta tt kimlikleri.
 *
 * JSON girdisinde betik ağacı özyinelemeli gezer; her `ids.imdb` alanını ve
 * tt desenine uyan her metni toplar, türü (film/dizi/bölüm/sezon/kişi)
 * çevresindeki anahtarlardan tahmin eder.
 *
 * Kurulum
 * -------
 * Tampermonkey veya Violentmonkey → Yeni betik → bu dosyanın içeriğini yapıştır →
 * Kaydet. Sonra https://www.imdb.com/ adresini aç (oturumun açık olsun); sağ
 * altta 👁 düğmesi belirir.
 *
 * Güvenlik ve dürüstlük notları
 * -----------------------------
 * - Betik hiçbir hesabı/parolayı/çerezi istemez, saklamaz, dışarı göndermez.
 *   Yalnızca senin tarayıcı oturumunu kullanır ve yalnızca IMDb'nin kendi
 *   API'sine (api.graphql.imdb.com) istek atar.
 * - @grant none: GM_* yetkisi yok, sayfa bağlamında çalışır. İstekler
 *   imdb.com origin'inden gittiği için CORS ve çerezler kendiliğinden doğru.
 * - Varsayılan olarak KURU KOŞU (dry run) açıktır: hiçbir şey yazmadan ne
 *   yapılacağını listeler. Gerçek yazma için bilinçli olarak kapatman ve
 *   doğrulama onayı vermen gerekir.
 * - Bu, IMDb'nin RESMÎ OLMAYAN iç API'sidir. IMDb Kullanım Koşulları otomatik
 *   erişime yazılı izin şartı koyar; mutation adı/imzası IMDb sürümüyle
 *   değişebilir. Bu yüzden "Yakala" modu var: düğmeye bir kez kendin
 *   tıklarsın, betik gerçek isteği kaydeder ve onunla devam eder.
 * - Yalnızca kendi hesabının verisi için, kişisel kullanım.
 *
 * Sürüm geçmişi
 * -------------
 * 0.1.0  İlk sürüm: ayrıştırıcı, kuru koşu, hız sınırı, duraklat/devam,
 *        yakalama modu, doğrulama, CSV dışa aktarım.
 */

(function () {
  'use strict';

  var VERSION = '0.1.0';

  var CFG = {
    gqlUrl: 'https://api.graphql.imdb.com/',
    storeKey: 'imdbWatchedMarker.v1',
    defaultDelayMs: 650,      // istekler arası bekleme
    jitterMs: 250,            // üstüne eklenen rastgele süre
    minDelayMs: 200,
    maxDelayMs: 5000,
    maxConsecutiveFails: 5,   // bu kadar art arda hata olursa kendiliğinden durur
    backoffMs: [5000, 15000, 30000], // 429/5xx için bekleme basamakları
    verifyPageSize: 250,
    verifyMaxPages: 200,
    logKeep: 400,
    bigRunWarn: 2000          // bu sayıyı aşınca "parça parça koş" uyarısı
  };

  var ADD_WATCHED_QUERY =
    'mutation AddWatchedTitle($titleId: ID!) { addWatchedTitle(titleId: $titleId) { success } }';

  /* __PURE_START__ */
  /* Bu blok saf (DOM/ağ kullanmayan) fonksiyonlar içerir; tests/parse.test.mjs
   * dosyası bu iki işaretçi arasındaki metni çekip Node içinde çalıştırır. */

  var TT_ID_RE = /^tt\d{7,8}$/;
  var TT_SCAN_RE = /tt\d{7,8}/g;
  var NM_SCAN_RE = /nm\d{7,8}/g;

  var TYPE_MOVIE = 'movie';
  var TYPE_SHOW = 'show';
  var TYPE_EPISODE = 'episode';
  var TYPE_SEASON = 'season';
  var TYPE_PERSON = 'person';
  var TYPE_UNKNOWN = 'unknown';

  function stripBom(text) {
    return String(text == null ? '' : text).replace(/^\uFEFF/, '');
  }

  function pad2(n) {
    var s = String(n);
    return s.length < 2 ? '0' + s : s;
  }

  function typeFromToken(token) {
    // IMDb "Title Type" değerleri ve Trakt tür adları: boşluk/tire/alt çizgi
    // fark etmeden eşlensin diye önce ayraçlar atılır.
    var t = String(token || '').toLowerCase().replace(/[\s_.-]+/g, '');
    if (!t) return null;
    if (t === 'movie' || t === 'film' || t === 'feature' || t === 'tvmovie' || t === 'video' ||
      t === 'short' || t === 'tvshort' || t === 'shortfilm') return TYPE_MOVIE;
    if (t === 'show' || t === 'tvshow' || t === 'series' || t === 'tvseries' ||
      t === 'tvminiseries' || t === 'miniseries') return TYPE_SHOW;
    if (t === 'episode' || t === 'tvepisode' || t === 'special' || t === 'tvspecial') return TYPE_EPISODE;
    if (t === 'season') return TYPE_SEASON;
    if (t === 'person' || t === 'people' || t === 'name') return TYPE_PERSON;
    return null;
  }

  // JSON ağacında bir düğümün türünü tahmin et: önce açık `type` alanı,
  // sonra içinde bulunduğu anahtarın adı (movie/show/episode/...).
  function guessType(path, node) {
    if (node && typeof node === 'object') {
      var direct = typeFromToken(node.type) || typeFromToken(node.titleType) ||
        typeFromToken(node.__typename) ||
        (node.titleType && typeof node.titleType === 'object' ? typeFromToken(node.titleType.id) : null);
      if (direct) return direct;
    }
    for (var i = path.length - 1; i >= 0; i--) {
      var fromPath = typeFromToken(path[i]);
      if (fromPath) return fromPath;
    }
    return TYPE_UNKNOWN;
  }

  // İnsanın logda tanıyabileceği bir etiket üret.
  function guessLabel(node, path) {
    if (!node || typeof node !== 'object') return '';
    var cand = node.title || node.name || node.text || null;
    if (cand && typeof cand === 'object') cand = cand.text || cand.title || cand.name || null;
    if (!cand) {
      for (var i = 0; i < path.length; i++) {
        var seg = path[i];
        var holder = null;
        // path'in köküne inmek yerine düz anahtar denemeleri yeter
        if (node[seg] && typeof node[seg] === 'object') holder = node[seg];
        if (holder && (holder.title || holder.name)) {
          cand = holder.title || holder.name;
          if (cand && typeof cand === 'object') cand = cand.text || cand.title || null;
          if (cand) break;
        }
      }
    }
    var label = cand ? String(cand).slice(0, 90) : '';
    var s = node.season;
    var e = node.number != null ? node.number : node.episode;
    if ((s != null || e != null) && (typeof s === 'number' || typeof s === 'string') && s !== '') {
      var sNum = parseInt(s, 10);
      var eNum = parseInt(e, 10);
      if (!isNaN(sNum)) {
        label += (label ? ' ' : '') + 'S' + pad2(sNum);
        if (!isNaN(eNum)) label += 'E' + pad2(eNum);
      }
    }
    if (node.year) label += ' (' + node.year + ')';
    return label.trim();
  }

  function createSink() {
    return {
      items: [],
      seen: Object.create(null),
      duplicates: 0,
      skipped: Object.create(null)
    };
  }

  function sinkSkip(sink, reason) {
    sink.skipped[reason] = (sink.skipped[reason] || 0) + 1;
  }

  function sinkAdd(sink, id, type, label, source) {
    var clean = String(id || '').trim();
    if (!TT_ID_RE.test(clean)) {
      sinkSkip(sink, 'gecersiz-tt');
      return false;
    }
    if (sink.seen[clean]) {
      sink.duplicates += 1;
      // Aynı tt birden çok türle gelirse bilineni koru.
      var prev = sink.seen[clean];
      if (prev.type === TYPE_UNKNOWN && type && type !== TYPE_UNKNOWN) prev.type = type;
      if (!prev.label && label) prev.label = label;
      return false;
    }
    var item = { id: clean, type: type || TYPE_UNKNOWN, label: label || '', source: source || '' };
    sink.seen[clean] = item;
    sink.items.push(item);
    return true;
  }

  function walkJson(node, path, sink, source) {
    if (node == null) return;
    if (typeof node === 'string') {
      var s = node.trim();
      if (TT_ID_RE.test(s)) sinkAdd(sink, s, guessType(path, null), '', source);
      return;
    }
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) walkJson(node[i], path, sink, source);
      return;
    }

    var ids = node.ids;
    if (ids && typeof ids === 'object' && !Array.isArray(ids)) {
      if (typeof ids.imdb === 'string' && TT_ID_RE.test(ids.imdb.trim())) {
        sinkAdd(sink, ids.imdb, guessType(path, node), guessLabel(node, path), source);
      } else if (ids.imdb === null || ids.imdb === undefined) {
        // Trakt'ta bazı öğelerde imdb kimliği boş gelir: bunlar taşınamaz.
        sinkSkip(sink, guessType(path, node) === TYPE_SEASON ? 'imdb-null-sezon' : 'imdb-null');
      } else if (typeof ids.imdb === 'string') {
        sinkSkip(sink, 'imdb-bicimsiz');
      }
      if (typeof ids.slug === 'string' && !ids.imdb) sinkSkip(sink, 'yalnizca-trakt-slug');
    }

    // Kişi kayıtları: Watched yalnızca başlıklar için geçerli.
    if (typeof node.name === 'string' && node.ids && node.ids.imdb === null && node.ids.slug) {
      sinkSkip(sink, 'kisi-nm');
    }

    var keys = Object.keys(node);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (key === 'ids') continue;
      var val = node[key];
      if (typeof val === 'string') {
        if (key === 'imdb' || key === 'imdbId' || key === 'imdb_id' || key === 'Const' || key === 'const') {
          sinkAdd(sink, val, guessType(path.concat(key), node), guessLabel(node, path), source);
        } else if (TT_ID_RE.test(val.trim())) {
          sinkAdd(sink, val, guessType(path.concat(key), node), guessLabel(node, path), source);
        }
      } else if (val && typeof val === 'object') {
        walkJson(val, path.concat(key), sink, source);
      }
    }

    // Sezon düğümleri: IMDb'de karşılığı yok, sayıp atlıyoruz.
    if (!ids && (node.season != null || node.number != null) && typeFromToken(node.type) === TYPE_SEASON) {
      sinkSkip(sink, 'sezon-tt-yok');
    }
  }

  // Çok basit, tırnak destekli CSV ayrıştırıcı (IMDb dışa aktarımları için yeterli).
  function parseCsv(text) {
    var lines = stripBom(text).split(/\r\n|\r|\n/);
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line === '' || line.replace(/\s/g, '') === '') continue;
      var row = [''];
      var inStr = false;
      for (var j = 0; j < line.length; j++) {
        var ch = line[j];
        if (inStr) {
          if (ch === '"') {
            if (line[j + 1] === '"') { row[row.length - 1] += '"'; j++; } else { inStr = false; }
          } else {
            row[row.length - 1] += ch;
          }
        } else if (ch === '"') {
          inStr = true;
        } else if (ch === ',' || ch === '\t' || ch === ';') {
          row.push('');
        } else {
          row[row.length - 1] += ch;
        }
      }
      rows.push(row);
    }
    return rows;
  }

  function findColumn(headerRow, names) {
    for (var i = 0; i < headerRow.length; i++) {
      var cell = String(headerRow[i] || '').trim().toLowerCase();
      for (var n = 0; n < names.length; n++) {
        if (cell === names[n]) return i;
      }
    }
    return -1;
  }

  function csvToItems(text, source) {
    var rows = parseCsv(text);
    var sink = createSink();
    if (!rows.length) return sink;
    var header = rows[0];
    var idCol = findColumn(header, ['const', 'imdb', 'imdbid', 'imdb_id', 'imdb id', 'tt']);
    var titleCol = findColumn(header, ['title', 'label', 'baslik', 'başlık', 'name']);
    var typeCol = findColumn(header, ['title type', 'titletype', 'type', 'tur', 'tür']);
    var seasonCol = findColumn(header, ['season', 'sezon', 'season number']);
    var episodeCol = findColumn(header, ['episode', 'bolum', 'bölüm', 'episode number']);

    if (idCol < 0) {
      // Başlık satırı tanınmadı: bütün metni tt deseniyle tara.
      return textToItems(text, source);
    }

    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var raw = String(row[idCol] || '').trim();
      if (!raw) { sinkSkip(sink, 'bos-satir'); continue; }
      var found = raw.match(TT_SCAN_RE);
      if (!found) {
        if (NM_SCAN_RE.test(raw)) { NM_SCAN_RE.lastIndex = 0; sinkSkip(sink, 'kisi-nm'); }
        else sinkSkip(sink, 'gecersiz-tt');
        continue;
      }
      var id = found[0];
      var type = typeCol >= 0 ? (typeFromToken(row[typeCol]) || TYPE_UNKNOWN) : TYPE_UNKNOWN;
      var label = titleCol >= 0 ? String(row[titleCol] || '').slice(0, 90) : '';
      if (seasonCol >= 0 && row[seasonCol] && String(row[seasonCol]).trim() !== '') {
        label += (label ? ' ' : '') + 'S' + pad2(parseInt(row[seasonCol], 10) || 0);
        if (episodeCol >= 0 && row[episodeCol] && String(row[episodeCol]).trim() !== '') {
          label += 'E' + pad2(parseInt(row[episodeCol], 10) || 0);
        }
        if (type === TYPE_UNKNOWN) type = TYPE_EPISODE;
      }
      sinkAdd(sink, id, type, label, source);
    }
    return sink;
  }

  function textToItems(text, source) {
    var sink = createSink();
    var body = stripBom(text);
    var matches = body.match(TT_SCAN_RE) || [];
    for (var i = 0; i < matches.length; i++) sinkAdd(sink, matches[i], TYPE_UNKNOWN, '', source);
    var people = body.match(NM_SCAN_RE) || [];
    if (people.length) sinkSkip(sink, 'kisi-nm');
    return sink;
  }

  function looksLikeJson(text) {
    var t = stripBom(text).trim();
    return t.length > 0 && (t[0] === '{' || t[0] === '[');
  }

  function parseJsonAny(text) {
    var t = stripBom(text).trim();
    if (!t) return { ok: true, values: [] };
    try {
      return { ok: true, values: [JSON.parse(t)] };
    } catch (err) {
      // Satır satır JSON (NDJSON) olabilir.
      var values = [];
      var lines = t.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        try {
          values.push(JSON.parse(line));
        } catch (err2) {
          return { ok: false, error: err.message, values: [] };
        }
      }
      return values.length ? { ok: true, values: values } : { ok: false, error: 'bos', values: [] };
    }
  }

  // Ana giriş: herhangi bir metin (JSON / CSV / düz metin) -> tt öğeleri.
  function extractIds(text, options) {
    var opts = options || {};
    var source = opts.source || '';
    var body = stripBom(text);
    var sink = createSink();

    if (!body.trim()) {
      return { items: [], duplicates: 0, skipped: {}, format: 'empty', notes: ['girdi boş'] };
    }

    var notes = [];
    var format = 'text';

    if (looksLikeJson(body)) {
      var parsed = parseJsonAny(body);
      if (parsed.ok) {
        format = 'json';
        for (var i = 0; i < parsed.values.length; i++) walkJson(parsed.values[i], [], sink, source);
        if (!sink.items.length) notes.push('JSON okundu ama tt kimliği bulunamadı');
      } else {
        notes.push('JSON çözümlenemedi (' + parsed.error + '), düz metin taramasına geçildi');
        format = 'text';
        sink = mergeSink(sink, textToItems(body, source));
      }
    } else {
      var rows = parseCsv(body);
      var header = rows.length ? rows[0] : [];
      var idCol = findColumn(header, ['const', 'imdb', 'imdbid', 'imdb_id', 'imdb id', 'tt']);
      if (rows.length > 1 && idCol >= 0) {
        format = 'csv';
        sink = mergeSink(sink, csvToItems(body, source));
      } else {
        format = 'text';
        sink = mergeSink(sink, textToItems(body, source));
        if (rows.length > 1) notes.push('CSV başlığı tanınmadı, tt deseniyle tarandı');
      }
    }

    var skipped = sink.skipped;
    var summary = summarizeSkipped(skipped);
    if (summary.length) notes.push('atlanan: ' + summary);

    return {
      items: sink.items,
      duplicates: sink.duplicates,
      skipped: skipped,
      format: format,
      notes: notes
    };
  }

  function mergeSink(target, other) {
    for (var i = 0; i < other.items.length; i++) {
      var it = other.items[i];
      if (target.seen[it.id]) {
        target.duplicates += 1;
        continue;
      }
      target.seen[it.id] = it;
      target.items.push(it);
    }
    target.duplicates += other.duplicates;
    var keys = Object.keys(other.skipped);
    for (var k = 0; k < keys.length; k++) {
      target.skipped[keys[k]] = (target.skipped[keys[k]] || 0) + other.skipped[keys[k]];
    }
    return target;
  }

  var SKIP_REASONS = {
    'imdb-null': 'IMDb kimliği boş (Trakt\'ta imdb=null)',
    'imdb-null-sezon': 'sezon (IMDb\'de tt\'si yok)',
    'sezon-tt-yok': 'sezon (IMDb\'de tt\'si yok)',
    'yalnizca-trakt-slug': 'yalnızca Trakt slug\'ı var',
    'kisi-nm': 'kişi (nm) — Watched yalnızca başlıklar',
    'gecersiz-tt': 'tt biçimine uymayan kimlik',
    'imdb-bicimsiz': 'imdb alanı biçimsiz',
    'bos-satir': 'boş satır'
  };

  function summarizeSkipped(skipped) {
    var out = [];
    var keys = Object.keys(skipped || {});
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var label = SKIP_REASONS[key] || key;
      out.push(skipped[key] + ' × ' + label);
    }
    return out;
  }

  function mergeResults(results) {
    var sink = createSink();
    var notes = [];
    var formats = {};
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r) continue;
      formats[r.format] = (formats[r.format] || 0) + 1;
      for (var j = 0; j < r.items.length; j++) {
        var it = r.items[j];
        if (sink.seen[it.id]) { sink.duplicates += 1; continue; }
        var copy = { id: it.id, type: it.type, label: it.label, source: it.source };
        sink.seen[copy.id] = copy;
        sink.items.push(copy);
      }
      sink.duplicates += r.duplicates;
      var keys = Object.keys(r.skipped || {});
      for (var k = 0; k < keys.length; k++) {
        sink.skipped[keys[k]] = (sink.skipped[keys[k]] || 0) + r.skipped[keys[k]];
      }
      if (r.notes && r.notes.length) {
        for (var n = 0; n < r.notes.length; n++) {
          var tag = (r.source ? '[' + r.source + '] ' : '') + r.notes[n];
          if (notes.indexOf(tag) < 0) notes.push(tag);
        }
      }
    }
    return {
      items: sink.items,
      duplicates: sink.duplicates,
      skipped: sink.skipped,
      notes: notes,
      formats: Object.keys(formats)
    };
  }

  // Tür filtresi: hangileri işaretlenecek?
  function applyTypeFilter(items, filters) {
    var keep = [];
    var dropped = { movie: 0, show: 0, episode: 0, season: 0, person: 0, unknown: 0 };
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var type = it.type || TYPE_UNKNOWN;
      var allowed = filters && Object.prototype.hasOwnProperty.call(filters, type) ? filters[type] : true;
      if (allowed) keep.push(it);
      else dropped[type] = (dropped[type] || 0) + 1;
    }
    return { items: keep, dropped: dropped };
  }

  function countByType(items) {
    var out = { movie: 0, show: 0, episode: 0, season: 0, person: 0, unknown: 0, total: items.length };
    for (var i = 0; i < items.length; i++) {
      var t = items[i].type || TYPE_UNKNOWN;
      out[t] = (out[t] || 0) + 1;
    }
    return out;
  }

  // IMDb'de dizi gövdesini işaretlemek bölümlerini işaretlemiş saymaz, tersi de
  // doğru. İkisi birden kuyruktaysa aynı içerik iki kez işaretlenir; kullanıcı
  // bilinçli seçsin diye uyarı metni üret (yoksa null).
  function overlapWarning(counts) {
    if (!counts || !(counts.show > 0) || !(counts.episode > 0)) return null;
    return 'Kuyrukta hem ' + counts.show + ' dizi gövdesi hem ' + counts.episode + ' bölüm var. ' +
      'IMDb\'de gövdeyi işaretlemek bölümleri, bölümleri işaretlemek gövdeyi kapsamaz; ' +
      'ikisi birden işaretlenir. Yalnız bölüm bazında ilerlemek istiyorsan ' +
      '"Diziler (gövde)" kutusunu kapat.';
  }

  function toCsv(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var cells = [];
      for (var j = 0; j < rows[i].length; j++) {
        var v = rows[i][j] == null ? '' : String(rows[i][j]);
        if (/[",\n;]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
        cells.push(v);
      }
      out.push(cells.join(','));
    }
    return out.join('\n');
  }

  function formatEta(ms) {
    if (!isFinite(ms) || ms < 0) return '?';
    var s = Math.round(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    if (h) return h + 's ' + pad2(m) + 'dk';
    if (m) return m + 'dk ' + sec + 'sn';
    return sec + 'sn';
  }

  function looksLikeAuthError(message, status) {
    if (status === 401 || status === 403) return true;
    return /unauthor|not authoriz|authoriz|authoris|not logged|please log|log ?in|sign ?in|authenticat|session|permission|forbidden|credential|csrf/i
      .test(String(message || ''));
  }

  function gqlErrorMessage(json, status) {
    if (json && json.errors && json.errors.length) {
      var e = json.errors[0] || {};
      var msg = e.message || e.code || (e.extensions && (e.extensions.code || e.extensions.message)) || 'error';
      return String(msg).slice(0, 200);
    }
    if (json && json.error) return String(json.error).slice(0, 200);
    return 'HTTP ' + status;
  }
  /* __PURE_END__ */

  // ============================ Durum ============================

  var state = {
    results: [],          // dosya başına extractIds sonuçları
    merged: null,         // mergeResults çıktısı
    queue: [],            // filtreden geçmiş, koşulacak öğeler
    index: 0,
    running: false,
    stopped: false,
    dryRun: true,
    okCount: 0,
    failCount: 0,
    skipCount: 0,
    rows: [],             // sonuç satırları (id, durum, hata)
    startedAt: 0,
    captured: null,       // yakalama modundan öğrenilen istek
    captureArmed: false,
    verified: null,       // doğrulama sonucu
    filters: { movie: true, show: true, episode: true, unknown: true, season: false, person: false }
  };

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function delayFor() {
    var base = ui.delayValue();
    return base + Math.floor(Math.random() * CFG.jitterMs);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // ============================ Ağ ============================

  function gqlHeaders() {
    return {
      'content-type': 'application/json',
      'accept': 'application/graphql+json, application/json',
      'x-imdb-client-name': 'imdb-web-next'
    };
  }

  function gqlPost(payload) {
    return fetch(CFG.gqlUrl, {
      method: 'POST',
      credentials: 'include',
      headers: gqlHeaders(),
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = JSON.parse(text); } catch (err) { json = null; }
        return { status: res.status, text: text, json: json };
      });
    });
  }

  // Yakalanan gerçek isteği (düğmeye bir kez tıklanınca öğrenilir) yeniden kullan.
  function buildPayloadFor(titleId) {
    var cap = state.captured;
    if (cap && ui.useCaptured()) {
      var payload = {
        operationName: cap.operationName || 'AddWatchedTitle',
        variables: Object.assign({}, cap.variables || {}, { titleId: titleId })
      };
      if (cap.query) payload.query = cap.query;
      if (cap.extensions) payload.extensions = cap.extensions;
      return payload;
    }
    return {
      query: ADD_WATCHED_QUERY,
      operationName: 'AddWatchedTitle',
      variables: { titleId: titleId }
    };
  }

  function markWatchedOnce(titleId) {
    return gqlPost(buildPayloadFor(titleId)).then(function (res) {
      var data = res.json && res.json.data;
      var ok = !!(data && data.addWatchedTitle && data.addWatchedTitle.success) ||
        !!(state.captured && res.status === 200 && !res.json.errors && data &&
          Object.keys(data).some(function (k) {
            var v = data[k];
            return v && (v.success === true || v === true || (typeof v === 'object' && v.success !== false));
          }));
      return {
        ok: ok,
        status: res.status,
        error: ok ? '' : gqlErrorMessage(res.json, res.status),
        raw: res.text ? res.text.slice(0, 300) : ''
      };
    }).catch(function (err) {
      return { ok: false, status: 0, error: 'ag hatasi: ' + (err && err.message ? err.message : err), raw: '' };
    });
  }

  // ============================ Yakalama modu ============================
  // IMDb'nin kendi "Mark as watched" isteğini dinle. Böylece mutation adı ya da
  // persisted-query hash'i değişirse betik yine çalışır.

  function looksLikeWatchedRequest(bodyText) {
    return /watched/i.test(String(bodyText || ''));
  }

  function recordCaptured(bodyText, note) {
    var payload = null;
    try { payload = JSON.parse(bodyText); } catch (err) { return false; }
    if (!payload || typeof payload !== 'object') return false;
    var isWatchedOp = /watched/i.test(String(payload.operationName || '')) ||
      /watched/i.test(String(payload.query || ''));
    if (!isWatchedOp) return false;
    var isRemoval = /remove|delete|unmark|unwatch/i.test(String(payload.operationName || '')) ||
      /removeWatchedTitle|deleteWatchedTitle/i.test(String(payload.query || ''));
    state.captured = {
      operationName: payload.operationName || null,
      query: payload.query || null,
      variables: payload.variables || {},
      extensions: payload.extensions || null,
      removal: !!isRemoval,
      at: nowIso(),
      note: note || ''
    };
    persist();
    ui.onCaptured(state.captured);
    log(isRemoval ? 'warn' : 'ok',
      'Yakalandı: ' + (payload.operationName || '(adsız işlem)') +
      (payload.query ? ' — düz query' : (payload.extensions ? ' — persisted query' : '')) +
      (isRemoval ? ' (geri alma isteği; işaretleme için kullanılmaz)' : ''));
    return true;
  }

  function installCapture() {
    if (installCapture.done) return;
    installCapture.done = true;

    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        try {
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          var body = init && init.body ? init.body : (input && typeof input !== 'string' && input.bodyUsed === false ? null : null);
          if (url.indexOf('api.graphql.imdb.com') >= 0 && typeof body === 'string' && looksLikeWatchedRequest(body)) {
            recordCaptured(body, 'fetch');
          }
        } catch (err) { /* dinleme hatası akışı bozmasın */ }
        return origFetch.apply(this, arguments);
      };
    }

    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__iwmUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      try {
        if (String(this.__iwmUrl || '').indexOf('api.graphql.imdb.com') >= 0 &&
          typeof body === 'string' && looksLikeWatchedRequest(body)) {
          recordCaptured(body, 'xhr');
        }
      } catch (err) { /* yut */ }
      return origSend.apply(this, arguments);
    };
  }

  // ============================ Doğrulama (salt okuma) ============================
  // Watched listesini advancedTitleSearch ile çekmeye çalışır. IMDb bu sorguyu
  // persisted-query olarak da istiyor olabilir; o durumda kullanıcıya elle
  // kontrol yolu gösterilir.

  var VERIFY_QUERY =
    'query IwmWatchedHistory($first: Int, $after: String) {' +
    ' advancedTitleSearch(filter: {myWatchedConstraint: {filterType: INCLUDE}}, first: $first, after: $after,' +
    ' sort: {sortBy: MY_WATCHED_DATE, sortOrder: DESC}) {' +
    ' edges { node { title { id titleText { text } } } }' +
    ' pageInfo { hasNextPage endCursor } total } }';

  function verifyWatched(onProgress) {
    var ids = {};
    var after = null;
    var pages = 0;
    var reportedTotal = null;

    function step() {
      pages += 1;
      return gqlPost({
        query: VERIFY_QUERY,
        operationName: 'IwmWatchedHistory',
        variables: { first: CFG.verifyPageSize, after: after }
      }).then(function (res) {
        var conn = res.json && res.json.data && res.json.data.advancedTitleSearch;
        if (!conn) {
          var msg = gqlErrorMessage(res.json, res.status);
          if (pages === 1) {
            return { ok: false, error: msg, count: 0, found: [], missing: [], at: nowIso() };
          }
          return finish();
        }
        if (typeof conn.total === 'number') reportedTotal = conn.total;
        var edges = conn.edges || [];
        for (var i = 0; i < edges.length; i++) {
          var node = edges[i] && edges[i].node;
          var title = node && node.title;
          if (title && title.id) ids[title.id] = title.titleText ? title.titleText.text : '';
        }
        if (onProgress) onProgress(Object.keys(ids).length, pages);
        if (conn.pageInfo && conn.pageInfo.hasNextPage && pages < CFG.verifyMaxPages) {
          after = conn.pageInfo.endCursor;
          return sleep(CFG.minDelayMs).then(step);
        }
        return finish();
      });
    }

    function finish() {
      var found = [];
      var missing = [];
      for (var i = 0; i < state.queue.length; i++) {
        var id = state.queue[i].id;
        if (ids[id]) found.push(id); else missing.push(id);
      }
      return {
        ok: true,
        count: Object.keys(ids).length,
        total: reportedTotal,
        found: found,
        missing: missing,
        at: nowIso()
      };
    }

    return step();
  }

  // ============================ Kalıcılık ============================

  function persist() {
    // İlerleme küçük tutulur (yalnız sayaçlar ve sıra numarası); kuyruğun kendisi
    // ayrı anahtarda ve yalnızca kuyruk değiştiğinde yazılır (saveQueue). Böylece
    // 14.000+ öğelik koşuda her adımda yüzlerce KB JSON serileştirilmez.
    try {
      localStorage.setItem(CFG.storeKey, JSON.stringify({
        version: VERSION,
        savedAt: nowIso(),
        dryRun: state.dryRun,
        filters: state.filters,
        captured: state.captured ? {
          operationName: state.captured.operationName,
          query: state.captured.query,
          variables: state.captured.variables,
          extensions: state.captured.extensions,
          removal: state.captured.removal,
          at: state.captured.at
        } : null,
        run: state.queue.length ? {
          index: state.index,
          okCount: state.okCount,
          failCount: state.failCount,
          qCount: state.queue.length
        } : null,
        verified: state.verified ? {
          ok: state.verified.ok, count: state.verified.count, total: state.verified.total,
          foundCount: (state.verified.found || []).length,
          missingCount: (state.verified.missing || []).length, at: state.verified.at
        } : null
      }));
    } catch (err) {
      log('warn', 'İlerleme kaydedilemedi: ' + (err && err.message ? err.message : err));
    }
  }

  function queueStoreKey() {
    return CFG.storeKey + '.queue';
  }

  // Kuyruğu [id, tür, etiket] biçiminde sakla. Kota (~5 MB) aşılırsa etiketler
  // atılır; yine sığmazsa kuyruk hiç saklanmaz ve kullanıcı uyarılır.
  function saveQueue() {
    var full = state.queue.map(function (it) { return [it.id, it.type, it.label]; });
    var lite = state.queue.map(function (it) { return [it.id, it.type]; });
    var attempts = [full, lite, null];
    for (var i = 0; i < attempts.length; i++) {
      try {
        if (attempts[i] === null) {
          localStorage.removeItem(queueStoreKey());
          log('warn', 'Kuyruk localStorage kotasına sığmadı (' + state.queue.length +
            ' öğe). Sayfa yenilenirse kaynak dosyaları yeniden seçmen gerekir; ' +
            'güvenli yol: koşuyu tek seferde bitir ya da parçalara böl.');
          return false;
        }
        localStorage.setItem(queueStoreKey(), JSON.stringify(attempts[i]));
        return true;
      } catch (err) {
        // bir sonraki (daha küçük) biçimi dene
      }
    }
    return false;
  }

  function loadQueue() {
    try {
      var raw = localStorage.getItem(queueStoreKey());
      if (!raw) return null;
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr) || !arr.length) return null;
      return arr.map(function (row) {
        return { id: row[0], type: row[1] || TYPE_UNKNOWN, label: row[2] || '', source: 'kayitli-kosu' };
      });
    } catch (err) {
      return null;
    }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(CFG.storeKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function clearStoredRun() {
    try {
      var data = restore();
      if (data) {
        data.run = null;
        localStorage.setItem(CFG.storeKey, JSON.stringify(data));
      }
      localStorage.removeItem(queueStoreKey());
    } catch (err) { /* yut */ }
  }

  // ============================ Log ============================

  var logLines = [];

  function log(level, message) {
    var line = { at: nowIso(), level: level, message: String(message) };
    logLines.push(line);
    if (logLines.length > CFG.logKeep) logLines.splice(0, logLines.length - CFG.logKeep);
    ui.appendLog(line);
  }

  function logText() {
    return logLines.map(function (l) {
      return l.at + '\t' + l.level.toUpperCase() + '\t' + l.message;
    }).join('\n');
  }

  // ============================ Koşu ============================

  function buildQueue() {
    var merged = state.merged || { items: [] };
    var filtered = applyTypeFilter(merged.items, state.filters);
    state.queue = filtered.items;
    return filtered;
  }

  function startRun(options) {
    var opts = options || {};
    if (state.running) { log('warn', 'Zaten bir koşu sürüyor.'); return; }
    if (!state.queue.length) { log('err', 'Kuyruk boş. Önce dosya seç/yapıştır ve "Listeyi hazırla" de.'); return; }

    var limit = opts.limit || 0;
    var startAt = opts.startAt || 0;
    var targets = state.queue.slice(startAt, limit ? startAt + limit : undefined);
    if (!targets.length) { log('err', 'Bu aralıkta öğe yok.'); return; }

    if (!state.dryRun && !opts.skipConfirm) {
      var msg = 'IMDb hesabında ' + targets.length + ' başlık "izlendi" olarak işaretlenecek.\n\n' +
        '- Tarih yazılamaz (bugünün tarihi olur).\n' +
        '- Geri almak için her öğeyi tek tek açman gerekir.\n' +
        '- Bu, IMDb\'nin resmî olmayan iç API\'sini kullanır.\n\nDevam edilsin mi?';
      if (!window.confirm(msg)) { log('warn', 'Kullanıcı onaylamadı, koşu başlamadı.'); return; }
    }

    if (!state.dryRun && targets.length > CFG.bigRunWarn) {
      log('warn', targets.length + ' öğe tek koşuda çok fazla. IMDb hız sınırı uygularsa ' +
        'koşu duraklar; "Devam" ile kaldığın yerden sürdürebilirsin.');
    }

    state.running = true;
    state.stopped = false;
    state.index = startAt;
    state.startedAt = Date.now();
    if (!opts.keepRows) {
      state.rows = [];
      state.okCount = 0;
      state.failCount = 0;
      state.skipCount = 0;
    }

    ui.setRunning(true);
    log('info', (state.dryRun ? 'KURU KOŞU' : 'GERÇEK KOŞU') + ' başladı: ' + targets.length +
      ' öğe, gecikme ~' + ui.delayValue() + 'ms' + (state.captured && ui.useCaptured() ? ' (yakalanan istek)' : ''));
    window.addEventListener('beforeunload', ui.unloadGuard);

    runLoop(targets, startAt);
  }

  function runLoop(targets, baseIndex) {
    var consecutiveFails = 0;
    var backoffStep = 0;

    function next(i) {
      if (state.stopped || !state.running) return finishRun('durduruldu');
      if (i >= targets.length) return finishRun('bitti');

      var item = targets[i];
      state.index = baseIndex + i;

      if (state.dryRun) {
        state.rows.push({ id: item.id, type: item.type, label: item.label, status: 'dry', error: '' });
        state.skipCount += 1;
        ui.setProgress(i + 1, targets.length, item);
        return sleep(Math.min(ui.delayValue(), 50)).then(function () { return next(i + 1); });
      }

      return markWatchedOnce(item.id).then(function (res) {
        if (res.ok) {
          state.okCount += 1;
          consecutiveFails = 0;
          backoffStep = 0;
          state.rows.push({ id: item.id, type: item.type, label: item.label, status: 'ok', error: '' });
          ui.setProgress(i + 1, targets.length, item);
          if (state.okCount % 25 === 0) {
            log('info', state.okCount + ' öğe işaretlendi (' + (i + 1) + '/' + targets.length + ')');
            persist();
          }
          return sleep(delayFor()).then(function () { return next(i + 1); });
        }

        state.failCount += 1;
        consecutiveFails += 1;
        state.rows.push({ id: item.id, type: item.type, label: item.label, status: 'fail', error: res.error });
        ui.setProgress(i + 1, targets.length, item);
        log('err', item.id + ' başarısız: ' + res.error);

        if (looksLikeAuthError(res.error, res.status)) {
          log('err', 'Oturum/izin hatası. IMDb\'de oturumun açık mı? (Ayrıca "Yakala" modunu dene: ' +
            'herhangi bir başlıkta Watched düğmesine bir kez bas, betik gerçek isteği öğrenir.)');
          return finishRun('oturum hatası');
        }

        if (res.status === 429 || res.status >= 500 || res.status === 0) {
          if (backoffStep < CFG.backoffMs.length) {
            var wait = CFG.backoffMs[backoffStep];
            backoffStep += 1;
            log('warn', 'Hız sınırı/sunucu hatası (HTTP ' + res.status + '). ' + (wait / 1000) + 'sn beklenip devam edilecek…');
            persist();
            return sleep(wait).then(function () {
              consecutiveFails = 0;
              return next(i);
            });
          }
          log('err', 'Üç geri çekilme denemesi de başarısız. Koşu duraklatıldı; "Devam" ile sürebilirsin.');
          return finishRun('hız sınırı');
        }

        if (consecutiveFails >= CFG.maxConsecutiveFails) {
          log('err', 'Art arda ' + consecutiveFails + ' hata. Betik kendini durdurdu (hesabını zorlamamak için). ' +
            'Muhtemel neden: mutation adı değişti → "Yakala" modunu kullan.');
          return finishRun('art arda hata');
        }

        return sleep(delayFor()).then(function () { return next(i + 1); });
      });
    }

    next(0);
  }

  function finishRun(reason) {
    state.running = false;
    window.removeEventListener('beforeunload', ui.unloadGuard);
    ui.setRunning(false);
    persist();
    var elapsed = state.startedAt ? Date.now() - state.startedAt : 0;
    log(reason === 'bitti' ? 'ok' : 'warn',
      'Koşu ' + reason + '. Başarılı: ' + state.okCount + ', başarısız: ' + state.failCount +
      (state.dryRun ? ' (kuru koşu, hiçbir şey yazılmadı)' : '') +
      ', süre: ' + formatEta(elapsed));
    if (state.failCount) log('info', '"Başarısızları indir" ile hata listesini CSV alabilirsin.');
    ui.refreshButtons();
  }

  function stopRun() {
    state.stopped = true;
    log('warn', 'Durdurma isteği alındı, geçerli öğe bitince duracak…');
    ui.refreshButtons();
  }

  function downloadFile(name, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 1500);
  }

  function exportRows(onlyFailures) {
    // İlk kolon bilinçli olarak `const`: IMDb'nin kendi CSV başlığı ve betiğin
    // tanıdığı kolon adı bu. Böylece dışa aktarılan dosya hem IMDb Ratings
    // Importer'a hem de bu betiğe tekrar girdi olarak verilebilir.
    var rows = [['const', 'type', 'label', 'status', 'error']];
    for (var i = 0; i < state.rows.length; i++) {
      var r = state.rows[i];
      if (onlyFailures && r.status !== 'fail') continue;
      rows.push([r.id, r.type, r.label, r.status, r.error]);
    }
    if (rows.length === 1) { log('warn', onlyFailures ? 'Başarısız öğe yok.' : 'Dışa aktarılacak satır yok.'); return; }
    downloadFile(
      (onlyFailures ? 'imdb-watched-basarisizlar-' : 'imdb-watched-sonuc-') +
      new Date().toISOString().slice(0, 10) + '.csv',
      toCsv(rows), 'text/csv');
    log('info', (rows.length - 1) + ' satır CSV olarak indirildi.');
  }

  function retryFailed() {
    var failedIds = {};
    for (var i = 0; i < state.rows.length; i++) {
      if (state.rows[i].status === 'fail') failedIds[state.rows[i].id] = true;
    }
    var ids = Object.keys(failedIds);
    if (!ids.length) { log('warn', 'Yeniden denenecek başarısız öğe yok.'); return; }
    state.queue = state.queue.filter(function (it) { return failedIds[it.id]; });
    state.rows = state.rows.filter(function (r) { return r.status !== 'fail'; });
    state.index = 0;
    saveQueue();
    log('info', ids.length + ' başarısız öğe yeniden kuyruğa alındı.');
    ui.refreshQueueInfo();
    startRun({ keepRows: true });
  }

  // ============================ Girdi okuma ============================

  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var pending = files.length;
    files.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        var res = extractIds(String(reader.result || ''), { source: file.name });
        res.source = file.name;
        state.results.push(res);
        log('info', file.name + ': ' + res.format + ', ' + res.items.length + ' tt bulundu' +
          (res.duplicates ? ', ' + res.duplicates + ' yineleme' : ''));
        if (--pending === 0) rebuild();
      };
      reader.onerror = function () {
        log('err', file.name + ' okunamadı.');
        if (--pending === 0) rebuild();
      };
      reader.readAsText(file);
    });
  }

  function handleText(text, sourceName) {
    var res = extractIds(String(text || ''), { source: sourceName || 'yapistirilan' });
    if (!res.items.length && !Object.keys(res.skipped).length) {
      log('warn', 'Yapıştırılan metinde tt kimliği bulunamadı.');
      return;
    }
    state.results.push(res);
    log('info', (sourceName || 'Yapıştırılan metin') + ': ' + res.format + ', ' + res.items.length + ' tt bulundu.');
    rebuild();
  }

  function rebuild() {
    state.merged = mergeResults(state.results);
    var filtered = buildQueue();
    var counts = countByType(state.merged.items);
    var overlap = overlapWarning(countByType(state.queue));
    if (overlap) log('warn', overlap);
    log('info', 'Toplam benzersiz tt: ' + state.merged.items.length +
      ' (film ' + counts.movie + ', dizi ' + counts.show + ', bölüm ' + counts.episode +
      ', bilinmeyen ' + counts.unknown + ')' +
      (state.merged.duplicates ? ', yineleme ' + state.merged.duplicates : ''));
    var skippedSummary = summarizeSkipped(state.merged.skipped);
    if (skippedSummary.length) log('warn', 'Taşınamayan: ' + skippedSummary.join('; '));
    if (state.merged.notes && state.merged.notes.length) {
      state.merged.notes.slice(0, 6).forEach(function (n) { log('info', 'not: ' + n); });
    }
    var droppedSummary = [];
    Object.keys(filtered.dropped).forEach(function (k) {
      if (filtered.dropped[k]) droppedSummary.push(filtered.dropped[k] + ' × ' + k);
    });
    log('info', 'Kuyruk: ' + state.queue.length + ' öğe' +
      (droppedSummary.length ? ' (filtreyle atılan: ' + droppedSummary.join(', ') + ')' : ''));
    if (!state.queue.some(function (it) { return it.type === TYPE_EPISODE; }) && counts.episode > 0) {
      log('warn', 'Bölümler filtreyle devre dışı.');
    }
    ui.refreshQueueInfo();
    if (state.queue.length) saveQueue(); else clearStoredRun();
    persist();
  }

  function resetAll() {
    if (!window.confirm('Tüm girdi, kuyruk ve ilerleme silinsin mi? (IMDb\'de işaretlenenler geri alınmaz.)')) return;
    state.results = [];
    state.merged = null;
    state.queue = [];
    state.rows = [];
    state.index = 0;
    state.okCount = 0;
    state.failCount = 0;
    state.skipCount = 0;
    state.verified = null;
    clearStoredRun();
    ui.clearInputs();
    ui.refreshQueueInfo();
    log('info', 'Sıfırlandı.');
  }

  // ============================ Arayüz ============================

  var ui = (function () {
    var host = null;
    var root = null;
    var el = {};
    var logBox = null;
    var dragging = null;

    var CSS = [
      ':host { all: initial; }',
      '* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }',
      '.fab { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; width: 46px; height: 46px;',
      '  border-radius: 50%; border: 1px solid #f5c518; background: #1f1f1f; color: #f5c518; font-size: 20px;',
      '  cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.35); }',
      '.panel { position: fixed; right: 18px; bottom: 74px; z-index: 2147483001; width: 430px; max-width: 94vw;',
      '  max-height: 82vh; display: flex; flex-direction: column; background: #14161a; color: #e8e8e8;',
      '  border: 1px solid #2c313a; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,.55); overflow: hidden; }',
      '.panel.hidden, .fab.hidden { display: none; }',
      '.head { display: flex; align-items: center; gap: 8px; padding: 9px 11px; background: #1b1e24;',
      '  border-bottom: 1px solid #2c313a; cursor: move; user-select: none; }',
      '.head b { color: #f5c518; font-size: 13px; }',
      '.head .ver { color: #8a93a3; font-size: 11px; }',
      '.head .sp { flex: 1; }',
      '.body { padding: 11px; overflow: auto; }',
      'h4 { margin: 12px 0 6px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #8a93a3; }',
      'h4:first-child { margin-top: 0; }',
      'label.row { display: flex; align-items: center; gap: 6px; font-size: 12px; margin: 3px 0; cursor: pointer; }',
      'textarea { width: 100%; height: 74px; background: #0f1115; color: #e8e8e8; border: 1px solid #2c313a;',
      '  border-radius: 6px; padding: 6px; font: 11px/1.4 ui-monospace, Menlo, Consolas, monospace; resize: vertical; }',
      'input[type=file] { font-size: 11px; color: #c9d1d9; width: 100%; }',
      'input[type=number] { width: 74px; background: #0f1115; color: #e8e8e8; border: 1px solid #2c313a;',
      '  border-radius: 5px; padding: 3px 5px; font-size: 12px; }',
      'button { background: #232830; color: #e8e8e8; border: 1px solid #39414d; border-radius: 6px;',
      '  padding: 6px 9px; font-size: 12px; cursor: pointer; }',
      'button:hover { border-color: #f5c518; }',
      'button:disabled { opacity: .45; cursor: not-allowed; }',
      'button.primary { background: #f5c518; color: #14161a; border-color: #f5c518; font-weight: 600; }',
      'button.danger { background: #3a1f22; border-color: #7a3b41; color: #ffb4b4; }',
      '.btns { display: flex; flex-wrap: wrap; gap: 6px; }',
      '.stat { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; margin: 6px 0; }',
      '.stat span b { color: #f5c518; }',
      '.bar { height: 7px; background: #232830; border-radius: 4px; overflow: hidden; margin: 6px 0; }',
      '.bar i { display: block; height: 100%; width: 0%; background: #f5c518; transition: width .2s; }',
      '.log { background: #0b0d11; border: 1px solid #232830; border-radius: 6px; padding: 6px; height: 132px;',
      '  overflow: auto; font: 11px/1.5 ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }',
      '.log .ok { color: #7ee787; } .log .err { color: #ff7b72; } .log .warn { color: #f5c518; }',
      '.log .info { color: #c9d1d9; } .log .dim { color: #6e7681; }',
      '.note { font-size: 11px; color: #8a93a3; margin: 4px 0; }',
      '.tag { display: inline-block; padding: 1px 6px; border-radius: 10px; background: #232830;',
      '  border: 1px solid #39414d; font-size: 10px; color: #c9d1d9; }',
      '.tag.ok { border-color: #2ea043; color: #7ee787; }',
      '.tag.warn { border-color: #9e6a03; color: #f5c518; }'
    ].join('\n');

    function h(tag, attrs, text) {
      var node = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
      if (text != null) node.textContent = text;
      return node;
    }

    function build() {
      host = h('div');
      root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      var style = h('style');
      style.textContent = CSS;
      root.appendChild(style);

      el.fab = h('button', { class: 'fab', type: 'button', title: 'IMDb Watched Marker' }, '👁');
      el.fab.addEventListener('click', toggle);
      root.appendChild(el.fab);

      el.panel = h('div', { class: 'panel hidden' });
      root.appendChild(el.panel);

      var head = h('div', { class: 'head' });
      head.appendChild(h('b', null, 'IMDb Watched Marker'));
      head.appendChild(h('span', { class: 'ver' }, 'v' + VERSION));
      head.appendChild(h('span', { class: 'sp' }));
      el.captureTag = h('span', { class: 'tag' }, 'yakalama: kapalı');
      head.appendChild(el.captureTag);
      var closeBtn = h('button', { type: 'button', title: 'Kapat' }, '✕');
      closeBtn.addEventListener('click', toggle);
      head.appendChild(closeBtn);
      el.panel.appendChild(head);
      makeDraggable(head, el.panel);

      var body = h('div', { class: 'body' });
      el.panel.appendChild(body);

      // 1) Girdi
      body.appendChild(h('h4', null, '1 · Girdi'));
      body.appendChild(h('div', { class: 'note' },
        'Trakt ZIP\'inden çıkardığın JSON dosyalarını seç (birden çok), IMDb CSV\'si yükle ya da tt kimliklerini yapıştır.'));
      el.file = h('input', { type: 'file', multiple: 'multiple', accept: '.json,.csv,.txt,.ndjson,application/json,text/csv,text/plain' });
      el.file.addEventListener('change', function () { handleFiles(el.file.files); });
      body.appendChild(el.file);
      el.text = h('textarea', { placeholder: 'tt13207736\ntt0903747\n... veya IMDb CSV içeriği' });
      body.appendChild(el.text);
      var textBtns = h('div', { class: 'btns' });
      var addText = h('button', { type: 'button' }, 'Metni ekle');
      addText.addEventListener('click', function () { handleText(el.text.value); el.text.value = ''; });
      var clearSources = h('button', { type: 'button' }, 'Girdileri temizle');
      clearSources.addEventListener('click', function () {
        state.results = []; state.merged = null; state.queue = []; rebuild();
      });
      textBtns.appendChild(addText);
      textBtns.appendChild(clearSources);
      body.appendChild(textBtns);

      // 2) Filtre
      body.appendChild(h('h4', null, '2 · Hangi türler işaretlensin'));
      var filters = h('div');
      el.filterBoxes = {};
      [['movie', 'Filmler'], ['show', 'Diziler (gövde)'], ['episode', 'Bölümler'],
        ['unknown', 'Türü belirsiz'], ['season', 'Sezonlar (IMDb\'de yok)'], ['person', 'Kişiler (nm)']].forEach(function (pair) {
          var key = pair[0];
          var lab = h('label', { class: 'row' });
          var cb = h('input', { type: 'checkbox' });
          cb.checked = !!state.filters[key];
          cb.addEventListener('change', function () { state.filters[key] = cb.checked; rebuild(); });
          el.filterBoxes[key] = cb;
          lab.appendChild(cb);
          lab.appendChild(h('span', null, pair[1]));
          filters.appendChild(lab);
        });
      body.appendChild(filters);

      // Hazır filtre ayarları: watched-history.json hem film, hem dizi gövdesi, hem
      // bölüm içerir; en sık istenen iki kombinasyon tek tıkla uygulanabilsin.
      function applyPreset(preset, name) {
        Object.keys(state.filters).forEach(function (key) {
          var on = !!preset[key];
          state.filters[key] = on;
          if (el.filterBoxes[key]) el.filterBoxes[key].checked = on;
        });
        log('info', 'Hazır filtre uygulandı: ' + name);
        rebuild();
      }
      var presets = h('div', { class: 'btns' });
      var onlyEpisodes = h('button', { type: 'button', title: 'Yalnız bölüm tt\'leri (watched-history için)' }, 'Yalnız bölümler');
      onlyEpisodes.addEventListener('click', function () {
        applyPreset({ movie: false, show: false, episode: true, unknown: false, season: false, person: false }, 'yalnız bölümler');
      });
      var bodiesAndMovies = h('button', { type: 'button', title: 'Film + dizi gövdesi (bölüm yok)' }, 'Film + gövde');
      bodiesAndMovies.addEventListener('click', function () {
        applyPreset({ movie: true, show: true, episode: false, unknown: true, season: false, person: false }, 'film + dizi gövdesi');
      });
      presets.appendChild(onlyEpisodes);
      presets.appendChild(bodiesAndMovies);
      body.appendChild(presets);
      body.appendChild(h('div', { class: 'note' },
        'watched-history-*.json her kayıtta hem dizi gövdesini hem bölümü taşır; ' +
        '"Yalnız bölümler" gövdeleri düşürür. "Türü belirsiz" kapalıyken türü ' +
        'çıkarılamayan öğeler işaretlenmez — kuru koşuda "bilinmeyen" sayısı 0 mı kontrol et.'));
      body.appendChild(h('div', { class: 'note' },
        'Dizi gövdesini işaretlemek IMDb\'de "tüm diziyi izledim" anlamına gelmez ama rozet konur; ' +
        'yalnız bölüm bazında ilerlemek istiyorsan "Diziler (gövde)" kutusunu kapat.'));

      // 3) Ayarlar
      body.appendChild(h('h4', null, '3 · Ayarlar'));
      var settings = h('div', { class: 'btns' });
      var delayLab = h('label', { class: 'row' }, null);
      delayLab.appendChild(h('span', null, 'İstek arası gecikme (ms)'));
      el.delay = h('input', { type: 'number', min: String(CFG.minDelayMs), max: String(CFG.maxDelayMs), step: '50' });
      el.delay.value = String(CFG.defaultDelayMs);
      delayLab.appendChild(el.delay);
      settings.appendChild(delayLab);
      var capLab = h('label', { class: 'row' });
      el.useCaptured = h('input', { type: 'checkbox' });
      capLab.appendChild(el.useCaptured);
      capLab.appendChild(h('span', null, 'Yakalanan isteği kullan'));
      settings.appendChild(capLab);
      body.appendChild(settings);
      var dryLab = h('label', { class: 'row' });
      el.dry = h('input', { type: 'checkbox' });
      el.dry.checked = true;
      el.dry.addEventListener('change', function () {
        state.dryRun = el.dry.checked;
        persist();
        log(state.dryRun ? 'warn' : 'err',
          state.dryRun ? 'KURU KOŞU açık: hiçbir şey yazılmayacak.' : 'KURU KOŞU KAPALI: gerçek yazma yapılacak.');
      });
      dryLab.appendChild(el.dry);
      dryLab.appendChild(h('span', null, 'Kuru koşu (dry run) — hiçbir şey yazma'));
      body.appendChild(dryLab);

      // 4) Çalıştır
      body.appendChild(h('h4', null, '4 · Çalıştır'));
      var runBtns = h('div', { class: 'btns' });
      el.testBtn = h('button', { type: 'button' }, 'Tek öğeyle dene');
      el.testBtn.addEventListener('click', function () { startRun({ limit: 1, skipConfirm: false }); });
      el.startBtn = h('button', { type: 'button', class: 'primary' }, 'Koşuyu başlat');
      el.startBtn.addEventListener('click', function () { startRun({ startAt: state.index > 0 && !state.running ? state.index : 0 }); });
      el.stopBtn = h('button', { type: 'button', class: 'danger' }, 'Durdur');
      el.stopBtn.addEventListener('click', stopRun);
      el.retryBtn = h('button', { type: 'button' }, 'Başarısızları yeniden dene');
      el.retryBtn.addEventListener('click', retryFailed);
      runBtns.appendChild(el.testBtn);
      runBtns.appendChild(el.startBtn);
      runBtns.appendChild(el.stopBtn);
      runBtns.appendChild(el.retryBtn);
      body.appendChild(runBtns);

      el.progress = h('div', { class: 'stat' });
      body.appendChild(el.progress);
      el.bar = h('div', { class: 'bar' });
      el.barFill = h('i');
      el.bar.appendChild(el.barFill);
      body.appendChild(el.bar);
      el.current = h('div', { class: 'note' }, '—');
      body.appendChild(el.current);

      // 5) Yakalama
      body.appendChild(h('h4', null, '5 · Yakalama modu (mutation değişirse)'));
      body.appendChild(h('div', { class: 'note' },
        'Silahı kuşan → herhangi bir IMDb başlık sayfasında Watched düğmesine bir kez bas → ' +
        'betik gerçek isteği kaydeder ve o istekle toplu koşar.'));
      var capBtns = h('div', { class: 'btns' });
      el.armBtn = h('button', { type: 'button' }, 'Yakalamayı başlat');
      el.armBtn.addEventListener('click', function () {
        state.captureArmed = !state.captureArmed;
        el.armBtn.textContent = state.captureArmed ? 'Yakalama açık (kapat)' : 'Yakalamayı başlat';
        el.captureTag.textContent = state.captureArmed ? 'yakalama: dinliyor' : (state.captured ? 'yakalandı ✓' : 'yakalama: kapalı');
        el.captureTag.className = 'tag' + (state.captureArmed || state.captured ? ' ok' : '');
        log('info', state.captureArmed ? 'Dinleniyor: bir başlıkta Watched düğmesine bas.' : 'Dinleme kapatıldı.');
      });
      el.forgetBtn = h('button', { type: 'button' }, 'Yakalananı unut');
      el.forgetBtn.addEventListener('click', function () {
        state.captured = null;
        el.useCaptured.checked = false;
        el.captureTag.textContent = 'yakalama: kapalı';
        el.captureTag.className = 'tag';
        persist();
        log('info', 'Yakalanan istek unutuldu; yerleşik AddWatchedTitle kullanılacak.');
      });
      capBtns.appendChild(el.armBtn);
      capBtns.appendChild(el.forgetBtn);
      body.appendChild(capBtns);

      // 6) Doğrulama
      body.appendChild(h('h4', null, '6 · Doğrula'));
      body.appendChild(h('div', { class: 'note' },
        'Watched listeni IMDb\'den geri okur ve kuyruğundaki hangi tt\'lerin gerçekten işaretli olduğunu sayar. ' +
        'IMDb bu sorguyu reddederse Profil → "Your watch history" toplamına elle bak.'));
      var verBtns = h('div', { class: 'btns' });
      el.verifyBtn = h('button', { type: 'button' }, 'Doğrula');
      el.verifyBtn.addEventListener('click', function () {
        if (!state.queue.length) { log('warn', 'Önce kuyruk hazırla.'); return; }
        el.verifyBtn.disabled = true;
        log('info', 'Doğrulama başladı (salt okuma)…');
        verifyWatched(function (count, pages) {
          el.current.textContent = 'doğrulama: ' + count + ' izlenen başlık okundu (' + pages + '. sayfa)';
        }).then(function (res) {
          el.verifyBtn.disabled = false;
          state.verified = res;
          persist();
          if (!res.ok) {
            log('warn', 'Doğrulama sorgusu çalışmadı: ' + res.error +
              ' → Profil → "Your watch history" sayfasındaki toplamı elle karşılaştır.');
            return;
          }
          log('ok', 'Watched listende ' + res.count + ' başlık var. Kuyruktan bulunan: ' +
            res.found.length + '/' + state.queue.length + ', eksik: ' + res.missing.length);
          if (res.missing.length) {
            log('warn', 'Eksikler için "Başarısızları yeniden dene" ya da metne yapıştırıp tekrar koş.');
            downloadFile('imdb-watched-eksikler-' + new Date().toISOString().slice(0, 10) + '.txt',
              res.missing.join('\n'), 'text/plain');
          }
        }).catch(function (err) {
          el.verifyBtn.disabled = false;
          log('err', 'Doğrulama hatası: ' + (err && err.message ? err.message : err));
        });
      });
      verBtns.appendChild(el.verifyBtn);
      body.appendChild(verBtns);

      // 7) Dışa aktar
      body.appendChild(h('h4', null, '7 · Dışa aktar / sıfırla'));
      var expBtns = h('div', { class: 'btns' });
      var expAll = h('button', { type: 'button' }, 'Sonuç CSV');
      expAll.addEventListener('click', function () { exportRows(false); });
      var expFail = h('button', { type: 'button' }, 'Başarısızlar CSV');
      expFail.addEventListener('click', function () { exportRows(true); });
      var expQueue = h('button', { type: 'button' }, 'Kuyruk CSV');
      expQueue.addEventListener('click', function () {
        if (!state.queue.length) { log('warn', 'Kuyruk boş.'); return; }
        var rows = [['const', 'type', 'label']];
        state.queue.forEach(function (it) { rows.push([it.id, it.type, it.label]); });
        downloadFile('imdb-watched-kuyruk.csv', toCsv(rows), 'text/csv');
      });
      var expLog = h('button', { type: 'button' }, 'Log');
      expLog.addEventListener('click', function () { downloadFile('imdb-watched-log.txt', logText()); });
      var resetBtn = h('button', { type: 'button', class: 'danger' }, 'Sıfırla');
      resetBtn.addEventListener('click', resetAll);
      [expAll, expFail, expQueue, expLog, resetBtn].forEach(function (b) { expBtns.appendChild(b); });
      body.appendChild(expBtns);

      body.appendChild(h('h4', null, 'Günlük'));
      logBox = h('div', { class: 'log' });
      body.appendChild(logBox);
      el.body = body;

      document.documentElement.appendChild(host);
      installCapture();
    }

    function makeDraggable(handle, target) {
      handle.addEventListener('mousedown', function (ev) {
        if (ev.target.tagName === 'BUTTON') return;
        var rect = target.getBoundingClientRect();
        dragging = { dx: ev.clientX - rect.left, dy: ev.clientY - rect.top };
        ev.preventDefault();
      });
      document.addEventListener('mousemove', function (ev) {
        if (!dragging) return;
        var x = Math.max(4, Math.min(window.innerWidth - 120, ev.clientX - dragging.dx));
        var y = Math.max(4, Math.min(window.innerHeight - 60, ev.clientY - dragging.dy));
        target.style.left = x + 'px';
        target.style.top = y + 'px';
        target.style.right = 'auto';
        target.style.bottom = 'auto';
      });
      document.addEventListener('mouseup', function () { dragging = null; });
    }

    function toggle() {
      if (!host) build();
      var hidden = el.panel.classList.contains('hidden');
      el.panel.classList.toggle('hidden', !hidden);
      el.fab.classList.toggle('hidden', hidden);
    }

    return {
      ensure: function () { if (!host) build(); },
      toggle: toggle,
      delayValue: function () {
        var v = el.delay ? parseInt(el.delay.value, 10) : CFG.defaultDelayMs;
        if (isNaN(v)) v = CFG.defaultDelayMs;
        return Math.max(CFG.minDelayMs, Math.min(CFG.maxDelayMs, v));
      },
      useCaptured: function () { return !!(el.useCaptured && el.useCaptured.checked && state.captured && !state.captured.removal); },
      setDryChecked: function (value) { if (el.dry) el.dry.checked = !!value; },
      appendLog: function (line) {
        if (!logBox) return;
        var div = h('div', { class: line.level }, line.at.slice(11, 19) + ' · ' + line.message);
        logBox.appendChild(div);
        while (logBox.childNodes.length > CFG.logKeep) logBox.removeChild(logBox.firstChild);
        logBox.scrollTop = logBox.scrollHeight;
      },
      setProgress: function (done, total, item) {
        if (!el.barFill) return;
        var pct = total ? Math.round((done / total) * 100) : 0;
        el.barFill.style.width = pct + '%';
        var elapsed = state.startedAt ? Date.now() - state.startedAt : 0;
        var perItem = done ? elapsed / done : 0;
        el.progress.textContent = '';
        var parts = [
          ['ilerleme', done + '/' + total + ' (%' + pct + ')'],
          ['başarılı', String(state.okCount)],
          ['hata', String(state.failCount)],
          ['kalan', formatEta((total - done) * perItem)]
        ];
        parts.forEach(function (p) {
          var s = h('span');
          s.appendChild(h('b', null, p[1]));
          s.appendChild(document.createTextNode(' ' + p[0]));
          el.progress.appendChild(s);
        });
        el.current.textContent = item ? (item.id + (item.label ? ' · ' + item.label : '')) : '—';
      },
      setRunning: function (running) {
        if (el.startBtn) el.startBtn.disabled = running;
        if (el.testBtn) el.testBtn.disabled = running;
        if (el.stopBtn) el.stopBtn.disabled = !running;
        if (el.retryBtn) el.retryBtn.disabled = running;
        if (el.verifyBtn) el.verifyBtn.disabled = running;
      },
      refreshButtons: function () {
        this.setRunning(state.running);
        if (el.startBtn) {
          el.startBtn.textContent = (!state.running && state.index > 0 && state.index < state.queue.length)
            ? 'Devam et (' + state.index + '. öğeden)' : 'Koşuyu başlat';
        }
      },
      refreshQueueInfo: function () {
        if (!el.current) return;
        el.current.textContent = state.queue.length
          ? ('kuyruk: ' + state.queue.length + ' öğe · ' + state.queue[0].id + (state.queue[0].label ? ' · ' + state.queue[0].label : ''))
          : 'kuyruk boş';
        this.refreshButtons();
      },
      clearInputs: function () {
        if (el.file) el.file.value = '';
        if (el.text) el.text.value = '';
        if (logBox) logBox.innerHTML = '';
        logLines.length = 0;
      },
      onCaptured: function (cap) {
        if (el.captureTag) {
          el.captureTag.textContent = 'yakalandı: ' + (cap.operationName || '?');
          el.captureTag.className = 'tag ok';
        }
        if (el.useCaptured && !cap.removal) el.useCaptured.checked = true;
      },
      unloadGuard: function (ev) {
        ev.preventDefault();
        ev.returnValue = '';
        return '';
      }
    };
  })();

  // ============================ Açılış ============================

  function boot() {
    // Önce kayıtlı durumu oku (arayüz kutuları bu değerlerle kurulur), sonra UI'yi kur.
    var stored = restore();
    var restored = { captured: null, run: null };
    if (stored) {
      if (stored.filters) {
        Object.keys(stored.filters).forEach(function (k) {
          if (Object.prototype.hasOwnProperty.call(state.filters, k)) state.filters[k] = !!stored.filters[k];
        });
      }
      if (typeof stored.dryRun === 'boolean') state.dryRun = stored.dryRun;
      if (stored.captured && !stored.captured.removal) restored.captured = stored.captured;
      if (stored.run) {
        var savedQueue = loadQueue();
        restored.run = {
          index: stored.run.index || 0,
          okCount: stored.run.okCount || 0,
          failCount: stored.run.failCount || 0,
          qCount: stored.run.qCount || (savedQueue ? savedQueue.length : 0),
          queue: savedQueue
        };
      }
    }

    ui.ensure();

    if (el_setDry) el_setDry(state.dryRun);
    if (restored.captured) {
      state.captured = restored.captured;
      ui.onCaptured(state.captured);
      log('info', 'Önceki oturumdan yakalanan istek yüklendi: ' + (state.captured.operationName || '?'));
    }
    if (restored.run) {
      state.index = restored.run.index;
      state.okCount = restored.run.okCount;
      state.failCount = restored.run.failCount;
      if (restored.run.queue) {
        state.queue = restored.run.queue;
        log('warn', 'Yarım kalmış koşu bulundu: ' + state.queue.length + ' öğe, ' + state.index +
          '. sırada kalmış. "Devam et" ile sürebilirsin.');
      } else {
        log('warn', 'Yarım kalmış koşu vardı (' + restored.run.qCount + ' öğe, ' + restored.run.index +
          '. sıra) ama kuyruk kaydı sığmamış; kaynak dosyaları yeniden seç, sonra "Devam et".');
      }
    }

    log('info', 'IMDb Watched Marker v' + VERSION + ' hazır. IMDb oturumun açık olmalı.');
    log(state.dryRun ? 'warn' : 'err',
      state.dryRun ? 'Kuru koşu varsayılan olarak AÇIK: hiçbir şey yazılmaz. Gerçek yazma için 3. adımdaki kutuyu kapat.'
        : 'DİKKAT: kuru koşu KAPALI durumda; "Koşuyu başlat" gerçekten yazar.');
    log('info', 'Bilinen sınır: izlenme tarihi yazılamaz; IMDb Watched tarihi = işaretleme anı.');

    if (location.pathname.indexOf('/preferences') === 0) {
      log('info', 'Not: reference view açıksa sayfadaki Watched düğmesi çalışmaz, ama bu betik ' +
        'düğmeye değil doğrudan API\'ye gittiği için etkilenmez.');
    }

    ui.refreshQueueInfo();
  }

  // Kuru koşu kutusunu kayıtlı durumla eşitle (arayüz kurulduktan sonra çağrılır).
  function el_setDry(value) {
    ui.setDryChecked(value);
  }

  // Sayfa bağlamında çalışıyoruz (@grant none): IMDb'nin kendi SPA yönlendirmeleri
  // betiği öldürmesin diye bir kez kur, sonra dokunma.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Hata ayıklama için dışa aç (salt okuma yardımcılar).
  window.ImdbWatchedMarker = {
    version: VERSION,
    extractIds: extractIds,
    mergeResults: mergeResults,
    applyTypeFilter: applyTypeFilter,
    countByType: countByType,
    overlapWarning: overlapWarning,
    state: state,
    markOne: markWatchedOnce
  };
})();
