# SKYHUD

**Seattle space citizen-science HUD** — visor UI for the night sky over Puget Sound.

Live: [https://galacticlight.github.io/SKYHUD/](https://galacticlight.github.io/SKYHUD/)  
(or [index.html](https://galacticlight.github.io/SKYHUD/index.html) if the directory URL 404s)

## Features

- Polar **Seattle sky map** (zenith center, north up)
- Satellite **trajectories** for objects that cross this sky (elevation ≥ 10°)
- ISS countdown, moon phase, cloud cover
- Citizen-science missions (Globe at Night, ISS video, SAS star parties)
- Red-light night mode

Static files only — GitHub Pages, no build step.

```
SKYHUD/
├── index.html
├── styles.css
├── app.js
├── favicon.svg
└── README.md
```

## Run locally

Open `index.html` in a modern browser, or:

```bash
python3 -m http.server 8765
```

## Tech

Vanilla HTML / CSS / JS. [satellite.js](https://github.com/shashwatak/satellite-js) for SGP4. TLEs from ARISS / AMSAT / SatNOGS. Open-Meteo for cloud cover. Observer fixed at Seattle 47.61N, 122.33W.

## License

MIT
