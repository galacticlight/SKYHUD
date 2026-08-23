# SKYHUD

**Seattle space citizen-science visor** — live sky tracks, NASA news, citizen-science asks, and open grants.

Live: [https://galacticlight.github.io/SKYHUD/](https://galacticlight.github.io/SKYHUD/)

## What’s on the visor

- Polar **Seattle sky map** (zenith center, north up) with satellite trajectories that actually cross this sky (el ≥ 10°)
- ISS countdown, moon phase, cloud cover
- **News** — live NASA / ESA / ISS feed (Spaceflight News API)
- **Citizen** — specific asks (Globe at Night, GLOBE Observer, ISS video, Aurorasaurus) plus NASA/Zooniverse projects
- **Grants** — currently open NASA ROSES, NSPIRES, Space Apps, NSF AISL, ESA OSIP, and the CSSFP watch cycle
- **Events** — SAS star party and Globe at Night campaign window
- Red-light night mode

Static files only — GitHub Pages, no build step. Works in current Chrome, Firefox, Safari, and Edge (no `color-mix` / no overlay-`hidden` clash).

```
SKYHUD/
├── index.html
├── styles.css
├── app.js
├── satellite.min.js
├── favicon.svg
└── README.md
```

## Tech

Vanilla HTML / CSS / JS. [satellite.js](https://github.com/shashwatak/satellite-js) v5 (vendored) for SGP4. TLEs from ARISS / AMSAT / SatNOGS. Open-Meteo for cloud cover. News from [Spaceflight News API](https://api.spaceflightnewsapi.net/v4/docs/). Observer fixed at Seattle 47.61N, 122.33W.

## License

MIT
