# Waldbrände Europa

Verbrannte Fläche (Hektar) je europäischem Land und Jahr, seit 2012, plus Vergleich (Jahr vs. Vorjahr, Jahrzehnt vs. Vorjahrzehnt, freier Zeitraum).

Daten: [GWIS/EFFIS](https://gwis.jrc.ec.europa.eu/apps/gwis.statistics/) (Copernicus Emergency Management Service, EU-Kommission), 53 Länder. Russland wird als ein Ländercode geführt, der auch den asiatischen Teil (Sibirien) einschließt, und daher nicht in die "Europa"-Summe eingerechnet (bleibt aber einzeln wählbar).

## Architektur

Statische Seite, kein Server:

- `scripts/precompute.py` lädt jährliche Werte je Land von der GWIS-API und schreibt JSON nach `docs/data/`
- `.github/workflows/update.yml` läuft täglich per Cron und aktualisiert die Daten
- `docs/` wird per GitHub Pages und Cloudflare Pages (Git-Integration) ausgeliefert (reines HTML/JS + Chart.js, kein Framework)

## Lokal ausführen

```bash
python3 scripts/precompute.py
cd docs && python3 -m http.server 8000
```
