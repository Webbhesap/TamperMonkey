# IMDb Watched Marker

Trakt yedeğindeki (veya elindeki herhangi bir `tt` listesindeki) başlıkları IMDb'de
**puan vermeden ve check-in kullanmadan** "izlendi" (Watched) olarak topluca işaretleyen
Tampermonkey/Violentmonkey betiği.

Neden gerekti: IMDb'de izleme geçmişini toplu yazmanın hazır yolu **check-ins**
konteyneriydi ve orası **12.000 öğeyle sınırlı** ("Watchlists, Lists, and Check-ins can
have a maximum of 12,000 items." — IMDb Lists FAQ, 9 Temmuz 2026). 14.400 öğelik bir
geçmiş oraya sığmıyor. Bu betik check-ins'i hiç kullanmaz; IMDb'nin "Mark as watched"
düğmesinin arkasındaki `addWatchedTitle` GraphQL mutation'ını senin oturumunla çalıştırır.
Watched için belgelenmiş bir öğe tavanı yok.

Ayrıntılı arka plan: [`../imdb-tasima-rehberi.md`](../imdb-tasima-rehberi.md) §5b ve §5c.

---

## Ne yapar

- **Film, dizi ve BÖLÜM** (`tt` kimliği olan her başlık) için Watched işareti koyar.
- Puan vermez, yorum yazmaz, check-in yapmaz → 12.000 tavanına takılmaz, puan
  istatistiklerin değişmez.
- Trakt ZIP'inden çıkan JSON dosyalarını, IMDb CSV dışa aktarımlarını (`Const` kolonlu)
  ve düz `tt` metnini okur; birden çok dosyayı birleştirip tekilleştirir.
- **Kuru koşu** (varsayılan açık), tek öğeyle deneme, hız sınırı, duraklat/devam,
  art arda hatada kendini durdurma, doğrulama (geri okuma), CSV/log dışa aktarımı.
- **Yakalama modu**: IMDb arayüzü/mutation'ı değişirse, düğmeye bir kez kendin
  tıklarsın; betik gerçek isteği kaydeder ve onunla toplu koşar.

## Ne yapamaz (IMDb'nin sınırı, betiğin değil)

| | |
|---|---|
| İzlenme **tarihi** yazma | **Yapamaz.** IMDb'de Watched tarihi = işaretleme anı. Trakt'taki `watched_at` değerleri kaybolur. |
| **Sezon** işaretleme | Yapamaz — IMDb'de sezon öğesi/`tt`'si yok (IMDb ürün yöneticisi de bunu doğruladı). |
| Tekrar izleme sayısı | Tutamaz — Watched bir kez işaretlenir; tekrarlar Check-ins'e gider (12.000 tavanı). |
| Toplu geri alma | Yok — her başlıkta Watched düğmesine basman gerekir; puan/yorum/check-in varsa önce onlar silinmeli (IMDb Watched FAQ). |
| İlerleme yüzdesi | Yok — IMDb eski "How much have you seen?" sayfalarını kaldırdı. |

**Özet:** tarihli izleme geçmişi için doğru kap IMDb değil. Geçmişin asıl kopyası
Trakt'ta (`history` kovası ücretsiz hesapta 100.000) veya Trakt ZIP'ini doğrudan alan
Simkl/Plex'te dursun; bu betik IMDb'yi "izledim mi?" rozetiyle eşitlemek için.

---

## Kurulum

1. Tarayıcında [Tampermonkey](https://www.tampermonkey.net/) veya Violentmonkey kurulu olsun.
2. Eklentinin paneli → **Yeni betik** → şablonu sil → `imdb-watched-marker.user.js`
   dosyasının tüm içeriğini yapıştır → kaydet (Ctrl+S).
   (Dosyayı sürükleyip tarayıcı penceresine bırakmak da çoğu kurulumda çalışır.)
3. <https://www.imdb.com/> adresini aç ve **oturumun açık olsun**. Sağ altta 👁 düğmesi
   belirir; tıklayınca panel açılır.

Betik yalnızca `https://www.imdb.com/*` üzerinde çalışır ve `@grant none` ile kuruludur:
GM yetkisi istemez, sayfa bağlamında koşar. İstekler imdb.com origin'inden gittiği için
çerezler ve CORS kendiliğinden doğru çalışır — parola, çerez veya API anahtarı istemez.

---

## Kullanım

### 1) Girdiyi hazırla

`app.trakt.tv/settings/data` → **Export now** → `trakt-export-<slug>.zip` dosyasını
indir ve **çıkar** (betik ZIP'i kendisi açmaz; çıkardığın JSON dosyalarını seçersin).

Panelde **1 · Girdi** bölümünden dosyaları seç. İşe yarayanlar:

| Dosya | Ne verir |
|---|---|
| `watched-history-*.json` | İzleme geçmişinin **bölüm düzeyine kadar** tüm `tt`'leri (asıl kaynak) |
| `watched-movies-*.json` | İzlenen filmler |
| `watched-shows-*.json` | İzlenen dizi gövdeleri |
| `ratings-movies/-shows/-episodes-*.json` | Puanladıkların (puanlar ayrıca gerekmez, ama kaynak olarak kullanılabilir) |
| `lists-list-*.json`, `lists-watchlist.json` | Taşıdığın listelerdeki öğeler |
| IMDb CSV (`ratings.csv`, liste export'u) | `Const` kolonundan `tt`'ler |

Ayrıca **yapıştırma** da olur: alt alta `tt0903747` satırları veya IMDb CSV içeriği.

Betik JSON ağacını özyinelemeli gezer; `ids.imdb` alanlarını ve `tt` desenli metinleri
toplar, türü çevresindeki anahtarlardan (`movie`/`show`/`episode`) tahmin eder.
**`imdb: null`** olan Trakt öğeleri taşınamaz — betik bunları sayıp loga yazar
(ayrıntı: rehber §5 "Kaybolan öğeleri topluca bulma").

### 2) Filtreleri seç

- **Filmler / Bölümler / Türü belirsiz**: normalde açık kalsın.
- **Diziler (gövde)**: bölüm düzeyinde geçmişin varsa bunu **kapatmanı** öneririm;
  hem gövde hem bölümler işaretlenirse IMDb'de aynı içerik iki kez işaretli görünür
  (teknik olarak hata değil, ama gereksiz). Kuyrukta ikisi birden varsa betik artık
  kendiliğinden uyarır.
- **Sezonlar / Kişiler**: IMDb'de karşılığı yok, kapalı gelir.

İki hazır ayar düğmesi var: **"Yalnız bölümler"** (film + gövde + belirsiz kapanır) ve
**"Film + gövde"** (bölümler kapanır).

### 2b) `watched-history-*.json`'dan yalnız bölümleri almak

Trakt'ın geçmiş dosyasında her kayıt **hem dizi gövdesini hem bölümü** taşır:

```json
{
  "id": 912345,
  "watched_at": "2025-10-03T20:14:11.000Z",
  "action": "scrobble",
  "type": "episode",
  "episode": { "season": 3, "number": 1, "title": "Mother!", "ids": { "trakt": 88, "imdb": "tt1190634" } },
  "show":    { "title": "Monster", "year": 2022, "ids": { "trakt": 2, "imdb": "tt13207736" } }
}
```

Betik ikisini de toplar ama **türünü bilir** (`episode` / `show` / `movie`), dolayısıyla
süzme işi filtre kutularına kalır:

**Yol 1 — betik içinde (önerilen).** Dosyaları seç → **"Yalnız bölümler"** düğmesi →
kuru koşu ile sayılara bak (log'da `bölüm N`, `bilinmeyen 0` olmalı) → koş.
Gövde `tt`'leri hiç isteğe girmez.

**Yol 2 — listeyi dosya olarak almak.** Aynı filtreyi uygula, sonra
**7 · Dışa aktar → "Kuyruk CSV"**. Eline `const,type,label` kolonlu, **yalnız
bölümlerden** oluşan bir CSV geçer. Başlık kolonu bilerek `const` (IMDb'nin kendi
biçimi): dosyayı hem bu betiğe tekrar girdi olarak yükleyebilirsin, hem IMDb Ratings
Importer'a (`const` + `your rating`) verebilirsin, hem de düz `tt` listesi olarak
saklayabilirsin.

**Yol 3 — betiksiz, dosyadan süzme.** Geçmiş dosyalarından bölüm `tt`'lerini ayıklamak
istiyorsan:

```bash
# jq (Linux/macOS/WSL): sayfalanmış tüm dosyaları birden verir
jq -r '.[] | select(.type=="episode") | .episode.ids.imdb // empty' watched-history-*.json \
  | sort -u > episodes.txt
```

```powershell
# PowerShell (Windows): her dosyayı sırayla işler, tek liste üretir
$out = foreach ($f in Get-ChildItem watched-history-*.json) {
  (Get-Content $f.FullName -Raw | ConvertFrom-Json) |
    Where-Object { $_.type -eq 'episode' -and $_.episode.ids.imdb } |
    ForEach-Object { $_.episode.ids.imdb }
}
$out | Sort-Object -Unique | Set-Content episodes.txt
"$($out.Count) ham kayıt, $(($out | Sort-Object -Unique).Count) benzersiz bölüm"
```

Çıkan `episodes.txt` dosyasını betiğin **1 · Girdi** kutusuna olduğu gibi
yapıştırabilirsin (alt alta `tt…` metnini tanır).

> Not: bazı Trakt bölümlerinde `imdb` alanı **boş** (`null`) gelir. `jq`'daki `// empty`
> ve PowerShell'deki `-and $_.episode.ids.imdb` koşulu bunları düşürür; betik de aynı
> öğeleri atlayıp sayısını loga yazar. IMDb kimliği olmayan bölüm hiçbir yolla
> işaretlenemez.

### 3) Kuru koşu + tek öğe denemesi

1. **Kuru koşu** kutusu açıkken "Koşuyu başlat" → hiçbir şey yazmadan tüm listeyi loga
   döker. Sayıları ve atlananları burada kontrol et.
2. Kuru koşuyu **kapat**, "Tek öğeyle dene" → tek bir gerçek istek atar. Logda
   başarılı mı gör, gerekirse bir **bölüm** `tt`'siyle dene (IMDb'nin bölüm düzeyini
   kendi hesabında kabul ettiğini böyle doğrularsın).

### 4) Gerçek koşu

"Koşuyu başlat" → onay penceresi → koşar. Panelde ilerleme, başarılı/hata sayacı,
kalan süre tahmini ve canlı log görünür.

- **Durdur**: geçerli öğe bitince durur; sonra **Devam et (N. öğeden)** ile sürer.
- HTTP **429/5xx** gelirse 5 → 15 → 30 sn geri çekilir, sonra duraklar.
- Art arda **5 hata** olursa kendini durdurur (hesabını zorlamamak için).
- İlerleme `localStorage`'dadır; sekme kazara kapanırsa aynı listede kaldığın yerden
  devam edebilirsin (kuyruk çok büyükse yeniden dosya seçmen istenebilir).

**Süre beklentisi:** varsayılan gecikme 650 ms + 0–250 ms rastgele pay.
14.400 öğe ≈ **3,2–4,2 saat**. Önerim: 2.000–3.000'er parça hâlinde, aralarda dinlenerek
koş (gecikmeyi 1.500–2.500 ms'e çıkarmak hız sınırı riskini düşürür, süreyi uzatır).

### 5) Doğrula

**6 · Doğrula** düğmesi Watched listeni IMDb'den geri okur (`advancedTitleSearch` +
`myWatchedConstraint`, salt okuma) ve kuyruğundaki hangi `tt`'lerin gerçekten işaretli
olduğunu sayar; eksikleri `imdb-watched-eksikler-<tarih>.txt` olarak indirir.
IMDb bu sorguyu düz query olarak kabul etmezse betik bunu söyler — o durumda
Profil → **Your watch history** sayfasındaki toplamı elle karşılaştır.

### 6) Dışa aktar

**Sonuç CSV** (tüm öğeler + durum + hata), **Başarısızlar CSV**, **Kuyruk CSV**,
**Log** (tam metin). Başarısızları düzelttikten sonra "Başarısızları yeniden dene"
yalnızca onları tekrar kuyruğa alır.

---

## Yakalama modu (mutation değişirse)

`addWatchedTitle`, IMDb'nin **resmî olmayan iç API**'sinin parçası; adı ya da imzası
değişebilir. Belirti: her öğede `PersistedQueryNotFound`, `Cannot query field ...` ya da
benzeri bir GraphQL hatası.

Çözüm betiğin içinde:

1. Panelde **5 · Yakalama modu** → "Yakalamayı başlat".
2. Herhangi bir IMDb başlık sayfasında **Watched** düğmesine bir kez bas (istersen sonra
   geri al).
3. Betik gerçek isteği kaydeder (`operationName`, `query` veya `persistedQuery` hash'i,
   değişkenler) → başlıkta "yakalandı ✓" görünür.
4. "Yakalanan isteği kullan" kutusunu işaretle ve koşuyu başlat.

Betik yalnızca **işaretleme** isteklerini kullanır; yakalanan istek bir geri alma
(`remove…`) ise onu toplu koşuda kullanmaz.

---

## Güvenlik ve dürüstlük notları

- Betik **hiçbir hesap bilgisi, çerez veya anahtar istemez/saklamaz/göndermez**. Yalnızca
  tarayıcındaki mevcut IMDb oturumunu kullanır ve yalnızca `api.graphql.imdb.com`
  adresine istek atar. Üçüncü bir sunucu yok.
- `@grant none`: GM_* yetkisi yok, ağ isteği senin sekmenin kendi `fetch`'iyle yapılır.
- Varsayılan **kuru koşu**, gerçek yazma öncesi **onay penceresi**, art arda hatada
  **kendini durdurma**, hız sınırı için **gecikme + geri çekilme**.
- Bu, IMDb'nin resmî olmayan iç API'sidir. IMDb Kullanım Koşulları ve `robots.txt`
  otomatik erişimi yazılı izne bağlar; aynı mutation'ı kullanan yayında ve MIT lisanslı
  başka betikler var (örn. `Juwan-Hwang/douban2imdb`, Greasy Fork #596763), ancak
  **kural ihlali riski ve hesabınla ilgili sonuçlar sana aittir**. IMDb'nin bu tür
  araçlara karşı bilinen tepkisi teknik (AWS WAF, hız sınırı, arayüz değişikliği);
  2026'da bu tür betikler ortalama 1–2 ayda bir kırıldı.
- Betik yalnızca **senin başlattığın** koşuda istek atar; arka planda kendiliğinden
  hiçbir şey göndermez.

## Sorun giderme

| Belirti | Ne yapmalı |
|---|---|
| `HTTP 401/403`, "unauthorized", "sign in" | IMDb oturumu kapalı ya da ek doğrulama istiyor. imdb.com'da elle giriş yap, sonra Yakalama modunu dene. |
| `HTTP 429` | Hız sınırı. Gecikmeyi 1.500–2.500 ms'e çıkar, koşuyu 2.000'er öğeye böl. |
| `PersistedQueryNotFound` / alan hatası | Mutation imzası değişmiş → Yakalama modu. |
| "tt kimliği bulunamadı" | Girdi `tt` içermiyor; dosya yanlış ya da Trakt'ta `imdb: null` (log'daki atlanan sayılarına bak). |
| Öğeler listede ama Watched'da yok | IMDb bölüm `tt`'lerini kabul etmiyor olabilir → tek öğe testiyle dene; gerekirse dizi gövdesiyle yetin. |
| Doğrulama sorgusu çalışmadı | IMDb `advancedTitleSearch`'ü düz query ile kabul etmiyor; Profil → Your watch history toplamına bak. |
| Panel hiç görünmedi | Betik yalnızca `https://www.imdb.com/*` üzerinde çalışır; eklentinin "izin verilen siteler" ayarına bak. |
| Koşu sekme kapanınca kesildi | İlerleme kayıtlı; aynı listeyi aç, "Devam et" düğmesini kullan. |

## Geliştirme

```bash
cd Trakt1000/imdb-watched-marker
node --check imdb-watched-marker.user.js   # sözdizimi
node --test tests/parse.test.mjs           # 19 test: ayrıştırıcı, filtreler, CSV/ETA/hata yardımcıları
```

Ayrıştırıcının DOM/ağ kullanmayan kısmı betikte `/* __PURE_START__ */ … /* __PURE_END__ */`
işaretçileri arasında durur; test dosyası bu bloğu kesip Node içinde çalıştırır. Yani
arayüz kodu değişse bile testler geçerli kalır, arayüz değişmeden ayrıştırıcı da
test edilmiş olur. Bağımlılık yok (`node_modules` gerekmez), Node ≥ 20.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `imdb-watched-marker.user.js` | Betiğin kendisi (tek dosya, bağımlılıksız) |
| `README.md` | Bu dosya |
| `package.json` | `npm test` / `npm run check` kısayolları |
| `tests/parse.test.mjs` | Saf ayrıştırıcı testleri (node:test) |
