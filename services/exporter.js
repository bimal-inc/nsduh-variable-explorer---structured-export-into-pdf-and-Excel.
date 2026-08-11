const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const db = require('../db');

function getSelections(payload) {
  const selections = Array.isArray(payload?.selections) ? payload.selections : [];
  const dataset = payload?.dataset ? String(payload.dataset) : null;
  const seen = new Set();
  return selections.map(sel => {
    const v = db.prepare('SELECT * FROM variables WHERE id=?').get(Number(sel.variableId));
    if (!v || seen.has(v.id) || (dataset && v.dataset_slug !== dataset)) return null;
    seen.add(v.id);
    let options = db.prepare('SELECT * FROM options WHERE variable_id=? ORDER BY display_order,id').all(v.id);
    const selected = Array.isArray(sel.optionIds) ? new Set(sel.optionIds.map(Number)) : null;
    if (selected && selected.size) options = options.filter(o => selected.has(o.id));
    return {
      variable: v,
      options,
      mainCategory: String(sel.mainCategory || sel.codebookCategory || v.section || v.category || 'Uncategorized').trim(),
      codebookCategory: String(sel.codebookCategory || v.section || v.category || 'Uncategorized').trim()
    };
  }).filter(Boolean).sort((a, b) =>
    a.mainCategory.localeCompare(b.mainCategory, undefined, { sensitivity: 'base' }) ||
    a.codebookCategory.localeCompare(b.codebookCategory, undefined, { sensitivity: 'base' }) ||
    String(a.variable.code).localeCompare(String(b.variable.code), undefined, { sensitivity: 'base' })
  );
}

function variableHeading(v) {
  const len = v.length ? `Len : ${v.length}  ` : '';
  return `${len}${v.label || v.code}`.trim();
}

function questionIdentifier(v) {
  return `${v.question_id ? `(${v.question_id})\n` : ''}${v.code}`;
}

function optionLabel(o) {
  const code = o.option_key == null ? '' : String(o.option_key).trim();
  const desc = (o.description || o.title || '').trim();
  if (!desc) return code;
  // The parser deliberately labels RANGE rows as "Valid range". The original
  // NSDUH codebook prints only the RANGE expression, so preserve that layout.
  if (/^RANGE\s*=/i.test(code) && /^Valid range$/i.test(desc)) return code;
  if (/^RANGE\s*=/i.test(code)) return desc ? `${code}  ${desc}` : code;
  return code ? `${code} = ${desc}` : desc;
}

function pageLabel(v) {
  const p = v.codebook_page || v.page;
  if (p) return `Page- ${p}`;
  return v.pdf_page ? `PDF- ${v.pdf_page}` : '';
}

function addThinBorder(cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
  };
}

function approxQuestionHeight(text, widthChars = 105) {
  if (!text) return 24;
  const explicitLines = String(text).split(/\n/);
  let lines = 0;
  for (const part of explicitLines) lines += Math.max(1, Math.ceil(part.length / widthChars));
  return Math.max(24, Math.min(110, lines * 17));
}

async function makeExcel(payload) {
  const items = getSelections(payload);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NSDUH Variable Explorer';
  wb.created = new Date();

  const toc = wb.addWorksheet('Table of Contents', {
    views: [{ state: 'frozen', ySplit: 3 }],
    properties: { defaultRowHeight: 20 }
  });
  const ws = wb.addWorksheet('Variables', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 20 }
  });

  // Layout mirrors the user's clean Google Sheet:
  // Main category sits above the original codebook category.
  ws.columns = [
    { key: 'mainCategory', width: 20 },
    { key: 'section', width: 22 },
    { key: 'page', width: 14 },
    { key: 'code', width: 22 },
    { key: 'value', width: 60 },
    { key: 'freq', width: 15 },
    { key: 'pct', width: 13 }
  ];

  ws.getRow(1).values = ['Main Category', 'Codebook Category', 'Page', 'Question ID / Variable', 'Question / Response', 'Freq', 'Pct'];
  ws.getRow(1).font = { bold: true, size: 11 };
  ws.getRow(1).height = 26;
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

  let row = 2;
  const categoryRows = [];
  const seenCategories = new Set();
  const categoryCounts = new Map();
  const mainCategoryCounts = new Map();
  for (const { mainCategory, codebookCategory } of items) {
    const key = `${mainCategory}\u0000${codebookCategory}`;
    categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
    mainCategoryCounts.set(mainCategory, (mainCategoryCounts.get(mainCategory) || 0) + 1);
  }
  for (const { variable: v, options, mainCategory, codebookCategory } of items) {
    // Question is intentionally above the merged metadata cells, exactly like
    // the reference sheet. It spans C:F so long question wording stays readable.
    const categoryKey = `${mainCategory}\u0000${codebookCategory}`;
    const questionRow = row;
    const questionParts = [];
    if (v.question) questionParts.push(String(v.question).trim());
    if (v.notes || v.description) questionParts.push(`NOTE: ${String(v.notes || v.description).trim()}`);
    const questionText = questionParts.join('\n');

    if (questionText) {
      ws.mergeCells(questionRow, 4, questionRow, 7);
      ws.getCell(questionRow, 4).value = questionText;
      ws.getCell(questionRow, 4).alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
      ws.getCell(questionRow, 4).font = { size: 11 };
      ws.getRow(questionRow).height = approxQuestionHeight(questionText);
      row++;
    }

    const blockStart = row;
    if (!seenCategories.has(categoryKey)) {
      seenCategories.add(categoryKey);
      categoryRows.push({ mainCategory, codebookCategory, key: categoryKey, row: blockStart, page: pageLabel(v) });
    }
    ws.getCell(blockStart, 1).value = mainCategory;
    ws.getCell(blockStart, 2).value = codebookCategory;
    ws.getCell(blockStart, 3).value = pageLabel(v);
    ws.getCell(blockStart, 4).value = questionIdentifier(v);
    ws.getCell(blockStart, 5).value = variableHeading(v);
    ws.getCell(blockStart, 6).value = 'Freq';
    ws.getCell(blockStart, 7).value = 'Pct';
    ws.getCell(blockStart, 5).font = { bold: true };
    ws.getCell(blockStart, 6).font = { bold: true };
    ws.getCell(blockStart, 7).font = { bold: true };
    ws.getRow(blockStart).height = 23;
    row++;

    if (options.length) {
      for (const o of options) {
        ws.getCell(row, 5).value = optionLabel(o);
        if (o.frequency != null) {
          ws.getCell(row, 6).value = Number(o.frequency);
          ws.getCell(row, 6).numFmt = '0';
        }
        if (o.percent != null) {
          ws.getCell(row, 7).value = Number(o.percent);
          ws.getCell(row, 7).numFmt = '0.00';
        }
        ws.getCell(row, 5).alignment = { wrapText: true, vertical: 'middle', horizontal: 'left' };
        ws.getCell(row, 6).alignment = { vertical: 'middle', horizontal: 'right' };
        ws.getCell(row, 7).alignment = { vertical: 'middle', horizontal: 'right' };
        ws.getRow(row).height = 22;
        row++;
      }
    } else {
      ws.getCell(row, 5).value = '(No coded response/value rows parsed)';
      ws.getCell(row, 5).font = { italic: true };
      row++;
    }

    const blockEnd = row - 1;
    if (blockEnd > blockStart) {
      for (let col = 1; col <= 4; col++) ws.mergeCells(blockStart, col, blockEnd, col);
    }

    for (const col of [1, 2, 3, 4]) {
      ws.getCell(blockStart, col).alignment = {
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true
      };
    }
    ws.getCell(blockStart, 1).font = { bold: false, size: 11 };
    ws.getCell(blockStart, 4).font = { size: 11 };

    // One clean spacer row between variables. No borders on the spacer.
    row++;
  }

  const lastDataRow = Math.max(1, row - 1);
  for (let r = 1; r <= lastDataRow; r++) {
    // Skip spacer rows (completely blank).
    const values = ws.getRow(r).values;
    const hasContent = Array.isArray(values) && values.some((v, i) => i > 0 && v !== null && v !== undefined && v !== '');
    if (!hasContent) {
      ws.getRow(r).height = 8;
      continue;
    }
    for (let c = 1; c <= 7; c++) {
      const cell = ws.getCell(r, c);
      addThinBorder(cell);
      cell.alignment = {
        ...(cell.alignment || {}),
        wrapText: true,
        vertical: cell.alignment?.vertical || 'top'
      };
    }
  }

  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9, // A4
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 }
  };
  ws.autoFilter = 'A1:G1';

  toc.columns = [
    { key: 'mainCategory', width: 30 },
    { key: 'category', width: 42 },
    { key: 'count', width: 18 },
    { key: 'location', width: 20 }
  ];
  toc.mergeCells('A1:D1');
  toc.getCell('A1').value = 'Table of Contents';
  toc.getCell('A1').font = { bold: true, size: 16 };
  toc.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  toc.getRow(1).height = 30;
  toc.mergeCells('A2:D2');
  toc.getCell('A2').value = `Total variables: ${items.length}`;
  toc.getCell('A2').font = { bold: true };
  toc.getRow(3).values = ['Main Category', 'Codebook Category', 'Variables', 'Page'];
  toc.getRow(3).font = { bold: true };
  toc.getRow(3).alignment = { horizontal: 'center' };

  let tocRow = 4;
  let lastMainCategory = null;
  for (const { mainCategory, codebookCategory, key, row: targetRow, page } of categoryRows) {
    const target = `#'Variables'!A${targetRow}`;
    if (mainCategory !== lastMainCategory) {
      toc.mergeCells(tocRow, 1, tocRow, 2);
      toc.getCell(tocRow, 1).value = { text: `${mainCategory} (${mainCategoryCounts.get(mainCategory) || 0} variables)`, hyperlink: target };
      toc.getCell(tocRow, 1).font = { bold: true, size: 13, color: { argb: 'FF174E82' }, underline: true };
      toc.getCell(tocRow, 3).value = mainCategoryCounts.get(mainCategory) || 0;
      toc.getCell(tocRow, 3).alignment = { horizontal: 'center' };
      toc.getRow(tocRow).height = 25;
      tocRow++;
      lastMainCategory = mainCategory;
    }
    toc.getCell(tocRow, 2).value = { text: codebookCategory, hyperlink: target, tooltip: `Go to ${codebookCategory}` };
    toc.getCell(tocRow, 2).alignment = { indent: 1 };
    toc.getCell(tocRow, 2).font = { bold: true, color: { argb: 'FF0563C1' }, underline: true };
    toc.getCell(tocRow, 3).value = categoryCounts.get(key) || 0;
    toc.getCell(tocRow, 3).alignment = { horizontal: 'center' };
    toc.getCell(tocRow, 4).value = { text: page || `Variables row ${targetRow}`, hyperlink: target, tooltip: `Go to row ${targetRow}` };
    toc.getCell(tocRow, 4).font = { color: { argb: 'FF0563C1' }, underline: true };
    tocRow++;
  }
  for (let r = 3; r < tocRow; r++) {
    for (let c = 1; c <= 4; c++) addThinBorder(toc.getCell(r, c));
  }
  toc.autoFilter = 'A3:D3';
  toc.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  return wb.xlsx.writeBuffer();
}

// ---------- PDF codebook-style rendering ----------

const PDF = {
  marginLeft: 58,
  marginRight: 58,
  top: 34,
  bottom: 42,
  qidWidth: 115,
  freqWidth: 58,
  pctWidth: 50,
  bodySize: 10.5,
  valueSize: 10,
  labelSize: 10.5
};

function pdfPageWidth(doc) {
  return doc.page.width - PDF.marginLeft - PDF.marginRight;
}

function drawSectionPageHeader(doc, section) {
  if (!section) return;
  doc.font('Times-Roman').fontSize(11.5).fillColor('black');
  doc.text(section, PDF.marginLeft, 28, { width: pdfPageWidth(doc), align: 'center' });
}

function addCodebookPage(doc, section) {
  doc.addPage();
  drawSectionPageHeader(doc, section);
  doc.y = 60;
}

function ensurePdfSpace(doc, needed, section) {
  const limit = doc.page.height - PDF.bottom;
  if (doc.y + needed > limit) addCodebookPage(doc, section);
}

function textHeight(doc, text, opts = {}) {
  return doc.heightOfString(text || '', opts);
}

function formatFreq(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return String(Math.round(n));
}

function formatPct(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(2);
}

function drawDotLeader(doc, x1, x2, y) {
  if (x2 <= x1 + 8) return;
  doc.save();
  doc.lineWidth(0.5).dash(1, { space: 1.7 }).moveTo(x1, y).lineTo(x2, y).strokeColor('#444444').stroke();
  doc.undash().restore();
}

function estimateVariableBlock(doc, v, options, includeSectionTitle) {
  const contentW = pdfPageWidth(doc);
  let h = includeSectionTitle ? 30 : 6;
  doc.font('Times-Roman').fontSize(PDF.bodySize);
  h += textHeight(doc, v.question || '', { width: contentW, lineGap: 1 }) + 16;
  if (v.notes || v.description) {
    doc.font('Times-Italic').fontSize(9.2);
    h += textHeight(doc, `NOTE: ${v.notes || v.description}`, { width: contentW, lineGap: 1 }) + 8;
  }
  h += 26;
  h += Math.max(1, options.length) * 17;
  h += 20;
  return h;
}

function drawVariablePdf(doc, v, options, showSectionTitle = false, destination = null, sectionOverride = null) {
  const hierarchy = sectionOverride && typeof sectionOverride === 'object' ? sectionOverride : null;
  const section = hierarchy ? `${hierarchy.mainCategory} — ${hierarchy.codebookCategory}` : (sectionOverride || v.section || v.category || 'VARIABLES');
  const contentW = pdfPageWidth(doc);

  ensurePdfSpace(doc, estimateVariableBlock(doc, v, options, showSectionTitle), section);
  const startPage = doc.bufferedPageRange().count;
  if (destination) doc.addNamedDestination(destination, 'XYZ', PDF.marginLeft, doc.y, null);

  if (showSectionTitle) {
    const x = PDF.marginLeft;
    const y = doc.y;
    if (hierarchy) {
      if (hierarchy.showMain) {
        doc.font('Times-Bold').fontSize(16).fillColor('black').text(hierarchy.mainCategory, x, y);
        doc.font('Times-BoldItalic').fontSize(12.5).fillColor('#333333').text(hierarchy.codebookCategory, x + 16, y + 23);
        doc.y = y + 55;
      } else {
        doc.font('Times-BoldItalic').fontSize(12.5).fillColor('#333333').text(hierarchy.codebookCategory, x + 16, y);
        doc.y = y + 32;
      }
    } else {
      doc.font('Times-BoldItalic').fontSize(13).fillColor('black').text(section, x, y);
      doc.y = y + 34;
    }
  }

  if (v.question) {
    doc.font('Times-Roman').fontSize(PDF.bodySize).fillColor('black');
    doc.text(v.question, PDF.marginLeft, doc.y, { width: contentW, lineGap: 1.2 });
    doc.moveDown(0.65);
  }

  if (v.notes || v.description) {
    doc.font('Times-Italic').fontSize(9.2).fillColor('black');
    doc.text(`NOTE: ${v.notes || v.description}`, PDF.marginLeft, doc.y, { width: contentW, lineGap: 1 });
    doc.moveDown(0.55);
  }

  // Identifier/code at left, Len + variable label to its right.
  const metaY = doc.y;
  const labelX = PDF.marginLeft + PDF.qidWidth + 18;
  const labelW = contentW - PDF.qidWidth - 18;

  if (v.question_id) {
    doc.font('Times-Italic').fontSize(10.5).fillColor('black');
    doc.text(`(${v.question_id})`, PDF.marginLeft, metaY, { width: PDF.qidWidth });
  }

  const codeY = metaY + (v.question_id ? 15 : 0);
  doc.font('Times-Roman').fontSize(10.5).fillColor('#1756A9');
  doc.text(v.code || '', PDF.marginLeft, codeY, { width: PDF.qidWidth });
  const codeW = Math.min(PDF.qidWidth, doc.widthOfString(v.code || ''));
  if (codeW > 0) {
    doc.moveTo(PDF.marginLeft, codeY + 11.5).lineTo(PDF.marginLeft + codeW, codeY + 11.5)
      .lineWidth(0.45).strokeColor('#1756A9').stroke();
  }

  doc.font('Times-Roman').fontSize(PDF.labelSize).fillColor('black');
  doc.text(variableHeading(v), labelX, metaY + 10, { width: labelW });

  doc.y = Math.max(codeY + 21, metaY + 31);

  // Table positions reproduce the codebook's open layout (no box grid).
  const valuesX = labelX + 4;
  const pctX = doc.page.width - PDF.marginRight - PDF.pctWidth;
  const freqX = pctX - PDF.freqWidth - 8;
  const leaderEndX = freqX - 12;

  doc.font('Times-Bold').fontSize(10).fillColor('black');
  doc.text('Freq', freqX, doc.y, { width: PDF.freqWidth, align: 'right' });
  doc.text('Pct', pctX, doc.y, { width: PDF.pctWidth, align: 'right' });
  doc.y += 16;

  const rows = options.length ? options : [{ option_key: '', description: '(No coded response/value rows parsed)', frequency: null, percent: null }];
  for (const o of rows) {
    ensurePdfSpace(doc, 22, section);
    const y = doc.y;
    const label = optionLabel(o);
    doc.font('Times-Roman').fontSize(PDF.valueSize).fillColor('black');
    doc.text(label, valuesX, y, { width: leaderEndX - valuesX - 8, lineBreak: false, ellipsis: true });
    const labelWidth = Math.min(leaderEndX - valuesX - 8, doc.widthOfString(label));
    drawDotLeader(doc, valuesX + labelWidth + 4, leaderEndX, y + 10);
    doc.text(formatFreq(o.frequency), freqX, y, { width: PDF.freqWidth, align: 'right' });
    doc.text(formatPct(o.percent), pctX, y, { width: PDF.pctWidth, align: 'right' });
    doc.y = y + 16;
  }

  doc.y += 24;
  return startPage;
}

function drawPdfTocPage(doc, entries, pageIndex, pageCount, totalVariables) {
  doc.font('Times-Bold').fontSize(20).fillColor('black');
  doc.text('Table of Contents', PDF.marginLeft, 45, { width: pdfPageWidth(doc), align: 'center' });
  doc.font('Times-Roman').fontSize(11).text(`Total variables: ${totalVariables}`, PDF.marginLeft, 78, { width: pdfPageWidth(doc), align: 'center' });
  if (pageCount > 1) doc.fontSize(9).text(`Contents page ${pageIndex + 1} of ${pageCount}`, PDF.marginLeft, 96, { width: pdfPageWidth(doc), align: 'center' });

  let y = pageCount > 1 ? 124 : 108;
  doc.font('Times-Bold').fontSize(10.5);
  doc.text('Category hierarchy', PDF.marginLeft, y, { width: pdfPageWidth(doc) - 190 });
  doc.text('Variables', doc.page.width - PDF.marginRight - 165, y, { width: 80, align: 'right' });
  doc.text('Page', doc.page.width - PDF.marginRight - 55, y, { width: 55, align: 'right' });
  y += 22;
  for (const entry of entries) {
    const isMain = entry.level === 1;
    doc.font(isMain ? 'Times-Bold' : 'Times-BoldItalic').fontSize(isMain ? 13 : 11).fillColor(isMain ? '#123E68' : '#1756A9');
    doc.text(entry.label, PDF.marginLeft + (isMain ? 0 : 24), y, {
      width: pdfPageWidth(doc) - 190 - (isMain ? 0 : 24),
      lineBreak: false,
      ellipsis: true,
      goTo: entry.destination,
      underline: true
    });
    doc.font('Times-Roman').fontSize(11).fillColor('black');
    doc.text(String(entry.count), doc.page.width - PDF.marginRight - 165, y, {
      width: 80,
      align: 'right'
    });
    doc.fillColor('#1756A9');
    doc.text(String(entry.page), doc.page.width - PDF.marginRight - 55, y, {
      width: 55,
      align: 'right',
      goTo: entry.destination,
      underline: true
    });
    y += isMain ? 23 : 18;
  }
}

function makePdf(payload) {
  const items = getSelections(payload);
  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: PDF.top, right: PDF.marginRight, bottom: PDF.bottom, left: PDF.marginLeft },
    autoFirstPage: false,
    bufferPages: true,
    info: { Title: 'NSDUH Selected Variables', Author: 'NSDUH Variable Explorer' }
  });

  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const sections = [];
  const seenSections = new Set();
  const sectionCounts = new Map();
  const mainCategoryCounts = new Map();
  for (const { mainCategory, codebookCategory } of items) {
    const key = `${mainCategory}\u0000${codebookCategory}`;
    sectionCounts.set(key, (sectionCounts.get(key) || 0) + 1);
    mainCategoryCounts.set(mainCategory, (mainCategoryCounts.get(mainCategory) || 0) + 1);
    if (!seenSections.has(key)) {
      seenSections.add(key);
      sections.push({ key, mainCategory, codebookCategory });
    }
  }
  const groupedItems = sections.flatMap(section => items.filter(item =>
    item.mainCategory === section.mainCategory && item.codebookCategory === section.codebookCategory
  ));
  const tocOutline = [];
  for (const section of sections) {
    if (!tocOutline.some(entry => entry.level === 1 && entry.mainCategory === section.mainCategory)) {
      tocOutline.push({ level: 1, mainCategory: section.mainCategory });
    }
    tocOutline.push({ level: 2, ...section });
  }
  const tocRowsPerPage = 19;
  const tocPageCount = Math.max(1, Math.ceil(tocOutline.length / tocRowsPerPage));
  for (let i = 0; i < tocPageCount; i++) doc.addPage();

  let currentSection = null;
  let currentMainCategory = null;
  const tocEntries = [];
  for (const { variable: v, options, mainCategory, codebookCategory } of groupedItems) {
    const key = `${mainCategory}\u0000${codebookCategory}`;
    const section = `${mainCategory}  —  ${codebookCategory}`;
    if (!doc.page || !doc.page.width) {
      addCodebookPage(doc, section);
      currentSection = section;
    }

    const changedSection = section !== currentSection;
    if (changedSection) {
      addCodebookPage(doc, section);
      currentSection = section;
    }

    const isFirstInSection = !tocEntries.some(entry => entry.key === key);
    const destination = isFirstInSection ? `section-${tocEntries.length + 1}` : null;
    const showMain = mainCategory !== currentMainCategory;
    const page = drawVariablePdf(doc, v, options, changedSection || doc.y <= 64, destination, { mainCategory, codebookCategory, showMain });
    currentMainCategory = mainCategory;
    if (isFirstInSection) tocEntries.push({
      key,
      mainCategoryRaw: mainCategory,
      mainCategory: `${mainCategory} (${mainCategoryCounts.get(mainCategory) || 0} total)`,
      codebookCategory,
      destination,
      page,
      count: sectionCounts.get(key) || 0
    });
  }

  const hierarchicalTocEntries = [];
  for (const outlineEntry of tocOutline) {
    if (outlineEntry.level === 1) {
      const first = tocEntries.find(entry => entry.mainCategoryRaw === outlineEntry.mainCategory || entry.mainCategory.startsWith(`${outlineEntry.mainCategory} (`));
      hierarchicalTocEntries.push({
        level: 1,
        label: `${outlineEntry.mainCategory} (${mainCategoryCounts.get(outlineEntry.mainCategory) || 0} variables)`,
        count: mainCategoryCounts.get(outlineEntry.mainCategory) || 0,
        destination: first?.destination,
        page: first?.page || ''
      });
    } else {
      const match = tocEntries.find(entry => entry.key === outlineEntry.key);
      if (match) hierarchicalTocEntries.push({ ...match, level: 2, label: outlineEntry.codebookCategory });
    }
  }

  if (!items.length) {
    // The TOC itself is the complete empty export.
  }


  for (let i = 0; i < tocPageCount; i++) {
    doc.switchToPage(i);
    drawPdfTocPage(
      doc,
      hierarchicalTocEntries.slice(i * tocRowsPerPage, (i + 1) * tocRowsPerPage),
      i,
      tocPageCount,
      items.length
    );
  }

  doc.end();
  return done;
}

module.exports = { makeExcel, makePdf };
