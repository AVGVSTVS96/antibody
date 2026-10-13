#!/usr/bin/env bash
# Download the CBO files (via the Internet Archive, since cbo.gov answers scripts with a DataDome 403), the bill XML and the congress.gov bill records.
set -euo pipefail
cd "$(dirname "$0")/../.."
D=data/cbo
mkdir -p $D/files $D/bills
for b in 119/s/1582 119/hr/1 117/hr/5376; do
  curl -sf "https://api.congress.gov/v3/bill/$b?api_key=${DATA_GOV_KEY:-DEMO_KEY}&format=json" > "$D/bill-${b//\//-}.json"
done
wayback() {
  local ts; ts=$(curl -s "https://web.archive.org/cdx/search/cdx?url=$1&fl=timestamp&filter=statuscode:200&limit=1")
  curl -sfL -o "$D/files/$(basename "$1")" "https://web.archive.org/web/${ts}id_/$1"
  sleep 2
}
for f in 2025-07/s1582.pdf 2025-07/s1582table1.xlsx 2025-07/61570-pl119-21-2025Recon-CLB.xlsx 2025-07/61569-pl119-21-2025Recon-BEB.xlsx \
         2025-06/HR1_HousePassed_6-4-2025.xlsx 2022-09/PL117-169_9-7-22.pdf 2022-08/hr5376_IR_Act_8-3-22.pdf; do
  wayback "https://www.cbo.gov/system/files/$f"
done
for p in BILLS-119hr1enr BILLS-119hr1eh BILLS-119s1582es BILLS-119s1582enr BILLS-117hr5376enr; do
  curl -sfL -o "$D/bills/$p.xml" "https://www.govinfo.gov/content/pkg/$p/xml/$p.xml"
done
