import re

PAREN = re.compile(r"\((?:F/?K/?A|FORMERLY|D/?B/?A|ON BEHALF OF)[^)]*\)|\b(?:F/?K/?A|D/?B/?A|FORMERLY KNOWN AS)\b.*$")
NOISE = re.compile(r"\b(?:AND (?:ITS )?(?:AFFILIATES|SUBSIDIARIES)|POLITICAL ACTION COMMITTEE|EMPLOYEES?|FEDERAL|GOOD GOVERNMENT|"
                   r"COMMON STOCK|CLASS [A-C]|ORDINARY SHARES|SPONSORED ADR|ADR|ADS|COMMON|STOCK|SHARES|PAC|FUND|COMMITTEE)\b")
SUFFIX = re.compile(r"\b(?:INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LLC|L L C|LP|L P|LLP|LTD|LIMITED|PLC|N ?A|SA|AG|NV|SE|"
                    r"HOLDINGS?|GROUP|THE|DE|NEW|CL [A-C])\b")


def norm(name):
    s = (name or "").upper().replace("&", " AND ").replace("’", "'")
    s = re.sub(r"^.*\b(?:OBO|ON BEHALF OF)\b", " ", s)
    s = re.sub(r"\s*/[A-Z]{2,3}/?\s*$|/ADR\b|/NEW/", " ", s)
    s = PAREN.sub(" ", s)
    s = re.sub(r"\([A-Z0-9]*PAC[A-Z0-9]*\)|\(.*?\)", " ", s)
    s = re.sub(r"[^A-Z0-9 ]+", " ", s.replace("'", ""))
    s = NOISE.sub(" ", s)
    s = SUFFIX.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()
