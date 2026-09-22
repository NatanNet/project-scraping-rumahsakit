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
        // Query Bing yang sangat spesifik ke Wilayah Indonesia
        const query = encodeURIComponent(`"Rumah Sakit" "${name}" site:.id OR site:.com contact email`);
        await searchPage.goto(`https://www.bing.com/search?q=${query}`, { 
          waitUntil: 'domcontentloaded', 
          timeout: 20000 
        });

        const rawLinks = await searchPage.$$eval('#b_results h2 a', els => els.map(e => e.href)).catch(() => []);

        let targetUrl = null;

        for (let link of rawLinks) {
          let cleanUrl = link;

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

          // Filter domain pengganggu / media sosial / direktori
          const isIgnored = [
            'kemkes.go.id', 'wikipedia.org', 'wikimedia.org', 
            'facebook.com', 'instagram.com', 'twitter.com', 
            'linkedin.com', 'youtube.com', 'halodoc.com', 'alodokter.com',
            'att.com', 'adobe.com', 'golflens.io', 'velezsarsfield'
          ].some(domain => cleanUrl.toLowerCase().includes(domain));

          if (!isIgnored && (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://'))) {
            targetUrl = cleanUrl;
            break;
          }
        }

        if (targetUrl) {
          console.log(`Membuka website resmi: ${targetUrl}`);
          const rsPage = await context.newPage();
          
          await rsPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
          await rsPage.waitForTimeout(2000);

          // METODE 1: Tag <a href="mailto:...">
          const mailtoEmails = await rsPage.$$eval('a[href^="mailto:"]', links => {
            return links.map(a => a.href.replace('mailto:', '').split('?')[0].trim());
          }).catch(() => []);

          if (mailtoEmails.length > 0) {
            emailFound = mailtoEmails[0];
            console.log(`>>> EMAIL DITEMUKAN (mailto): ${emailFound}`);
          } else {
            // METODE 2: MANIPULASI DOM TEKS (Mencari khusus di elemen Footer / Paragraph)
            const domTexts = await rsPage.$$eval('footer, p, span, div', els => 
              els.map(el => el.innerText).filter(t => t && t.includes('@'))
            ).catch(() => []);

            const fullText = domTexts.join(' ');
            
            // Regex Email yang Sangat Ketat (Memfilter file .webp, .png, dan domain asing/system)
            const strictEmailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(?:co\.id|id|com|go\.id|org|net)/g;
            const matches = fullText.match(strictEmailRegex);

            if (matches && matches.length > 0) {
              const cleanEmails = [...new Set(matches)].filter(e => 
                !e.includes('adobe') &&
                !e.includes('example') &&
                !e.includes('bootstrap') &&
                !e.includes('w3.org') &&
                !e.includes('sentry') &&
                !e.includes('schema') &&
                !e.endsWith('.webp') &&
                !e.endsWith('.png')
              );

              if (cleanEmails.length > 0) {
                emailFound = cleanEmails[0];
                console.log(`>>> EMAIL DITEMUKAN (DOM Text): ${emailFound}`);
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