import os
import random
import subprocess
import shutil
import uuid
from collections import defaultdict
from PIL import Image
from multiprocessing import Pool, cpu_count, set_start_method
from tqdm import tqdm

# Global shared variables for multiprocessing
global_background_image = None
global_images_with_masks = None
global_frame_overlay = None

def sample_unique_image_sets(source_directory, categories, num_sets):
    images_by_category = defaultdict(list)
    for filename in os.listdir(source_directory):
        for category in categories:
            if category in filename:
                images_by_category[category].append(os.path.join(source_directory, filename))

    for category, images in images_by_category.items():
        if len(images) < num_sets:
            raise ValueError(f"Not enough images for category '{category}'. Required: {num_sets}, Available: {len(images)}")

    preselected_images_by_category = {
        category: random.sample(images, num_sets) for category, images in images_by_category.items()
    }

    set_image_paths = []
    for i in range(num_sets):
        for category in categories:
            selected_image = preselected_images_by_category[category][i]
            set_image_paths.append(selected_image)

    return set_image_paths

def load_images_and_masks(image_paths):
    result = []
    for path in image_paths:
        img = Image.open(path).convert('RGBA')
        mask = img.split()[3]  # Alpha channel
        result.append((img, mask))
    return result

def init_worker(background_path, frame_overlay_path, image_paths):
    global global_background_image, global_frame_overlay, global_images_with_masks
    global_background_image = Image.open(background_path).convert('RGBA')
    global_frame_overlay = Image.open(frame_overlay_path).convert('RGBA')
    global_images_with_masks = load_images_and_masks(image_paths)

def create_frame(args):
    frame_num, total_frames, fade_frames, still_frames, frames_directory = args

    cycle_length = fade_frames + still_frames
    current_image_index = (frame_num - 1) // cycle_length
    current_phase_in_cycle = (frame_num - 1) % cycle_length

    current_frame = global_background_image.copy()

    for i, (image, mask) in enumerate(global_images_with_masks):
        if i < current_image_index:
            opacity = 255
        elif i == current_image_index:
            opacity = int(255 * current_phase_in_cycle / fade_frames) if current_phase_in_cycle < fade_frames else 255
        else:
            break

        fading_mask = mask.point(lambda p: min(p, opacity))
        fading_image = image.copy()
        fading_image.putalpha(fading_mask)
        current_frame = Image.alpha_composite(current_frame, fading_image)

    bg_width, bg_height = global_frame_overlay.size
    fg_width, fg_height = current_frame.size
    x_offset = (bg_width - fg_width) // 2
    y_offset = (bg_height - fg_height) // 2

    transparent_canvas = Image.new("RGBA", (bg_width, bg_height), (0, 0, 0, 0))
    transparent_canvas.paste(current_frame, (x_offset, y_offset), current_frame)

    final_composite = Image.alpha_composite(transparent_canvas, global_frame_overlay)

    frame_path = os.path.join(frames_directory, f"frame_{frame_num:05}.png")
    final_composite.save(frame_path, compress_level=1)  # Lower compression for speed

def create_sequential_fade_animation_with_background(background_path, image_paths, frames_directory, fade_frames, still_frames, frame_background_path):
    total_images = len(image_paths)
    total_frames = (fade_frames + still_frames) * total_images + still_frames

    args = [(frame_num, total_frames, fade_frames, still_frames, frames_directory) for frame_num in range(1, total_frames + 1)]

    with Pool(processes=cpu_count(), initializer=init_worker,
              initargs=(background_path, frame_background_path, image_paths)) as pool:
        list(tqdm(pool.imap_unordered(create_frame, args), total=total_frames, desc="Generating animation frames"))

    return total_frames

def add_outro_frames(frames_directory, outro_image_path, frame_background_path, start_frame_num, fade_frames=300):
    outro_image = Image.open(outro_image_path).convert("RGBA")
    frame_bg_image = Image.open(frame_background_path).convert('RGBA')
    bg_width, bg_height = frame_bg_image.size
    outro_width, outro_height = outro_image.size
    x_offset = (bg_width - outro_width) // 2
    y_offset = (bg_height - outro_height) // 2
    transparent_canvas = Image.new("RGBA", (bg_width, bg_height), (0, 0, 0, 0))

    for i in tqdm(range(1, fade_frames + 1), desc="Adding outro frames"):
        opacity = int(255 * (i / fade_frames))
        outro_frame_with_opacity = outro_image.copy()
        outro_frame_with_opacity.putalpha(opacity)

        temp_canvas = transparent_canvas.copy()
        temp_canvas.paste(outro_frame_with_opacity, (x_offset, y_offset), outro_frame_with_opacity)
        final_frame = Image.alpha_composite(temp_canvas, frame_bg_image)

        frame_path = os.path.join(frames_directory, f"frame_{start_frame_num + i - 1:05}.png")
        final_frame.save(frame_path, compress_level=1)

def create_video_from_frames(frames_directory, output_video_path, framerate=60):
    command = [
        'ffmpeg',
        '-framerate', str(framerate),
        '-i', os.path.join(frames_directory, 'frame_%05d.png'),
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-threads', str(cpu_count()),
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        output_video_path
    ]
    subprocess.run(command, check=True)

def create_art0_video(background_path, source_directory, outro_image_path, num_sets, fade_frames, still_frames, frame_background, results_directory=None):
    categories = ["pink", "green", "cyan", "red", "yellow", "orange", "blue", "indigo"]
    base_name = os.path.basename(os.path.normpath(source_directory))
    short_uid = uuid.uuid4().hex[:8]
    frames_directory = f'/tmp/.tmp_frames_{short_uid}'
    os.makedirs(frames_directory, exist_ok=True)

    set_image_paths = sample_unique_image_sets(source_directory, categories, num_sets)
    total_frames = create_sequential_fade_animation_with_background(
        background_path, set_image_paths, frames_directory, fade_frames, still_frames, frame_background
    )

    add_outro_frames(frames_directory, outro_image_path, frame_background, total_frames + 1, fade_frames)

    if results_directory is None:
        results_directory = "/path/to/results/directory"
    os.makedirs(results_directory, exist_ok=True)

    output_video_path = os.path.join(results_directory, f"{base_name}-{num_sets}sets-{short_uid}.mp4")
    create_video_from_frames(frames_directory, output_video_path, 60)

    print(f"✅ Video created successfully: {output_video_path}")
    shutil.rmtree(frames_directory)

def main():
    config_list = [
        (12, "./assets/zones/vegas/v0/1680", "./assets/intro/intro@1680.png", "./assets/outro/outro-vegas@1680.png", "/Users/laeh/Desktop/art0/assets/cadre/5l-inverted.png"),
        (12, "./assets/zones/vegas/v0/1680", "./assets/intro/intro@1680.png", "./assets/outro/outro-vegas@1680.png", "/Users/laeh/Desktop/art0/assets/cadre/5l.png"),
        (12, "./assets/zones/vegas/v0/3360", "./assets/intro/intro@3360.png", "./assets/outro/outro-vegas@3360.png", "/Users/laeh/Desktop/art0/assets/cadre/5l-inverted.png"),
        (12, "./assets/zones/vegas/v0/3360", "./assets/intro/intro@3360.png", "./assets/outro/outro-vegas@3360.png", "/Users/laeh/Desktop/art0/assets/cadre/5l.png"),
    ]
    for _ in range(10):
        for num_sets, source_dir, bg, outro, frame_bg in config_list:
            create_art0_video(bg, source_dir, outro, num_sets, 100, 100, frame_bg, "/Users/laeh/Desktop/art0/results/MacStudio")

if __name__ == "__main__":
    try:
        set_start_method("spawn")
    except RuntimeError:
        pass  # Already set in some environments
    main()