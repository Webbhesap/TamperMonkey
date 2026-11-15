// imdb-watched-marker.user.js içindeki saf (DOM/ağ kullanmayan) ayrıştırıcı bloğunu
// Node içinde çalıştırıp test eder. Blok, betikteki PURE_START / PURE_END blok
// yorumu işaretçileri arasındadır; DOM kodu değişse bile bu testler çalışır.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'imdb-watched-marker.user.js'), 'utf8');

const START = '/* __PURE_START__ */';
const END = '/* __PURE_END__ */';
const from = source.indexOf(START);
const to = source.indexOf(END);
assert.ok(from >= 0 && to > from, 'betikte __PURE_START__ / __PURE_END__ işaretçileri bulunamadı');
const pureCode = source.slice(from + START.length, to);

const pure = new Function(`${pureCode}
  return {
    extractIds, mergeResults, applyTypeFilter, countByType, overlapWarning, toCsv, parseCsv,
    summarizeSkipped, formatEta, looksLikeAuthError, gqlErrorMessage, typeFromToken, pad2
  };`)();

test('imdb puan CSV\'si: Const kolonu, türler ve başlıklar', () => {
  const csv = [
    'Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Year',
    'tt0111161,10,2024-03-01,The Shawshank Redemption,https://www.imdb.com/title/tt0111161/,movie,1994',
    'tt13207736,,2026-01-05,"Monster",https://www.imdb.com/title/tt13207736/,tvSeries,2022',
    'tt1190634,9,2026-01-06,"Mother!",https://www.imdb.com/title/tt1190634/,tvEpisode,2025'
  ].join('\n');
  const r = pure.extractIds(csv, { source: 'ratings.csv' });
  assert.equal(r.format, 'csv');
  assert.equal(r.items.length, 3);
  assert.deepEqual(r.items.map((i) => i.id), ['tt0111161', 'tt13207736', 'tt1190634']);
  assert.deepEqual(r.items.map((i) => i.type), ['movie', 'show', 'episode']);
  assert.equal(r.items[1].label, 'Monster');
});

test('imdb liste dışa aktarımı: Position,Const,Created,Description', () => {
  const csv = 'Position,Const,Created,Description,Title,URL\n' +
    '1,tt0903747,2026-02-01,"S1 Breaking Bad","Breaking Bad",https://www.imdb.com/title/tt0903747/\n' +
    '2,tt0372784,2026-02-01,,Batman Begins,https://www.imdb.com/title/tt0372784/\n';
  const r = pure.extractIds(csv, { source: 'list.csv' });
  assert.equal(r.format, 'csv');
  assert.deepEqual(r.items.map((i) => i.id), ['tt0903747', 'tt0372784']);
  assert.equal(r.items[0].type, 'unknown');
  assert.equal(r.items[0].label, 'Breaking Bad');
});

test('trakt JSON: film, dizi gövdesi ve bölüm (S/E etiketi)', () => {
  const json = JSON.stringify([
    { watched_at: '2022-09-21T20:00:00.000Z', movie: { title: 'Batman Begins', year: 2005, ids: { trakt: 1, imdb: 'tt0372784' } } },
    { watched_at: '2022-09-22T20:00:00.000Z', show: { title: 'Monster', year: 2022, ids: { trakt: 2, imdb: 'tt13207736' } } },
    {
      watched_at: '2025-10-03T20:00:00.000Z',
      show: { title: 'Monster', ids: { trakt: 2, imdb: 'tt13207736' } },
      episode: { season: 3, number: 1, title: 'Mother!', ids: { trakt: 3, imdb: 'tt1190634' } }
    }
  ]);
  const r = pure.extractIds(json, { source: 'watched-history.json' });
  assert.equal(r.format, 'json');
  const byId = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.equal(byId.tt0372784.type, 'movie');
  assert.equal(byId.tt13207736.type, 'show');
  assert.equal(byId.tt1190634.type, 'episode');
  assert.match(byId.tt1190634.label, /S03E01/);
  assert.equal(r.items.length, 3, 'aynı dizinin gövdesi yineleme sayılmamalı, bölüm ayrı öğe olmalı');
  // Üçüncü kayıtta dizi gövdesi (tt13207736) bir kez daha geçer → tekilleştirilip
  // yineleme sayacına yazılır.
  assert.equal(r.duplicates, 1);
});

test('trakt JSON: imdb=null olan öğeler atlanır ve sayılır', () => {
  const json = JSON.stringify([
    { movie: { title: 'Kimliksiz Film', ids: { trakt: 9, imdb: null } } },
    { show: { title: 'Monster', ids: { trakt: 2, imdb: 'tt13207736' } } },
    { type: 'season', season: 2, ids: { trakt: 5, imdb: null } }
  ]);
  const r = pure.extractIds(json, { source: 'lists.json' });
  assert.deepEqual(r.items.map((i) => i.id), ['tt13207736']);
  assert.ok(r.skipped['imdb-null'] >= 1, 'imdb=null sayılmalı');
  assert.ok(r.skipped['imdb-null-sezon'] >= 1 || r.skipped['sezon-tt-yok'] >= 1, 'sezon atlanmalı');
  assert.match(pure.summarizeSkipped(r.skipped).join(' '), /IMDb kimliği boş/);
});

test('kişi (nm) kimlikleri Watched için geçersizdir', () => {
  const r = pure.extractIds('nm0000123, tt0111161, nm0005132\n', { source: 'people.txt' });
  assert.deepEqual(r.items.map((i) => i.id), ['tt0111161']);
  assert.ok(r.skipped['kisi-nm'] >= 1);
});

test('düz metin: yinelemeler tekilleştirilir, sıra korunur', () => {
  const text = 'tt0111161\ntt0903747\ntt0111161\nboş satır\n\ntt13207736\n';
  const r = pure.extractIds(text, { source: 'liste.txt' });
  assert.equal(r.format, 'text');
  assert.deepEqual(r.items.map((i) => i.id), ['tt0111161', 'tt0903747', 'tt13207736']);
  assert.equal(r.duplicates, 1);
});

test('satır satır JSON (NDJSON) çözülür', () => {
  const nd = '{"ids":{"imdb":"tt0111161"}}\n{"ids":{"imdb":"tt0903747"}}\n';
  const r = pure.extractIds(nd, { source: 'nd.json' });
  assert.equal(r.format, 'json');
  assert.deepEqual(r.items.map((i) => i.id), ['tt0111161', 'tt0903747']);
});

test('bozuk JSON düz metin taramasına düşer ve not bırakır', () => {
  const broken = '{"ids":{"imdb":"tt0111161"} bozuk';
  const r = pure.extractIds(broken, { source: 'bozuk.json' });
  assert.equal(r.format, 'text');
  assert.deepEqual(r.items.map((i) => i.id), ['tt0111161']);
  assert.ok(r.notes.some((n) => /düz metin/i.test(n)));
});

test('boş girdi patlamaz', () => {
  const r = pure.extractIds('   \n ', { source: 'bos.txt' });
  assert.equal(r.format, 'empty');
  assert.equal(r.items.length, 0);
});

test('mergeResults dosyalar arası yinelemeleri düşer ve notları toplar', () => {
  const a = pure.extractIds('tt0111161\ntt0903747\n', { source: 'a.txt' });
  const b = pure.extractIds('tt0903747\ntt13207736\n', { source: 'b.txt' });
  const m = pure.mergeResults([a, b]);
  assert.deepEqual(m.items.map((i) => i.id), ['tt0111161', 'tt0903747', 'tt13207736']);
  assert.equal(m.duplicates, 1);
  assert.deepEqual(m.formats, ['text']);
});

test('applyTypeFilter: dizi gövdeleri kapatılınca yalnız bölümler kalır', () => {
  const items = [
    { id: 'tt1', type: 'movie', label: '' },
    { id: 'tt2', type: 'show', label: '' },
    { id: 'tt3', type: 'episode', label: '' },
    { id: 'tt4', type: 'unknown', label: '' }
  ];
  const on = pure.applyTypeFilter(items, { movie: true, show: true, episode: true, unknown: true });
  assert.equal(on.items.length, 4);
  assert.equal(on.dropped.show, 0);
  const off = pure.applyTypeFilter(items, { movie: true, show: false, episode: true, unknown: false });
  assert.deepEqual(off.items.map((i) => i.id), ['tt1', 'tt3']);
  assert.equal(off.dropped.show, 1);
  assert.equal(off.dropped.unknown, 1);
});

test('countByType özet sayar', () => {
  const c = pure.countByType([
    { id: 'tt1', type: 'movie' }, { id: 'tt2', type: 'movie' },
    { id: 'tt3', type: 'episode' }, { id: 'tt4', type: 'unknown' }
  ]);
  assert.equal(c.total, 4);
  assert.equal(c.movie, 2);
  assert.equal(c.episode, 1);
  assert.equal(c.unknown, 1);
});

test('trakt history kaydı: gövde + bölüm birlikte gelir, filtreyle yalnız bölümler kalır', () => {
  const json = JSON.stringify([
    {
      id: 1, watched_at: '2025-10-03T20:14:11.000Z', action: 'scrobble', type: 'episode',
      episode: { season: 3, number: 1, title: 'Mother!', ids: { trakt: 88, imdb: 'tt1190634' } },
      show: { title: 'Monster', year: 2022, ids: { trakt: 2, imdb: 'tt13207736' } }
    },
    {
      id: 2, watched_at: '2024-05-01T20:00:00.000Z', action: 'scrobble', type: 'movie',
      movie: { title: 'Dune', year: 2021, ids: { trakt: 5, imdb: 'tt1160419' } }
    }
  ]);
  const r = pure.extractIds(json, { source: 'watched-history-1.json' });
  assert.equal(r.format, 'json');
  assert.deepEqual(r.items.map((i) => [i.id, i.type]),
    [['tt1190634', 'episode'], ['tt13207736', 'show'], ['tt1160419', 'movie']]);
  assert.match(r.items[0].label, /Mother!/);
  assert.match(r.items[0].label, /S03E01/);

  // "Yalnız bölümler" hazır filtresinin karşılığı
  const only = pure.applyTypeFilter(r.items, { movie: false, show: false, episode: true, unknown: false });
  assert.deepEqual(only.items.map((i) => i.id), ['tt1190634']);
  assert.equal(only.dropped.show, 1);
  assert.equal(only.dropped.movie, 1);
  assert.equal(pure.overlapWarning(pure.countByType(only.items)), null,
    'yalnız bölüm kalınca gövde/bölüm çakışması uyarısı olmamalı');
  assert.ok(pure.overlapWarning(pure.countByType(r.items)), 'süzülmemiş listede uyarı çıkmalı');
});

test('dışa aktarılan kuyruk CSV\'si (const başlığı) kayıpsız geri okunur', () => {
  const exported = pure.toCsv([
    ['const', 'type', 'label'],
    ['tt1190634', 'episode', 'Mother! S03E01'],
    ['tt1160419', 'movie', 'Dune']
  ]);
  const back = pure.extractIds(exported, { source: 'kuyruk.csv' });
  assert.equal(back.format, 'csv');
  assert.deepEqual(back.items.map((i) => i.id), ['tt1190634', 'tt1160419']);
  assert.deepEqual(back.items.map((i) => i.type), ['episode', 'movie']);
  assert.deepEqual(back.items.map((i) => i.label), ['Mother! S03E01', 'Dune']);
});

test('overlapWarning: gövde + bölüm varsa uyarı, tek tür varsa null', () => {
  const both = pure.overlapWarning({ show: 3, episode: 40, movie: 10, unknown: 0 });
  assert.ok(both && /dizi gövdesi/.test(both) && /40 bölüm/.test(both));
  assert.match(both, /Diziler \(gövde\)/);
  assert.equal(pure.overlapWarning({ show: 3, episode: 0 }), null);
  assert.equal(pure.overlapWarning({ show: 0, episode: 40 }), null);
  assert.equal(pure.overlapWarning(null), null);
});

test('toCsv tırnak ve virgül kaçışlar', () => {
  const csv = pure.toCsv([['id', 'label'], ['tt1', 'a,b "x"'], ['tt2', 'satır\nsonu']]);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'id,label');
  assert.equal(lines[1], 'tt1,"a,b ""x"""');
  assert.match(csv, /"satır\nsonu"/);
});

test('parseCsv ayraç olarak virgül, noktalı virgül ve sekme kabul eder', () => {
  assert.deepEqual(pure.parseCsv('a,b\n1,2')[0], ['a', 'b']);
  assert.deepEqual(pure.parseCsv('a;b\n1;2')[0], ['a', 'b']);
  assert.deepEqual(pure.parseCsv('a\tb\n1\t2')[0], ['a', 'b']);
});

test('typeFromToken IMDb Title Type değerlerini eşler', () => {
  assert.equal(pure.typeFromToken('tvSeries'), 'show');
  assert.equal(pure.typeFromToken('TV Mini Series'), 'show');
  assert.equal(pure.typeFromToken('tvEpisode'), 'episode');
  assert.equal(pure.typeFromToken('short'), 'movie');
  assert.equal(pure.typeFromToken('video game'), null);
});

test('formatEta saat/dakika/saniye basamaklarını gösterir', () => {
  assert.equal(pure.formatEta(45_000), '45sn');
  assert.equal(pure.formatEta(125_000), '2dk 5sn');
  assert.equal(pure.formatEta(3_725_000), '1s 02dk');
  assert.equal(pure.formatEta(-1), '?');
});

test('looksLikeAuthError 401/403 ve oturum mesajlarını yakalar', () => {
  assert.equal(pure.looksLikeAuthError('', 401), true);
  assert.equal(pure.looksLikeAuthError('', 403), true);
  assert.equal(pure.looksLikeAuthError('Not authorized to perform this action', 200), true);
  assert.equal(pure.looksLikeAuthError('PersistedQueryNotFound', 200), false);
});

test('gqlErrorMessage GraphQL hatalarını okur', () => {
  assert.equal(pure.gqlErrorMessage({ errors: [{ message: 'boom' }] }, 200), 'boom');
  assert.equal(pure.gqlErrorMessage({ errors: [{ extensions: { code: 'FORBIDDEN' } }] }, 200), 'FORBIDDEN');
  assert.equal(pure.gqlErrorMessage(null, 500), 'HTTP 500');
});

test('pad2 iki haneye tamamlar', () => {
  assert.equal(pure.pad2(3), '03');
  assert.equal(pure.pad2(12), '12');
});
