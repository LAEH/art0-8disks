#!/usr/bin/env python3
"""
Art0 Studio CLI - Interactive terminal app for generating art0 videos
"""

import os
import sys
import subprocess
import uuid
import random
import re
import time
import argparse
from collections import defaultdict

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DISKPATH_FILE = os.path.join(SCRIPT_DIR, ".diskpath")


def resolve_disk_path():
    """Read disk base path from .diskpath, prompt if missing or invalid."""
    # Try reading saved path
    if os.path.exists(DISKPATH_FILE):
        saved = open(DISKPATH_FILE).read().strip()
        assets = os.path.join(saved, "assets")
        if os.path.isdir(assets):
            return saved

    # Prompt user
    print("\033[1;33mDisk path not set or not found.\033[0m")
    print("Enter the path to the art0-8disks data folder on your disk.")
    print("It should contain: assets/ results/")
    while True:
        path = input("\nPath: ").strip().rstrip("/")
        if not path:
            continue
        assets = os.path.join(path, "assets")
        if os.path.isdir(assets):
            with open(DISKPATH_FILE, "w") as f:
                f.write(path + "\n")
            print(f"\033[32mSaved to .diskpath\033[0m")
            return path
        print(f"\033[31mNo assets/ folder found at {path}\033[0m")


DISK_BASE = resolve_disk_path()
ASSETS_DIR = os.path.join(DISK_BASE, "assets")
DEFAULT_OUTPUT_DIR = os.path.join(DISK_BASE, "results", "studio")

CATEGORIES = ["pink", "green", "cyan", "red", "yellow", "orange", "blue", "indigo"]

CADRES = {
    "1": ("5 Layer Inverted", "5l-inverted.png"),
    "2": ("5 Layer", "5l.png"),
    "3": ("3 Layer Inverted", "3l-inverted.png"),
    "4": ("3 Layer", "3l.png"),
    "5": ("None", None),
}

INTROS = {
    "1": ("Colored", "intro"),
    "2": ("White", "white"),
}


# ============================================================================
# TERMINAL HELPERS
# ============================================================================

def clear():
    os.system('clear')


def print_header():
    print("\033[1;36m")
    print("  ╔═══════════════════════════════════════╗")
    print("  ║           ART0 STUDIO                 ║")
    print("  ╚═══════════════════════════════════════╝")
    print("\033[0m")


def get_choice(prompt, valid_options, default=None):
    while True:
        default_str = f" [{default}]" if default else ""
        choice = input(f"\n{prompt}{default_str}: ").strip()
        if not choice and default and default in valid_options:
            return default
        if choice in valid_options:
            return choice
        print(f"\033[31mInvalid choice. Enter one of: {', '.join(valid_options)}\033[0m")


def get_number(prompt, min_val, max_val, default=None):
    while True:
        default_str = f" [{default}]" if default else ""
        val = input(f"{prompt} ({min_val}-{max_val}){default_str}: ").strip()
        if not val and default:
            return default
        try:
            num = int(val) if '.' not in val else float(val)
            if min_val <= num <= max_val:
                return num
            print(f"\033[31mMust be between {min_val} and {max_val}\033[0m")
        except ValueError:
            print(f"\033[31mEnter a valid number\033[0m")


# ============================================================================
# PROGRESS BAR
# ============================================================================

def fmt_time(seconds):
    """Format seconds as m:ss or h:mm:ss."""
    s = int(seconds)
    if s < 3600:
        return f"{s // 60}:{s % 60:02d}"
    return f"{s // 3600}:{(s % 3600) // 60:02d}:{s % 60:02d}"


class ProgressBar:
    def __init__(self, total, video_num=0, video_total=0):
        self.total = total
        self.video_num = video_num
        self.video_total = video_total
        self.current = 0
        self.start_time = time.time()

    def update(self, current):
        self.current = current
        self._draw()

    def _draw(self):
        percent = self.current / self.total if self.total > 0 else 0
        elapsed = time.time() - self.start_time

        if percent > 0.02:
            eta = elapsed / percent - elapsed
            eta_str = fmt_time(eta)
        else:
            eta_str = "-:--"

        w = 25
        filled = int(w * percent)
        bar = "=" * filled + "-" * (w - filled)

        tag = f"[{self.video_num}/{self.video_total}]" if self.video_total else ""

        sys.stdout.write(f"\r  {tag} [{bar}] {percent * 100:3.0f}%  {fmt_time(elapsed)} / ~{fmt_time(self.total)}  eta {eta_str}   ")
        sys.stdout.flush()

    def finish(self):
        self.current = self.total
        elapsed = time.time() - self.start_time
        w = 25
        tag = f"[{self.video_num}/{self.video_total}]" if self.video_total else ""
        sys.stdout.write(f"\r  {tag} [{'=' * w}] 100%  done in {fmt_time(elapsed)}                    \n")
        sys.stdout.flush()


# ============================================================================
# ASSET SCANNING
# ============================================================================

def scan_themes():
    zones_dir = os.path.join(ASSETS_DIR, "zones")
    themes = {}
    if os.path.exists(zones_dir):
        entries = sorted(e for e in os.listdir(zones_dir) if not e.startswith('.'))
        for i, theme in enumerate(entries, 1):
            theme_path = os.path.join(zones_dir, theme, "v0")
            if os.path.exists(theme_path):
                resolutions = sorted(
                    e for e in os.listdir(theme_path)
                    if not e.startswith('.') and os.path.isdir(os.path.join(theme_path, e))
                )
                if resolutions:
                    themes[str(i)] = (theme, resolutions)
    return themes


def get_max_sets(source_directory):
    images_by_category = defaultdict(list)
    for filename in os.listdir(source_directory):
        for category in CATEGORIES:
            if category in filename:
                images_by_category[category].append(filename)
    if not images_by_category:
        return 0
    return min(len(imgs) for imgs in images_by_category.values())


def get_all_configs():
    """Get all valid theme/resolution combinations."""
    configs = []
    zones_dir = os.path.join(ASSETS_DIR, "zones")
    if os.path.exists(zones_dir):
        for theme in os.listdir(zones_dir):
            if theme.startswith('.'):
                continue
            theme_path = os.path.join(zones_dir, theme, "v0")
            if os.path.exists(theme_path):
                for resolution in os.listdir(theme_path):
                    source_dir = os.path.join(theme_path, resolution)
                    if resolution.startswith('.') or not os.path.isdir(source_dir):
                        continue
                    max_sets = get_max_sets(source_dir)
                    if max_sets > 0:
                        configs.append((theme, resolution, max_sets))
    return configs


# ============================================================================
# VIDEO GENERATION
# ============================================================================

def get_image_size(path):
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
        capture_output=True, text=True
    )
    w, h = result.stdout.strip().split(',')
    return int(w), int(h)


def sample_unique_image_sets(source_directory, num_sets):
    images_by_category = defaultdict(list)
    for filename in os.listdir(source_directory):
        for category in CATEGORIES:
            if category in filename:
                images_by_category[category].append(os.path.join(source_directory, filename))

    preselected = {cat: random.sample(imgs, num_sets) for cat, imgs in images_by_category.items()}
    return [preselected[cat][i] for i in range(num_sets) for cat in CATEGORIES]


def generate_video(source_dir, background_path, outro_path, cadre_path,
                   output_path, fade_sec, still_sec, num_sets, show_progress=True,
                   video_num=0, video_total=0):

    image_paths = sample_unique_image_sets(source_dir, num_sets)

    content_w, content_h = get_image_size(background_path)

    # Check if cadre is large enough for content
    if cadre_path and os.path.exists(cadre_path):
        frame_w, frame_h = get_image_size(cadre_path)
        if frame_w < content_w or frame_h < content_h:
            # Cadre too small, skip it
            cadre_path = None
            frame_w, frame_h = content_w, content_h
            pad_x, pad_y = 0, 0
        else:
            pad_x = (frame_w - content_w) // 2
            pad_y = (frame_h - content_h) // 2
    else:
        frame_w, frame_h = content_w, content_h
        pad_x, pad_y = 0, 0

    framerate = 30
    fade_frames = int(fade_sec * framerate)
    still_frames = int(still_sec * framerate)
    cycle_frames = fade_frames + still_frames

    num_images = len(image_paths)
    total_main_frames = cycle_frames * num_images + still_frames
    total_frames = total_main_frames + fade_frames
    total_duration = total_frames / framerate

    inputs = ['-loop', '1', '-t', str(total_duration), '-i', background_path]
    for img_path in image_paths:
        inputs.extend(['-loop', '1', '-t', str(total_duration), '-i', img_path])
    inputs.extend(['-loop', '1', '-t', str(total_duration), '-i', outro_path])
    if cadre_path:
        inputs.extend(['-loop', '1', '-t', str(total_duration), '-i', cadre_path])

    filters = []
    outro_idx = num_images + 1
    frame_idx = num_images + 2 if cadre_path else None

    current_layer = "0:v"

    for i in range(num_images):
        start_time = (i * cycle_frames) / framerate
        filters.append(f"[{i+1}:v]format=rgba,fade=t=in:st={start_time:.3f}:d={fade_sec}:alpha=1[img{i}]")
        filters.append(f"[{current_layer}][img{i}]overlay=format=auto[comp{i}]")
        current_layer = f"comp{i}"

    outro_start = total_main_frames / framerate
    filters.append(f"[{outro_idx}:v]format=rgba,fade=t=in:st={outro_start:.3f}:d={fade_sec}:alpha=1[outro]")
    filters.append(f"[{current_layer}][outro]overlay=format=auto[with_outro]")

    if cadre_path:
        filters.append(f"[with_outro]pad={frame_w}:{frame_h}:{pad_x}:{pad_y}:color=black@0[padded]")
        filters.append(f"[padded][{frame_idx}:v]overlay=0:0:format=auto[final]")
        final_output = "[final]"
    else:
        final_output = "[with_outro]"

    cmd = [
        'ffmpeg', '-y',
        *inputs,
        '-filter_complex', ";".join(filters),
        '-map', final_output,
        '-t', str(total_duration),
        '-c:v', 'libx264', '-preset', 'fast', '-profile:v', 'high', '-crf', '23',
        '-pix_fmt', 'yuv420p', '-r', str(framerate),
        output_path
    ]

    if show_progress:
        progress = ProgressBar(total_duration, video_num=video_num, video_total=video_total)

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        # Parse stderr for real-time time= updates
        time_pattern = re.compile(rb'time=(\d{2}):(\d{2}):(\d{2})\.(\d+)')
        buf = b''

        while True:
            chunk = process.stderr.read(256)
            if not chunk:
                break
            buf += chunk
            while b'\r' in buf:
                line, buf = buf.split(b'\r', 1)
                match = time_pattern.search(line)
                if match:
                    h, m, s, frac = match.groups()
                    frac_str = frac.decode()
                    current_sec = int(h) * 3600 + int(m) * 60 + int(s) + int(frac_str) / (10 ** len(frac_str))
                    progress.update(min(current_sec, total_duration))

        process.wait()

        if process.returncode == 0:
            progress.finish()

        return process.returncode == 0, total_duration
    else:
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result.returncode == 0, total_duration


# ============================================================================
# RANDOM MODE
# ============================================================================

def generate_random(count=1, output_dir=None, high_res=False):
    """Generate random videos with random settings."""
    clear()
    print_header()
    print("\033[1;35m  🎲 RANDOM MODE\033[0m\n")

    configs = get_all_configs()
    if not configs:
        print("\033[31mNo valid configurations found!\033[0m")
        sys.exit(1)

    # Filter configs: prefer 1680 unless high_res mode
    if not high_res:
        fast_configs = [c for c in configs if int(c[1]) <= 1680]
        if fast_configs:
            configs = fast_configs

    output_dir = output_dir or DEFAULT_OUTPUT_DIR
    os.makedirs(output_dir, exist_ok=True)

    cadre_options = list(CADRES.values())
    intro_options = list(INTROS.values())

    print(f"  Generating {count} random artwork(s)...\n")

    for i in range(count):
        # Random selections
        theme, resolution, max_sets = random.choice(configs)
        num_sets = random.randint(1, min(3, max_sets))  # 1-3 sets for variety
        fade_sec = round(random.uniform(1.0, 2.5), 1)
        still_sec = round(random.uniform(0.5, 2.0), 1)
        cadre_name, cadre_file = random.choice(cadre_options)
        intro_name, intro_prefix = random.choice(intro_options)

        # Build paths
        source_dir = os.path.join(ASSETS_DIR, "zones", theme, "v0", resolution)
        background_path = os.path.join(ASSETS_DIR, "intro", f"{intro_prefix}@{resolution}.png")
        outro_path = os.path.join(ASSETS_DIR, "outro", f"outro-{theme}@{resolution}.png")
        cadre_path = os.path.join(ASSETS_DIR, "cadre", cadre_file) if cadre_file else None

        # Output filename
        short_uid = uuid.uuid4().hex[:8]
        filename = f"{theme}-{resolution}-{num_sets}s-{short_uid}.mp4"
        output_path = os.path.join(output_dir, filename)

        # Estimate duration
        est_duration = (num_sets * 8 * (fade_sec + still_sec)) + still_sec + fade_sec

        print(f"  \033[90m{filename}  {theme} {num_sets}s fade:{fade_sec} hold:{still_sec}\033[0m")

        success, duration = generate_video(
            source_dir, background_path, outro_path, cadre_path,
            output_path, fade_sec, still_sec, num_sets,
            show_progress=True, video_num=i+1, video_total=count
        )

        if success:
            file_size = os.path.getsize(output_path)
            print(f"  \033[32m✓\033[0m {file_size / (1024*1024):.1f}MB\n")
        else:
            print(f"  \033[31m✗ failed\033[0m\n")

    print(f"\n  \033[1;32mDone\033[0m {count} videos → {output_dir}")

    # Open folder (only prompt if interactive)
    if sys.stdin.isatty():
        open_folder = input("\nOpen output folder? [Y/n]: ").strip().lower()
        if open_folder != 'n':
            subprocess.run(['open', output_dir])
    else:
        subprocess.run(['open', output_dir])


# ============================================================================
# INTERACTIVE MODE
# ============================================================================

def interactive_mode():
    clear()
    print_header()

    # Scan available themes
    themes = scan_themes()
    if not themes:
        print("\033[31mNo themes found in assets/zones/\033[0m")
        sys.exit(1)

    # Find default theme key (prefer "vegas")
    default_theme_key = None
    for key, (name, _) in themes.items():
        if name == "vegas":
            default_theme_key = key
            break
    if not default_theme_key:
        default_theme_key = list(themes.keys())[-1]

    # Theme selection
    print("\n\033[1mAvailable Themes:\033[0m")
    for key, (name, resolutions) in themes.items():
        marker = " \033[2m← default\033[0m" if key == default_theme_key else ""
        print(f"  [{key}] {name.capitalize()} ({', '.join(resolutions)}){marker}")

    theme_choice = get_choice("Select theme", themes.keys(), default=default_theme_key)
    theme_name, resolutions = themes[theme_choice]

    # Resolution selection - default to 1680 if available
    if len(resolutions) > 1:
        print("\n\033[1mAvailable Resolutions:\033[0m")
        res_options = {str(i): r for i, r in enumerate(resolutions, 1)}
        default_res_key = None
        for key, res in res_options.items():
            if res == "1680":
                default_res_key = key
        if not default_res_key:
            default_res_key = "1"
        for key, res in res_options.items():
            marker = " \033[2m← default\033[0m" if key == default_res_key else ""
            print(f"  [{key}] {res}px{marker}")
        res_choice = get_choice("Select resolution", res_options.keys(), default=default_res_key)
        resolution = res_options[res_choice]
    else:
        resolution = resolutions[0]
        print(f"\nResolution: {resolution}px")

    # Frame selection - default to None
    print("\n\033[1mFrame Style:\033[0m")
    for key, (label, _) in CADRES.items():
        marker = " \033[2m← default\033[0m" if key == "5" else ""
        print(f"  [{key}] {label}{marker}")
    cadre_choice = get_choice("Select frame", CADRES.keys(), default="5")
    cadre_name, cadre_file = CADRES[cadre_choice]

    # Intro selection - default to Colored
    print("\n\033[1mIntro Style:\033[0m")
    for key, (label, _) in INTROS.items():
        marker = " \033[2m← default\033[0m" if key == "1" else ""
        print(f"  [{key}] {label}{marker}")
    intro_choice = get_choice("Select intro", INTROS.keys(), default="1")
    intro_name, intro_prefix = INTROS[intro_choice]

    # Get max sets
    source_dir = os.path.join(ASSETS_DIR, "zones", theme_name, "v0", resolution)
    max_sets = get_max_sets(source_dir)

    # Number of sets - default to 3 for fast generation
    default_sets = min(3, max_sets)
    print(f"\n\033[1mNumber of Sets (8 zones each, max {max_sets}):\033[0m")
    num_sets = int(get_number("Sets", 1, max_sets, default_sets))

    # Timing - default to 1.0s
    print("\n\033[1mTiming:\033[0m")
    fade_sec = float(get_number("Fade duration (seconds)", 0.5, 5.0, 1.0))
    still_sec = float(get_number("Hold duration (seconds)", 0.0, 5.0, 1.0))

    # Number of videos - default to 2
    print("\n\033[1mBatch Generation:\033[0m")
    num_videos = int(get_number("Number of videos to generate", 1, 50, 2))

    # Output directory
    print(f"\n\033[1mOutput Directory:\033[0m")
    print(f"  Default: {DEFAULT_OUTPUT_DIR}")
    custom = input("Press Enter for default, or enter custom path: ").strip()
    output_dir = custom if custom else DEFAULT_OUTPUT_DIR
    os.makedirs(output_dir, exist_ok=True)

    # Summary
    clear()
    print_header()
    print("\033[1mConfiguration Summary:\033[0m")
    print(f"  Theme:      {theme_name.capitalize()}")
    print(f"  Resolution: {resolution}px")
    print(f"  Frame:      {cadre_name}")
    print(f"  Intro:      {intro_name}")
    print(f"  Sets:       {num_sets} ({num_sets * 8} zones)")
    print(f"  Fade:       {fade_sec}s")
    print(f"  Hold:       {still_sec}s")
    print(f"  Videos:     {num_videos}")
    print(f"  Output:     {output_dir}")

    est_duration = (num_sets * 8 * (fade_sec + still_sec)) + still_sec + fade_sec
    print(f"\n  Estimated video length: ~{est_duration:.0f}s each")

    confirm = input("\n\033[1mProceed? [Y/n]:\033[0m ").strip().lower()
    if confirm == 'n':
        print("Cancelled.")
        sys.exit(0)

    # Build paths
    background_path = os.path.join(ASSETS_DIR, "intro", f"{intro_prefix}@{resolution}.png")
    outro_path = os.path.join(ASSETS_DIR, "outro", f"outro-{theme_name}@{resolution}.png")
    cadre_path = os.path.join(ASSETS_DIR, "cadre", cadre_file) if cadre_file else None

    # Generate videos
    print()
    batch_start = time.time()
    successes = 0
    for i in range(num_videos):
        short_uid = uuid.uuid4().hex[:8]
        filename = f"{theme_name}-{resolution}-{num_sets}s-{short_uid}.mp4"
        output_path = os.path.join(output_dir, filename)

        print(f"  \033[90m{filename}\033[0m")

        success, duration = generate_video(
            source_dir, background_path, outro_path, cadre_path,
            output_path, fade_sec, still_sec, num_sets,
            show_progress=True, video_num=i+1, video_total=num_videos
        )

        if success:
            successes += 1
            file_size = os.path.getsize(output_path)
            size_str = f"{file_size / (1024*1024):.1f}MB"
            print(f"  \033[32m✓\033[0m {size_str}\n")
        else:
            print(f"  \033[31m✗ failed\033[0m\n")

    batch_elapsed = time.time() - batch_start
    print(f"\n  \033[1;32mDone\033[0m {successes}/{num_videos} in {fmt_time(batch_elapsed)} → {output_dir}")

    # Open folder (only prompt if interactive)
    if sys.stdin.isatty():
        open_folder = input("\nOpen output folder? [Y/n]: ").strip().lower()
        if open_folder != 'n':
            subprocess.run(['open', output_dir])
    else:
        subprocess.run(['open', output_dir])


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Art0 Studio - Generate art0 video compositions",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  ./make              Interactive mode
  ./make -r           Generate 1 random video
  ./make -r 5         Generate 5 random videos
  ./make -r 3 -o ./my_art   Generate 3 random to custom folder
        """
    )
    parser.add_argument('-r', '--random', nargs='?', const=1, type=int, metavar='COUNT',
                        help='Generate random video(s). Optionally specify count (default: 1)')
    parser.add_argument('-o', '--output', type=str, metavar='DIR',
                        help='Output directory for videos')
    parser.add_argument('--hires', action='store_true',
                        help='Allow high resolution (5040) in random mode (slower)')

    args = parser.parse_args()

    if args.random:
        generate_random(count=args.random, output_dir=args.output, high_res=args.hires)
    else:
        interactive_mode()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nCancelled.")
        sys.exit(0)
