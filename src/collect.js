const fs = require('node:fs');
const path = require('node:path');
const { firefox } = require('playwright');

const OUTPUT_DIR = path.join(__dirname, '../data/output');
const JSON_FILE = path.join(OUTPUT_DIR, 'rs-data.json');

async function scrapeHospitals() {
  console.log('[1/2] Memulai browser Firefox...');
  const browser = await firefox.launch({ headless: true });

  const results = [];

  try {
    const mainContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
      locale: 'id-ID'
    });
    const page = await mainContext.newPage();

    console.log('[2/2] Membuka SIRS Kemkes...');
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
    await mainContext.close().catch(() => {});

    const blacklistedDomains = [
      'kemkes.go.id', 'wikipedia.org', 'wikimedia.org', 
      'facebook.com', 'instagram.com', 'twitter.com', 'linkedin.com', 'youtube.com',
      'halodoc.com', 'alodokter.com', 'klikdokter.com', 'sehatq.com',
      'pinhome.id', 'rumah123.com', 'lamudi.co.id', 'brighton.co.id', 'olx.co.id',
      'google.com', 'play.google.com', 'apple.com', 'duckduckgo.com',
      'symbolsdb.com', 'altius.id', 'agility.co.id', 'jadwalpraktek.com'
    ];

    for (const name of hospitalNames) {
      console.log(`----------------------------------------`);
      console.log(`Mencari email untuk: ${name}`);
      let emailFound = 'Tidak Ditemukan';
      let targetUrl = null;

      if (!browser.isConnected()) break;

      const rsContext = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
        locale: 'id-ID'
      });
      const searchPage = await rsContext.newPage();

      try {
        // Query spesifik dengan petik dua agar persis
        const cleanName = name.replace(/Rumah Sakit|RS/gi, '').trim();
        const query = encodeURIComponent(`"Rumah Sakit" "${cleanName}" official website contact email`);
        await searchPage.goto(`https://www.bing.com/search?q=${query}&mkt=id-ID`, { 
          waitUntil: 'domcontentloaded', 
          timeout: 20000 
        });

        const rawLinks = await searchPage.$$eval('#b_results .b_algo h2 a', els => els.map(e => e.href)).catch(() => []);

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

          const isBlacklisted = blacklistedDomains.some(d => cleanUrl.toLowerCase().includes(d));
          
          // FILTER KETAT: Memastikan URL mengandung indikasi RS / Hospital atau bagian nama RS
          const isHospitalRelated = /rs|hospital|sehat|medika|health|kasih|shita|charitas|mayapada/i.test(cleanUrl) || 
                                    cleanUrl.toLowerCase().includes(cleanName.toLowerCase().replace(/\s+/g, ''));

          if (!isBlacklisted && isHospitalRelated && (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://'))) {
            targetUrl = cleanUrl;
            break;
          }
        }

        if (targetUrl) {
          console.log(`Membuka website resmi: ${targetUrl}`);
          const rsPage = await rsContext.newPage();
          
          try {
            await rsPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            await rsPage.waitForTimeout(2000);

            // 1. Ekstrak mailto:
            const mailtoEmails = await rsPage.$$eval('a[href^="mailto:"]', links => {
              return links.map(a => a.href.replace('mailto:', '').split('?')[0].trim());
            }).catch(() => []);

            if (mailtoEmails.length > 0) {
              emailFound = mailtoEmails[0];
              console.log(`>>> EMAIL DITEMUKAN (mailto): ${emailFound}`);
            } else {
              // 2. Scan Regex Teks
              const content = await rsPage.content();
              const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(?:co\.id|id|com|go\.id)/g;
              const matches = content.match(emailRegex);

              if (matches && matches.length > 0) {
                const cleanEmails = [...new Set(matches)].filter(e => 
                  !blacklistedDomains.some(b => e.includes(b)) &&
                  !e.includes('example') && !e.includes('bootstrap') && !e.includes('w3.org') &&
                  !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.webp')
                );
                if (cleanEmails.length > 0) {
                  emailFound = cleanEmails[0];
                  console.log(`>>> EMAIL DITEMUKAN (Regex): ${emailFound}`);
                }
              }
            }
          } catch (rsErr) {
            console.log(`Akses web ${targetUrl} dibatasi/timeout.`);
          }
        } else {
          console.log(`Website resmi tidak ditemukan di pencarian.`);
        }
      } catch (err) {
        console.log(`Peringatan (${name}): ${err.message}`);
      } finally {
        await rsContext.close().catch(() => {});
      }

      results.push({ rumahSakit: name, email: emailFound });
    }

  } finally {
    if (browser.isConnected()) {
      await browser.close().catch(() => {});
    }
  }

  // Simpan JSON
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_FILE, JSON.stringify(results, null, 2));
  console.log(`\nProses selesai! Data JSON tersimpan di: ${JSON_FILE}`);
}

scrapeHospitals().catch(err => {
  console.error(err.message);
  process.exit(1);
});