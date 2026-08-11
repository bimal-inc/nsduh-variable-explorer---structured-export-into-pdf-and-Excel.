const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { refreshDataset, getVariable, searchVariables, listDatasets } = require('./services/nsduh');
const { parseAndImportCodebook } = require('./services/codebook');
const { makeExcel, makePdf } = require('./services/exporter');

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDir = process.env.VERCEL
  ? path.join('/tmp', 'nsduh-variable-explorer-uploads')
  : path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    cb(ok ? null : new Error('Please upload a PDF codebook.'), ok);
  }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const datasets = listDatasets();
  const requested = req.query.dataset;
  const dataset = datasets.some(d => d.slug === requested)
    ? requested
    : (datasets[0]?.slug || 'NSDUH-2021-DS0001');
  res.render('index', { datasets, dataset });
});

app.post('/api/codebook', upload.single('codebook'), async (req, res) => {
  try {
    const result = await parseAndImportCodebook(req.file);
    res.setHeader('HX-Redirect', `/?dataset=${encodeURIComponent(result.slug)}`);
    res.send(`<div class="notice success">Parsed ${result.count.toLocaleString()} variables and ${result.valueCount.toLocaleString()} coded values.</div>`);
  } catch (e) {
    console.error(e);
    res.status(500).send(`<div class="notice error"><strong>Codebook parse failed.</strong><br>${escapeHtml(e.message)}</div>`);
  }
});

app.post('/api/import', async (req, res) => {
  try {
    const slug = String(req.body.slug || 'NSDUH-2021-DS0001').trim();
    if (!/^NSDUH-[0-9]{4}-DS[0-9]+$/i.test(slug)) return res.status(400).send('Invalid dataset slug');
    const result = await refreshDataset(slug);
    res.setHeader('HX-Redirect', `/?dataset=${encodeURIComponent(slug)}`);
    res.send(`<div class="notice success">Imported ${result.count.toLocaleString()} variables from ${escapeHtml(slug)}.</div>`);
  } catch (e) {
    console.error(e);
    res.status(500).send(`<div class="notice error">Import failed: ${escapeHtml(e.message)}</div>`);
  }
});

app.get('/search', (req, res) => {
  const dataset = String(req.query.dataset || 'NSDUH-2021-DS0001').trim();
  const q = String(req.query.q || '');
  const results = searchVariables({ dataset, q, limit: 100 });
  res.render('partials/results', { results, q, dataset });
});

app.get('/variable/:id', (req, res) => {
  const variable = getVariable(Number(req.params.id));
  if (!variable) return res.status(404).send('Variable not found');
  res.render('partials/variable', { variable });
});

app.post('/export/xlsx', async (req, res) => {
  try {
    const buffer = await makeExcel(req.body);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="nsduh-selected-variables.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (e) { console.error(e); res.status(500).send(e.message); }
});

app.post('/export/pdf', async (req, res) => {
  try {
    const buffer = await makePdf(req.body);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="nsduh-selected-variables.pdf"');
    res.send(buffer);
  } catch (e) { console.error(e); res.status(500).send(e.message); }
});

function escapeHtml(s='') {
  return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

app.use((err, req, res, next) => {
  if (!err) return next();
  console.error(err);
  res.status(400).send(`<div class="notice error">${escapeHtml(err.message || 'Request failed')}</div>`);
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`NSDUH Variable Explorer: http://localhost:${PORT}`));
}

module.exports = app;
