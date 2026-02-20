import os
import random
import subprocess
import shutil
from collections import defaultdict
from PIL import Image
import uuid
from concurrent.futures import ProcessPoolExecutor
from tqdm import tqdm
from functools import partial

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


def create_frame_worker(frame_num, background_path, image_paths, frame_overlay_path,
                        frames_directory, fade_frames, still_frames, canvas_size, offsets):
    """Worker function for creating a single frame - runs in separate process."""
    cycle_length = fade_frames + still_frames
    current_image_index = (frame_num - 1) // cycle_length
    current_phase_in_cycle = (frame_num - 1) % cycle_length

    # Load images in this process (necessary for multiprocessing)
    background_image = Image.open(background_path).convert('RGBA')
    current_frame = background_image.copy()

    # Load only the images we need for this frame
    for i in range(min(current_image_index + 1, len(image_paths))):
        img = Image.open(image_paths[i]).convert('RGBA')
        mask = img.split()[3]

        if i < current_image_index:
            opacity = 255
        elif i == current_image_index:
            if current_phase_in_cycle < fade_frames:
                opacity = int(255 * current_phase_in_cycle / fade_frames)
            else:
                opacity = 255
        else:
            break

        fading_mask = mask.point(lambda p, op=opacity: min(p, op))
        fading_image = img.copy()
        fading_image.putalpha(fading_mask)
        current_frame = Image.alpha_composite(current_frame, fading_image)

    # Load frame overlay and composite
    frame_overlay = Image.open(frame_overlay_path).convert('RGBA')
    bg_width, bg_height = canvas_size
    x_offset, y_offset = offsets

    transparent_canvas = Image.new("RGBA", (bg_width, bg_height), (0, 0, 0, 0))
    transparent_canvas.paste(current_frame, (x_offset, y_offset), current_frame)
    final_composite = Image.alpha_composite(transparent_canvas, frame_overlay)

    frame_path = os.path.join(frames_directory, f"frame_{frame_num:05}.png")
    final_composite.save(frame_path, optimize=False)


def create_outro_frame_worker(frame_idx, outro_path, frame_overlay_path, frames_directory,
                               start_frame_num, fade_frames, canvas_size, offsets):
    """Worker function for creating outro frames."""
    opacity = int(255 * (frame_idx / fade_frames))

    outro_image = Image.open(outro_path).convert("RGBA")
    frame_overlay = Image.open(frame_overlay_path).convert('RGBA')

    bg_width, bg_height = canvas_size
    x_offset, y_offset = offsets

    # Create outro frame with opacity
    outro_with_opacity = outro_image.copy()
    alpha = outro_with_opacity.split()[3].point(lambda p, op=opacity: int(p * op / 255))
    outro_with_opacity.putalpha(alpha)

    transparent_canvas = Image.new("RGBA", (bg_width, bg_height), (0, 0, 0, 0))
    transparent_canvas.paste(outro_with_opacity, (x_offset, y_offset), outro_with_opacity)
    final_frame = Image.alpha_composite(transparent_canvas, frame_overlay)

    frame_path = os.path.join(frames_directory, f"frame_{start_frame_num + frame_idx:05}.png")
    final_frame.save(frame_path, optimize=False)


def compute_canvas_geometry(background_path, frame_overlay_path):
    """Pre-compute canvas size and offsets."""
    with Image.open(frame_overlay_path) as frame_overlay:
        bg_width, bg_height = frame_overlay.size
    with Image.open(background_path) as bg:
        fg_width, fg_height = bg.size

    x_offset = (bg_width - fg_width) // 2
    y_offset = (bg_height - fg_height) // 2

    return (bg_width, bg_height), (x_offset, y_offset)


def create_sequential_fade_animation(background_path, image_paths, frames_directory,
                                      fade_frames, still_frames, frame_overlay_path):
    """Generate animation frames using multiprocessing."""
    total_images = len(image_paths)
    total_frames = (fade_frames + still_frames) * total_images + still_frames

    canvas_size, offsets = compute_canvas_geometry(background_path, frame_overlay_path)

    # Use ProcessPoolExecutor for CPU-bound PIL operations
    worker = partial(
        create_frame_worker,
        background_path=background_path,
        image_paths=image_paths,
        frame_overlay_path=frame_overlay_path,
        frames_directory=frames_directory,
        fade_frames=fade_frames,
        still_frames=still_frames,
        canvas_size=canvas_size,
        offsets=offsets
    )

    with ProcessPoolExecutor(max_workers=os.cpu_count()) as executor:
        list(tqdm(
            executor.map(worker, range(1, total_frames + 1), chunksize=10),
            total=total_frames,
            desc="Generating frames"
        ))

    return total_frames


def add_outro_frames(frames_directory, outro_path, frame_overlay_path,
                     start_frame_num, fade_frames, canvas_size, offsets):
    """Add outro frames using multiprocessing."""
    worker = partial(
        create_outro_frame_worker,
        outro_path=outro_path,
        frame_overlay_path=frame_overlay_path,
        frames_directory=frames_directory,
        start_frame_num=start_frame_num,
        fade_frames=fade_frames,
        canvas_size=canvas_size,
        offsets=offsets
    )

    with ProcessPoolExecutor(max_workers=os.cpu_count()) as executor:
        list(tqdm(
            executor.map(worker, range(1, fade_frames + 1), chunksize=10),
            total=fade_frames,
            desc="Generating outro"
        ))


def create_video_from_frames(frames_directory, output_video_path, framerate=60):
    """Encode frames to MP4 using ffmpeg."""
    command = [
        'ffmpeg', '-y',
        '-framerate', str(framerate),
        '-i', os.path.join(frames_directory, 'frame_%05d.png'),
        '-c:v', 'libx264',
        '-profile:v', 'high',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        output_video_path
    ]
    subprocess.run(command, check=True, capture_output=True)


def create_art0_video(background_path, source_directory, outro_image_path, num_sets,
                      fade_frames, still_frames, frame_background, results_directory=None):
    """Main function to create the art0 video."""
    categories = ["pink", "green", "cyan", "red", "yellow", "orange", "blue", "indigo"]
    base_name = os.path.basename(os.path.normpath(source_directory))
    short_uid = uuid.uuid4().hex[:8]
    frames_directory = f'/tmp/.tmp_frames_{short_uid}'
    os.makedirs(frames_directory, exist_ok=True)

    try:
        # Sample images
        set_image_paths = sample_unique_image_sets(source_directory, categories, num_sets)

        # Pre-compute geometry once
        canvas_size, offsets = compute_canvas_geometry(background_path, frame_background)

        # Generate main animation frames
        total_frames = create_sequential_fade_animation(
            background_path, set_image_paths, frames_directory,
            fade_frames, still_frames, frame_background
        )

        # Add outro frames
        add_outro_frames(
            frames_directory, outro_image_path, frame_background,
            total_frames + 1, fade_frames, canvas_size, offsets
        )

        # Create output directory and encode video
        if results_directory is None:
            results_directory = "/Users/laeh/Desktop/art0/results/NEW"
        os.makedirs(results_directory, exist_ok=True)

        output_video_path = os.path.join(results_directory, f"{base_name}-{num_sets}sets-{short_uid}.mp4")
        create_video_from_frames(frames_directory, output_video_path, 60)

        print(f"Video created: {output_video_path}")

    finally:
        # Always clean up temp directory
        if os.path.exists(frames_directory):
            shutil.rmtree(frames_directory)


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
