#!/usr/bin/env python3
"""
Art0 Studio - GUI for generating art0 video compositions
"""

import os
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import subprocess
import threading
import uuid
from collections import defaultdict
import random

# ============================================================================
# CONFIGURATION
# ============================================================================

ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
DEFAULT_OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "studio")

CATEGORIES = ["pink", "green", "cyan", "red", "yellow", "orange", "blue", "indigo"]

CADRE_OPTIONS = {
    "5 Layer": "5l.png",
    "5 Layer Inverted": "5l-inverted.png",
    "3 Layer": "3l.png",
    "3 Layer Inverted": "3l-inverted.png",
    "None": None,
}

INTRO_OPTIONS = {
    "Colored": "intro",
    "White": "white",
}


# ============================================================================
# CORE VIDEO GENERATION (from generate_fast.py)
# ============================================================================

def get_image_size(path):
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
        capture_output=True, text=True
    )
    w, h = result.stdout.strip().split(',')
    return int(w), int(h)


def sample_unique_image_sets(source_directory, categories, num_sets):
    images_by_category = defaultdict(list)
    for filename in os.listdir(source_directory):
        for category in categories:
            if category in filename:
                images_by_category[category].append(os.path.join(source_directory, filename))

    for category, images in images_by_category.items():
        if len(images) < num_sets:
            raise ValueError(f"Not enough images for '{category}'. Need {num_sets}, have {len(images)}")

    preselected = {cat: random.sample(imgs, num_sets) for cat, imgs in images_by_category.items()}
    return [preselected[cat][i] for i in range(num_sets) for cat in categories]


def get_max_sets(source_directory):
    """Get the maximum number of sets available."""
    images_by_category = defaultdict(list)
    for filename in os.listdir(source_directory):
        for category in CATEGORIES:
            if category in filename:
                images_by_category[category].append(filename)
    if not images_by_category:
        return 0
    return min(len(imgs) for imgs in images_by_category.values())


def build_ffmpeg_command(background_path, image_paths, outro_path, frame_overlay_path,
                         output_path, fade_duration, still_duration, framerate=60):
    content_w, content_h = get_image_size(background_path)

    if frame_overlay_path:
        frame_w, frame_h = get_image_size(frame_overlay_path)
        pad_x = (frame_w - content_w) // 2
        pad_y = (frame_h - content_h) // 2
    else:
        frame_w, frame_h = content_w, content_h
        pad_x, pad_y = 0, 0

    fade_frames = int(fade_duration * framerate)
    still_frames = int(still_duration * framerate)
    cycle_frames = fade_frames + still_frames

    num_images = len(image_paths)
    total_main_frames = cycle_frames * num_images + still_frames
    outro_frames = fade_frames
    total_frames = total_main_frames + outro_frames
    total_duration = total_frames / framerate

    inputs = ['-loop', '1', '-t', str(total_duration), '-i', background_path]
    for img_path in image_paths:
        inputs.extend(['-loop', '1', '-t', str(total_duration), '-i', img_path])
    inputs.extend(['-loop', '1', '-t', str(total_duration), '-i', outro_path])
    if frame_overlay_path:
        inputs.extend(['-loop', '1', '-t', str(total_duration), '-i', frame_overlay_path])

    filters = []
    outro_idx = num_images + 1
    frame_idx = num_images + 2 if frame_overlay_path else None

    current_layer = "0:v"

    for i, _ in enumerate(image_paths):
        input_idx = i + 1
        start_time = (i * cycle_frames) / framerate
        filters.append(
            f"[{input_idx}:v]format=rgba,fade=t=in:st={start_time:.3f}:d={fade_duration}:alpha=1[img{i}]"
        )
        filters.append(
            f"[{current_layer}][img{i}]overlay=format=auto[comp{i}]"
        )
        current_layer = f"comp{i}"

    outro_start = total_main_frames / framerate
    filters.append(
        f"[{outro_idx}:v]format=rgba,fade=t=in:st={outro_start:.3f}:d={fade_duration}:alpha=1[outro]"
    )
    filters.append(
        f"[{current_layer}][outro]overlay=format=auto[with_outro]"
    )

    if frame_overlay_path:
        filters.append(
            f"[with_outro]pad={frame_w}:{frame_h}:{pad_x}:{pad_y}:color=black@0[padded]"
        )
        filters.append(
            f"[padded][{frame_idx}:v]overlay=0:0:format=auto[final]"
        )
        final_output = "[final]"
    else:
        final_output = "[with_outro]"

    filter_complex = ";".join(filters)

    cmd = [
        'ffmpeg', '-y',
        *inputs,
        '-filter_complex', filter_complex,
        '-map', final_output,
        '-t', str(total_duration),
        '-c:v', 'libx264',
        '-profile:v', 'high',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-r', str(framerate),
        output_path
    ]

    return cmd, total_duration


# ============================================================================
# GUI APPLICATION
# ============================================================================

class Art0Studio:
    def __init__(self, root):
        self.root = root
        self.root.title("Art0 Studio")
        self.root.geometry("500x650")
        self.root.resizable(False, False)

        # Variables
        self.theme_var = tk.StringVar()
        self.resolution_var = tk.StringVar()
        self.cadre_var = tk.StringVar(value="5 Layer Inverted")
        self.intro_var = tk.StringVar(value="Colored")
        self.num_sets_var = tk.IntVar(value=1)
        self.fade_var = tk.DoubleVar(value=1.67)
        self.still_var = tk.DoubleVar(value=1.67)
        self.num_videos_var = tk.IntVar(value=1)
        self.output_dir_var = tk.StringVar(value=DEFAULT_OUTPUT_DIR)

        self.available_themes = []
        self.available_resolutions = {}
        self.max_sets = 1

        self._scan_assets()
        self._build_ui()
        self._on_theme_change()

    def _scan_assets(self):
        """Scan available themes and resolutions."""
        zones_dir = os.path.join(ASSETS_DIR, "zones")
        if os.path.exists(zones_dir):
            self.available_themes = sorted(os.listdir(zones_dir))
            for theme in self.available_themes:
                theme_path = os.path.join(zones_dir, theme, "v0")
                if os.path.exists(theme_path):
                    self.available_resolutions[theme] = sorted(os.listdir(theme_path))

        if self.available_themes:
            self.theme_var.set(self.available_themes[0])

    def _build_ui(self):
        """Build the UI components."""
        style = ttk.Style()
        style.configure('Header.TLabel', font=('Helvetica', 16, 'bold'))
        style.configure('Section.TLabel', font=('Helvetica', 11, 'bold'))

        main_frame = ttk.Frame(self.root, padding="20")
        main_frame.pack(fill=tk.BOTH, expand=True)

        # Header
        header = ttk.Label(main_frame, text="Art0 Studio", style='Header.TLabel')
        header.pack(pady=(0, 20))

        # Theme & Resolution
        row1 = ttk.Frame(main_frame)
        row1.pack(fill=tk.X, pady=5)

        ttk.Label(row1, text="Theme:", width=12).pack(side=tk.LEFT)
        self.theme_combo = ttk.Combobox(row1, textvariable=self.theme_var,
                                         values=self.available_themes, state="readonly", width=15)
        self.theme_combo.pack(side=tk.LEFT, padx=(0, 20))
        self.theme_combo.bind("<<ComboboxSelected>>", lambda e: self._on_theme_change())

        ttk.Label(row1, text="Resolution:", width=10).pack(side=tk.LEFT)
        self.res_combo = ttk.Combobox(row1, textvariable=self.resolution_var,
                                       state="readonly", width=10)
        self.res_combo.pack(side=tk.LEFT)
        self.res_combo.bind("<<ComboboxSelected>>", lambda e: self._on_resolution_change())

        # Cadre & Intro
        row2 = ttk.Frame(main_frame)
        row2.pack(fill=tk.X, pady=5)

        ttk.Label(row2, text="Frame:", width=12).pack(side=tk.LEFT)
        cadre_combo = ttk.Combobox(row2, textvariable=self.cadre_var,
                                    values=list(CADRE_OPTIONS.keys()), state="readonly", width=15)
        cadre_combo.pack(side=tk.LEFT, padx=(0, 20))

        ttk.Label(row2, text="Intro:", width=10).pack(side=tk.LEFT)
        intro_combo = ttk.Combobox(row2, textvariable=self.intro_var,
                                    values=list(INTRO_OPTIONS.keys()), state="readonly", width=10)
        intro_combo.pack(side=tk.LEFT)

        # Separator
        ttk.Separator(main_frame, orient=tk.HORIZONTAL).pack(fill=tk.X, pady=15)

        # Number of Sets
        row3 = ttk.Frame(main_frame)
        row3.pack(fill=tk.X, pady=5)

        ttk.Label(row3, text="Sets:", width=12).pack(side=tk.LEFT)
        self.sets_scale = ttk.Scale(row3, from_=1, to=10, variable=self.num_sets_var,
                                     orient=tk.HORIZONTAL, length=200,
                                     command=lambda v: self.sets_label.config(text=str(int(float(v)))))
        self.sets_scale.pack(side=tk.LEFT, padx=(0, 10))
        self.sets_label = ttk.Label(row3, text="1", width=3)
        self.sets_label.pack(side=tk.LEFT)
        ttk.Label(row3, text="(8 zones each)", foreground="gray").pack(side=tk.LEFT, padx=5)

        # Fade Duration
        row4 = ttk.Frame(main_frame)
        row4.pack(fill=tk.X, pady=5)

        ttk.Label(row4, text="Fade (sec):", width=12).pack(side=tk.LEFT)
        fade_scale = ttk.Scale(row4, from_=0.5, to=5.0, variable=self.fade_var,
                                orient=tk.HORIZONTAL, length=200,
                                command=lambda v: self.fade_label.config(text=f"{float(v):.1f}"))
        fade_scale.pack(side=tk.LEFT, padx=(0, 10))
        self.fade_label = ttk.Label(row4, text="1.7", width=4)
        self.fade_label.pack(side=tk.LEFT)

        # Still Duration
        row5 = ttk.Frame(main_frame)
        row5.pack(fill=tk.X, pady=5)

        ttk.Label(row5, text="Hold (sec):", width=12).pack(side=tk.LEFT)
        still_scale = ttk.Scale(row5, from_=0.0, to=5.0, variable=self.still_var,
                                 orient=tk.HORIZONTAL, length=200,
                                 command=lambda v: self.still_label.config(text=f"{float(v):.1f}"))
        still_scale.pack(side=tk.LEFT, padx=(0, 10))
        self.still_label = ttk.Label(row5, text="1.7", width=4)
        self.still_label.pack(side=tk.LEFT)

        # Number of Videos
        row6 = ttk.Frame(main_frame)
        row6.pack(fill=tk.X, pady=5)

        ttk.Label(row6, text="Videos:", width=12).pack(side=tk.LEFT)
        videos_spin = ttk.Spinbox(row6, from_=1, to=100, textvariable=self.num_videos_var, width=5)
        videos_spin.pack(side=tk.LEFT)
        ttk.Label(row6, text="(random variations)", foreground="gray").pack(side=tk.LEFT, padx=10)

        # Separator
        ttk.Separator(main_frame, orient=tk.HORIZONTAL).pack(fill=tk.X, pady=15)

        # Output Directory
        row7 = ttk.Frame(main_frame)
        row7.pack(fill=tk.X, pady=5)

        ttk.Label(row7, text="Output:", width=12).pack(side=tk.LEFT)
        output_entry = ttk.Entry(row7, textvariable=self.output_dir_var, width=30)
        output_entry.pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(row7, text="Browse", command=self._browse_output).pack(side=tk.LEFT)

        # Duration Estimate
        self.duration_label = ttk.Label(main_frame, text="Estimated duration: ~30s per video",
                                         foreground="gray")
        self.duration_label.pack(pady=15)

        # Progress
        self.progress_var = tk.DoubleVar()
        self.progress = ttk.Progressbar(main_frame, variable=self.progress_var,
                                         maximum=100, length=400)
        self.progress.pack(pady=5)

        self.status_label = ttk.Label(main_frame, text="Ready", foreground="gray")
        self.status_label.pack(pady=5)

        # Generate Button
        self.generate_btn = ttk.Button(main_frame, text="Generate",
                                        command=self._start_generation)
        self.generate_btn.pack(pady=20)

        # Open Output Folder Button
        ttk.Button(main_frame, text="Open Output Folder",
                   command=self._open_output_folder).pack()

    def _on_theme_change(self):
        """Update available resolutions when theme changes."""
        theme = self.theme_var.get()
        resolutions = self.available_resolutions.get(theme, [])
        self.res_combo['values'] = resolutions
        if resolutions:
            self.resolution_var.set(resolutions[0])
        self._on_resolution_change()

    def _on_resolution_change(self):
        """Update max sets when resolution changes."""
        theme = self.theme_var.get()
        resolution = self.resolution_var.get()
        source_dir = os.path.join(ASSETS_DIR, "zones", theme, "v0", resolution)

        if os.path.exists(source_dir):
            self.max_sets = get_max_sets(source_dir)
            self.sets_scale.config(to=max(1, self.max_sets))
            if self.num_sets_var.get() > self.max_sets:
                self.num_sets_var.set(self.max_sets)
                self.sets_label.config(text=str(self.max_sets))

        self._update_duration_estimate()

    def _update_duration_estimate(self):
        """Update the duration estimate label."""
        num_sets = self.num_sets_var.get()
        fade = self.fade_var.get()
        still = self.still_var.get()

        zones_per_video = num_sets * 8
        duration = (zones_per_video * (fade + still)) + still + fade  # +outro

        self.duration_label.config(text=f"Estimated duration: ~{duration:.0f}s per video")

    def _browse_output(self):
        """Open folder browser for output directory."""
        folder = filedialog.askdirectory(initialdir=self.output_dir_var.get())
        if folder:
            self.output_dir_var.set(folder)

    def _open_output_folder(self):
        """Open the output folder in Finder."""
        folder = self.output_dir_var.get()
        if os.path.exists(folder):
            subprocess.run(['open', folder])
        else:
            os.makedirs(folder, exist_ok=True)
            subprocess.run(['open', folder])

    def _start_generation(self):
        """Start video generation in background thread."""
        self.generate_btn.config(state=tk.DISABLED)
        self.progress_var.set(0)
        self.status_label.config(text="Starting...")

        thread = threading.Thread(target=self._generate_videos, daemon=True)
        thread.start()

    def _generate_videos(self):
        """Generate videos (runs in background thread)."""
        try:
            theme = self.theme_var.get()
            resolution = self.resolution_var.get()
            num_sets = int(self.num_sets_var.get())
            num_videos = self.num_videos_var.get()
            fade_duration = self.fade_var.get()
            still_duration = self.still_var.get()
            output_dir = self.output_dir_var.get()

            cadre_file = CADRE_OPTIONS[self.cadre_var.get()]
            intro_style = INTRO_OPTIONS[self.intro_var.get()]

            # Build paths
            source_dir = os.path.join(ASSETS_DIR, "zones", theme, "v0", resolution)
            background_path = os.path.join(ASSETS_DIR, "intro", f"{intro_style}@{resolution}.png")
            outro_path = os.path.join(ASSETS_DIR, "outro", f"outro-{theme}@{resolution}.png")
            cadre_path = os.path.join(ASSETS_DIR, "cadre", cadre_file) if cadre_file else None

            os.makedirs(output_dir, exist_ok=True)

            for i in range(num_videos):
                self._update_status(f"Generating video {i+1}/{num_videos}...")
                self._update_progress((i / num_videos) * 100)

                # Sample images
                image_paths = sample_unique_image_sets(source_dir, CATEGORIES, num_sets)

                # Generate unique filename
                short_uid = uuid.uuid4().hex[:8]
                output_path = os.path.join(output_dir, f"{theme}-{resolution}-{num_sets}s-{short_uid}.mp4")

                # Build and run ffmpeg command
                cmd, duration = build_ffmpeg_command(
                    background_path, image_paths, outro_path, cadre_path,
                    output_path, fade_duration, still_duration
                )

                result = subprocess.run(cmd, capture_output=True, text=True)

                if result.returncode != 0:
                    raise RuntimeError(f"ffmpeg error: {result.stderr}")

            self._update_progress(100)
            self._update_status(f"Done! Created {num_videos} video(s)")
            self._show_completion(num_videos, output_dir)

        except Exception as e:
            self._update_status(f"Error: {str(e)}")
            self.root.after(0, lambda: messagebox.showerror("Error", str(e)))

        finally:
            self.root.after(0, lambda: self.generate_btn.config(state=tk.NORMAL))

    def _update_status(self, text):
        """Update status label (thread-safe)."""
        self.root.after(0, lambda: self.status_label.config(text=text))

    def _update_progress(self, value):
        """Update progress bar (thread-safe)."""
        self.root.after(0, lambda: self.progress_var.set(value))

    def _show_completion(self, num_videos, output_dir):
        """Show completion dialog."""
        def show():
            if messagebox.askyesno("Complete",
                                    f"Created {num_videos} video(s)!\n\nOpen output folder?"):
                subprocess.run(['open', output_dir])
        self.root.after(0, show)


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    root = tk.Tk()
    app = Art0Studio(root)
    root.mainloop()
