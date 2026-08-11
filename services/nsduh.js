const axios = require('axios');
const db = require('../db');

const BASE = 'https://datatools.samhsa.gov';

function first(...values) {
  return values.find(v => v !== undefined && v !== null && String(v).trim() !== '') ?? null;
}

function text(value) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function normalizeOption(o, i) {
  return {
    key: text(first(o.key, o.value, o.code, o.id)),
    title: text(first(o.title, o.label, o.text, o.description)),
    missing: Number(Boolean(first(o.missing, o.is_missing, false))),
    nonresponse: Number(Boolean(first(o.nonresponse, o.non_response, o.is_nonresponse, false))),
    frequency: first(o.frequency, o.freq, o.count, o.n),
    percent: first(o.percent, o.pct, o.percentage),
    displayOrder: Number(first(o.display_order, o.order, i))
  };
}

function normalizeVariable(v) {
  const options = Array.isArray(v.options) ? v.options.map(normalizeOption) : [];
  const filters = Array.isArray(v.filters) ? v.filters : [];
  return {
    remoteId: text(first(v.id, v.variable_id)),
    code: text(first(v.key, v.code, v.variable, v.name)),
    label: text(first(v.label, v.title, v.variable_label, v.short_label)),
    question: text(first(v.question, v.question_text, v.prompt, v.text, v.survey_question, v.question_wording)),
    description: text(first(v.description, v.long_description, v.notes)),
    category: text(first(v.category, v.group, v.section, v.topic)),
    page: text(first(v.page, v.page_number, v.codebook_page)),
    length: text(first(v.length, v.len, v.width)),
    stratum: text(v.stratum),
    cluster: text(v.cluster),
    defaultWeight: text(first(v.default_weight, v.weight)),
    filters,
    options,
    raw: v
  };
}

async function fetchDataset(slug) {
  const url = `${BASE}/api/surveys_ia/${encodeURIComponent(slug)}/?format=json`;
  const response = await axios.get(url, {
    timeout: 120000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'NSDUH-Variable-Explorer/1.0 (local research tool)'
    }
  });
  return { url, data: response.data };
}

function importDataset(slug, sourceUrl, data) {
  if (!Array.isArray(data.variables)) throw new Error('SAMHSA response does not contain a variables array.');

  const upsertDataset = db.prepare(`
    INSERT INTO datasets(slug, study, study_group, survey_year, dataset_id, fetched_at, source_url, raw_json, source_type, display_name)
    VALUES(@slug,@study,@study_group,@survey_year,@dataset_id,@fetched_at,@source_url,@raw_json,'samhsa',@slug)
    ON CONFLICT(slug) DO UPDATE SET
      study=excluded.study,
      study_group=excluded.study_group,
      survey_year=excluded.survey_year,
      dataset_id=excluded.dataset_id,
      fetched_at=excluded.fetched_at,
      source_url=excluded.source_url,
      raw_json=excluded.raw_json,
      source_type='samhsa',
      display_name=excluded.display_name
  `);

  const insertVar = db.prepare(`
    INSERT INTO variables(dataset_slug,remote_id,code,label,question,description,category,page,length,stratum,cluster,default_weight,filters_json,raw_json,source_type)
    VALUES(@dataset_slug,@remote_id,@code,@label,@question,@description,@category,@page,@length,@stratum,@cluster,@default_weight,@filters_json,@raw_json,'samhsa')
  `);
  const insertOpt = db.prepare(`
    INSERT INTO options(variable_id,option_key,title,missing,nonresponse,frequency,percent,display_order,raw_json)
    VALUES(@variable_id,@option_key,@title,@missing,@nonresponse,@frequency,@percent,@display_order,@raw_json)
  `);
  const insertFts = db.prepare(`INSERT INTO variables_fts(rowid, code, label, question, description, category, option_text) VALUES(?,?,?,?,?,?,?)`);

  const tx = db.transaction(() => {
    upsertDataset.run({
      slug,
      study: text(data.study),
      study_group: text(data.study_group),
      survey_year: text(data.survey_year),
      dataset_id: text(data.dataset_id),
      fetched_at: new Date().toISOString(),
      source_url: sourceUrl,
      raw_json: JSON.stringify(data)
    });

    db.prepare('DELETE FROM variables WHERE dataset_slug = ?').run(slug);
    db.prepare('DELETE FROM variables_fts').run();

    let imported = 0;
    for (const raw of data.variables) {
      const v = normalizeVariable(raw);
      if (!v.code) continue;
      const result = insertVar.run({
        dataset_slug: slug,
        remote_id: v.remoteId,
        code: v.code,
        label: v.label,
        question: v.question,
        description: v.description,
        category: v.category,
        page: v.page,
        length: v.length,
        stratum: v.stratum,
        cluster: v.cluster,
        default_weight: v.defaultWeight,
        filters_json: JSON.stringify(v.filters),
        raw_json: JSON.stringify(v.raw)
      });
      const variableId = Number(result.lastInsertRowid);
      for (const [i, rawOpt] of (raw.options || []).entries()) {
        const o = normalizeOption(rawOpt, i);
        insertOpt.run({
          variable_id: variableId,
          option_key: o.key,
          title: o.title,
          missing: o.missing,
          nonresponse: o.nonresponse,
          frequency: o.frequency == null ? null : Number(o.frequency),
          percent: o.percent == null ? null : Number(o.percent),
          display_order: o.displayOrder,
          raw_json: JSON.stringify(rawOpt)
        });
      }
      const optionText = optionsToText(v.options);
      insertFts.run(variableId, v.code, v.label || '', v.question || '', v.description || '', v.category || '', optionText);
      imported++;
    }
    return imported;
  });
  return tx();
}

function optionsToText(options) {
  return options.map(o => `${o.key || ''} ${o.title || ''}`).join(' ');
}

async function refreshDataset(slug) {
  const { url, data } = await fetchDataset(slug);
  const count = importDataset(slug, url, data);
  return { count, metadata: { study: data.study, survey_year: data.survey_year, dataset_id: data.dataset_id } };
}

function getVariable(id) {
  const variable = db.prepare('SELECT * FROM variables WHERE id=?').get(id);
  if (!variable) return null;
  variable.options = db.prepare('SELECT * FROM options WHERE variable_id=? ORDER BY display_order, id').all(id);
  variable.dataset = db.prepare('SELECT slug,source_type,display_name,survey_year,source_file FROM datasets WHERE slug=?').get(variable.dataset_slug) || null;
  variable.filters = JSON.parse(variable.filters_json || '[]');
  variable.raw = JSON.parse(variable.raw_json);

  // Preserve and expose useful metadata even when SAMHSA changes field names.
  // Complex fields such as options/filters are already rendered separately.
  const excluded = new Set(['options', 'filters', 'values']);
  variable.metadata = Object.entries(variable.raw)
    .filter(([key, value]) => !excluded.has(key) && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({
      key,
      value: (typeof value === 'object') ? JSON.stringify(value, null, 2) : String(value)
    }));

  // Collect question-like fields so the UI shows all available wording, not only one guessed field.
  const questionKeys = ['question', 'question_text', 'prompt', 'text', 'survey_question', 'question_wording'];
  variable.question_fields = questionKeys
    .filter(key => variable.raw[key] !== null && variable.raw[key] !== undefined && String(variable.raw[key]).trim() !== '')
    .map(key => ({ key, value: String(variable.raw[key]) }));

  return variable;
}

function searchVariables({ dataset, q = '', limit = 50 }) {
  q = q.trim();
  if (!q) {
    return db.prepare(`SELECT id,code,label,question,category,page,section,question_id,codebook_page,pdf_page,source_type FROM variables WHERE dataset_slug=? ORDER BY id LIMIT ?`).all(dataset, limit);
  }
  const like = `%${q}%`;
  return db.prepare(`
    SELECT v.id,v.code,v.label,v.question,v.category,v.page,v.section,v.question_id,v.codebook_page,v.pdf_page,v.source_type
    FROM variables v
    WHERE v.dataset_slug=? AND (
      v.code LIKE ? COLLATE NOCASE OR
      v.remote_id LIKE ? COLLATE NOCASE OR
      v.question_id LIKE ? COLLATE NOCASE OR
      v.label LIKE ? COLLATE NOCASE OR
      v.question LIKE ? COLLATE NOCASE
    )
    ORDER BY CASE
      WHEN v.code = ? COLLATE NOCASE THEN 0
      WHEN v.remote_id = ? COLLATE NOCASE THEN 1
      WHEN v.question_id = ? COLLATE NOCASE THEN 2
      WHEN v.code LIKE ? COLLATE NOCASE THEN 3
      WHEN v.remote_id LIKE ? COLLATE NOCASE THEN 4
      WHEN v.question_id LIKE ? COLLATE NOCASE THEN 5
      WHEN v.label = ? COLLATE NOCASE THEN 6
      WHEN v.label LIKE ? COLLATE NOCASE THEN 7
      WHEN v.question LIKE ? COLLATE NOCASE THEN 8
      ELSE 9
    END, v.code
    LIMIT ?
  `).all(
    dataset,
    like, like, like, like, like,
    q, q, q,
    `${q}%`, `${q}%`, `${q}%`,
    q, `${q}%`, `${q}%`,
    limit
  );
}

function listDatasets() {
  return db.prepare(`
    SELECT d.*, COALESCE(d.display_name,d.slug) display_name, (SELECT COUNT(*) FROM variables v WHERE v.dataset_slug=d.slug) variable_count
    FROM datasets d ORDER BY CASE WHEN d.source_type='codebook' THEN 0 ELSE 1 END, survey_year DESC, slug
  `).all();
}

module.exports = { refreshDataset, getVariable, searchVariables, listDatasets };
