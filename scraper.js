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

    const hospitalNames = await page.$$eval('table tbody tr', rows => {
      return rows.map(row => {
        const cells = row.querySelectorAll('td');
        return cells[0] ? cells[0].innerText.trim() : null;
      }).filter(Boolean);
    });

    console.log(`Berhasil mengambil ${hospitalNames.length} nama rumah sakit.`);

    // Daftar domain yang WAJIB dibuang
    const blacklistedDomains = [
      'kemkes.go.id', 'wikipedia.org', 'wikimedia.org', 
      'facebook.com', 'instagram.com', 'twitter.com', 'linkedin.com', 'youtube.com',
      'halodoc.com', 'alodokter.com', 'klikdokter.com',
      'rumah123.com', 'sehatq.com', 'jadwalpraktek.com'
    ];

    for (const name of hospitalNames) {
      console.log(`----------------------------------------`);
      console.log(`Mencari email untuk: ${name}`);
      let emailFound = 'Tidak Ditemukan';

      const searchPage = await context.newPage();

      try {
        // Query DuckDuckGo Lite (Ringan, Cepat, Tidak Mudah Kena Bot Block)
        const query = encodeURIComponent(`"${name}" site:.id OR site:.com`);
        await searchPage.goto(`https://lite.duckduckgo.com/lite/`, { 
          waitUntil: 'domcontentloaded', 
          timeout: 20000 
        });

        // Form submit di DDG Lite
        await searchPage.type('input[name="q"]', `"${name}" official website contact email`);
        await searchPage.click('input[type="submit"]');
        await searchPage.waitForLoadState('domcontentloaded');

        // Ambil link hasil pencarian
        const links = await searchPage.$$eval('a.result-link', els => els.map(e => e.href)).catch(() => []);

        let targetUrl = null;

        for (let link of links) {
          const isBlacklisted = blacklistedDomains.some(domain => link.toLowerCase().includes(domain));
          if (!isBlacklisted && (link.startsWith('http://') || link.startsWith('https://'))) {
            targetUrl = link;
            break;
          }
        }

        if (targetUrl) {
          console.log(`Membuka website resmi: ${targetUrl}`);
          const rsPage = await context.newPage();
          
          await rsPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
          await rsPage.waitForTimeout(2000);

          // 1. Prioritas Utama: Selektor mailto:[cite: 14]
          const mailtoEmails = await rsPage.$$eval('a[href^="mailto:"]', links => {
            return links.map(a => a.href.replace('mailto:', '').split('?')[0].trim());
          }).catch(() => []);

          if (mailtoEmails.length > 0) {
            emailFound = mailtoEmails[0];
            console.log(`>>> EMAIL DITEMUKAN (mailto): ${emailFound}`);
          } else {
            // 2. Ekstraksi Teks Footer / Kontak
            const pageContent = await rsPage.content();
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(?:co\.id|id|com|go\.id)/g;
            const matches = pageContent.match(emailRegex);

            if (matches && matches.length > 0) {
              const cleanEmails = [...new Set(matches)].filter(e => 
                !blacklistedDomains.some(b => e.includes(b)) &&
                !e.includes('example') &&
                !e.includes('bootstrap') &&
                !e.includes('w3.org') &&
                !e.endsWith('.png') &&
                !e.endsWith('.jpg') &&
                !e.endsWith('.webp')
              );

              if (cleanEmails.length > 0) {
                emailFound = cleanEmails[0];
                console.log(`>>> EMAIL DITEMUKAN (Regex): ${emailFound}`);
              }
            }
          }

          await rsPage.close();
        } else {
          console.log(`Website resmi tidak ditemukan.`);
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

  // Export File Excel
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Data Rumah Sakit');

  worksheet.columns = [
    { header: 'Nama Rumah Sakit', key: 'rumahSakit', width: 40 },
    { header: 'Email', key: 'email', width: 40 }
  ];

  results.forEach(item => worksheet.addRow(item));

  await workbook.xlsx.writeFile('Hasil_Scraping_RS.xlsx');
  console.log('Proses selesai! File Hasil_Scraping_RS.xlsx berhasil diperbarui.');
})();