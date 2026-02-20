#!/usr/bin/env python3
"""Art0 Studio Web App - Flask server for real-time art animation."""

import os
import re
from collections import defaultdict
from flask import Flask, render_template, jsonify, send_from_directory

app = Flask(__name__)

# Base paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DISKPATH_FILE = os.path.join(BASE_DIR, ".diskpath")

def resolve_disk_path():
    """Read disk base path from .diskpath."""
    if os.path.exists(DISKPATH_FILE):
        saved = open(DISKPATH_FILE).read().strip()
        if os.path.isdir(os.path.join(saved, "assets")):
            return saved
    print(f"ERROR: Run the CLI first (./make) to set the disk path in .diskpath")
    raise SystemExit(1)

DISK_BASE = resolve_disk_path()
ASSETS_DIR = os.path.join(DISK_BASE, "assets")
ZONES_DIR = os.path.join(ASSETS_DIR, "zones")

# Remote CDN base URL
CDN_BASE = "https://storage.googleapis.com/myproject-public-assets/art/8disks/v1"

# Color categories in display order
CATEGORIES = ["pink", "green", "cyan", "red", "yellow", "orange", "blue", "indigo"]


def scan_styles():
    """Scan available styles and their resolutions."""
    styles = {}

    if not os.path.isdir(ZONES_DIR):
        return styles

    for style_name in os.listdir(ZONES_DIR):
        style_path = os.path.join(ZONES_DIR, style_name, "v0")
        if not os.path.isdir(style_path):
            continue

        resolutions = []
        for res_name in os.listdir(style_path):
            res_path = os.path.join(style_path, res_name)
            if os.path.isdir(res_path):
                # Handle both "1680" and "1680px" formats
                if res_name.endswith("px"):
                    res_value = int(res_name[:-2])
                elif res_name.isdigit():
                    res_value = int(res_name)
                else:
                    continue
                resolutions.append(res_value)

        if resolutions:
            styles[style_name] = sorted(resolutions)

    return styles


def get_style_images(style_name, resolution):
    """Get all images for a style organized by color."""
    images_by_color = defaultdict(list)

    # Try both formats: "1680" and "1680px"
    res_path = os.path.join(ZONES_DIR, style_name, "v0", str(resolution))
    if not os.path.isdir(res_path):
        res_path = os.path.join(ZONES_DIR, style_name, "v0", f"{resolution}px")
    if not os.path.isdir(res_path):
        return {}

    # Get the actual directory name for constructing paths
    res_dir_name = os.path.basename(res_path)

    # Pattern to match color-number.png or color-number_variant.png
    pattern = re.compile(r'^([a-z]+)-(\d+)(_\d+)?\.png$', re.IGNORECASE)

    for filename in os.listdir(res_path):
        match = pattern.match(filename)
        if match:
            color = match.group(1).lower()
            if color in CATEGORIES:
                # Store relative path from assets
                rel_path = f"zones/{style_name}/v0/{res_dir_name}/{filename}"
                images_by_color[color].append(rel_path)

    # Sort images within each color for consistency
    for color in images_by_color:
        images_by_color[color].sort()

    return dict(images_by_color)


def get_frames():
    """Get available frame (cadre) options."""
    cadre_dir = os.path.join(ASSETS_DIR, "cadre")
    frames = {"none": None}

    if os.path.isdir(cadre_dir):
        for filename in os.listdir(cadre_dir):
            if filename.endswith(".png"):
                name = filename[:-4]  # Remove .png
                frames[name] = f"cadre/{filename}"

    return frames


def get_intros():
    """Get available intro/background images by resolution."""
    intro_dir = os.path.join(ASSETS_DIR, "intro")
    intros = {}

    if os.path.isdir(intro_dir):
        for filename in os.listdir(intro_dir):
            if filename.endswith(".png"):
                # Parse intro@1680.png or white@1680.png
                name = filename[:-4]  # Remove .png
                if "@" in name:
                    prefix, res = name.split("@", 1)
                    if res.isdigit():
                        res = int(res)
                        if res not in intros:
                            intros[res] = {}
                        intros[res][prefix] = f"intro/{filename}"

    return intros


# Routes
@app.route("/")
def index():
    """Serve the main application page."""
    return render_template("index.html")


@app.route("/api/styles")
def api_styles():
    """Return available styles and their resolutions."""
    styles = scan_styles()
    frames = get_frames()
    intros = get_intros()
    return jsonify({
        "styles": styles,
        "frames": frames,
        "intros": intros,
        "categories": CATEGORIES,
        "cdn": CDN_BASE
    })


@app.route("/api/style/<name>")
def api_style(name):
    """Return images for a specific style."""
    # Default to 1680px, fallback to first available
    styles = scan_styles()

    if name not in styles:
        return jsonify({"error": "Style not found"}), 404

    # Prefer 1680px resolution
    resolutions = styles[name]
    resolution = 1680 if 1680 in resolutions else resolutions[0]

    images = get_style_images(name, resolution)

    return jsonify({
        "style": name,
        "resolution": resolution,
        "images": images
    })


@app.route("/api/style/<name>/<int:resolution>")
def api_style_resolution(name, resolution):
    """Return images for a specific style and resolution."""
    styles = scan_styles()

    if name not in styles:
        return jsonify({"error": "Style not found"}), 404

    if resolution not in styles[name]:
        return jsonify({"error": "Resolution not available"}), 404

    images = get_style_images(name, resolution)

    return jsonify({
        "style": name,
        "resolution": resolution,
        "images": images
    })


@app.route("/assets/<path:filepath>")
def serve_asset(filepath):
    """Serve static assets from the assets directory."""
    return send_from_directory(ASSETS_DIR, filepath)


if __name__ == "__main__":
    print("Art0 Studio Web App")
    print("=" * 40)

    # Show available styles
    styles = scan_styles()
    print(f"Available styles: {list(styles.keys())}")
    for style, resolutions in styles.items():
        print(f"  {style}: {resolutions}")

    print("=" * 40)
    print("Starting server at http://localhost:5000")

    app.run(debug=True, port=5000)
