import sys, duckdb
db = duckdb.connect(sys.argv[1], read_only=True)
rows = db.sql("""select * from (
  select m.mid, m.source, m.raw_name, x.edgar_name, x.ticker, x.method, x.confidence,
         row_number() over (partition by x.method like 'llm%' order by hash(m.mid || 'antibody')) as k,
         x.method like 'llm%' as llm
  from matches x join mentions m using (mid) where x.method <> 'ticker') where k <= 25 order by llm, k""").fetchall()
for r in rows: print("|".join(str(v) for v in r[:7]))
