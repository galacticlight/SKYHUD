# SKYHUD

**Seattle space citizen-science HUD** — a helmet-visor style web interface for tracking the night sky, ISS passes, and local stargazing opportunities.

Live instruments for stargazers in the Puget Sound area (centered on Seattle). Designed to feel like a tactical heads-up display.

## Features

- **Local clock** (America/Los_Angeles) + date
- **Moon phase** and next new/full moon (computed)
- **Cloud cover** hint via Open-Meteo
- **ISS tracking**
  - Live position (when TLE is available)
  - Next ≥10° visible pass over Seattle
  - Countdown, direction of travel, duration
  - Desktop notifications when a pass is approaching
- **Mission cards**
  - Globe at Night (citizen light-pollution science)
  - ISS video capture for backyard photometry
  - Seattle Astronomical Society (SAS) public star parties
- **Red-light mode** (night-vision friendly)
- **Ops log** with ambient system chatter
- Filterable mission cards (All / Online / Outside / Events)

## Live demo

Once pushed to the `main` branch, enable **GitHub Pages** (Settings → Pages → Deploy from branch → main / root).

Then the site will be available at:

`https://galacticlight.github.io/SKYHUD/`

## Run locally

```bash
# From the project folder
python3 -m http.server 8765
```

Open http://localhost:8765

Or just open `index.html` directly in a modern browser (some features that use fetch may be limited under `file://`).

## Tech

- Vanilla HTML / CSS / JS (no build step)
- [satellite.js](https://github.com/shashwatak/satellite-js) for ISS propagation
- Open-Meteo for cloud cover
- Celestrak / ARISS TLE sources with offline fallback

## Project structure

```
SKYHUD/
├── index.html      # HUD shell
├── styles.css      # Visual language (cyan / amber / red-light mode)
├── app.js          # Clock, moon, weather, ISS pass prediction, UI logic
└── README.md
```

## Roadmap ideas

- Add more citizen-science projects (e.g. meteor counting, variable stars)
- Better offline support / service worker
- Configurable location (currently hard-coded to Seattle)
- Dark-sky quality map overlay
- Shareable “next ISS pass” deep links

## License

MIT (or as preferred by the owner). Feel free to fork and adapt for other cities.
