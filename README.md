# NSDUH Variable Explorer

A research-focused browser for exploring, organizing, and exporting variables from National Survey on Drug Use and Health (NSDUH) codebooks.

The application combines a Node.js/Express interface, a Python PDF parser, SQLite storage, HTMX, and Alpine.js. It is designed for the variable-discovery and codebook-organization stage of a research project—not as a replacement for SAMHSA's official analysis systems or documentation.

## Why this project exists

SAMHSA's official Data Analysis System (DAS) is the authoritative online tool for browsing study variables and running crosstabs. Official NSDUH codebooks contain detailed variable definitions, source/question identifiers, available values, and—in applicable public-use/analytic codebooks—frequency information. Those official resources should remain the source of truth.

The practical difficulty for some codebook-heavy workflows is that the information needed to build a variable list can be spread across variable-search pages, long PDF codebooks, category structures, question text, value tables, and manually maintained research spreadsheets. Researchers may need to search repeatedly, collect variables from many official codebook sections, impose a project-specific topic structure, avoid duplicates, and produce a reviewable selection document before analysis begins.

This project addresses that workflow by providing:

- one searchable, normalized view of parsed codebook variables;
- focused search across variable code/name, Question ID, variable label, and question wording;
- full codebook context for each result, including its original section and value rows;
- user-defined main categories above the original codebook categories;
- unique-variable enforcement so one variable cannot silently appear in several main categories;
- reusable, date-stamped variable-selection presets;
- hierarchical PDF and Excel exports for review, documentation, and handoff.

This is a workflow complement to official SAMHSA tools. It does not calculate estimates, apply survey weights, replace DAS crosstabs, determine cross-year comparability, or validate substantive variable choices.

## Features

### Data sources

- Upload and parse an NSDUH PDF codebook locally.
- Switch among imported codebooks/datasets.
- Optionally import metadata from the SAMHSA DAS JSON endpoint.
- Preserve normalized records plus raw source material for auditing.

### Parsed codebook fields

- original section/category;
- PDF page and printed codebook page;
- Question ID/source ID;
- variable code and length;
- variable label;
- full question wording;
- notes and definitions for display/export context;
- response/value codes and descriptions;
- frequency and percentage where present;
- raw codebook value row and raw normalized JSON.

### Search

The main search intentionally matches only:

- variable code/name;
- remote variable ID when available;
- Question ID;
- variable label;
- full question/question wording.

Notes/definitions and response/value-code text are intentionally excluded from search results.

### Selection and organization

- Select one variable or all current search results.
- Select all response values or only particular value rows.
- Create a project-specific main category, prefilled from the current search term.
- Reuse existing main categories through a searchable category picker.
- Rename, merge, or delete main categories.
- Retain original codebook categories as subcategories.
- Sort selections by main category, then codebook subcategory, then variable code.
- Search within selected variables.
- Click a selected variable to reopen its full detail view.
- Remove one variable, remove an entire main category, or clear the active dataset.
- Store selections and category definitions in browser `localStorage`.

### Presets

- Save the active dataset's selected variables under a custom preset name.
- Record the date/time and number of variables in each preset.
- Load a preset to restore its selections.
- Delete presets.
- Store presets locally in the current browser profile.

Presets are not user accounts and are not synchronized across browsers or devices. Clearing browser site data removes them.

### Export

- Export selected variables to Excel (`.xlsx`) or PDF.
- Preserve selected response-value filtering.
- Deduplicate variables by database variable ID.
- Group output by main category and original codebook subcategory.
- Include total variable counts.
- Produce a hierarchical table of contents:
  - Heading 1: user-defined main category;
  - Heading 2: original codebook subcategory.
- Include question wording, identifiers, pages, labels, response rows, frequency, and percentage where available.

## Visual walkthrough

### 1. Explorer overview and codebook selection

Choose the active codebook, upload a locally parsed NSDUH codebook, search the variable library, and manage the current selection from one workspace. The three-column layout keeps search results, variable details, and selected variables visible together.

![NSDUH Variable Explorer overview](<screenshots/Screenshot 2026-08-11 at 6.57.53 PM.png>)

### 2. Create or manage a main category

After selecting one or many variables, the category dialog creates a project-specific main category above the original codebook categories. The current search term is proposed automatically. Existing categories are searchable and can be selected, renamed, or deleted.

![Create and manage a main category](<screenshots/Screenshot 2026-08-11 at 6.58.10 PM.png>)

### 3. Reuse an existing category for a new search

Different searches can feed the same main category. For example, variables found through several alcohol-related keywords can all be assigned to the existing `Alcohol` category instead of producing duplicate or misspelled categories.

![Reuse an existing Alcohol category](<screenshots/Screenshot 2026-08-11 at 6.58.33 PM.png>)

### 4. Review selected variables as a hierarchy

The Selected panel groups variables under the user-defined main category and then under their original codebook subcategories. It displays category totals and supports preset saving, selected-variable search, individual removal, and removal of an entire main category.

![Hierarchically organized selected variables](<screenshots/Screenshot 2026-08-11 at 6.58.56 PM.png>)

### 5. Inspect complete variable details

Selecting a search result or clicking a variable in the Selected panel opens its detailed codebook record. The view includes section, Question ID, codebook/PDF pages, length, variable label, full question wording, response codes, frequencies, and percentages. Individual value rows can be selected when only part of a response table should be exported.

![Detailed variable and response-code view](<screenshots/Screenshot 2026-08-11 at 6.59.55 PM.png>)

### 6. PDF table of contents

The PDF begins with a linked hierarchical table of contents. Main categories show total variable counts, codebook subcategories appear underneath, and page links jump to the corresponding section of the export.

![PDF hierarchical table of contents](<screenshots/Screenshot 2026-08-11 at 7.01.52 PM.png>)

### 7. PDF variable pages

PDF detail pages preserve a compact codebook-style structure: category headings, Question IDs, variable codes and labels, response descriptions, dotted leaders, frequencies, and percentages.

![PDF variable detail pages](<screenshots/Screenshot 2026-08-11 at 7.02.02 PM.png>)

### 8. Excel table of contents

The Excel workbook includes a dedicated Table of Contents worksheet with the total variable count and clickable links into the Variables worksheet. This makes large selection exports easier to navigate and review.

![Excel table of contents worksheet](<screenshots/Screenshot 2026-08-11 at 7.02.32 PM.png>)

### 9. Excel variable worksheet

The Variables worksheet presents question wording, Question ID and variable code, codebook page, response values, frequency, and percentage in a structured research-sheet layout suitable for filtering, annotation, and handoff.

![Excel variables worksheet](<screenshots/Screenshot 2026-08-11 at 7.02.41 PM.png>)

## Technology

- Node.js 20+
- Express 5 and EJS
- HTMX and Alpine.js
- SQLite through `better-sqlite3`
- ExcelJS
- PDFKit
- Python 3.10+ and PyMuPDF for local PDF parsing

## Repository structure

```text
.
├── data/                       # Bundled SQLite database
├── public/                     # Browser JavaScript and CSS
├── scripts/                    # Python codebook parser
├── services/                   # Import, query, and export logic
├── views/                      # EJS pages and partials
├── db.js                       # SQLite setup and migrations
├── server.js                   # Express application
├── package.json
└── README.md
```

## Local installation

### 1. Install prerequisites

Install:

- [Node.js](https://nodejs.org/) 20 or newer;
- npm (included with Node.js);
- Python 3.10 or newer;
- Git.

Confirm them:

```bash
node --version
npm --version
python3 --version
git --version
```

### 2. Install dependencies

From the project folder:

```bash
npm install
python3 -m pip install PyMuPDF
```

Confirm PyMuPDF:

```bash
npm run check:python
```

### 3. Start the app

```bash
npm start
```

For automatic Node.js restarts during development:

```bash
npm run dev
```

Open <http://localhost:3000>.

## Parse an NSDUH codebook locally

1. Download the appropriate codebook from an official SAMHSA source.
2. Open the application.
3. Under **Parse a new NSDUH codebook PDF**, choose the PDF.
4. Click **Upload & Parse Codebook**.
5. Wait for parsing and import to complete.
6. Select the new dataset from **Active codebook / dataset** if it is not selected automatically.
7. Review `parse_warnings.csv` in the generated parsed-upload directory.

The parser creates:

- `codebook.json`;
- `variables.csv`;
- `value_codes.csv`;
- `parse_warnings.csv`.

The parser uses PDF text extraction and a state machine, not OCR. Scanned PDFs or changed layouts may require parser changes. Always review warnings and compare important variables with the official codebook.

## Publish the project to GitHub

### 1. Prepare the database

The repository includes `data/nsduh.sqlite` so a deployed read-only demo has data. Before committing, stop the application and checkpoint SQLite so pending WAL data is moved into the main database:

```bash
node -e "const db=require('./db'); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();"
```

The included `.gitignore` excludes `node_modules`, temporary exports, uploads, Vercel metadata, logs, and SQLite WAL/SHM files. It intentionally does **not** ignore `data/nsduh.sqlite`.

Before publishing a bundled database, confirm that it contains only data you are legally permitted to publish. Do not commit restricted-use respondent microdata, credentials, private uploads, or sensitive data. This application is intended for public codebook metadata, not respondent-level restricted-use files.

### 2. Create the local Git repository

If this directory is not already a Git repository:

```bash
git init
git add .
git status
git commit -m "Initial NSDUH Variable Explorer release"
```

Review `git status` before committing. The database should appear if you want the hosted demo to include it; `uploads/`, `node_modules/`, and `data/*.sqlite-wal` should not.

### 3. Create an empty GitHub repository

1. Sign in to [GitHub](https://github.com/).
2. Click **New repository**.
3. Enter a repository name such as `nsduh-variable-explorer`.
4. Choose **Public** or **Private**.
5. Do not initialize it with another README, `.gitignore`, or license because those files already exist locally.
6. Click **Create repository**.

### 4. Connect and push

Replace `YOUR-USERNAME` with your GitHub username:

```bash
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/nsduh-variable-explorer.git
git push -u origin main
```

If GitHub asks for authentication, use GitHub's browser login, GitHub CLI, SSH, or a personal access token rather than an account password.

For future updates:

```bash
git add .
git commit -m "Describe the update"
git push
```

## Deploy to Vercel from GitHub

Vercel currently detects Express applications and runs the app as a Vercel Function. This repository exports its Express app from `server.js`, while still using `app.listen` for normal local execution.

### 1. Create the Vercel project

1. Sign in at [vercel.com](https://vercel.com/) using GitHub.
2. Click **Add New → Project**.
3. Import the GitHub repository you created.
4. Keep the repository root as the **Root Directory**.
5. Let Vercel detect the Express framework.
6. Do not set a custom build command or output directory unless Vercel specifically requests one.
7. Click **Deploy**.

### 2. Verify the deployment

After deployment:

1. Open the generated `*.vercel.app` URL.
2. Confirm that the active dataset dropdown contains the bundled dataset.
3. Search for a known variable code and Question ID.
4. Open a variable detail page.
5. Select variables and create a main category.
6. Save/load a preset.
7. Test Excel and PDF exports.

Each push to `main` creates a new production deployment when Git integration is enabled. Pull requests and non-production branches normally create preview deployments.

### 3. Optional Vercel CLI workflow

Install and authenticate:

```bash
npm install --global vercel
vercel login
```

Test using Vercel's local environment:

```bash
vercel dev
```

Create a preview deployment:

```bash
vercel
```

Deploy to production:

```bash
vercel --prod
```

## Important Vercel limitations

The Vercel deployment should be treated as a browsable demo of the database committed to GitHub.

### Ephemeral SQLite writes

Vercel Functions do not provide a durable local filesystem. On Vercel, this project copies the bundled SQLite database to `/tmp` so SQLite can open it and create journals. Changes made to that temporary copy can disappear when the function instance is recycled and are not shared reliably across instances.

Consequences:

- the bundled codebook remains available for browsing;
- searches, detail views, browser-side categories/presets, and exports work;
- server-side imports are not durable;
- uploaded/imported datasets may disappear;
- concurrent function instances may not see identical temporary database changes.

Browser selections, category definitions, and presets use `localStorage`; they remain in that browser unless site data is cleared, but they are not synced to other users/devices.

### PDF upload size and Python parsing

Vercel Functions currently limit request and response bodies to 4.5 MB. NSDUH codebook PDFs commonly exceed that size. The local PDF parser also depends on Python/PyMuPDF and a long-running file-processing workflow that is not a good fit for this single Node.js Function deployment.

For production codebook uploads, use one of these architectures:

1. Parse codebooks locally, commit the resulting SQLite database, and redeploy.
2. Upload PDFs directly to durable object storage, process them in a separate Python worker/service, and save normalized results in a hosted database.
3. Host the complete application on a persistent container/VM platform with a durable disk instead of Vercel Functions.

### Production database recommendation

For a multi-user production service, replace local SQLite writes with a durable hosted database. Preserve the current normalized `datasets`, `variables`, and `options` model, then move codebook parsing into a background job. Also add authentication and server-side preset storage if presets must follow users across devices.

## Updating the bundled database on Vercel

To publish newly parsed public codebook metadata:

1. Run and test the app locally.
2. Parse/import the codebook locally.
3. Stop the app.
4. Checkpoint SQLite:

   ```bash
   node -e "const db=require('./db'); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();"
   ```

5. Confirm `data/nsduh.sqlite` changed:

   ```bash
   git status
   ```

6. Commit and push:

   ```bash
   git add data/nsduh.sqlite
   git commit -m "Update bundled NSDUH codebook database"
   git push
   ```

7. Vercel will build a new deployment from the updated repository.

## Data and research cautions

- Use official SAMHSA documentation as the source of truth.
- Review parser warnings and spot-check important records against the PDF.
- Do not infer comparability across survey years from similar names alone; use official crosswalks and methodology.
- Frequencies displayed from a codebook are not automatically weighted population estimates.
- This application does not apply complex survey design, weights, strata, clusters, variance estimation, suppression rules, or disclosure review.
- Never upload or publish restricted-use respondent data through this repository.

## Troubleshooting

### Search returns no results

- Confirm the correct active dataset.
- Search using a variable code, remote variable ID, Question ID, variable label, or wording from the question.
- Notes and response/value descriptions are intentionally not searchable.

### The hosted app has no data

- Confirm `data/nsduh.sqlite` was committed to GitHub.
- Check whether the file is visible in the GitHub repository.
- Review Vercel build logs for `better-sqlite3` installation or file-tracing errors.

### Vercel deployment fails because of function size

The Express app, native dependencies, and bundled database must fit within Vercel's Function bundle limit. Remove unneeded generated files and uploads. If the bundled database grows substantially, move it to a hosted database.

### PDF upload fails on Vercel

This is expected for PDFs over Vercel's request-body limit and is why PDF parsing is documented as a local or external-worker workflow.

### Presets disappeared

Presets are stored in browser `localStorage`. They disappear if site data is cleared, a private/incognito session ends, or a different browser/device is used.

### SQLite is locked locally

Stop duplicate Node.js processes, then restart the app. Do not delete the main `.sqlite` file. WAL and SHM files should only be removed after all database processes have stopped and the database has been safely checkpointed.

## Official resources

- [SAMHSA Data Tools](https://datatools.samhsa.gov/)
- [NSDUH resources and data files](https://www.samhsa.gov/data/data-we-collect/nsduh-national-survey-drug-use-and-health)
- [Vercel Express documentation](https://vercel.com/docs/frameworks/backend/express)
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [GitHub: add an existing project to GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)

## License and attribution

Add a license before distributing or accepting contributions. This project is an independent research utility and is not an official SAMHSA product. NSDUH and SAMHSA names identify the public data/documentation being explored; they do not imply endorsement.
