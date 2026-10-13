import json, random, subprocess, sys
rows = [json.loads(l) for l in open(sys.argv[1])]
by_doc = {}
for r in rows:
    by_doc.setdefault(r["doc_id"], []).append(r)
random.seed(int(sys.argv[2]))
docs = random.sample(sorted(by_doc), 40)
sample = [random.choice(by_doc[d]) for d in docs]
json.dump(sample, open(sys.argv[3], "w"), indent=1)
for i, r in enumerate(sample, 1):
    year = r["url"].split("/")[-2]
    txt = subprocess.run(["pdftotext", "-layout", "-f", str(r["page"]), "-l", str(r["page"]), f"house/{year}/{r['doc_id']}.pdf", "-"], capture_output=True, text=True).stdout.splitlines()
    hits = [j for j, l in enumerate(txt) if r["date"] in l and r["notified"] in l]
    print(f"#{i} {r['doc_id']} p{r['page']} | {r['filer']} | {r['owner']} | {r['asset']} | tk={r['ticker']} | {r['type']} | {r['date']} | {r['notified']} | {r['amount']}  [hits={len(hits)}]")
    for j in hits[:3]:
        print("   " + "\n   ".join(l[:165].replace("\x00", "") for l in txt[j:j+3]))
        print("   ..")
