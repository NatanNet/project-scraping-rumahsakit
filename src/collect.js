const fs = require('node:fs');
const path = require('node:path');
const { firefox } = require('playwright');

const OUTPUT_DIR = path.join(__dirname, '../data/output');
const JSON_FILE = path.join(OUTPUT_DIR, 'rs-data.json');
const MAX_RELEVANT_PAGES = 5;
const REQUEST_TIMEOUT = 20000;
const HOSPITAL_TIMEOUT = 90000;

const BLACKLISTED_DOMAINS = [
  'kemkes.go.id', 'wikipedia.org', 'wikimedia.org', 'facebook.com',
  'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'youtube.com',
  'halodoc.com', 'alodokter.com', 'klikdokter.com', 'sehatq.com',
  'google.com', 'bing.com', 'duckduckgo.com', 'jadwalpraktek.com',
  'direktori', 'portal', 'blogspot.com', 'wordpress.com'
];

const IRRELEVANT_EMAIL_DOMAINS = [
  'example.com', 'example.org', 'wordpress.org', 'w3.org', 'bootstrapcdn.com',
  'gravatar.com', 'sentry.io', 'google-analytics.com', 'careers360.com',
  'bookwidgets.com', 'zhihu.com', 'crash2.zhihu.com'
];

const CONTACT_WORDS = /contact|kontak|contact-us|hubungi|hubungi-kami|tentang|tentang-kami|about|about-us|layanan|informasi|customer.?service/i;

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function nameTokens(name) {
  return normalizeText(name)
    .replace(/\brs\b|\brumah sakit\b|\bhospital\b/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3);
}

function isBlacklistedUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return BLACKLISTED_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch (_) {
    return true;
  }
}

function getRootUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/`;
  } catch (_) {
    return null;
  }
}

function scoreWebsite(url, name, title = '') {
  let score = 0;
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  const normalizedHost = normalizeText(hostname.replace(/^www\./, ''));
  const normalizedName = normalizeText(name);
  const tokens = nameTokens(name);

  if (isBlacklistedUrl(url)) return -1000;
  if (/\.(co\.id|go\.id|ac\.id|or\.id|id)$/.test(hostname)) score += 18;
  if (hostname.includes('hospital') || hostname.includes('rumahsakit') || hostname.includes('rs')) score += 8;
  if (normalizedName && normalizedHost.includes(normalizedName.replace(/ /g, ''))) score += 28;
  score += tokens.filter(token => normalizedHost.includes(token)).length * 7;
  score += tokens.filter(token => normalizeText(title).includes(token)).length * 5;
  if (CONTACT_WORDS.test(parsed.pathname)) score -= 4;
  if (parsed.pathname.split('/').filter(Boolean).length > 2) score -= 3;
  return score;
}

function extractEmails(html) {
  const candidates = new Set();
  const emailRegex = /[a-z0-9.!#$%&'*+?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
  for (const match of String(html || '').match(emailRegex) || []) {
    candidates.add(match.replace(/^mailto:/i, '').replace(/[),.;:'"]+$/g, '').toLowerCase());
  }
  return [...candidates].filter(validateEmail);
}

function validateEmail(email) {
  if (!/^[a-z0-9.!#$%&'*+?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(email)) return false;
  const lower = email.toLowerCase();
  const [localPart, domain] = lower.split('@');
  if (IRRELEVANT_EMAIL_DOMAINS.some(item => domain === item || domain.endsWith(`.${item}`))) return false;
  if (/example|noreply|no-reply|donotreply|test|sample|dummy|your.?email|email.?address/.test(localPart)) return false;
  if (/^(you|user|username|name|email|someone|hello)$/.test(localPart)) return false;
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(domain)) return false;
  return true;
}

function normalizePhone(phone) {
  const value = String(phone || '').replace(/\s+/g, ' ').trim();
  if (value.includes('.')) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('62')) {
    if (digits.length < 10 || digits.length > 14) return null;
    if (!/^62[2-8]/.test(digits)) return null;
  } else if (digits.startsWith('0')) {
    if (digits.length < 9 || digits.length > 13 || digits.startsWith('00')) return null;
    if (!/^0[2-8]/.test(digits)) return null;
  } else {
    return null;
  }
  if (/^(\d)\1+$/.test(digits)) return null;
  return value;
}

function extractPhones(html) {
  const candidates = new Set();
  const text = String(html || '')
    .replace(/\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b/g, ' ')
    .replace(/\b\d{4}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,2}\b/g, ' ');
  const phoneRegex = /(?:\+62|62|0)(?:[\s()-]*\d){8,12}/g;
  for (const match of text.match(phoneRegex) || []) {
    const phone = normalizePhone(match);
    if (phone && !/\d{4}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,2}/.test(phone)) candidates.add(phone);
  }
  return [...candidates];
}

function scoreEmail(email, { hospitalName, website, source, sourceUrl }) {
  const [localPart, domain] = email.toLowerCase().split('@');
  const tokens = nameTokens(hospitalName);
  const websiteDomain = new URL(website).hostname.replace(/^www\./, '').toLowerCase();
  let score = 0;

  if (source === 'contact-page') score += 35;
  else if (source === 'homepage') score += 25;
  else if (source === 'search-engine') score += 8;
  if (domain === websiteDomain || domain.endsWith(`.${websiteDomain}`)) score += 30;
  if (tokens.some(token => localPart.includes(token) || domain.includes(token))) score += 18;
  if (/^(info|contact|kontak|cs|admin|humas|marketing|customer.?service|office|sekretariat)$/.test(localPart)) score += 12;
  if (sourceUrl && isBlacklistedUrl(sourceUrl)) score -= 100;
  return score;
}

async function extractPageEmails(page, hospitalName, website, source) {
  const pageUrl = page.url();
  const visibleText = await page.locator('body').innerText().catch(() => '');
  const emailValues = await page.$$eval('a[href^="mailto:"], [data-email], [aria-label*="@"], [title*="@"]', elements => elements.flatMap(element => [
    element.getAttribute('href') || '',
    element.getAttribute('data-email') || '',
    element.getAttribute('aria-label') || '',
    element.getAttribute('title') || '',
    element.textContent || ''
  ])).catch(() => []);
  const emails = new Set([...extractEmails(visibleText), ...emailValues.flatMap(extractEmails)]);
  return [...emails].map(email => ({
    email,
    source,
    sourceUrl: pageUrl,
    score: scoreEmail(email, { hospitalName, website, source, sourceUrl: pageUrl })
  }));
}

async function extractPagePhones(page) {
  const visibleText = await page.locator('body').innerText().catch(() => '');
  const domValues = await page.$$eval('a[href^="tel:"], [data-phone], [data-telepon], [aria-label*="tel" i], [aria-label*="phone" i]', elements => elements.flatMap(element => [
    element.getAttribute('href') || '',
    element.getAttribute('data-phone') || '',
    element.getAttribute('data-telepon') || '',
    element.getAttribute('aria-label') || '',
    element.textContent || ''
  ])).catch(() => []);
  return [...new Set([...domValues.flatMap(extractPhones), ...extractPhones(visibleText)])];
}

async function findContactPages(page, website) {
  const rootUrl = getRootUrl(website);
  if (!rootUrl) return [];
  const links = await page.$$eval('a[href]', anchors => anchors.map(anchor => ({
    href: anchor.href,
    text: anchor.innerText || anchor.getAttribute('aria-label') || anchor.getAttribute('title') || ''
  }))).catch(() => []);
  return [...new Map(links
    .filter(link => link.href.startsWith(rootUrl) && CONTACT_WORDS.test(`${link.href} ${link.text}`))
    .map(link => [link.href.split('#')[0], link.href.split('#')[0]])).values()]
    .slice(0, MAX_RELEVANT_PAGES - 1);
}

async function findOfficialWebsite(searchPage, name) {
  const cleanName = name.replace(/Rumah Sakit|RS/gi, '').trim();
  const queryTexts = [
    `"${name}" official website`,
    `"${name}" rumah sakit`,
    `"${cleanName}" hospital contact`
  ];
  const candidates = [];
  console.log(`[SEARCH START] ${name}`);
  for (const queryText of queryTexts) {
    const query = encodeURIComponent(queryText);
    try {
      await searchPage.goto(`https://www.google.com/search?gbv=1&hl=id&q=${query}`, {
        waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT
      });
      await searchPage.waitForSelector('a[href]', { timeout: 5000 }).catch(() => {});
      await searchPage.waitForTimeout(500);
      candidates.push(...await extractSearchCandidates(searchPage));
      await searchPage.goto(`https://www.bing.com/search?q=${query}&mkt=id-ID`, {
        waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT
      });
      candidates.push(...await extractSearchCandidates(searchPage));
    } catch (error) {
      console.log(`[SEARCH ERROR] ${queryText}: ${error.message}`);
    }
  }
  const uniqueCandidates = [...new Map(candidates.map(candidate => [candidate.url, candidate])).values()];
  console.log(`[SEARCH] ${name}: ${uniqueCandidates.length} kandidat`);
  return uniqueCandidates
    .filter(candidate => candidate.url && /^https?:\/\//i.test(candidate.url) && !isBlacklistedUrl(candidate.url))
    .map(candidate => ({ ...candidate, score: scoreWebsite(candidate.url, cleanName, `${candidate.title} ${candidate.snippet}`) }))
    .sort((left, right) => right.score - left.score)[0] || null;
}

async function extractSearchCandidates(page) {
  const links = await page.$$eval('a[href]', anchors => anchors.map(anchor => {
    const href = anchor.href || anchor.getAttribute('href') || '';
    const container = anchor.closest('div, li') || anchor;
    return {
      href,
      title: anchor.querySelector('h3')?.innerText || anchor.innerText || '',
      snippet: container.innerText || ''
    };
  })).catch(() => []);

  return links.map(candidate => {
    let url = candidate.href;
    try {
      const parsed = new URL(url, page.url());
      if (parsed.pathname === '/url' && parsed.searchParams.get('q')) {
        url = parsed.searchParams.get('q');
      } else if (parsed.hostname.endsWith('bing.com') && parsed.pathname.includes('/ck/a')) {
        const encodedUrl = parsed.searchParams.get('u');
        if (encodedUrl) {
          const base64Url = encodedUrl.replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/');
          url = Buffer.from(base64Url, 'base64').toString('utf8');
        }
      }
    } catch (_) {
      return null;
    }
    return { url, title: candidate.title, snippet: candidate.snippet };
  }).filter(candidate => candidate && /^https?:\/\//i.test(candidate.url) && !isBlacklistedUrl(candidate.url));
}

async function findEmailFallback(searchPage, hospitalName, website) {
  const queries = [
    `"${hospitalName}" email`, `"${hospitalName}" contact`, `"${hospitalName}" "@"`,
    `"${hospitalName}" mail`, `"${hospitalName}" mailto`
  ];
  const candidates = [];
  for (const queryText of queries) {
    await searchPage.goto(`https://www.google.com/search?gbv=1&q=${encodeURIComponent(queryText)}&hl=id`, {
      waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT
    }).catch(() => {});
    let results = await extractSearchCandidates(searchPage);
    if (!results.length) {
      await searchPage.goto(`https://www.bing.com/search?q=${encodeURIComponent(queryText)}&mkt=id-ID`, {
        waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT
      }).catch(() => {});
      results = await extractSearchCandidates(searchPage);
    }
    for (const result of results) {
      if (!normalizeText(result.snippet).includes(normalizeText(hospitalName))) continue;
      const sourcePage = await searchPage.context().newPage();
      try {
        await sourcePage.goto(result.url, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT });
        const pageText = await sourcePage.locator('body').innerText().catch(() => '');
        if (!normalizeText(pageText).includes(normalizeText(hospitalName))) continue;
        for (const email of extractEmails(pageText)) {
          candidates.push({
            email,
            source: 'search-engine',
            sourceUrl: result.url,
            score: scoreEmail(email, {
              hospitalName,
              website,
              source: 'search-engine',
              sourceUrl: result.url
            })
          });
        }
      } catch (_) {
        // Hasil search yang tidak dapat diverifikasi tidak dipakai.
      } finally {
        await sourcePage.close().catch(() => {});
      }
    }
  }
  return candidates.sort((left, right) => right.score - left.score)[0] || null;
}

async function findPhoneFallback(searchPage, hospitalName) {
  const queries = [
    `"${hospitalName}" telepon`,
    `"${hospitalName}" phone`,
    `"${hospitalName}" contact`
  ];
  for (const queryText of queries) {
    try {
      await searchPage.goto(`https://www.google.com/search?gbv=1&q=${encodeURIComponent(queryText)}&hl=id`, {
        waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT
      });
      let results = await extractSearchCandidates(searchPage);
      if (!results.length) {
        await searchPage.goto(`https://www.bing.com/search?q=${encodeURIComponent(queryText)}&mkt=id-ID`, {
          waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT
        });
        results = await extractSearchCandidates(searchPage);
      }
      for (const result of results) {
        if (isBlacklistedUrl(result.url)) continue;
        if (!normalizeText(result.snippet).includes(normalizeText(hospitalName))) continue;
        const phone = extractPhones(result.snippet)[0];
        if (phone) return phone;
      }
    } catch (_) {
      // Search fallback boleh gagal tanpa menghentikan rumah sakit berikutnya.
    }
  }
  return null;
}

async function discoverEmail(rsContext, hospitalName, website) {
  const page = await rsContext.newPage();
  const candidates = [];
  try {
    await page.goto(website, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT });
    await page.waitForTimeout(1000);
    candidates.push(...await extractPageEmails(page, hospitalName, website, 'homepage'));
    const contactPages = await findContactPages(page, website);
    for (const contactUrl of contactPages) {
      const contactPage = await rsContext.newPage();
      try {
        await contactPage.goto(contactUrl, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT });
        candidates.push(...await extractPageEmails(contactPage, hospitalName, website, 'contact-page'));
        console.log(`[CONTACT] Menemukan halaman kontak: ${contactUrl}`);
      } catch (_) {
        // Halaman individual boleh gagal tanpa menghentikan rumah sakit berikutnya.
      } finally {
        await contactPage.close().catch(() => {});
      }
    }
    const bestOfficial = candidates.sort((left, right) => right.score - left.score)[0];
    if (bestOfficial) return bestOfficial;
    console.log('[FALLBACK] Mencari melalui search engine');
    return await findEmailFallback(page, hospitalName, website);
  } finally {
    await page.close().catch(() => {});
  }
}

async function discoverContactInfo(rsContext, hospitalName, website) {
  const page = await rsContext.newPage();
  const emailCandidates = [];
  const phoneCandidates = [];
  try {
    await page.goto(website, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT });
    await page.waitForTimeout(1000);
    emailCandidates.push(...await extractPageEmails(page, hospitalName, website, 'homepage'));
    phoneCandidates.push(...await extractPagePhones(page));
    const contactPages = await findContactPages(page, website);
    for (const contactUrl of contactPages) {
      const contactPage = await rsContext.newPage();
      try {
        await contactPage.goto(contactUrl, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT });
        emailCandidates.push(...await extractPageEmails(contactPage, hospitalName, website, 'contact-page'));
        phoneCandidates.push(...await extractPagePhones(contactPage));
        console.log(`[CONTACT] ${contactUrl}`);
      } catch (error) {
        console.log(`[CONTACT ERROR] ${contactUrl}: ${error.message}`);
      } finally {
        await contactPage.close().catch(() => {});
      }
    }
    const bestEmail = emailCandidates.sort((left, right) => right.score - left.score)[0];
    const fallbackEmail = bestEmail || await findEmailFallback(page, hospitalName, website);
    const fallbackPhone = phoneCandidates[0] || await findPhoneFallback(page, hospitalName);
    return {
      email: fallbackEmail?.email || 'Tidak Ditemukan',
      phone: fallbackPhone || 'Tidak Ditemukan'
    };
  } finally {
    await page.close().catch(() => {});
  }
}

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

    await page.waitForSelector('table', { timeout: 60000 }).catch(async error => {
      const title = await page.title().catch(() => '');
      throw new Error(`Tabel SIRS tidak ditemukan (${title}): ${error.message}`);
    });

    const hospitalNames = await page.$$eval('table tbody tr', rows => {
      return rows.map(row => {
        const cells = row.querySelectorAll('td');
        return cells[0] ? cells[0].innerText.trim() : null;
      }).filter(Boolean);
    });

    console.log(`Berhasil mengambil ${hospitalNames.length} nama rumah sakit.`);
    await mainContext.close().catch(() => {});

    const selectedHospitalNames = process.env.RS_NAME
      ? hospitalNames.filter(name => normalizeText(name).includes(normalizeText(process.env.RS_NAME)))
      : hospitalNames.slice(0, Number(process.env.RS_LIMIT) || hospitalNames.length);

    for (const name of selectedHospitalNames) {
      console.log(`----------------------------------------`);
      console.log(`[RS] ${name}`);
      let discovery = {
        email: 'Tidak Ditemukan',
        phone: 'Tidak Ditemukan'
      };

      if (!browser.isConnected()) break;

      console.log('[BROWSER] Membuat context pencarian');
      const rsContext = await Promise.race([
        browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
          locale: 'id-ID'
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout membuat context setelah ${HOSPITAL_TIMEOUT} ms`)), HOSPITAL_TIMEOUT))
      ]);
      const searchPage = await Promise.race([
        rsContext.newPage(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout membuat halaman setelah ${HOSPITAL_TIMEOUT} ms`)), HOSPITAL_TIMEOUT))
      ]);
      console.log('[BROWSER] Halaman pencarian siap');

      try {
        const websiteCandidate = await Promise.race([
          findOfficialWebsite(searchPage, name),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout pencarian ${HOSPITAL_TIMEOUT} ms`)), HOSPITAL_TIMEOUT))
        ]);
        if (!websiteCandidate) {
          console.log('[WEBSITE] Tidak ditemukan kandidat resmi');
        } else {
          const website = getRootUrl(websiteCandidate.url) || websiteCandidate.url;
          console.log(`[WEBSITE] ${website} (skor ${websiteCandidate.score})`);
          const contactInfo = await discoverContactInfo(rsContext, name, website);
          discovery.email = contactInfo.email;
          discovery.phone = contactInfo.phone;
          console.log(`[EMAIL] ${discovery.email}`);
          console.log(`[TELEPON] ${discovery.phone}`);
        }
      } catch (err) {
        console.log(`Peringatan (${name}): ${err.message}`);
      } finally {
        await rsContext.close().catch(() => {});
      }

      results.push({
        rumahSakit: name,
        email: discovery.email,
        telepon: discovery.phone
      });
      console.log(`[STATUS] ${discovery.email !== 'Tidak Ditemukan' || discovery.phone !== 'Tidak Ditemukan' ? 'Berhasil' : 'Tidak Ditemukan'}`);
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