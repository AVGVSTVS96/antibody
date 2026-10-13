import json, sys, time, pathlib, requests
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
s = requests.Session(); s.headers["User-Agent"] = "antibody research"
for term in ["GENIUS Act", "stablecoin"]:
    for year in [2025, 2026]:
        url = f"https://lda.gov/api/v1/filings/?filing_specific_lobbying_issues={term}&filing_year={year}&page_size=25"
        page = 1
        while url:
            f = out / f"{term.replace(' ', '_')}_{year}_{page:03d}.json"
            if f.exists():
                d = json.loads(f.read_text())
            else:
                r = s.get(url, timeout=60)
                if r.status_code == 429:
                    time.sleep(int(r.headers.get("Retry-After", 30))); continue
                r.raise_for_status(); d = r.json(); f.write_text(json.dumps(d)); time.sleep(0.7)
            print(term, year, page, d["count"], flush=True)
            url = d["next"]; page += 1
