# art0 · 8disks

Generative art studio with smooth crossfade animations across 8 color zones.

## Features

- 4 generative art styles (louvre, klimt, vegas, light)
- 8 color zone layers with independent fade transitions
- Adjustable fade/hold timing
- Frame overlays (3L, 5L variants)
- 60fps canvas rendering with GPU-optimized image loading
- Offline support via service worker
- Responsive design (mobile, tablet, desktop)

## Quick Start

```bash
./install.sh
```

## Manual Setup

**Requirements:** Python 3.x or Node.js

```bash
# Option 1: Python
python3 -m http.server 8080

# Option 2: Node.js
npx serve -p 8080
```

Then open http://localhost:8080

## Project Structure

```
├── index.html          # Main entry point
├── config.json         # Asset paths and style definitions
├── css/
│   └── style.css       # Responsive liquid glass UI
├── js/
│   ├── app.js          # Application orchestration
│   ├── animator.js     # 60fps canvas animation engine
│   └── imageLoader.js  # Adaptive image preloader
├── sw.js               # Service worker for offline caching
└── firebase.json       # Firebase hosting config
```

## Deployment

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login and deploy
firebase login
firebase deploy
```

## Configuration

Edit `config.json` to modify:
- `cdn`: Base URL for image assets
- `categories`: Color zone order
- `styles`: Available art styles and resolutions
- `frames`: Frame overlay paths
- `intros`: Background image paths

## License

MIT
