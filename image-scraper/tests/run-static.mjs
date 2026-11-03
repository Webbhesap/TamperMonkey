// Static checks: syntax, metadata contract, template/control wiring, CSS classes,
// dead code / duplication and obvious coding mistakes. No browser needed.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { Assertions, ROOT, readBundle, readMetadata } from './helpers.mjs';

const t = new Assertions();
const files = readBundle();
const scripts = ['lib/jszip.min.js', 'modules/zip.js', 'modules/settings-ui.js', 'modules/page-tools.js',
  'modules/network.js', 'modules/image-analysis.js', 'modules/ui-results.js', 'app.js'];

t.test('Tüm betikler sözdizimsel olarak geçerli');
for (const file of scripts) {
  try { new vm.Script(files[file], { filename: file }); t.ok(true, file); }
  catch (error) { t.ok(false, `${file}: ${error.message}`); }
}

t.test('panel.html geçerli bir şablon belgesi');
const requiredTemplates = ['isp-launch-template', 'isp-settings-navigation-template', 'isp-dialog-template',
  'isp-section-template', 'isp-excluded-site-row-template'];
const templateIds = [...files['panel.html'].matchAll(/<template id="([^"]+)"/g)].map(m => m[1]);
t.ok(requiredTemplates.every(id => templateIds.includes(id)),
  `Eksik şablon: ${requiredTemplates.filter(id => !templateIds.includes(id)).join(', ')}`);

t.test('app.js her $el(tag) için panel.html şablonu var');
const usedTags = new Set();
for (const file of Object.keys(files)) {
  if (!file.endsWith('.js') || file.startsWith('lib/')) continue;
  for (const m of files[file].matchAll(/\$el\('([a-z]+)'/g)) usedTags.add(m[1]);
}
const missingTags = [...usedTags].filter(tag => !templateIds.includes(`isp-element-${tag}`));
t.ok(missingTags.length === 0, `Eksik element şablonları: ${missingTags.join(', ')}`);

t.test('Ayarlar sekmesindeki her data-control panel.html içinde var');
const controlNames = new Set([...files['panel.html'].matchAll(/data-control="([^"]+)"/g)].map(m => m[1]));
const queried = new Set([...files['modules/settings-ui.js'].matchAll(/q\('([^']+)'\)/g)].map(m => m[1]));
const missingControls = [...queried].filter(name => !controlNames.has(name));
t.ok(missingControls.length === 0, `Eksik denetim: ${missingControls.join(', ')}`);

t.test('data-action düğmeleri modülde bağlanmış');
const actionNames = new Set([...files['panel.html'].matchAll(/data-action="([^"]+)"/g)].map(m => m[1]));
// Statik düğmeler `action('ad')` ile, şablon içinden üretilen satırlar ise
// querySelector('[data-action="ad"]') ile bağlanır; ikisi de geçerlidir.
const bound = new Set([...files['modules/settings-ui.js'].matchAll(/action\('([^']+)'\)/g)].map(m => m[1]));
for (const m of files['modules/settings-ui.js'].matchAll(/data-action=\\?"([^"\\]+)\\?"/g)) bound.add(m[1]);
t.ok([...actionNames].every(name => bound.has(name)), `Bağlanmamış eylem: ${[...actionNames].filter(n => !bound.has(n)).join(', ')}`);

t.test('CSS: kullanılan sınıfların tamamı styles.css içinde tanımlı');
const cssClasses = new Set([...files['styles.css'].matchAll(/\.([a-zA-Z][\w-]+)/g)].map(m => m[1]));
const usedClasses = new Set();
for (const file of Object.keys(files)) {
  if (!/\.(js|html)$/.test(file) || file.startsWith('lib/')) continue;
  const src = files[file];
  for (const m of src.matchAll(/class:\s*'([^']+)'/g)) m[1].split(/\s+/).forEach(c => c && usedClasses.add(c));
  for (const m of src.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c => c && usedClasses.add(c));
  for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\('([^']+)'/g)) usedClasses.add(m[1]);
}
const undefinedClasses = [...usedClasses].filter(c => !cssClasses.has(c) && c !== 'x-cloak');
t.ok(undefinedClasses.length === 0, `Tanımsız sınıf: ${undefinedClasses.join(', ')}`);

t.test('Kullanıcı betiği metadata sözleşmesi');
const { map, text } = readMetadata();
const requires = map.get('require') || [];
const resources = map.get('resource') || [];
t.ok(requires.length >= 9, `@require sayısı beklenenden az: ${requires.length}`);
t.ok(resources.length >= 2, '@resource eksik');
t.ok(requires.every(u => /^https:\/\//.test(u)), `file:// veya güvensiz @require: ${requires.filter(u => !/^https:\/\//.test(u)).join(', ')}`);
t.ok(resources.every(r => /^https:\/\//.test(r.split(/\s+/)[1] || '')), 'file:// @resource kalmış');
t.ok(!/file:\/\//.test(text), 'Metadata içinde file:// satırı kaldı');
t.ok(/GM_getValue/.test((map.get('grant') || []).join(' ')), 'GM_getValue izni yok');
t.ok((map.get('match') || []).length > 0, '@match eksik');

t.test('Modüller kendi ad alanlarını paylaşıyor');
for (const [name, factory] of [['zip.js', 'createZipModule'], ['settings-ui.js', 'createSettingsUI'], ['page-tools.js', 'createPageTools'],
  ['network.js', 'createNetworkModule'], ['image-analysis.js', 'createImageAnalysisModule'], ['ui-results.js', 'createResultsUI']]) {
  t.includes(files[`modules/${name}`], `modules.${factory}`, `${name} kayıt`);
}
const factoryCalls = [...files['app.js'].matchAll(/ImageScraperModules\?\.(\w+)/g)].map(m => m[1]);
t.ok(factoryCalls.length >= 6, `app.js modül fabrikalarını çözemiyor: ${factoryCalls.join(', ')}`);

t.test('Modül bağımlılık sözleşmeleri: eksik bağımlılık kurulum anında bildirilir');
for (const [file, factory] of [['zip.js', 'createZipModule'], ['settings-ui.js', 'createSettingsUI'],
  ['page-tools.js', 'createPageTools'], ['network.js', 'createNetworkModule'],
  ['image-analysis.js', 'createImageAnalysisModule'], ['ui-results.js', 'createResultsUI']]) {
  const context = vm.createContext({ console, TextEncoder, TextDecoder, URL, Blob, setTimeout, clearTimeout });
  vm.runInContext(files[`modules/${file}`], context, { filename: file });
  const create = context.ImageScraperModules?.[factory];
  if (typeof create !== 'function') { t.ok(false, `${file}: ${factory} kaydı bulunamadı`); continue; }
  try {
    create({});
    t.ok(false, `${file}: eksik bağımlılıklarla modül kuruldu (geç hata riski)`);
  } catch (error) {
    // Hata mesajı hem nedeni hem eksik adları içermeli; aksi hâlde kullanıcı
    // ve geliştirici için geç bir ReferenceError'den farkı kalmaz.
    t.includes(error.message, 'eksik bağımlılık', `${file}: anlaşılır hata mesajı yok`);
    t.ok(/eksik bağımlılık: \S/.test(error.message), `${file}: eksik bağımlılık adları listelenmemiş`);
  }
}

t.test('Sözdizimsel hata kalıpları yok (kontrolsüz catch, yanlış escape)');
for (const file of scripts) {
  const src = files[file];
  const suspicious = [...src.matchAll(/'[^'\n]*\\\\n[^'\n]*'/g)].filter(m => !/\.map\(|join\(/.test(src.slice(Math.max(0, m.index - 80), m.index)));
  t.ok(suspicious.length === 0, `${file}: şüpheli çift escape ${suspicious.map(m => m[0]).join(', ')}`);
}

t.test('join çağrıları gerçek satır sonu kullanıyor');
for (const file of ['modules/ui-results.js']) {
  const bad = [...files[file].matchAll(/join\('(\\\\+n)'\)/g)].filter(m => m[1] !== '\\n');
  t.ok(bad.length === 0, `${file}: join('\\\\n') kaçış hatası: ${bad.map(m => m[0]).join(', ')}`);
}

const ok = t.summary('Statik kontroller');
process.exit(ok ? 0 : 1);
