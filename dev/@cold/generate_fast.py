import os
import random
import subprocess
from collections import defaultdict
import uuid

def sample_unique_image_sets(source_directory, categories, num_sets):
    """Sample unique images from each category."""
    images_by_category = defaultdict(list)
    for filename in os.listdir(source_directory):
        for category in categories:
            if category in filename:
                images_by_category[category].append(os.path.join(source_directory, filename))

    for category, images in images_by_category.items():
        if len(images) < num_sets:
            raise ValueError(f"Not enough images for category '{category}'. Required: {num_sets}, Available: {len(images)}")

    preselected = {cat: random.sample(imgs, num_sets) for cat, imgs in images_by_category.items()}
    return [preselected[cat][i] for i in range(num_sets) for cat in categories]


def get_image_size(path):
    """Get image dimensions using ffprobe."""
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
        capture_output=True, text=True
    )
    w, h = result.stdout.strip().split(',')
    return int(w), int(h)


def build_ffmpeg_command(background_path, image_paths, outro_path, frame_overlay_path,
                         output_path, fade_duration, still_duration, framerate=60):
    """Build ffmpeg command with filter_complex for all compositing."""

    # Get sizes to calculate padding
    content_w, content_h = get_image_size(background_path)
    frame_w, frame_h = get_image_size(frame_overlay_path)
    pad_x = (frame_w - content_w) // 2
    pad_y = (frame_h - content_h) // 2

    fade_frames = int(fade_duration * framerate)
    still_frames = int(still_duration * framerate)
    cycle_frames = fade_frames + still_frames

    num_images = len(image_paths)
    total_main_frames = cycle_frames * num_images + still_frames
    outro_frames = fade_frames
    total_frames = total_main_frames + outro_frames
    total_duration = total_frames / framerate

    # Build input list
    inputs = [
        '-loop', '1', '-t', str(total_duration), '-i', background_path,
    ]
    for img_path in image_paths:
        inputs.extend(['-loop', '1', '-t', str(total_duration), '-i', img_path])
    inputs.extend(['-loop', '1', '-t', str(total_duration), '-i', outro_path])
    inputs.extend(['-loop', '1', '-t', str(total_duration), '-i', frame_overlay_path])

    # Build filter_complex
    filters = []

    # Index mapping: 0=background, 1..N=images, N+1=outro, N+2=frame_overlay
    outro_idx = num_images + 1
    frame_idx = num_images + 2

    # Start with background
    current_layer = "0:v"

    # Fade in each image sequentially
    for i, _ in enumerate(image_paths):
        input_idx = i + 1
        start_time = (i * cycle_frames) / framerate

        # Apply fade to this image's alpha channel
        filters.append(
            f"[{input_idx}:v]format=rgba,fade=t=in:st={start_time:.3f}:d={fade_duration}:alpha=1[img{i}]"
        )

        # Overlay onto current composition
        filters.append(
            f"[{current_layer}][img{i}]overlay=format=auto[comp{i}]"
        )
        current_layer = f"comp{i}"

    # Add outro fade
    outro_start = total_main_frames / framerate
    filters.append(
        f"[{outro_idx}:v]format=rgba,fade=t=in:st={outro_start:.3f}:d={fade_duration}:alpha=1[outro]"
    )
    filters.append(
        f"[{current_layer}][outro]overlay=format=auto[with_outro]"
    )

    # Pad content to match frame overlay size, then overlay frame on top
    # The frame has transparent center so content shows through
    filters.append(
        f"[with_outro]pad={frame_w}:{frame_h}:{pad_x}:{pad_y}:color=black@0[padded]"
    )
    filters.append(
        f"[padded][{frame_idx}:v]overlay=0:0:format=auto[final]"
    )

    filter_complex = ";".join(filters)

    cmd = [
        'ffmpeg', '-y',
        *inputs,
        '-filter_complex', filter_complex,
        '-map', '[final]',
        '-t', str(total_duration),
        '-c:v', 'libx264',
        '-profile:v', 'high',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-r', str(framerate),
        output_path
    ]

    return cmd


def create_art0_video(background_path, source_directory, outro_image_path, num_sets,
                      fade_frames, still_frames, frame_background, results_directory=None,
                      framerate=60):
    """Main function to create the art0 video using ffmpeg filter_complex."""
    categories = ["pink", "green", "cyan", "red", "yellow", "orange", "blue", "indigo"]
    base_name = os.path.basename(os.path.normpath(source_directory))
    short_uid = uuid.uuid4().hex[:8]

    # Sample images
    set_image_paths = sample_unique_image_sets(source_directory, categories, num_sets)

    # Setup output
    if results_directory is None:
        results_directory = "/Users/laeh/Desktop/art0/results/NEW"
    os.makedirs(results_directory, exist_ok=True)
    output_path = os.path.join(results_directory, f"{base_name}-{num_sets}sets-{short_uid}.mp4")

    # Convert frame counts to durations
    fade_duration = fade_frames / framerate
    still_duration = still_frames / framerate

    # Build and run ffmpeg
    cmd = build_ffmpeg_command(
        background_path, set_image_paths, outro_image_path, frame_background,
        output_path, fade_duration, still_duration, framerate
    )

    print(f"Processing {len(set_image_paths)} images...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print("ffmpeg error:")
        print(result.stderr)
        raise RuntimeError("ffmpeg failed")

    print(f"Video created: {output_path}")
    return output_path


if __name__ == "__main__":
    num_sets = 1
    source_directory = "/Users/laeh/Desktop/art0/assets/zones/vegas/v0/1680"
    background_path = "/Users/laeh/Desktop/art0/assets/intro/intro@1680.png"
    outro_image_path = "/Users/laeh/Desktop/art0/assets/outro/outro-vegas@1680.png"
    results_directory = "/Users/laeh/Desktop/art0/results/NEW"
    frame_background = "/Users/laeh/Desktop/art0/assets/cadre/5l-inverted.png"

    create_art0_video(
        background_path, source_directory, outro_image_path, num_sets,
        fade_frames=100, still_frames=100,
        frame_background=frame_background,
        results_directory=results_directory
    )
