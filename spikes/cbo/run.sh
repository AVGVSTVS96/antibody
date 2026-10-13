#!/usr/bin/env bash
# Rebuild every output from the downloaded CBO files and print the reconciliation and section-mapping numbers.
set -euo pipefail
cd "$(dirname "$0")"
DATA=../../data/cbo
PY="uv run -q --isolated --with openpyxl --with pdfplumber python"
GOV=https://www.govinfo.gov/content/pkg
mkdir -p out

$PY parse_xlsx.py $DATA/files/61570-pl119-21-2025Recon-CLB.xlsx meta/hr1-pl119-21-clb.json > out/hr1-pl119-21-clb.json
$PY parse_xlsx.py $DATA/files/61569-pl119-21-2025Recon-BEB.xlsx meta/hr1-pl119-21-beb.json > out/hr1-pl119-21-beb.json
$PY parse_xlsx.py $DATA/files/HR1_HousePassed_6-4-2025.xlsx meta/hr1-house-passed.json > out/hr1-house-passed.json
$PY parse_pdf.py $DATA/files/PL117-169_9-7-22.pdf meta/hr5376-pl117-169.json > out/hr5376-pl117-169.json
$PY parse_table1.py $DATA/files/s1582table1.xlsx $DATA/files/s1582.pdf meta/s1582-es.json > out/s1582-es.json

for f in hr1-pl119-21-clb hr1-pl119-21-beb hr1-house-passed hr5376-pl117-169; do
  python3 -I reconcile.py out/$f.json > out/$f.reconcile.txt
done

map() { python3 -I map_sections.py "out/$1.json" "$DATA/bills/$2.xml" "$GOV/$2/xml/$2.xml" > "out/$1.mapping.json"; }
map hr1-pl119-21-clb BILLS-119hr1enr
map hr1-pl119-21-beb BILLS-119hr1enr
map hr1-house-passed BILLS-119hr1eh
map hr5376-pl117-169 BILLS-117hr5376enr

python3 -I export.py out > out/cbo_rows.json
