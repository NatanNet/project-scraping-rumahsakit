const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

(async () => {
  console.log('Memulai proses scraping...');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'id-ID'
  });

  const page = await context.newPage();
  const results = [];

  try {
    console.log('Membuka website SIRS Kemkes...');
    await page.goto('https://sirs.kemkes.go.id/fo/home/dashboard_rs', { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });

    await page.waitForSelector('table', { timeout: 60000 });

    // Ekstrak nama RS
    const hospitalNames = await page.$$eval('table tbody tr', rows => {
      return rows.map(row => {
        const cells = row.querySelectorAll('td');
        return cells[0] ? cells[0].innerText.trim() : null;
      }).filter(Boolean);
    });

    console.log(`Berhasil mengambil ${hospitalNames.length} nama rumah sakit.`);

    // Regex Email yang lebih akurat
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    for (const name of hospitalNames) {
      console.log(`----------------------------------------`);
      console.log(`Mencari email untuk: ${name}`);
      let emailFound = 'Tidak Ditemukan';

      const searchPage = await context.newPage();

      try {
        // Cari URL website resmi RS via Google HTML
        const query = encodeURIComponent(`site:.id OR site:.com "${name}" email kontak`);
        await searchPage.goto(`https://html.duckduckgo.com/html/?q=${query}`, { 
          waitUntil: 'domcontentloaded', 
          timeout: 20000 
        });

        // Ambil link hasil pencarian pertama
        const links = await searchPage.$$eval('.result__url', els => els.map(e => e.href.trim()));
        let targetUrl = links.find(link => !link.includes('kemkes.go.id') && !link.includes('wikipedia.org'));

        if (targetUrl) {
          if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`;
          
          const rsPage = await context.newPage();
          console.log(`Membuka website: ${targetUrl}`);
          
          await rsPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

          // 1. Cek Email di Homepage
          let content = await rsPage.content();
          let matches = content.match(emailRegex);

          // 2. Jika tidak ada di homepage, coba cari & klik menu Kontak / Contact Us
          if (!matches || matches.length === 0) {
            const contactLink = await rsPage.$('a[href*="contact"], a[href*="kontak"], a:has-text("Contact"), a:has-text("Kontak")').catch(() => null);
            if (contactLink) {
              console.log(`Membuka halaman kontak...`);
              await Promise.all([
                rsPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
                contactLink.click().catch(() => {})
              ]);
              content = await rsPage.content();
              matches = content.match(emailRegex);
            }
          }

          // Filter email palsu / file gambar
          if (matches && matches.length > 0) {
            const cleanEmails = [...new Set(matches)].filter(e => 
              !e.endsWith('.png') && 
              !e.endsWith('.jpg') && 
              !e.endsWith('.svg') &&
              !e.includes('bootstrap') &&
              !e.includes('example') &&
              !e.includes('w3.org') &&
              !e.includes('sentry')
            );

            if (cleanEmails.length > 0) {
              emailFound = cleanEmails[0];
              console.log(`>>> EMAIL DITEMUKAN: ${emailFound}`);
            }
          }
          await rsPage.close();
        }
      } catch (err) {
        console.log(`Peringatan (${name}): ${err.message}`);
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

 // Export ke File Excel
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Data Rumah Sakit');

  worksheet.columns = [
    { header: 'Nama Rumah Sakit', key: 'rumahSakit', width: 40 },
    { header: 'Email', key: 'email', width: 40 }
  ];

  results.forEach(item => worksheet.addRow(item));

  await workbook.xlsx.writeFile('Hasil_Scraping_RS.xlsx');
  console.log('Proses selesai! File Hasil_Scraping_RS.xlsx berhasil dibuat.');
})();