const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

(async () => {
  // UBAH BARIS INI:
// const browser = await chromium.launch({ headless: false });

// MENJADI INI:
const browser = await chromium.launch({ headless: true });// set true jika tidak ingin membuka browser secara visual
  const page = await browser.newPage();

  // 1. Buka Website Dashboard SIRS Kemkes
  await page.goto('https://sirs.kemkes.go.id/fo/home/dashboard_rs');
  await page.waitForSelector('table');

  // 2. Ekstrak nama-nama Rumah Sakit dari DOM Tabel
  const hospitalList = await page.$$eval('table tbody tr', rows => {
    return rows.map(row => {
      const cells = row.querySelectorAll('td');
      return cells[0] ? cells[0].innerText.trim() : null;
    }).filter(name => name !== null);
  });

  console.log(`Ditemukan ${hospitalList.length} rumah sakit.`);

  const results = [];

  // 3. Loop setiap RS untuk mencari email via Google/DuckDuckGo
  for (const rsName of hospitalList) {
    console.log(`Mencari email untuk: ${rsName}`);
    let emailFound = 'Tidak Ditemukan';

    try {
      // Pindah ke Google untuk mencari website resmi
      const searchPage = await browser.newPage();
      await searchPage.goto('https://www.google.com');
      await searchPage.fill('textarea[name="q"]', `${rsName} official website contact`);
      await searchPage.keyboard.press('Enter');
      await searchPage.waitForSelector('#search');

      // Ambil URL hasil pencarian pertama
      const firstResultLink = await searchPage.$eval('#search a', el => el.href);
      await searchPage.close();

      if (firstResultLink) {
        // Buka website resmi RS
        const rsPage = await browser.newPage();
        await rsPage.goto(firstResultLink, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        
        // Ambil isi teks seluruh halaman web untuk dicari emailnya pakai Regex
        const pageContent = await rsPage.content();
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const matches = pageContent.match(emailRegex);

        if (matches && matches.length > 0) {
          // Filtering sederhana untuk menghindari email aset/image seperti .png/.jpg jika ada
          const validEmails = matches.filter(e => !e.endsWith('.png') && !e.endsWith('.jpg'));
          if (validEmails.length > 0) {
            emailFound = validEmails[0];
          }
        }
        await rsPage.close();
      }
    } catch (err) {
      console.log(`Gagal memproses ${rsName}: ${err.message}`);
    }

    results.push({ rumahSakit: rsName, email: emailFound });
  }

  await browser.close();

  // 4. Export Hasil ke File Excel
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Data RS');

  worksheet.columns = [
    { header: 'Nama Rumah Sakit', key: 'rumahSakit', width: 35 },
    { header: 'Email', key: 'email', width: 35 }
  ];

  results.forEach(data => worksheet.addRow(data));

  await workbook.xlsx.writeFile('Hasil_Email_RS.xlsx');
  console.log('Proses selesai! File Hasil_Email_RS.xlsx berhasil dibuat.');
})();