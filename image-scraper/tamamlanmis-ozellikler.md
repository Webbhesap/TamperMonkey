# Image Scraper — tamamlanan özellikler ve düzeltmeler

Bu dosya **yapılmış işlerin kaydıdır**. Yapılacaklar için
[`ozellik-onerileri.md`](ozellik-onerileri.md) dosyasına bakın.

Bir öneri uygulandığında `ozellik-onerileri.md`'den çıkarılıp buraya tarihiyle
eklenir. Amaç: hangi işin bittiğini tek bakışta görmek.

---

## 2026-11-03 — ZIP paketleme, iş akışı profilleri ve kaynak sınırı

### ZIP içi klasörleme
- **Yeni ayar `ZIP_FOLDERS`:** `none` (düz), `host` (kaynak alan adı) veya
  `page` (kaynak sayfa yolu).
- Klasör adı `safeFolder()` ile üretilir: yol ayırıcıları ve denetim
  karakterleri temizlenir, `..` gibi kaçışlar atılır, Windows ayrılmış adları
  (CON/PRN/…) ön ek alır, toplam uzunluk 120 karakterle sınırlanır. Klasör
  arşivin dışına yazmaz.
- **Ad çakışması tam yol üzerinden çözülür:** `zipEntryName(..., folder)`
  artık klasör parametresi alır; farklı klasörlerdeki aynı dosya adları
  korunur, aynı klasörde `_2` sonekiyle tekilleştirilir.
- Ölçüm (Chromium): `ZIP_FOLDERS=host` → `127.0.0.1_44793/001_red-400x300.png`;
  `page` → `127.0.0.1_44793/001_…` (sayfa yolu kök olduğu için yalnız alan adı).
  Klasör adındaki `:` karakteri `_` olur (ZIP güvenliği).

### Kaynak manifesti (`manifest.json`)
- **Yeni ayar `ZIP_MANIFEST`** (varsayılan kapalı). Arşive kökte
  `manifest.json` eklenir: oluşturma zamanı, kaynak, kaynak sayfa, parça
  numarası, uygulanan ad şablonu / klasörleme / parça sınırları, hata sayısı ve
  her dosya için `{sira, dosya, url, kaynak_sayfa, genislik, yukseklik,
  boyut_bayt, tur, sha256}`.
- **Bölünmüş arşivlerde her parça kendi manifestini taşır**, böylece parça
  başına içindekiler listesi doğrudur.
- Gizlilik: URL'ler imzalı/hassas parametre içerebilir; ayarın yardım
  balonunda açıkça uyarılır ve varsayılan kapalıdır.

### Kaynak sınırı (oturum başına)
- **Yeni ayarlar `MAX_IMAGES` ve `MAX_TOTAL_MB`** (0 = sınırsız).
- ZIP ön kontrolünde sınır ve aşım durumu görünür ("⚠ seçim sınırı aşıyor").
- Sınır aşılırsa **ZIP başlamaz**: “⛔ Kaynak sınırı aşıldı: 7 görsel seçili,
  sınır 3. Seçimi azaltın … veya Ayarlar → Tarama bölümündeki sınırı artırın.”
- İndirme sırasında bilinmeyen boyutlar yüzünden sınır aşılırsa işlem
  durdurulur ve kalan seçimle yeniden denenebilir.

### İş akışı profilleri
- **Genel sekmesinde yeni bölüm.** Üç hazır profil: **Hızlı tarama**,
  **Düşük bellek**, **Yüksek çözünürlük** — tarama + görsel + ZIP ayarlarını
  birlikte uygular.
- Kullanıcı, kayıtlı ayarlarını adlandırıp kendi profilini kaydedebilir
  (`isp_workflows_v1`); hazır profiller silinemez, hazır adlar kullanılamaz.
- Uygulama anında `saveConfig` çalışır, form alanları tek bir eşlemeden
  (`configToControls` + `syncControls`) yenilenir; böylece ekran ile ayarlar
  ayrışmaz. Etkin site profili varsa değerlerin ezilebileceği yazılır.

### Modül bağımlılık sözleşmeleri
- Altı modül fabrikası (zip, settings-ui, page-tools, network, image-analysis,
  ui-results) kurulum anında zorunlu bağımlılıklarını doğrular:
  `"<Modül> modülü için eksik bağımlılık: a, b"`.
- Statik test, her fabrikayı boş bir `vm` bağlamında `{}` ile çağırıp anlaşılır
  hata ve eksik ad listesi üretmesini doğrular. Geç `ReferenceError` yerine
  başlangıç hatası.

### Doğrulama
- Statik **48/48** · Loader **56/56** · Tarayıcı **229/229** · ESLint temiz.
- Yeni tarayıcı testleri: `İş akışı profilleri` (16 kontur — liste, seçimsiz
  uygulama, uygulama sonrası config + form, kaydet, hazır ad koruması, hazır
  profil silme koruması, kullanıcı profilini silme), `ZIP klasörleme`
  (15 kontur — host/page klasörleri, manifest alanları ve sayaçları, sınır
  aşımında işlemin başlamaması).

---

## 2026-11-03 — Filtre çekmecesi yenilendi (görünüm ayarları dâhil)

### Çekmece yapısı
- **Başlıklı bölümler:** Çekmece eşit ağırlıklı, etiketsiz `toolbar`
  satırlarından oluşuyordu; yer tutucu metin kaybolunca hangi alanın ne
  olduğu anlaşılmıyordu. Artık beş bölüm var: **Ara**, **Filtreler**,
  **Görünüm**, **Toplu seçim**, **İşlemler**. Her bölümün kendi başlığı,
  kısa açıklaması ve kart görünümü var; her kontrolün kalıcı etiketi var.
- **Canlı sayaç:** Başlıkta `5 / 7 görsel · 2 etkin filtre` gösterilir;
  filtre değiştikçe ve rozet kaldırıldıkça anında güncellenir.
- **Etkin filtre rozetleri:** Açık olan her filtre (arama, tür, içerik, konu,
  min/max ölçü, oran, boyut bilgisi, dosya boyutu, yalnız seçili) başlıkta
  rozet olarak listelenir; rozete tıklamak o filtreyi tek hamlede kaldırır.
  Rozetler başlıkta durduğu için çekmece kaydırılsa da görünür kalır.
- **Tek tıkla sıfırlama:** `↺ Filtreleri sıfırla` tüm filtreleri ve toplu
  seçim kutularını temizler; görünüm tercihlerine (sütun, açıklama) dokunmaz.
- **`Sonuçları gör` düğmesi:** Çekmeceyi kapatır. ZIP sekmesindeki birincil
  düğmeyle karışmaması için ayrı `drawer-apply` sınıfı kullanılır.
- **`/` kısayolu:** Çekmece içindeyken arama alanına odaklanır; `Escape`
  kapatır, odak tuzağı ve `aria-modal` korunur.

### Görünüm ayarları (yeni)
- **Resim altı açıklamalarını gizle:** Dosya adı, ölçü, tür ve durum satırı
  kapatılabilir; küçük resim kartın tamamını doldurur. Kart yüksekliği sabit
  kaldığı için galeri sanallaştırması etkilenmez (320px kart / 318px resim).
- **Izgara sütun sayısı:** `Otomatik` veya 1–6 sütun. Izgara şablonu JS'te
  hesaplanan sütun sayısıyla birebir aynı yazılır, böylece sanallaştırmanın
  satır hesabı CSS ile ayrışmaz; kartlar 120px'in altına sıkıştırılmaz.
- **Küçük resim görünümü:** `Tamamı görünsün (sığdır)` / `Kartı doldur (kırp)`.
- **Yalnız seçili görselleri göster:** Filtre gibi davranır, rozet olarak
  görünür ve tek tıkla kaldırılır.
- **Sıralamayı ters çevir:** Sayfa/URL/boyut sıralaması tersine döner.
- **Kalıcı tercihler:** Açıklama, sütun, kırpma, yalnız seçili, ters sıra ve
  önizleme tercihleri `isp_view_prefs_v1` altında saklanır.

### Testler
- Yeni `Filtre çekmecesi` tarayıcı testi (39 kontur): bölüm başlıkları,
  etiketsiz alan kalmaması, canlı sayaç, açıklama gizleme (meta gizli + resim
  kartı doldurur + tercih saklanır), sütun sayısı (4 → 4 iz, 2 → 2 iz, satırda
  2 kart, taşma yok), kırpma görünümü, rozet ekleme/kaldırma, sıfırlama,
  yalnız seçili filtresi ve kalıcılık.
- Toplam: statik 36/36, loader 56/56, tarayıcı **198/198**, ESLint temiz.

---

## 2026-11-03 — Arayüz yenilemesi ve ZIP görünürlüğü

### Tasarım ve kullanım kolaylığı
- **Tasarım belirteçleri (`--isp-*`):** Ölçek, renk, yarıçap ve dokunma
  hedefi tek yerden yönetiliyor (`styles.css` `:host`).
- **Ayarlar sekmesi şeridi:** 7 sekme tek satırda 926px yer kaplıyor, 820px
  altında 2–3 satıra kırılıyordu. Artık sabit yükseklikte, yatay
  kaydırılabilir, `scroll-snap` destekli şerit; her genişlikte **1 satır**
  (480px'de 3 → 1).
- **Sabit yükseklikte ayarlar diyaloğu:** Arama/sekme geçişinde içerik
  uzayınca diyalog büyüyor (`clientHeight 642 → 702`), aşağı kayıp başlık
  ekrandan çıkıyordu. Artık yükseklik sabit (`min(88dvh, 900px)`); yalnızca
  gövde kayar, başlık ve sekme şeridi yerinde kalır.
- **Ayar arama:** 30+ ayarı sekme sekme gezmek yerine yazarak bulma.
  - İlgili sekmeye atlar, eşleşen satırı vurgular, eşleşmeyenleri
    soluklaştırır (gizlemez — ayarın bağlamı korunur).
  - Türkçe karakter katlama: `sablon` → `şablon` bulunur.
  - `Escape` ve `×` ile temizlenir; sonuç sayısı `aria-live` ile bildirilir.
- **Dokunma hedefleri:** Onay kutusu 19 → 22px, form kontrolleri 38px,
  yardım balonu 16 → 20px. Yardım balonu artık `:active` ile dokunmatikte de
  açılıyor (önceden yalnızca `:hover`/`:focus-visible`) ve ekran kenarından
  taşmıyor.
- **Sonuç ekranı, dar ekran:** 800px'de başlık altı satıra sarıp metrik
  kartlarının altına giriyor, "Seçili görsel" etiketi kesiliyordu.
  1000px altında başlık kendi satırını alır, metrikler altında akar,
  kapatma düğmesi köşeye sabitlenir.
- **Küçük ekran düzenleri:** 640px ve 520px kırılımları; galeri 150px
  kolonlara iner, kart yüksekliği 280px, etiket/kontrol hizalaması düzeltilir.
- **Erişilebilirlik tercihleri:** `prefers-reduced-motion` (animasyonlar
  kapanır) ve `prefers-contrast: more` (kenarlık ve metin kontrastı artar).
- **Filtre çekmecesi onay kutusu:** "Önizlemeleri yükle" onay kutusu, eski
  `.filter-drawer-body .toolbar input{width:100%}` kuralına takılıp mor bir
  bar gibi tüm genişliği kaplıyordu. Onay kutuları artık içeriğe göre
  boyutlanır (22px).
- **Denenip geri alınan:** Sabit (sticky) ayarlar altbilgisi. 480px'de
  ekranın ~%22'sini kaplayıp alttaki ayarları örtüyordu; normal akışa
  döndürüldü (gerekçe kodda yorum olarak duruyor).

### ZIP görünürlüğü (öneri listesinden tamamlandı)
- **ZIP aşama göstergesi:** Tek satırlık "🗜️ ZIP 1/1 · 0% · 15.5 MB" mesajı
  işlemin nerede olduğunu göstermiyordu. Artık beş rozet:
  `İndirme → Benzerlik analizi → Tekilleştirme → Arşiv oluşturma → Hazır`.
  Geçmiş aşamalar ✓, etkin aşama ● (nabız animasyonu).
- **Takılma tespiti:** 20 sn ilerleme gelmezse hangi adımda takıldığı, geçen
  süre ve olası neden (bellek baskısı, parça sınırı önerisi) yazılır;
  "İptal" ve "ZIP'i yeniden dene" sunulur. İlerleme gelince sayaç sıfırlanır.
- **Yalnızca başarısızları yeniden dene:** Hatalı görseller biriktirilir;
  yeniden denemede yalnızca onlar indirilir, başarılılar önbellekten gelir.
  Tüm arşivi yeniden indirmek büyük oturumlarda dakikalar sürüyordu.

- **Toplu seçim kısayolları:** Filtre çekmecesinde sayfa / alan adı / formata
  göre hedefli seçim. "Tümünü seç" yerine üç ayrı seçici; her seçenekte
  eşleşen görsel sayısı yazar (ör. "`/basic/` (7)"). İki eylem: "Aralığı
  seç / kaldır" (değiştir) ve "Seçime ekle" (yalnızca ekle). Seçim yapılmadan
  tıklanırsa yönlendirme mesajı çıkar. Seçenekler `render()` içinde tazelenir
  ve kullanıcı seçimi korunur.
- **Dosya adı şablonu önizlemesi:** Şablonun üreteceği ad, kaydetmeden önce
  örnek veriyle gösterilir (`{sira}` = 001, `{sayfa}` = 1, `{orijinal_ad}` =
  ornek-gorsel, `{boyut}` = 1200x800). Uyarılan durumlar: bilinmeyen
  değişken, geçersiz karakter, Windows ayrılmış adı (CON/PRN/…) ve
  `{orijinal_ad}` yokluğu (ad çakışması riski). Renk kodu: ok = yeşil,
  warn = amber. Adlandırma kuralları `zip.js` ile aynıdır.
- **ZIP bütünlük kontrolü (isteğe bağlı):** Arşiv üretildikten sonra dosya
  sayısı ve ZIP merkezi dizini (EOCD) doğrulanır; bozuksa "başarılı" mesajı
  verilmez, açık hata çıkar. Bellek maliyeti nedeniyle varsayılan **kapalı**
  (`VERIFY_ZIP`). Doğrulayıcı gerçek/kesik/çöp arşivi ayırt ediyor:
  kesik → "EOCD bulunamadı", yanlış sayı → "dosya sayısı uyuşmuyor".

### Doğrulama
Gerçek Chromium'da ölçüldü; sonuçlar regresyon testlerine bağlandı.
- Statik 36/36 · Loader 56/56 · Tarayıcı 159/159 · ESLint temiz.
- Takılma senaryosu (görsel `fetch` hiç çözülmez): 23 sn'de
  "⬇️ İndirme adımı 23 sn'dir ilerlemiyor…" + yeniden dene düğmesi.
- Sekme satırı sayısı: 1280/1024/820/480px → hepsi **1 satır**.

---

## 2026-11-03 — `@connect` regresyonu ve galeri düzeni

- **`@connect` daraltma regresyonu (ürünü bozan hata):** `@connect` yalnızca
  `raw.githubusercontent.com`'a daraltılmıştı; herhangi bir alan adından gelen
  görseller "This domain is not a part of the @connect list" ile reddediliyor,
  ZIP adımında tüm görseller "GM ağ hatası" veriyordu. `@connect *` geri
  eklendi, gerekçesi belgelendi ve **testle kilitlendi**.
- **Anlaşılır ağ hatası:** `onerror` artık host adını ve olası `@connect`
  nedenini yazıyor (URL'nin tamamı değil; imzalı parametreler günlüğe düşmesin).
- **Galeri altındaki boş şerit:** `calc(100dvh - 430px)` paneli 70px taşırıyor,
  altında kullanılmayan boşluk bırakıyordu. Galeri kalan alanı dolduruyor.
- **Filtre düğmesi konumu:** "☷ Görselleri filtrele ve seç" galerinin üstündeki
  ayrı araç çubuğundan çıkıp sekme çubuğunun sağına taşındı; `.gallery-tools-bar`
  kaldırıldı.
- **Sekmelerin ilk durumu:** `activateTab` yalnızca tıklamaya bağlıydı, ilk
  durum hiç uygulanmıyordu. Erken çağrı ise TDZ `ReferenceError` ile tüm sonuç
  panelini öldürüyordu; çağrı bağımlılıklar hazır olduktan sonra yapılıyor.

---

## 2026-11-03 — Loader'ın GitHub'a taşınması, hata düzeltmeleri, test altyapısı

- **Loader GitHub raw URL'lerine taşındı:** 9 `@require` + `appHtml`/`appCss`
  `@resource`, `?_=` önbellek kırıcı. Eski loader `file:///C:/Users/...`
  yollarına bağlıydı ve başka makinede çalışmıyordu.
- **Geliştirme loader'ı:** Her açılışta dosyaları tazeler (`@require`
  önbelleği yok). Kararlı loader'ın yanında ikinci bir kullanıcı betiği.
- **`@require` önbelleği belgelendi:** Tampermonkey `@require` dosyalarını
  `@version` başına önbelleğe alır; sürüm artmazsa değişiklik yüklenmez.
- **Düzeltilen hatalar:**
  - HTML/CSS her açılışta tazelenir, ağ hatasında `@resource` yedeğine düşer.
  - Yerelleştirilmiş Cloudflare doğrulama sayfaları tanınır (yalnızca İngilizce
    başlığa bakmak boş sonuç üretiyordu).
  - `Retry-After` başlığı `NaN` üretebiliyordu.
  - `javascript:` şemalı `href` enjeksiyonu engellendi.
  - `kind()` beklenmeyen girdide çöküyordu (guard eklendi).
  - Sabit kodlanmış `scriptVersion` gerçek sürümü gösteriyor.
  - 8 eksik CSS sınıfı tanımlandı.
  - Ürünün sayfaya sızdırdığı `body{}` kuralı kaldırıldı.
  - Ayarlar sekmesi açılışında yarış koşulu.
  - Boş "Gizlilik" bölümü dolduruldu.
  - Derin tarama ve `downloadImage` içinde `new URL` çökmesi.
- **Test altyapısı:** `tests/` (statik + loader + gerçek Chromium tarayıcı
  testleri), `npm test`, `npm run lint`, ESLint yapılandırması. Test sitesi
  5.200 görselli ve büyük sayfalı senaryoları içerir.
- **Performans ölçümü:** 5.200 görselde tarama 79–99 ms; sanallaştırma DOM'u
  60 kartın altında tutuyor. O(n²) iyileştirme denemesi ölçüldü ve **fayda
  sağlamadığı için geri alındı** (basit kod korundu).

### Hâlâ doğrulanmamış
- **Firefox:** Kod yalnızca standart API'ler kullanıyor ve
  `createImageBitmap`/`showDirectoryPicker` yokluğunda geri düşüyor, ancak
  canlı Firefox doğrulaması yapılmadı (ortamda yalnızca Chromium var).
- **Ekran okuyucu:** Otomatik erişilebilirlik ağacı testi yok.
