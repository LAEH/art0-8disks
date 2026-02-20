# art0 · 8disks

Generative art studio — smooth crossfade animations across 8 color zones.

## Requirements

- **External disk** with art0 asset images (~1.7GB). On first run, the CLI asks for the path and saves it to `dev/.diskpath`.
- **ffmpeg** (for CLI video generation)
- **Python 3.x** with Flask (for web app)

## Project Structure

```
├── index.html              # Static web app (Firebase hosted)
├── css/ js/                # Static frontend assets
├── firebase.json           # Firebase hosting config
├── sw.js                   # Service worker for offline caching
│
└── dev/                    # Local dev tools (CLI + Flask web app)
    ├── make                # CLI launcher
    ├── art0_cli.py         # Interactive CLI — video generation via ffmpeg
    ├── art0_webapp.py      # Flask web app — browser-based animator
    ├── requirements.txt    # Python dependencies
    ├── .diskpath           # Path to asset data on disk (auto-created, gitignored)
    ├── templates/          # Flask HTML templates
    ├── static/             # Flask static assets (css/js)
    └── @cold/              # Archived scripts and notebooks
```

## CLI Studio

Generate art0 videos from the terminal. All choices have defaults — press Enter to accept.

```bash
# Interactive mode (defaults: vegas, 1680px, 3 sets, 1.0s fade/hold, 2 videos)
./dev/make

# Random mode
./dev/make -r        # 1 random video
./dev/make -r 5      # 5 random videos
./dev/make -r 3 -o ~/Desktop  # 3 random to custom folder
```

Videos are saved to `dev/results/studio/` by default.

## Web App

```bash
cd dev
pip install -r requirements.txt
python3 art0_webapp.py
```

Then open http://localhost:5000. Images load from GCS CDN. Features:
- 4 styles (klimt, light, louvre, vegas) with resolution picker
- Adjustable fade/hold timing
- Frame overlays (3L, 5L, inverted variants)
- Zone progress bar showing current animation cycle
- Terminal log panel

## Deployment (Static Site)

```bash
firebase deploy
```

The static site at root (`index.html`, `css/`, `js/`) is deployed to Firebase Hosting. It loads images from GCS CDN and runs entirely in the browser.

## License

MIT
