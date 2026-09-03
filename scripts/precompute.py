"""
Waldbrand-Dashboard - precompute.py

Laedt jaehrliche Waldbrandflaechen (Hektar) je europaeischem Land vom GWIS/
EFFIS-Dienst der EU-Kommission (Copernicus Emergency Management Service,
kein API-Key noetig). Ein Request pro Jahr liefert alle Laender auf einmal.

Zwei API-Modi werden kombiniert:
- scope=gwis: alle 53 Laender, aber erst ab 2012
- scope=effis: nur eine Teilmenge (v.a. feuergefaehrdete Mittelmeer-/Balkan-
  Laender), dafuer bis 2000 zurueck
Fuer 2000-2011 wird effis genutzt (wo verfuegbar), ab 2012 gwis (offizielle,
vollstaendige Abdeckung). Vor 2000 liefert keiner der beiden Modi Daten -
das ist die harte Grenze des Dienstes, nicht einstellbar.

Schreibt statische JSON-Dateien nach docs/data/, die das Frontend per
fetch() laedt. Kein Server noetig (siehe skill_static_dashboard Pattern).
"""
import json
import ssl
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()

sys.path.insert(0, str(Path(__file__).parent))
from countries_eu import COUNTRIES_DE

API_URL_TMPL = "https://api2.effis.emergency.copernicus.eu/statistics/v2/{scope}/estimatesoverview"
YEAR_START = 2000     # vor 2000 liefert keiner der beiden API-Modi Daten
GWIS_FROM = 2012       # ab hier: vollstaendige 53-Laender-Abdeckung (scope=gwis)

OUT_DIR = Path(__file__).parent.parent / "docs" / "data"
UA = {"User-Agent": "waldbrand-dashboard/1.0 (+https://github.com/kopitiful)"}


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
        return r.read()


def fetch_year(year, codes):
    scope = "gwis" if year >= GWIS_FROM else "effis"
    url = f"{API_URL_TMPL.format(scope=scope)}?countries={','.join(codes)}&year={year}"
    return json.loads(fetch(url, timeout=45).decode("utf-8"))


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.now(timezone.utc)
    current_year = today.year
    codes = list(COUNTRIES_DE.keys())

    yearly = {c: {} for c in codes}
    country_meta = {}
    years_seen = set()

    for year in range(YEAR_START, current_year + 1):
        print(f"[{year}] lade ...")
        try:
            rows = fetch_year(year, codes)
        except Exception as e:
            print(f"  WARN {year}: {e}")
            continue
        for row in rows:
            iso3 = row.get("iso3")
            if iso3 not in COUNTRIES_DE or row.get("ba") is None:
                continue  # effis liefert Platzhalterzeilen (ba=null) fuer nicht abgedeckte Laender/Jahre
            yearly[iso3][year] = {
                "ba": row.get("ba"),
                "nf": row.get("nf"),
                "ba_avg": row.get("ba_avg"),
            }
            years_seen.add(year)
            if iso3 not in country_meta:
                country_meta[iso3] = {"name": COUNTRIES_DE[iso3], "area_ha": row.get("area_ha")}

    if not years_seen:
        raise SystemExit("Keine Daten von der GWIS-API erhalten.")

    year_start, year_end = min(years_seen), max(years_seen)
    n_years = year_end - year_start + 1

    countries_out = {iso3: country_meta[iso3] for iso3 in codes if iso3 in country_meta}

    ba_out, nf_out, ba_avg_out = {}, {}, {}
    for iso3 in countries_out:
        ba_arr = [None] * n_years
        nf_arr = [None] * n_years
        avg_arr = [None] * n_years
        for year, vals in yearly[iso3].items():
            idx = year - year_start
            ba_arr[idx] = vals["ba"]
            nf_arr[idx] = vals["nf"]
            avg_arr[idx] = vals["ba_avg"]
        ba_out[iso3] = ba_arr
        nf_out[iso3] = nf_arr
        ba_avg_out[iso3] = avg_arr

    meta = {
        "generated_at": today.isoformat(),
        "year_start": year_start,
        "year_end": year_end,
        "n_countries": len(countries_out),
    }

    write_json("meta.json", meta)
    write_json("countries.json", countries_out)
    write_json("burnt_area.json", ba_out)
    write_json("n_fires.json", nf_out)
    write_json("burnt_area_avg.json", ba_avg_out)

    print(f"Fertig: {len(countries_out)} Laender, {year_start}..{year_end}")


def write_json(name, obj):
    path = OUT_DIR / name
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
    print(f"  geschrieben: {path} ({path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
