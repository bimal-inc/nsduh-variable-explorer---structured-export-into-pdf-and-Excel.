const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const bundledDbPath = path.join(__dirname, 'data', 'nsduh.sqlite');
const vercelDbPath = path.join('/tmp', 'nsduh-variable-explorer.sqlite');
if (process.env.VERCEL && !fs.existsSync(vercelDbPath)) {
  fs.copyFileSync(bundledDbPath, vercelDbPath);
}
const dbPath = process.env.DB_PATH || (process.env.VERCEL ? vercelDbPath : bundledDbPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS datasets (
  slug TEXT PRIMARY KEY,
  study TEXT,
  study_group TEXT,
  survey_year TEXT,
  dataset_id TEXT,
  fetched_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS variables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_slug TEXT NOT NULL,
  remote_id TEXT,
  code TEXT NOT NULL,
  label TEXT,
  question TEXT,
  description TEXT,
  category TEXT,
  page TEXT,
  length TEXT,
  stratum TEXT,
  cluster TEXT,
  default_weight TEXT,
  filters_json TEXT,
  raw_json TEXT NOT NULL,
  UNIQUE(dataset_slug, code),
  FOREIGN KEY(dataset_slug) REFERENCES datasets(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_variables_dataset ON variables(dataset_slug);
CREATE INDEX IF NOT EXISTS idx_variables_code ON variables(code);
CREATE INDEX IF NOT EXISTS idx_variables_category ON variables(category);

CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variable_id INTEGER NOT NULL,
  option_key TEXT,
  title TEXT,
  missing INTEGER NOT NULL DEFAULT 0,
  nonresponse INTEGER NOT NULL DEFAULT 0,
  frequency REAL,
  percent REAL,
  display_order INTEGER,
  raw_json TEXT NOT NULL,
  FOREIGN KEY(variable_id) REFERENCES variables(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_options_variable ON options(variable_id);

CREATE VIRTUAL TABLE IF NOT EXISTS variables_fts USING fts5(
  code, label, question, description, category, option_text, content=''
);
`);

function addColumn(table, definition) {
  const name = definition.trim().split(/\s+/)[0];
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

// Backward-compatible migrations for projects created by earlier versions.
addColumn('datasets', 'source_type TEXT DEFAULT \'samhsa\'');
addColumn('datasets', 'display_name TEXT');
addColumn('datasets', 'source_file TEXT');

addColumn('variables', 'section TEXT');
addColumn('variables', 'pdf_page INTEGER');
addColumn('variables', 'codebook_page TEXT');
addColumn('variables', 'question_id TEXT');
addColumn('variables', 'notes TEXT');
addColumn('variables', 'source_type TEXT DEFAULT \'samhsa\'');

addColumn('options', 'description TEXT');
addColumn('options', 'raw_line TEXT');

module.exports = db;
