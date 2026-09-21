const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

(async () => {
  console.log('Memulai proses scraping...');
  
  // Menjalankan Chromium dalam mode headless
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });

  // Gunakan User-Agent seperti browser asli
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  const results = [];

  try {
    console.log('Membuka website SIRS Kemkes...');
    
    // 1. Akses SIRS Kemkes dengan domcontentloaded & timeout 60 detik
    await page.goto('https://sirs.kemkes.go.id/fo/home/dashboard_rs', { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });

    console.log('Menunggu tabel dimuat...');
    await page.waitForSelector('table', { timeout: 60000 });

    // 2. Ekstrak Nama Rumah Sakit dari Tabel
    const hospitalNames = await page.$$eval('table tbody tr', rows => {
      return rows.map(row => {
        const cells = row.querySelectorAll('td');
        return cells[0] ? cells[0].innerText.trim() : null;
      }).filter(Boolean);
    });

    console.log(`Berhasil mengambil ${hospitalNames.length} nama rumah sakit.`);

    // 3. Loop pencarian email untuk setiap RS
    for (const name of hospitalNames) {
      console.log(`Sedang mencari email untuk: ${name}`);
      let emailFound = 'Tidak Ditemukan';

      const searchPage = await context.newPage();

      try {
        const query = encodeURIComponent(`${name} official contact email`);
        await searchPage.goto(`https://html.duckduckgo.com/html/?q=${query}`, { 
          waitUntil: 'domcontentloaded', 
          timeout: 20000 
        });

        const targetUrl = await searchPage.$eval('.result__url', el => el.href.trim()).catch(() => null);

        if (targetUrl) {
          const fullUrl = targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`;
          const rsPage = await context.newPage();
          
          await rsPage.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          
          const content = await rsPage.content();
          const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
          const matches = content.match(emailRegex);

          if (matches && matches.length > 0) {
            const filteredEmails = matches.filter(e => 
              !e.endsWith('.png') && 
              !e.endsWith('.jpg') && 
              !e.endsWith('.svg') &&
              !e.includes('bootstrap') &&
              !e.includes('example.com')
            );
            if (filteredEmails.length > 0) {
              emailFound = filteredEmails[0];
            }
          }
          await rsPage.close();
        }
      } catch (err) {
        console.log(`Peringatan saat memproses ${name}: ${err.message}`);
      } finally {
        await searchPage.close();
      }

      results.push({ rumahSakit: name, email: emailFound });
    }

  } catch (error) {
    console.error('Error Utama:', error.message);
  } finally {
    await browser.close();
  }

  // 4. Export Ke File Excel
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Data Rumah Sakit');

  worksheet.columns = [
    { header: 'Nama Rumah Sakit', key: 'rumahSakit', width: 35 },
    { header: 'Email', key: 'email', width: 35 }
  ];

  results.forEach(item => worksheet.addRow(item));

  await workbook.xlsx.writeFile('Hasil_Scraping_RS.xlsx');
  console.log('Proses selesai! File "Hasil_Scraping_RS.xlsx" berhasil dibuat.');
})();