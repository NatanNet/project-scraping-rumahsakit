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

    // Daftar domain yang wajib diabaikan
    const blacklistedDomains = [
      'kemkes.go.id', 'wikipedia.org', 'wikimedia.org', 
      'facebook.com', 'instagram.com', 'twitter.com', 'linkedin.com', 'youtube.com',
      'halodoc.com', 'alodokter.com', 'klikdokter.com', 'rumah123.com', 'sehatq.com'
    ];

    for (const name of hospitalNames) {
      console.log(`----------------------------------------`);
      console.log(`Mencari email untuk: ${name}`);
      let emailFound = 'Tidak Ditemukan';

      const searchPage = await context.newPage();

      try {
        // Step 1 & 2: Cari via Bing (Langsung Buka Query URL)
        const query = encodeURIComponent(`"Rumah Sakit" "${name}" official site`);
        await searchPage.goto(`https://www.bing.com/search?q=${query}`, { 
          waitUntil: 'domcontentloaded', 
          timeout: 25000 
        });

        // Ambil semua link dari hasil pencarian Bing
        const rawLinks = await searchPage.$$eval('#b_results h2 a', els => els.map(e => e.href)).catch(() => []);

        let targetUrl = null;

        for (let link of rawLinks) {
          let cleanUrl = link;

          // Dekode link tracking Bing jika ada
          if (link.includes('bing.com/ck/a')) {
            try {
              const urlParams = new URLSearchParams(link.split('?')[1]);
              const uParam = urlParams.get('u');
              if (uParam) {
                let base64Str = uParam.replace(/^a1/, '');
                cleanUrl = Buffer.from(base64Str, 'base64').toString('utf-8');
              }
            } catch (e) {
              cleanUrl = link;
            }
          }

          const isBlacklisted = blacklistedDomains.some(domain => cleanUrl.toLowerCase().includes(domain));
          
          if (!isBlacklisted && (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://'))) {
            targetUrl = cleanUrl;
            break; // Ambil URL valid pertama
          }
        }

        // Step 3: Klik/Buka Website Valid RS
        if (targetUrl) {
          console.log(`Membuka website resmi: ${targetUrl}`);
          const rsPage = await context.newPage();
          
          await rsPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
          await rsPage.waitForTimeout(2000);

          // Step 4: Cari Email via mailto: (Presisi 100% seperti inspect element kamu)
          const mailtoEmails = await rsPage.$$eval('a[href^="mailto:"]', links => {
            return links.map(a => a.href.replace('mailto:', '').split('?')[0].trim());
          }).catch(() => []);

          if (mailtoEmails.length > 0) {
            emailFound = mailtoEmails[0];
            console.log(`>>> EMAIL DITEMUKAN (mailto): ${emailFound}`);
          } else {
            // Coba buka halaman Contact Us jika di Homepage mailto tidak ditemukan
            const contactLink = await rsPage.$('a[href*="contact"], a[href*="kontak"], a:has-text("Contact"), a:has-text("Kontak")').catch(() => null);             if (contactLink) {               console.log('Membuka halaman kontak...');               await Promise.all([                 rsPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),                 contactLink.click().catch(() => {})               ]);                const contactMailtos = await rsPage.$$eval('a[href^="mailto:"]', links => {
                return links.map(a => a.href.replace('mailto:', '').split('?')[0].trim());
              }).catch(() => []);

              if (contactMailtos.length > 0) {
                emailFound = contactMailtos[0];
                console.log(`>>> EMAIL DITEMUKAN (mailto kontak): ${emailFound}`);
              }
            }

            // Fallback: Regex Teks di Halaman Website
            if (emailFound === 'Tidak Ditemukan') {
              const content = await rsPage.content();
              const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(?:co\.id|id|com|go\.id)/g;
              const matches = content.match(emailRegex);

              if (matches && matches.length > 0) {
                const cleanEmails = [...new Set(matches)].filter(e => 
                  !blacklistedDomains.some(b => e.includes(b)) &&
                  !e.includes('example') &&
                  !e.includes('bootstrap') &&
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