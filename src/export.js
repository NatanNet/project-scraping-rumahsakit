const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

const JSON_FILE = path.join(__dirname, '../data/output/rs-data.json');
const EXCEL_FILE = path.join(__dirname, '../data/output/Hasil_Scraping_RS.xlsx');

async function exportToExcel() {
  if (!fs.existsSync(JSON_FILE)) {
    throw new Error(`File JSON ${JSON_FILE} tidak ditemukan. Jalankan scraping terlebih dahulu.`);
  }

  const rawData = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Data Rumah Sakit');

  worksheet.columns = [
    { header: 'Nama Rumah Sakit', key: 'rumahSakit', width: 40 },
    { header: 'Email', key: 'email', width: 40 }
  ];

  rawData.forEach(item => worksheet.addRow(item));

  await workbook.xlsx.writeFile(EXCEL_FILE);
  console.log(`Ekspor Excel Berhasil: ${EXCEL_FILE}`);
}

exportToExcel().catch(err => {
  console.error(err.message);
  process.exit(1);
});