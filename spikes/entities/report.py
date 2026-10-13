import sys, duckdb
db = duckdb.connect(sys.argv[1], read_only=True)
q = lambda s: print(db.sql(s))
q("""select m.raw_name, x.edgar_name, x.ticker, x.confidence from matches x join mentions m using (mid)
     where x.method like 'llm%' and (regexp_matches(m.raw_name, '(?i)talos|williams|mccormick|heineken|honeywell'))""")
q("""select source, count(*) as names, count(x.mid) as resolved, round(100.0*count(x.mid)/count(*),1) as pct
     from mentions m left join (select distinct mid from matches) x using (mid) group by 1 order by 1""")
q("""select n.label as company, n.props->>'ticker' as ticker, count(distinct e.src) as lda_clients
     from edges e join nodes n on n.id = e.dst where e.kind='resolves_to' and e.src like 'lda_client:%' group by all order by 3 desc limit 12""")
q("""select p.label as pac, m.label as member, m.props->>'party' as party, (e.props->>'amount_usd')::double as usd, e.source_url
     from edges e join nodes p on p.id=e.src join nodes m on m.id=e.dst
     where e.kind='contributed' and e.dst in (select src from edges where kind in ('sponsored','cosponsored'))
     order by usd desc limit 10""")
q("""select m.label as member, m.props->>'party' as party, c.props->>'ticker' as ticker, e.props->>'date' as date,
            e.props->>'type' as type, e.props->>'amount' as amount, e.source_url
     from edges e join nodes m on m.id=e.src join nodes c on c.id=e.dst
     where e.kind='traded' and e.src in (select src from edges where kind='member_of') order by date desc limit 10""")
q("""select m.props->>'party' as party, count(distinct e.dst) as members_funded, sum((e.props->>'amount_usd')::double) as usd
     from edges e join nodes m on m.id=e.dst where e.kind='contributed' group by 1""")
