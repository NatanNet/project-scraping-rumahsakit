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

    for (const name of hospitalNames) {
      console.log(`----------------------------------------`);
      console.log(`Mencari email untuk: ${name}`);
      let emailFound = 'Tidak Ditemukan';

      const searchPage = await context.newPage();

      try {
        // Gunakan Bing Search untuk akurasi tinggi tanpa pemblokiran anti-bot
        const query = encodeURIComponent(`"${name}" site:.id OR site:.com contact email`);
        await searchPage.goto(`https://www.bing.com/search?q=${query}`, { 
          waitUntil: 'domcontentloaded', 
          timeout: 25000 
        });

        // Ambil link hasil pencarian teratas
        const links = await searchPage.$$eval('#b_results h2 a', els => els.map(e => e.href));
        let targetUrl = links.find(link => 
          !link.includes('kemkes.go.id') && 
          !link.includes('wikipedia.org') && 
          !link.includes('facebook.com') &&
          !link.includes('instagram.com')
        );

        if (targetUrl) {
          console.log(`Membuka website: ${targetUrl}`);
          const rsPage = await context.newPage();
          
          await rsPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

          // TEKNIK 1: Ambil langsung dari tag mailto:[cite: 14]
          const mailtoEmails = await rsPage.$$eval('a[href^="mailto:"]', links => {
            return links.map(a => a.href.replace('mailto:', '').split('?')[0].trim());
          }).catch(() => []);

          if (mailtoEmails.length > 0) {
            emailFound = mailtoEmails[0];
            console.log(`>>> EMAIL DITEMUKAN (mailto): ${emailFound}`);
          } else {
            // TEKNIK 2: Cek halaman Kontak
            const contactLink = await rsPage.$('a[href*="contact"], a[href*="kontak"], a:has-text("Contact"), a:has-text("Kontak")').catch(() => null);             if (contactLink) {               console.log('Membuka halaman kontak...');               await Promise.all([                 rsPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),                 contactLink.click().catch(() => {})               ]);                const contactMailtos = await rsPage.$$eval('a[href^="mailto:"]', links => {
                return links.map(a => a.href.replace('mailto:', '').split('?')[0].trim());
              }).catch(() => []);

              if (contactMailtos.length > 0) {
                emailFound = contactMailtos[0];
                console.log(`>>> EMAIL DITEMUKAN (mailto kontak): ${emailFound}`);
              }
            }

            // TEKNIK 3: Scanning Regex Teks
            if (emailFound === 'Tidak Ditemukan') {
              const content = await rsPage.content();
              const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
              const matches = content.match(emailRegex);

              if (matches && matches.length > 0) {
                const cleanEmails = [...new Set(matches)].filter(e => 
                  !e.endsWith('.png') && 
                  !e.endsWith('.jpg') && 
                  !e.endsWith('.svg') &&
                  !e.includes('example') &&
                  !e.includes('bootstrap') &&
                  !e.includes('w3.org')
                );
                if (cleanEmails.length > 0) {
                  emailFound = cleanEmails[0];
                  console.log(`>>> EMAIL DITEMUKAN (Regex): ${emailFound}`);
                }
              }
            }
          }

          await rsPage.close();
        } else {
          console.log(`Website resmi tidak ditemukan di pencarian Bing.`);
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
  console.log('Proses selesai! File Hasil_Scraping_RS.xlsx berhasil dibuat.');
})();