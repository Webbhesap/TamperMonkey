# TamperMonkey — Image Scraper Alternative

Bir web sayfasındaki (ve isteğe bağlı olarak sonraki sayfalardaki) görselleri toplayan,
filtreleyen ve ZIP olarak indiren bir userscript. Chrome + Firefox üzerinde
**Tampermonkey** ve **Violentmonkey** ile çalışır.

```
image-scraper/
├── tampermonkey-loader.user.js       ← kuracağın dosya (normal kullanım)
├── tampermonkey-loader.dev.user.js   ← geliştirme: JS önbelleğini atlar
├── app.js                            ← uygulama çekirdeği
├── modules/                          ← ağ, ZIP, ayarlar, galeri, sayfalama modülleri
├── panel.html / styles.css           ← arayüz (Shadow DOM içinde)
├── lib/                              ← Alpine.js + JSZip (gömülü)
├── eslint.config.mjs
└── tests/                            ← statik + tarayıcı + loader testleri
```

## Kurulum

1. **Tampermonkey** (Chrome/Firefox) veya **Violentmonkey** eklentisini kur.
2. Loader dosyasını aç:
   https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/tampermonkey-loader.user.js
3. Eklenti bu adresi görünce kurulum ekranı gösterir → **Kur / Yükle**.
   (Alternatif: eklentinin panelinden "Yeni betik" → dosyanın içeriğini yapıştır → Kaydet.)
4. Herhangi bir sayfayı yenile. Sağ altta **🖼️ Resimleri Topla** düğmesi görünür.

> Loader `@match *://*/*` ile çalışır; istemediğin sitelerde paneli
> **Ayarlar → Hariç tutulan siteler** bölümünden kapatabilirsin.

## Güncelleme

| Ne değişti | Ne yapmalı |
|---|---|
| `panel.html`, `styles.css` | Hiçbir şey. Loader bu iki dosyayı **her sayfa açılışında** `?_=zaman` ile yeniden çeker. |
| `app.js` veya `modules/*.js` | Loader'daki **`@version` artırılmalı**, sonra betik güncellenmeli. |

### Neden sürüm artırmak gerekiyor?

Tampermonkey `@require` ile listelenen dosyaları **betiğin `@version` değerine göre**
önbelleğe alır. Sürüm aynı kaldığı sürece eklenti elindeki kopyayı kullanır; depodaki
JS değişikliği sayfaya ulaşmaz. `@version` artırıldığında eklenti dosyaları yeniden indirir.
`panel.html` ve `styles.css` `@resource` olarak tanımlıdır ve loader bunları ayrıca ağdan
tazelediği için sürüm artırmadan güncellenebilir.

Sürümü elle artırmak istemiyorsan **geliştirme loader'ını** kullan:
`tampermonkey-loader.dev.user.js` hiç `@require` içermez, dokuz JS dosyasını her açılışta
indirir. Bedeli: sayfa başına birkaç ek istek. Günlük kullanım için kararlı loader'ı tercih et.

### Ağ erişimi

Loader yalnızca `raw.githubusercontent.com` ile konuşur (`@connect` bununla sınırlıdır).
GitHub'a erişilemezse `@resource` ile paketlenmiş panel/CSS kopyası devreye girer, yani
panel çevrimdışıyken de açılır (JS'in tamamı `@require` ile geldiği için zaten yereldir).

## Kullanım

- **Resimleri Topla** → tarama ayarlarına göre sayfayı (ve varsa sonraki sayfaları) tarar.
- **Ayarlar** → sayfalama, boyut filtresi, ZIP adlandırma/parçalama, içerik tekilleştirme,
  derin tarama (kategori → içerik), site profilleri, hariç tutulan siteler, yedekleme.
- **Sonuçlar** → sanallaştırılmış galeri, filtre çekmecesi, slayt gösterisi, TXT/CSV/JSON
  dışa aktarma, anonim tanılama raporu, ZIP (parçalı indirme veya klasöre akış).

Siteye özel ayar kaydetmek için Ayarlar → **Bu siteye kaydet**. Profil varsa düğme
**Genel ayarlara kaydet** olur ve o site profili yalnızca bu sitede geçerli kalır.

## Geliştirme ve test

```bash
cd image-scraper
npm install
npm test                 # statik + loader + tarayıcı testleri (sırayla)
npm run test:static      # yalnız statik denetimler (tarayıcı gerekmez)
npm run test:loader      # loader'ı gerçek dosyayla, GitHub taklit edilerek dener
npm run test:browser     # gerçek Chromium + yerel test sunucusu
npm run lint             # ESLint
npm test -- ZIP          # yalnız adı "ZIP" içeren tarayıcı/loader testleri
```

Tarayıcı testleri Puppeteer ile paketlenmiş Chromium'u kullanır. Farklı bir tarayıcı
kullanmak için: `CHROME_PATH=/yol/chrome npm run test:browser`.

Tarayıcı ve loader testleri **internet gerektirmez**: yerel bir test sunucusu ve
`GM_xmlhttpRequest` taklidi kullanılır.

### Test kapsamı

| Paket | Ne denetler |
|---|---|
| `run-static.mjs` | Sözdizimi, userscript metadata sözleşmesi (`file://` yok, https adresler, `@require` sırası), `panel.html` şablon/denetim/eylem eşleşmesi, CSS sınıf kapsamı, kaçış hataları |
| `run-loader.mjs` | Loader metadata'sı, panel/CSS tazeleme, `@resource` yedeği, hariç tutulan site, yeniden enjeksiyon, geliştirme loader'ı |
| `run-browser.mjs` | Gerçek Chromium'da tarama, sayfalama, seçiciler, derin tarama, kuyruk önizleme, ZIP, oturum, ağ hataları/challenge, yedekleme, slayt gösterisi |

## Mimari notları

- **Shadow DOM**: panel sayfanın CSS'inden ve yinelenen id'lerden yalıtılır.
  `styles.css` bu yüzden sayfanın `body`'sine ait hiçbir kural içermez.
- **Modüller**: `modules/*.js` bir `ImageScraperModules` ad alanına fabrika fonksiyonu
  kaydeder; `app.js` bunları sırayla çözer. `@require` sırası bu bağımlılığı taşır;
  loader'daki sırayı değiştirme.
- **Varsayılanlar güvenli tarafta**: `STREAM_ZIP_TO_DISK`, `SAVE_SCAN_PROGRESS`,
  `DEDUPE_CONTENT`, `GROUP_VISUAL_SIMILARITY`, `DEEP_CRAWL` kapalı gelir; bellek/disk
  maliyeti yüksek özellikleri kullanıcı bilerek açar.
- **Ağ**: aynı kaynakta `fetch`, ardından `GM_xmlhttpRequest` yedeği; yeniden deneme
  yalnızca 403/404/ağ/429/5xx için ve `Retry-After` dikkate alınarak yapılır.
  Cloudflare doğrulaması çözülmeye çalışılmaz; kullanıcıya sayfayı açma bağlantısı verilir.
- **Bağlantı güvenliği**: sonuçlardaki adresler `http:`/`https:` ile sınırlanır
  (`javascript:`/`data:` adresleri bağlantıya dönüşmez).

## Lisans

`lib/` altındaki Alpine.js ve JSZip kendi lisanslarını taşır
(`LICENSE-alpine.md`, `LICENSE-jszip.markdown`).
