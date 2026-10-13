import sys
from pathlib import Path

import duckdb

D = Path(sys.argv[1])
db = duckdb.connect(str(D / "genius.duckdb"))

PAS2 = "CMTE_ID,AMNDT_IND,RPT_TP,TRANSACTION_PGI,IMAGE_NUM,TRANSACTION_TP,ENTITY_TP,NAME,CITY,STATE,ZIP_CODE,EMPLOYER,OCCUPATION,TRANSACTION_DT,TRANSACTION_AMT,OTHER_ID,CAND_ID,TRAN_ID,FILE_NUM,MEMO_CD,MEMO_TEXT,SUB_ID"
CM = "CMTE_ID,CMTE_NM,TRES_NM,CMTE_ST1,CMTE_ST2,CMTE_CITY,CMTE_ST,CMTE_ZIP,CMTE_DSGN,CMTE_TP,CMTE_PTY_AFFILIATION,CMTE_FILING_FREQ,ORG_TP,CONNECTED_ORG_NM,CAND_ID"


def read(path, cols):
    names = cols.split(",")
    spec = "{" + ",".join(f"'{c}':'VARCHAR'" for c in names) + "}"
    return f"read_csv('{path}', delim='|', header=false, quote='', escape='', columns={spec}, ignore_errors=true)"


fec = D / "fec"
db.execute(f"""
create or replace table fec_cm as
  select *, '2026' as cycle from {read(fec / 'cm26/cm.txt', CM)}
  union all by name
  select *, '2024' as cycle from {read(fec / 'cm24/cm.txt', CM)} where CMTE_ID not in (select CMTE_ID from {read(fec / 'cm26/cm.txt', CM)});

create or replace table member_fec as
  select n.id member, unnest(from_json(json_extract(n.props, '$.fec_ids'), '["VARCHAR"]')) cand_id
  from nodes n where kind = 'member';

create or replace table fec_pas2 as
  select p.*, m.member, strptime(TRANSACTION_DT, '%m%d%Y')::date dt, TRANSACTION_AMT::double amt,
         case when p.CMTE_ID in (select CMTE_ID from fec_cm) then 1 end known
  from (select *, '2026' as cycle from {read(fec / 'pas226/itpas2.txt', PAS2)}
        union all select *, '2024' as cycle from {read(fec / 'pas224/itpas2.txt', PAS2)}) p
  join member_fec m on m.cand_id = p.CAND_ID
  where TRANSACTION_TP in ('24K', '24Z') and coalesce(MEMO_CD, '') <> 'X';
""")
print(db.sql("select count(*) as n_rows, count(distinct member) members, count(distinct CMTE_ID) donors, sum(amt) total from fec_pas2"))
print(db.sql("""select c.CMTE_TP, c.ORG_TP, count(distinct p.CMTE_ID) donors, sum(amt) total
                from fec_pas2 p left join fec_cm c using (CMTE_ID) group by all order by total desc limit 12"""))
