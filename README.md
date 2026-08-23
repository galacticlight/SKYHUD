# SKYHUD

**Seattle space citizen-science visor** — live sky tracks, NASA news, citizen-science asks, and open grants.

Live: [https://galacticlight.github.io/SKYHUD/](https://galacticlight.github.io/SKYHUD/)

## What’s on the visor

- Polar **Seattle sky map** (zenith center, north up) with satellite trajectories that actually cross this sky (el ≥ 10°)
- Science/visual constellation: **ISS, CSS (Tianhe), Hubble**, NOAA 15/18/19/20/21, Terra, Aqua, Landsat 8/9, Sentinel-2/3/5P, Envisat, Meteor-M, Suomi NPP, MetOp-C, CALIPSO, Jason-3, plus amateur radio birds (AO-07, SO-50, FO-29, AO-73)
- **News** — live NASA / ESA / ISS feed
- **Citizen** — specific asks plus NASA/Zooniverse projects
- **Grants** — NASA ROSES, NSPIRES, Space Apps, NSF AISL, ESA OSIP
- Red-light night mode

Static files only — GitHub Pages, no build step.

```
SKYHUD/
├── index.html
├── styles.css
├── app.js
├── catalog.tle
├── satellite.min.js
├── favicon.svg
└── README.md
```

`catalog.tle` is a same-origin visual catalog (~29 objects) so the map is not stuck on ISS when Celestrak/SatNOGS block the browser. Live elements refresh from ARISS + [tle.ivanstanojevic.me](https://tle.ivanstanojevic.me/) (CORS-open). Starlink / OneWeb / Kuiper dumps are filtered out on purpose.

## Tech

Vanilla HTML / CSS / JS. [satellite.js](https://github.com/shashwatak/satellite-js) v5 (vendored) for SGP4. Observer fixed at Seattle 47.61N, 122.33W.

## License

MIT
