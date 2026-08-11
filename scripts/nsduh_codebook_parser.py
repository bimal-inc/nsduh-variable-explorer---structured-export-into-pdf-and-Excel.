#!/usr/bin/env python3
"""Parse NSDUH public-use codebook PDFs into normalized tables.

Designed and tested against:
  2021 NSDUH Public Use File Codebook (12/13/2023)

Outputs:
  variables.csv       one row per NSDUH variable
  value_codes.csv     one row per code/range category
  codebook.json       nested loss-minimizing representation
  parse_warnings.csv  records that need manual review

Usage:
  python nsduh_codebook_parser.py NSDUH-2021-DS0001-info-codebook.pdf -o output_dir

The parser uses PyMuPDF's text extraction and a state machine rather than OCR.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, Optional

import fitz  # PyMuPDF


VAR_RE = re.compile(
    r"^\s*(?P<variable>[A-Z][A-Z0-9_]{1,31})\s+Len\s*:\s*(?P<length>\d+)\s+(?P<label>.+?)\s*$"
)
QID_RE = re.compile(r"^\s*\((?P<qid>[^()]{1,180})\)\s*$")
FREQ_HEADER_RE = re.compile(r"^\s*Freq\s+Pct\s*$", re.I)
PAGE_FOOTER_RE = re.compile(r"^\s*Codebook Creation Date:.*?\.{2,}\s*\d+\s*$", re.I)
PAGE_NO_RE = re.compile(r"^\s*(?:i-)?\d+\s*$")

# Code/range line ending in frequency and percentage.
# Description is intentionally non-greedy so dotted leaders stay out.
VALUE_RE = re.compile(
    r"^\s*(?P<code>RANGE\s*=\s*.+?|[^=]{1,35}?\s*=\s*[^.]+?)"
    r"(?:\.{2,}|\s{2,})\s*(?P<freq>[0-9,]+)\s+(?P<pct>\d+(?:\.\d+)?)\s*$",
    re.I,
)
# More permissive fallback for descriptions that contain periods/parentheses.
VALUE_FALLBACK_RE = re.compile(
    r"^\s*(?P<body>.+?)\s+(?P<freq>[0-9,]+)\s+(?P<pct>\d+(?:\.\d+)?)\s*$"
)
NOTE_RE = re.compile(r"^\s*(NOTE|NOTES|CAUTION|WARNING)\s*:\s*(.*)$", re.I)

# Common NSDUH top-of-page section headings. The parser also accepts other
# all-uppercase headings at the top of a page, but these help avoid false positives.
KNOWN_SECTIONS = {
    "IDENTIFICATION", "TOBACCO", "ALCOHOL", "MARIJUANA", "COCAINE", "CRACK",
    "HEROIN", "HALLUCINOGENS", "INHALANTS", "METHAMPHETAMINE",
    "PAIN RELIEVERS SCREENER", "TRANQUILIZERS SCREENER", "STIMULANTS SCREENER",
    "SEDATIVES SCREENER", "PAIN RELIEVERS", "TRANQUILIZERS", "STIMULANTS", "SEDATIVES",
    "RECENCY OF DRUG USE", "PAST YEAR FREQUENCY OF USE", "PAST MONTH FREQUENCY OF USE",
    "AGE/DATE OF FIRST DRUG USE", "RECODED DRUG USE", "SPECIAL DRUGS",
    "IMPUTED SPECIAL DRUGS", "RECODED SPECIAL DRUGS", "RISK/AVAILABILITY",
    "RECODED RISK/AVAILABILITY", "BLUNTS", "NICOTINE DEPENDENCE",
    "IMPUTED NICOTINE DEPENDENCE", "SUBSTANCE USE DISORDER",
    "IMPUTED SUBSTANCE USE DISORDER", "RECODED SUBSTANCE USE DISORDER", "SPECIAL TOPICS",
    "RECODED SPECIAL TOPICS", "PRIOR SUBSTANCE USE", "DRUG TREATMENT",
    "RECODED DRUG TREATMENT", "HEALTH", "RECODED HEALTH",
    "ADULT MENTAL HEALTH SERVICE UTILIZATION", "RECODED ADULT MENTAL HEALTH SERVICE UTILIZATION",
    "SOCIAL ENVIRONMENT", "YOUTH EXPERIENCES", "RECODED YOUTH EXPERIENCES", "MENTAL HEALTH",
    "IMPUTED MENTAL HEALTH", "RECODED MENTAL HEALTH", "ADULT DEPRESSION",
    "IMPUTED ADULT DEPRESSION", "RECODED ADULT DEPRESSION",
    "YOUTH MENTAL HEALTH SERVICE UTILIZATION", "RECODED YOUTH MENTAL HEALTH SERVICE UTILIZATION",
    "ADOLESCENT DEPRESSION", "RECODED ADOLESCENT DEPRESSION", "CONSUMPTION OF ALCOHOL",
    "RECODED CONSUMPTION OF ALCOHOL", "EMERGING ISSUES", "IMPUTED EMERGING ISSUES",
    "RECODED EMERGING ISSUES", "MARKET INFORMATION FOR MARIJUANA", "DEMOGRAPHICS",
    "IMPUTED DEMOGRAPHICS", "RECODED DEMOGRAPHICS", "EDUCATION", "RECODED EDUCATION",
    "EMPLOYMENT", "IMPUTED EMPLOYMENT", "HOUSEHOLD COMPOSITION (ROSTER)", "COVID-19",
    "RECODED COVID-19", "PROXY INFORMATION", "HEALTH INSURANCE", "IMPUTED HEALTH INSURANCE",
    "RECODED HEALTH INSURANCE", "INCOME", "IMPUTED INCOME", "RECODED INCOME", "COUNTY",
    "SEGMENT", "BLOCK", "SAMPLE WEIGHTING AND ESTIMATION VARS",
}


@dataclass
class ValueCode:
    code: str
    description: str
    frequency: Optional[int]
    percent: Optional[float]
    raw_line: str = ""


@dataclass
class VariableRecord:
    section: str
    pdf_page: int
    codebook_page: str
    question_id: str
    variable: str
    length: int
    label: str
    question_text: str
    notes: str = ""
    values: list[ValueCode] = field(default_factory=list)


@dataclass
class WarningRecord:
    page: int
    variable: str
    issue: str
    text: str


def clean_ws(text: str) -> str:
    text = text.replace("\u0002", "-")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_heading(line: str) -> bool:
    s = clean_ws(line)
    if not s or len(s) > 90:
        return False
    if s in KNOWN_SECTIONS:
        return True
    # Generic top-page uppercase heading, but exclude labels that contain digits/codes.
    return (
        s == s.upper()
        and any(c.isalpha() for c in s)
        and not re.search(r"\d", s)
        and not s.startswith(("NOTE:", "NOTES:", "TABLE", "APPENDIX", "CODEBOOK"))
    )


def extract_pages(pdf_path: Path) -> list[list[str]]:
    doc = fitz.open(pdf_path)
    pages: list[list[str]] = []
    for page in doc:
        # sorted=True generally follows visual reading order for this codebook.
        txt = page.get_text("text", sort=True)
        pages.append(txt.splitlines())
    return pages


def split_code_description(body: str) -> tuple[str, str]:
    body = re.sub(r"\.{2,}", " ", body).strip()
    if re.match(r"^RANGE\s*=", body, re.I):
        m = re.match(r"^(RANGE\s*=\s*.+?)\s*$", body, re.I)
        return (clean_ws(m.group(1)) if m else clean_ws(body), "Valid range")
    if "=" in body:
        left, right = body.split("=", 1)
        return clean_ws(left), clean_ws(right)
    return clean_ws(body), ""


def parse_value_line(line: str) -> Optional[ValueCode]:
    m = VALUE_RE.match(line)
    if m:
        body = m.group("code")
        code, desc = split_code_description(body)
        return ValueCode(code, desc, int(m.group("freq").replace(",", "")), float(m.group("pct")), line.rstrip())

    # Fallback: require an equals sign or RANGE marker to avoid treating ordinary prose as a value row.
    if "=" not in line and "RANGE" not in line.upper():
        return None
    m = VALUE_FALLBACK_RE.match(line)
    if not m:
        return None
    body = re.sub(r"\.{2,}", " ", m.group("body")).strip()
    if "=" not in body and not body.upper().startswith("RANGE"):
        return None
    code, desc = split_code_description(body)
    return ValueCode(code, desc, int(m.group("freq").replace(",", "")), float(m.group("pct")), line.rstrip())


def strip_noise(lines: Iterable[str], current_section: str = "") -> list[str]:
    out = []
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if PAGE_FOOTER_RE.match(s) or PAGE_NO_RE.match(s):
            continue
        if FREQ_HEADER_RE.match(s):
            continue
        if current_section and clean_ws(s) == current_section:
            continue
        out.append(clean_ws(s))
    return out


def parse_codebook(pdf_path: Path) -> tuple[list[VariableRecord], list[WarningRecord]]:
    pages = extract_pages(pdf_path)
    records: list[VariableRecord] = []
    warnings: list[WarningRecord] = []
    current_section = ""
    prose_buffer: list[str] = []
    pending_qid = ""
    current: Optional[VariableRecord] = None
    in_values = False

    def finalize_current() -> None:
        nonlocal current, in_values
        if current is not None:
            records.append(current)
        current = None
        in_values = False

    for page_num, lines in enumerate(pages, start=1):
        codebook_page = ""
        for footer_line in lines:
            fm = PAGE_FOOTER_RE.match(footer_line.strip())
            if fm:
                nm = re.search(r"(\d+)\s*$", footer_line.strip())
                if nm:
                    codebook_page = nm.group(1)
                break
        # Detect section from first few non-empty lines. NSDUH repeats the section at page tops.
        top = [clean_ws(x) for x in lines if clean_ws(x)][:8]
        detected_section = current_section
        for candidate in top:
            if is_heading(candidate):
                detected_section = candidate
                break
        if detected_section != current_section:
            # Introductory prose from the front matter must not leak into the first
            # variable of a new codebook section.
            if current is not None:
                finalize_current()
            prose_buffer = []
            pending_qid = ""
            current_section = detected_section

        i = 0
        while i < len(lines):
            raw = lines[i]
            s = raw.strip()
            i += 1

            if not s:
                # Preserve paragraph separation as one blank marker in prose buffer.
                if prose_buffer and prose_buffer[-1] != "":
                    prose_buffer.append("")
                continue
            if PAGE_FOOTER_RE.match(s) or PAGE_NO_RE.match(s):
                continue
            if clean_ws(s) == current_section:
                continue

            # Variable header starts a new record.
            vm = VAR_RE.match(s)
            if vm:
                finalize_current()
                question_lines = strip_noise(prose_buffer, current_section)
                question_text = clean_ws(" ".join(question_lines))
                # Avoid carrying preceding value rows or headings into question text.
                question_text = re.sub(r"^(?:Freq Pct\s*)+", "", question_text, flags=re.I)
                current = VariableRecord(
                    section=current_section,
                    pdf_page=page_num,
                    codebook_page=codebook_page,
                    question_id=pending_qid,
                    variable=vm.group("variable"),
                    length=int(vm.group("length")),
                    label=clean_ws(vm.group("label")),
                    question_text=question_text,
                )
                pending_qid = ""
                prose_buffer = []
                in_values = False
                continue

            # Question/source identifier directly preceding a variable header.
            qm = QID_RE.match(s)
            if qm:
                # If current variable already has values, this QID belongs to the next variable.
                if current is not None:
                    finalize_current()
                pending_qid = clean_ws(qm.group("qid"))
                # prose_buffer intentionally remains: it contains the question asked before (QID).
                continue

            if FREQ_HEADER_RE.match(s):
                in_values = True
                continue

            if current is not None:
                note = NOTE_RE.match(s)
                if note:
                    current.notes = clean_ws((current.notes + " " + s).strip())
                    in_values = False
                    continue

                value = parse_value_line(raw)
                if value:
                    current.values.append(value)
                    in_values = True
                    continue

                # Wrapped value-label text: attach to previous description only when indentation is deep
                # and the line does not resemble a new question or metadata line.
                if in_values and current.values and raw[:20].strip() == "" and not s.startswith("("):
                    cont = clean_ws(s)
                    if cont and not PAGE_FOOTER_RE.match(cont):
                        current.values[-1].description = clean_ws(current.values[-1].description + " " + cont)
                        current.values[-1].raw_line += " " + s
                        continue

                # Once prose appears after values, the variable has ended and the prose belongs to next record.
                if in_values and current.values:
                    finalize_current()
                    prose_buffer = [s]
                    continue

                # Text after a variable header but before value rows is usually a note/definition.
                current.notes = clean_ws((current.notes + " " + s).strip())
                continue

            # No current variable: collect question/prose for the next header.
            prose_buffer.append(s)

    finalize_current()

    # Basic QA warnings.
    for rec in records:
        if not rec.section:
            warnings.append(WarningRecord(rec.pdf_page, rec.variable, "missing_section", rec.label))
        if not rec.values:
            warnings.append(WarningRecord(rec.pdf_page, rec.variable, "no_value_rows", rec.label))
        if not rec.label:
            warnings.append(WarningRecord(rec.pdf_page, rec.variable, "missing_label", ""))

    return records, warnings


def write_outputs(records: list[VariableRecord], warnings: list[WarningRecord], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    variables_path = out_dir / "variables.csv"
    with variables_path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=[
            "section", "pdf_page", "codebook_page", "question_id", "variable", "length", "label",
            "question_text", "notes", "value_count"
        ])
        w.writeheader()
        for r in records:
            w.writerow({
                "section": r.section,
                "pdf_page": r.pdf_page,
                "codebook_page": r.codebook_page,
                "question_id": r.question_id,
                "variable": r.variable,
                "length": r.length,
                "label": r.label,
                "question_text": r.question_text,
                "notes": r.notes,
                "value_count": len(r.values),
            })

    values_path = out_dir / "value_codes.csv"
    with values_path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=[
            "section", "pdf_page", "codebook_page", "question_id", "variable", "variable_label",
            "code", "description", "frequency", "percent", "raw_line"
        ])
        w.writeheader()
        for r in records:
            for v in r.values:
                w.writerow({
                    "section": r.section,
                    "pdf_page": r.pdf_page,
                    "codebook_page": r.codebook_page,
                    "question_id": r.question_id,
                    "variable": r.variable,
                    "variable_label": r.label,
                    "code": v.code,
                    "description": v.description,
                    "frequency": v.frequency,
                    "percent": v.percent,
                    "raw_line": v.raw_line,
                })

    json_path = out_dir / "codebook.json"
    with json_path.open("w", encoding="utf-8") as f:
        json.dump([asdict(r) for r in records], f, ensure_ascii=False, indent=2)

    warnings_path = out_dir / "parse_warnings.csv"
    with warnings_path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["page", "variable", "issue", "text"])
        w.writeheader()
        for wr in warnings:
            w.writerow(asdict(wr))


def main() -> None:
    ap = argparse.ArgumentParser(description="Parse NSDUH PDF codebook into normalized CSV/JSON tables.")
    ap.add_argument("pdf", type=Path, help="Path to NSDUH codebook PDF")
    ap.add_argument("-o", "--output", type=Path, default=Path("nsduh_parsed"), help="Output directory")
    ap.add_argument("--section", help="Optionally keep only a section, e.g. ALCOHOL")
    args = ap.parse_args()

    records, warnings = parse_codebook(args.pdf)
    if args.section:
        wanted = args.section.strip().upper()
        records = [r for r in records if r.section.upper() == wanted]
        warnings = [w for w in warnings if any(r.variable == w.variable for r in records)]
    write_outputs(records, warnings, args.output)

    value_rows = sum(len(r.values) for r in records)
    print(f"Parsed {len(records):,} variables and {value_rows:,} value/code rows.")
    print(f"Warnings: {len(warnings):,}")
    print(f"Output: {args.output.resolve()}")


if __name__ == "__main__":
    main()
