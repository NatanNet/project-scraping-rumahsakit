# Scraping Data Rumah Sakit

Project Node.js untuk mengambil nama rumah sakit dari SIRS Kemkes, mencari website resmi melalui Google/Bing, lalu mengambil email dan nomor telepon dari homepage atau halaman kontak yang relevan.

## Output

File JSON dan Excel berisi:

| Nama Rumah Sakit | Email | No. Telepon |
|---|---|---|

Jika data tidak ditemukan atau tidak berhasil diverifikasi, nilainya adalah `Tidak Ditemukan`. Scraper tidak membuat data berdasarkan tebakan nama atau domain.

## Teknologi

- Node.js dan CommonJS
- Playwright dengan Firefox
- ExcelJS
- SIRS Kemkes sebagai sumber nama rumah sakit
- Google dan Bing sebagai sumber pencarian website/fallback

## Struktur Project

```text
.
├── package.json
├── scraper.js                 # Scraper lama, dipertahankan
├── src/
│   ├── collect.js             # Collection nama, email, dan telepon
│   └── export.js              # Export JSON ke Excel
└── data/output/
    ├── rs-data.json
    └── Hasil_Scraping_RS.xlsx
```

## Instalasi

```bash
npm install
npx playwright install firefox
```

## Menjalankan

Ambil data dari SIRS dan website rumah sakit:

```bash
npm run scrape:collect
```

Buat file Excel dari JSON:

```bash
npm run scrape:export
```

Atau jalankan keduanya:

```bash
npm run scrape:collect && npm run scrape:export
```

## Test Satu Rumah Sakit

Test satu data pertama:

```cmd
set RS_LIMIT=1
npm run scrape:collect
```

Test berdasarkan nama:

```cmd
set RS_NAME=Charlie Hospital Demak
npm run scrape:collect
```

PowerShell:

```powershell
$env:RS_LIMIT="1"
npm run scrape:collect
```

Setelah collection selesai:

```bash
npm run scrape:export
```

## Alur Scraping

1. Mengambil nama rumah sakit dari tabel SIRS Kemkes.
2. Mencari kandidat website dengan beberapa query Google dan Bing.
3. Membuang website pihak ketiga seperti media sosial, direktori, portal berita, Wikipedia, Halodoc, dan Alodokter.
4. Memberi skor kandidat berdasarkan kemiripan nama, title/snippet, domain `.id`, `.co.id`, `.go.id`, dan indikasi `hospital`, `rumahsakit`, atau `rs`.
5. Membuka website kandidat dengan Playwright.
6. Memindai homepage dan maksimal beberapa halaman internal yang mengandung `contact`, `kontak`, `hubungi`, `tentang`, `about`, `layanan`, atau `informasi`.
7. Mengambil email serta nomor telepon dari DOM dan atribut kontak.
8. Menggunakan fallback Google/Bing jika kontak belum ditemukan.
9. Memvalidasi hasil sebelum menulis JSON dan Excel.

## Email Dan Telepon

Email diambil dari:

- Link `mailto:`.
- Teks DOM yang terlihat.
- `data-email`, `aria-label`, dan `title`.
- Halaman kontak/informasi.
- Hasil search yang dibuka dan diverifikasi kembali.

Nomor telepon diambil dari:

- Link `tel:`.
- `data-phone` dan `data-telepon`.
- `aria-label` terkait telepon.
- Teks DOM yang terlihat.
- Snippet search sebagai fallback.

Email plugin, analytics, CMS, placeholder, domain tidak relevan, serta nomor berupa CSS, koordinat, tanggal, ID, atau format tidak wajar akan ditolak.

## Format JSON

File: `data/output/rs-data.json`

```json
[
  {
    "rumahSakit": "RS Contoh",
    "email": "info@rscontoh.co.id",
    "telepon": "021 12345678"
  }
]
```

## Konfigurasi Batas

Konstanta berada di `src/collect.js`:

- `MAX_RELEVANT_PAGES`: jumlah halaman internal yang dipindai.
- `REQUEST_TIMEOUT`: timeout navigasi website, saat ini 20 detik.
- `HOSPITAL_TIMEOUT`: timeout discovery per rumah sakit, saat ini 90 detik.

Error pada satu rumah sakit tidak menghentikan proses rumah sakit berikutnya.

## Troubleshooting

Jika Firefox belum tersedia:

```bash
npx playwright install firefox
```

Jika JSON berisi hasil lama, jalankan ulang:

```bash
npm run scrape:collect
```

Banyak nilai `Tidak Ditemukan` dapat terjadi jika website tidak menyediakan kontak publik, memakai CAPTCHA/JavaScript, memblokir bot, atau informasi kontak hanya tersedia di sistem internal. Nilai tersebut lebih aman daripada menyimpan email atau nomor milik pihak ketiga.

## Catatan Penggunaan

Gunakan scraper secara wajar. Hormati ketentuan website, robots.txt, rate limit, dan kebijakan penggunaan data setiap situs. Periksa kembali data sebelum digunakan untuk komunikasi resmi atau kebutuhan produksi.
