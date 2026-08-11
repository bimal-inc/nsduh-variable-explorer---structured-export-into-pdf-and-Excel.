const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const db = require('../db');

function clean(value) {
  return value === undefined || value === null ? null : String(value).trim() || null;
}

function slugify(filename) {
  const base = path.basename(filename, path.extname(filename))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return `CODEBOOK-${base || crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function runParser(pdfPath, outputDir) {
  const parser = path.join(__dirname, '..', 'scripts', 'nsduh_codebook_parser.py');
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outputDir, { recursive: true });
    const child = spawn(process.env.PYTHON || 'python3', [parser, pdfPath, '-o', outputDir], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`Codebook parser failed (${code}).\n${stderr || stdout}`));
      resolve({ stdout, stderr });
    });
  });
}

function importCodebookJson({ slug, displayName, sourceFile, jsonPath }) {
  const rawText = fs.readFileSync(jsonPath, 'utf8');
  const records = JSON.parse(rawText);
  if (!Array.isArray(records)) throw new Error('Parsed codebook JSON must be an array of variables.');

  const upsertDataset = db.prepare(`
    INSERT INTO datasets(slug, study, study_group, survey_year, dataset_id, fetched_at, source_url, raw_json, source_type, display_name, source_file)
    VALUES(@slug,@study,@study_group,@survey_year,@dataset_id,@fetched_at,@source_url,@raw_json,'codebook',@display_name,@source_file)
    ON CONFLICT(slug) DO UPDATE SET
      fetched_at=excluded.fetched_at, source_url=excluded.source_url, raw_json=excluded.raw_json,
      source_type='codebook', display_name=excluded.display_name, source_file=excluded.source_file
  `);

  const insertVar = db.prepare(`
    INSERT INTO variables(
      dataset_slug,remote_id,code,label,question,description,category,page,length,stratum,cluster,default_weight,
      filters_json,raw_json,section,pdf_page,codebook_page,question_id,notes,source_type
    ) VALUES(
      @dataset_slug,NULL,@code,@label,@question,@description,@category,@page,@length,NULL,NULL,NULL,
      '[]',@raw_json,@section,@pdf_page,@codebook_page,@question_id,@notes,'codebook'
    )
  `);
  const insertOpt = db.prepare(`
    INSERT INTO options(variable_id,option_key,title,missing,nonresponse,frequency,percent,display_order,raw_json,description,raw_line)
    VALUES(@variable_id,@option_key,@title,0,0,@frequency,@percent,@display_order,@raw_json,@description,@raw_line)
  `);
  const insertFts = db.prepare(`INSERT INTO variables_fts(rowid, code, label, question, description, category, option_text) VALUES(?,?,?,?,?,?,?)`);

  const yearMatch = `${displayName} ${sourceFile}`.match(/(?:19|20)\d{2}/);
  const tx = db.transaction(() => {
    upsertDataset.run({
      slug,
      study: 'NSDUH Public-Use File Codebook',
      study_group: 'NSDUH',
      survey_year: yearMatch ? yearMatch[0] : null,
      dataset_id: null,
      fetched_at: new Date().toISOString(),
      source_url: sourceFile,
      raw_json: JSON.stringify({ parser: 'scripts/nsduh_codebook_parser.py', record_count: records.length }),
      display_name: displayName,
      source_file: sourceFile
    });

    // Delete options first for SQLite installations where foreign keys are not enabled.
    const oldIds = db.prepare('SELECT id FROM variables WHERE dataset_slug=?').all(slug).map(x => x.id);
    if (oldIds.length) {
      const delOpt = db.prepare(`DELETE FROM options WHERE variable_id=?`);
      for (const id of oldIds) delOpt.run(id);
    }
    db.prepare('DELETE FROM variables WHERE dataset_slug=?').run(slug);

    let count = 0;
    let valueCount = 0;
    for (const rec of records) {
      const code = clean(rec.variable);
      if (!code) continue;
      const result = insertVar.run({
        dataset_slug: slug,
        code,
        label: clean(rec.label),
        question: clean(rec.question_text),
        description: clean(rec.notes),
        category: clean(rec.section),
        page: clean(rec.codebook_page),
        length: rec.length == null ? null : String(rec.length),
        raw_json: JSON.stringify(rec),
        section: clean(rec.section),
        pdf_page: rec.pdf_page == null ? null : Number(rec.pdf_page),
        codebook_page: clean(rec.codebook_page),
        question_id: clean(rec.question_id),
        notes: clean(rec.notes)
      });
      const variableId = Number(result.lastInsertRowid);
      const values = Array.isArray(rec.values) ? rec.values : [];
      values.forEach((val, i) => {
        const description = clean(val.description);
        insertOpt.run({
          variable_id: variableId,
          option_key: clean(val.code),
          title: description,
          frequency: val.frequency == null ? null : Number(val.frequency),
          percent: val.percent == null ? null : Number(val.percent),
          display_order: i,
          raw_json: JSON.stringify(val),
          description,
          raw_line: clean(val.raw_line)
        });
        valueCount++;
      });
      const optionText = values.map(v => `${v.code || ''} ${v.description || ''} ${v.raw_line || ''}`).join(' ');
      insertFts.run(variableId, code, rec.label || '', rec.question_text || '', rec.notes || '', rec.section || '', optionText);
      count++;
    }
    return { count, valueCount };
  });

  return tx();
}

async function parseAndImportCodebook(file) {
  if (!file?.path) throw new Error('No PDF uploaded.');
  const slug = slugify(file.originalname);
  const outDir = path.join(path.dirname(file.path), `${path.basename(file.path)}-parsed`);
  const run = await runParser(file.path, outDir);
  const jsonPath = path.join(outDir, 'codebook.json');
  if (!fs.existsSync(jsonPath)) throw new Error('Parser completed but codebook.json was not created.');
  const result = importCodebookJson({
    slug,
    displayName: file.originalname,
    sourceFile: file.path,
    jsonPath
  });
  return { slug, ...result, parserOutput: run.stdout.trim(), outputDir: outDir };
}

module.exports = { parseAndImportCodebook, importCodebookJson, slugify };
