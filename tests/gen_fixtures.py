#!/usr/bin/env python3
"""Regenerate tests/fixtures/horizons.json from the public JPL Horizons API.

Reference values only; SKYHUD never calls Horizons at runtime.
Usage: python3 tests/gen_fixtures.py
"""
import json, urllib.request, urllib.parse, datetime, os

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
SITES = {
    "seattle": {"lat": 47.6062, "lon": -122.3321, "times": ["2026-10-25 06:00", "2026-12-14 09:30"]},
    "sydney": {"lat": -33.8688, "lon": 151.2093, "times": ["2026-06-21 10:00", "2027-03-02 12:15"]},
    "london": {"lat": 51.5072, "lon": -0.1276, "times": ["2027-01-15 20:00", "2026-08-12 23:00"]},
}
BODIES = {"sun": "10", "moon": "301", "mercury": "199", "venus": "299", "mars": "499",
          "jupiter": "599", "saturn": "699", "uranus": "799", "neptune": "899"}
RTS_DAYS = {"seattle": "2026-10-24 07:00", "sydney": "2026-06-20 14:00", "london": "2027-01-15 00:00"}


def call(params):
    q = {"format": "json", "EPHEM_TYPE": "OBSERVER", "CSV_FORMAT": "YES", **params}
    url = API + "?" + urllib.parse.urlencode(q)
    res = json.load(urllib.request.urlopen(url, timeout=90))["result"]
    body = res[res.index("$$SOE") + 5:res.index("$$EOE")].strip()
    return [[c.strip() for c in line.split(",")] for line in body.splitlines()]


def site(s):
    return {"CENTER": "'coord@399'", "COORD_TYPE": "'GEODETIC'", "SITE_COORD": f"'{s['lon']},{s['lat']},0'"}


def to_iso(t):
    for fmt in ("%Y-%b-%d %H:%M", "%Y-%m-%d %H:%M"):
        try:
            return datetime.datetime.strptime(t, fmt).strftime("%Y-%m-%dT%H:%M:00Z")
        except ValueError:
            pass
    raise ValueError(t)


out = {"source": API, "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
       "notes": "Airless apparent azimuth/elevation (QUANTITIES 4), Moon illuminated fraction (10). Times UT. Rise/set: R_T_S_ONLY=TVH, refracted, site height 0.",
       "positions": [], "riseSet": [], "moonPhases": []}
for name, s in SITES.items():
    for t in s["times"]:
        for body, cmd in BODIES.items():
            rows = call({"COMMAND": f"'{cmd}'", **site(s), "START_TIME": f"'{t}'", "STOP_TIME": f"'{t}:30'",
                         "STEP_SIZE": "'1'", "QUANTITIES": "'4,10'"})
            r = rows[0]
            out["positions"].append({"site": name, "lat": s["lat"], "lon": s["lon"], "utc": to_iso(t), "body": body,
                                     "az": float(r[3]), "alt": float(r[4]), "illum": float(r[5]) if body == "moon" else None})
    for body in ("sun", "moon"):
        start = RTS_DAYS[name]
        d0 = datetime.datetime.strptime(start, "%Y-%m-%d %H:%M")
        stop = (d0 + datetime.timedelta(days=1)).strftime("%Y-%m-%d %H:%M")
        rows = call({"COMMAND": f"'{BODIES[body]}'", **site(s), "START_TIME": f"'{start}'", "STOP_TIME": f"'{stop}'",
                     "STEP_SIZE": "'1m'", "QUANTITIES": "'4'", "R_T_S_ONLY": "'TVH'", "APPARENT": "'REFRACTED'"})
        for r in rows:
            if r[2] in ("r", "s"):
                out["riseSet"].append({"site": name, "lat": s["lat"], "lon": s["lon"], "body": body, "start": to_iso(start),
                                       "type": "rise" if r[2] == "r" else "set", "utc": to_iso(r[0])})

# Moon phases: geocentric apparent ecliptic longitude difference Moon − Sun (QUANTITIES 31), 10-minute steps.
def eclon(cmd, a, b):
    rows = call({"COMMAND": f"'{cmd}'", "CENTER": "'500@399'", "START_TIME": f"'{a}'", "STOP_TIME": f"'{b}'",
                 "STEP_SIZE": "'10m'", "QUANTITIES": "'31'"})
    return [(r[0], float(r[3])) for r in rows]

a, b = "2026-10-01 00:00", "2026-12-31 00:00"
moon, sun = eclon("301", a, b), eclon("10", a, b)
names = {0: "New Moon", 90: "First quarter", 180: "Full Moon", 270: "Last quarter"}
prev = None
for (t, lm), (_, ls) in zip(moon, sun):
    age = (lm - ls) % 360
    if prev is not None:
        for target in names:
            x0 = (prev[1] - target + 180) % 360 - 180
            x1 = (age - target + 180) % 360 - 180
            if x0 < 0 <= x1 and abs(x1 - x0) < 30:
                t0 = datetime.datetime.strptime(prev[0], "%Y-%b-%d %H:%M")
                frac = -x0 / (x1 - x0)
                when = t0 + datetime.timedelta(minutes=10 * frac)
                out["moonPhases"].append({"name": names[target], "utc": when.strftime("%Y-%m-%dT%H:%M:%SZ")})
    prev = (t, age)

path = os.path.join(os.path.dirname(__file__), "fixtures", "horizons.json")
with open(path, "w") as f:
    json.dump(out, f, indent=1)
print("wrote", path, len(out["positions"]), "positions", len(out["riseSet"]), "rise/set", len(out["moonPhases"]), "phases")
