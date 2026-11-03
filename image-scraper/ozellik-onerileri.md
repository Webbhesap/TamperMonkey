# Image Scraper — geliştirme ve yeni özellik önerileri

**Kapsam:** Bu dosyada henüz uygulanmamış, değerlendirmeye açık fikirler bulunur. Tamamlanan özellikler `tamamlanmis-ozellikler.md` dosyasındadır. Öneriler mevcut ayarları ve özellikleri tekrar etmemek için gözden geçirilmiştir.

## Geliştirilebilir Özellikler

- **Kategori ve içerik sayfalarının sınırlarını daha görünür kıl:** Kategori sayfası sayısını, bulunan farklı içerik bağlantılarını ve her içerikte gezilen alt sayfaları ayrı sayaçlarla göster; URL’lerdeki `/page/2` gibi içerik sayfalarının yeni makale sayılmadığını denetle.
- **Derin tarama için güvenli devam kaydı:** Kategori keşfi, içerik kuyruğu ve her makalenin alt sayfa konumunu ayrı kaydet; kesinti sonrası tamamlanan içeriği yeniden taramadan sıradaki içerikten devam ettir.
- **Otomatik içerik bağlantısı bulmayı iyileştir:** Bağlantıları içerik kartları/başlıkları içinden önceliklendir, sayfalama ve navigasyon alanlarını dışla; bulunan aday sayısı ve seçilen seçiciyi önizlemede açıkça göster.
- **Makale sayfalandırmasında içerik sınırı:** Sonraki sayfanın aynı makaleye ait olduğunu doğrula; kategori, başka makale, etiket veya “tüm sayfalar” bağlantısına sapmayı engelle. İçerik başına sınır dolunca yalnız o makalenin kuyruğunu durdur.

- **ZIP işleminin durumunu ve takılmayı görünür kıl — yüksek öncelik:** İndirme, tekilleştirme, arşiv üretimi ve indirme bağlantısının hazırlanmasını ayrı aşamalar olarak göster. Uzun işlemde gerçek ilerleme/son etkinlik bilgisini sun; üretim ilerlemezse kullanıcıya iptal ve yeniden deneme yolu göster. ZIP çıktısının neden beklediğini anlamayı kolaylaştırır.
- **ZIP çıktısı için isteğe bağlı bütünlük kontrolü — yüksek öncelik:** Arşiv tamamlandığında dosya sayısı/boyut ve ZIP başlıklarını kontrol et; doğrulama başarısızsa başarılı indirme mesajı verme. Büyük arşivlerde ek bellek maliyeti olabileceğinden varsayılanı kapalı tut.
- **Yalnızca başarısız görselleri yeniden dene — orta öncelik:** Başarılı görselleri bellekteki/önbellekteki kopyalarından kullanıp hatalıları tekrar indir. Hata türüne göre sınırlı tekrar, `Retry-After`, sunucu başına bekleme ve iptal desteğini koru.
- **Oturum başına kullanıcı ayarlı toplam kaynak sınırı — orta öncelik:** Mevcut adaptif eşzamanlılığa ek olarak toplam indirilen bayt veya görsel adedi için isteğe bağlı üst sınır belirle; sınıra yaklaşınca uyar ve durdurma/seçerek devam seçenekleri sun.
- **Tarayıcı ve Tampermonkey uyumluluk matrisi — yüksek öncelik:** File System Access, Fullscreen, `createImageBitmap`, GM istekleri ve yerel `@require` davranışını Chromium/Firefox ve desteklenen Tampermonkey sürümlerinde ayrı ayrı test edip destek durumunu göster.
- **Arayüz erişilebilirlik kontrolü — orta öncelik:** Sekmeler, galeride seçim, slayt gösterisi ve modal için odak halkası, ekran okuyucu metni, klavye dolaşımı ve yüksek kontrastı düzenli doğrula.
- **Büyük oturumlarda arayüz performans ölçümü — orta öncelik:** Sanallaştırılmış galeri, sonuç güncelleme ve oturum kaydetme işlemlerini binlerce görselde ölç; uzun ana iş parçacığı görevlerini azalt ve ölçümleri regresyon testine bağla.
- **Tampermonkey modüllerinin bağımlılık sözleşmeleri — orta öncelik:** Modüllerin beklediği işlevleri başlangıçta doğrula; eksik bağlamı geç bir kullanıcı etkileşiminde `ReferenceError` olarak değil, hangi modül/bağımlılığın eksik olduğunu belirten erken bir hata olarak bildir.

## Yeni Özellikler

- **Hiyerarşik kategori → içerik → sayfa önizlemesi:** Taramadan önce bulunan kategori sayfalarını, her kategorideki makaleleri ve makale alt sayfalarını ağaç görünümünde listele; makale veya tek tek sayfa seçimi, toplu seçim ve içerik başına sayfa sınırı sun.
- **Konu bazlı tarama ve koleksiyon:** İçerik başlığını otomatik konu olarak kullanıp konu başına görsel sayısını göster; kullanıcı seçtiği konuları tara, dışarıda bırak veya ayrı koleksiyon/ZIP olarak dışa aktarabilsin.
- **İçerik kartı seçici yardımcısı:** Sayfadaki olası makale kartlarını işaretleyerek göster; kullanıcı örnek bir kart/başlık seçsin ve betik önerilen CSS seçicisini oluştursun.
- **Makale tarama özeti:** Her içerik için ana URL, konu başlığı, taranan alt sayfa adedi, benzersiz görsel ve atlanan tekrar sayılarını tek raporda sun; başarısız makaleleri tek tek yeniden dene.

- **Benzer görselleri ZIP öncesi gözden geçirme:** Algısal benzerlik gruplarını yan yana göster; kullanıcı grup içinden tutulacak görselleri seçebilsin. Otomatik silme varsayılan olmasın.
- **ZIP’e kaynak manifesti ekleme:** Kullanıcı isterse arşive `manifest.json` koy; dosya adı, kaynak URL, kaynak sayfa, ölçüler ve varsa içerik hash’ini listele. URL’lerde hassas/imzalı parametre bulunabileceğini açıkça uyar.
- **ZIP içi klasörleme:** Dosyaları tek klasörde toplamak yerine kaynak sayfaya, alan adına veya kullanıcının ad şablonuna göre klasörle. Güvenli ve çakışmasız dosya adlandırmasını koru.
- **Kaynak sayfaya göre hızlı filtre ve seçim:** Görselleri tarandıkları sayfaya göre grupla; tek bir sayfanın görsellerini seç, dışarıda bırak veya ayrı ZIP yap.
- **Yan yana görsel karşılaştırıcı:** İki görseli eş zamanlı yakınlaştırma ve kaydırmayla karşılaştır; özellikle benzer görsel gruplarındaki en iyi kopyayı seçmeye yardımcı olur.
- **Kaydedilebilir iş akışı profilleri:** Site profillerinden ayrı olarak genel “hızlı tarama”, “düşük bellek” veya “yüksek çözünürlük” gibi adlandırılmış ayar kombinasyonları oluşturup tek tıkla uygula.
- **Kalıcı favoriler ve koleksiyonlar:** Kullanıcı görselleri oturumlar arasında favorileyebilsin veya adlandırılmış koleksiyonlara ekleyebilsin; depolama ve gizlilik etkisi açıkça gösterilsin.
- **Dosya adı şablonu önizlemesi:** Örnek URL/sayfa/ölçüyle şablonun üreteceği adı kaydetmeden önce göster; geçersiz karakterleri, tekrar eden adları ve olası çakışmaları belirt.
- **İsteğe bağlı format dönüştürme:** Desteklenen tarayıcılarda seçilen görselleri ZIP’e eklemeden önce JPEG/PNG/WebP biçimine dönüştürme ve kalite ayarı sun. Orijinal dosyaları koruma seçeneği bulunsun; dönüşüm tarayıcıda yerel yapılsın.
- **Toplu seçim kısayolları:** Aralık seçimi, yalnızca mevcut sayfa, alan adı veya dosya türüne göre tümünü seç/kaldır gibi işlemler ekle; işlem öncesi etkilenecek görsel sayısını bildir.
