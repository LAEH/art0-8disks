/**
 * Animator - 60fps animation loop with layered zone crossfades
 *
 * Architecture:
 * - 8 zones displayed simultaneously (one per color)
 * - Each zone has a current image that gets replaced with crossfade
 * - Animation cycles through zones: pink -> green -> ... -> indigo (one set)
 * - Old image only removed after new image fully faded in
 */

class Animator {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // Animation state
        this.running = false;
        this.animationId = null;
        this.lastTime = 0;

        // Timing parameters (in seconds)
        this.fadeDuration = 1.7;
        this.holdDuration = 1.7;

        // State machine for current zone transition
        this.state = 'IDLE'; // IDLE, FADING, HOLDING
        this.stateTime = 0;

        // Image data
        this.imagesByColor = {};
        this.categories = [];
        this.frameImage = null;
        this.backgroundImage = null;  // Intro/background image

        // Zone layers - each zone has current and incoming image
        this.zones = {}; // { color: { current: img, incoming: img, alpha: 1 } }

        // Current animation position
        this.currentZoneIndex = 0;
        this.currentSet = 0;
        this.usedImages = {}; // Track used images per color

        // Style transition
        this.transitioningOut = false;
        this.transitionAlpha = 1;

        // FPS tracking
        this.frameCount = 0;
        this.fpsTime = 0;
        this.currentFps = 0;

        // Callbacks
        this.onStatusUpdate = null;
        this.onFpsUpdate = null;
        this.onTransitionComplete = null;
    }

    /**
     * Ease-in-out cubic function
     */
    easeInOutCubic(t) {
        return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    /**
     * Set images for animation
     */
    setImages(imagesByColor, categories) {
        this.imagesByColor = imagesByColor;
        this.categories = categories;

        // Initialize used images tracking
        this.usedImages = {};
        for (const color of categories) {
            this.usedImages[color] = new Set();
        }

        // Initialize zones
        this.zones = {};
        for (const color of categories) {
            this.zones[color] = {
                current: null,
                incoming: null,
                alpha: 0  // Alpha of incoming image during fade
            };
        }

        this.reset();
    }

    /**
     * Set frame overlay image
     */
    setFrame(frameImage) {
        this.frameImage = frameImage;
    }

    /**
     * Set background/intro image
     */
    setBackground(backgroundImage) {
        this.backgroundImage = backgroundImage;
    }

    /**
     * Reset animation state
     */
    reset() {
        this.currentZoneIndex = 0;
        this.currentSet = 0;
        this.state = 'IDLE';
        this.stateTime = 0;
        this.transitioningOut = false;
        this.transitionAlpha = 1;

        // Reset used images
        for (const color of this.categories) {
            if (this.usedImages[color]) {
                this.usedImages[color].clear();
            }
        }

        // Clear all zones
        for (const color of this.categories) {
            if (this.zones[color]) {
                this.zones[color].current = null;
                this.zones[color].incoming = null;
                this.zones[color].alpha = 0;
            }
        }
    }

    /**
     * Get random unused image for a color
     */
    getRandomImage(color) {
        const images = this.imagesByColor[color] || [];
        if (images.length === 0) return null;

        const used = this.usedImages[color] || new Set();

        // Filter out used images
        let available = images.filter(src => !used.has(src));

        if (available.length === 0) {
            // All used, reset for this color
            this.usedImages[color] = new Set();
            available = images;
        }

        const src = available[Math.floor(Math.random() * available.length)];
        this.usedImages[color].add(src);
        return src;
    }

    /**
     * Start fading in a new image for the current zone
     */
    startZoneFade() {
        const color = this.categories[this.currentZoneIndex];
        const imageSrc = this.getRandomImage(color);

        if (!imageSrc) {
            console.warn(`No images for color: ${color}`);
            return false;
        }

        const img = window.imageLoader.get(imageSrc);
        if (!img) {
            console.warn(`Image not loaded: ${imageSrc}`);
            return false;
        }

        // Set incoming image for this zone
        this.zones[color].incoming = img;
        this.zones[color].alpha = 0;

        // Update status
        if (this.onStatusUpdate) {
            this.onStatusUpdate({
                color: color,
                set: this.currentSet + 1,
                totalSets: '∞'
            });
        }

        return true;
    }

    /**
     * Complete the current zone fade (incoming becomes current)
     */
    completeZoneFade() {
        const color = this.categories[this.currentZoneIndex];
        const zone = this.zones[color];

        // Incoming becomes current, incoming cleared
        zone.current = zone.incoming;
        zone.incoming = null;
        zone.alpha = 0;
    }

    /**
     * Move to next zone
     */
    advanceToNextZone() {
        this.currentZoneIndex++;

        if (this.currentZoneIndex >= this.categories.length) {
            // Completed a set
            this.currentZoneIndex = 0;
            this.currentSet++;

            // Infinite loop - reset set counter periodically
            if (this.currentSet >= 1000) {
                this.currentSet = 0;
            }
        }
    }

    /**
     * Start animation
     */
    start() {
        if (this.running) return;

        this.running = true;
        this.lastTime = performance.now();
        this.fpsTime = this.lastTime;
        this.frameCount = 0;

        // Start first zone fade
        this.startZoneFade();
        this.state = 'FADING';
        this.stateTime = 0;

        this.loop();
    }

    /**
     * Stop animation
     */
    stop() {
        this.running = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    /**
     * Begin style transition (fade out)
     */
    beginTransition() {
        this.transitioningOut = true;
        this.transitionAlpha = 1;
    }

    /**
     * Main animation loop
     */
    loop() {
        if (!this.running) return;

        const now = performance.now();
        const deltaTime = (now - this.lastTime) / 1000; // Convert to seconds
        this.lastTime = now;

        // FPS calculation
        this.frameCount++;
        if (now - this.fpsTime >= 1000) {
            this.currentFps = this.frameCount;
            this.frameCount = 0;
            this.fpsTime = now;

            if (this.onFpsUpdate) {
                this.onFpsUpdate(this.currentFps);
            }
        }

        // Update state
        this.update(deltaTime);

        // Render
        this.render();

        // Schedule next frame
        this.animationId = requestAnimationFrame(() => this.loop());
    }

    /**
     * Update animation state
     */
    update(deltaTime) {
        // Handle style transition (fade out entire composition)
        if (this.transitioningOut) {
            this.transitionAlpha -= deltaTime / this.fadeDuration;
            if (this.transitionAlpha <= 0) {
                this.transitionAlpha = 0;
                this.transitioningOut = false;
                if (this.onTransitionComplete) {
                    this.onTransitionComplete();
                }
            }
            return;
        }

        // Fade in if returning from transition
        if (this.transitionAlpha < 1) {
            this.transitionAlpha += deltaTime / this.fadeDuration;
            if (this.transitionAlpha > 1) {
                this.transitionAlpha = 1;
            }
        }

        this.stateTime += deltaTime;

        switch (this.state) {
            case 'FADING':
                // Update alpha for current zone's incoming image
                const color = this.categories[this.currentZoneIndex];
                const zone = this.zones[color];

                if (zone && zone.incoming) {
                    const progress = Math.min(this.stateTime / this.fadeDuration, 1);
                    zone.alpha = this.easeInOutCubic(progress);
                }

                if (this.stateTime >= this.fadeDuration) {
                    // Fade complete - incoming becomes current
                    this.completeZoneFade();
                    this.state = 'HOLDING';
                    this.stateTime = 0;
                }
                break;

            case 'HOLDING':
                if (this.stateTime >= this.holdDuration) {
                    // Move to next zone and start its fade
                    this.advanceToNextZone();
                    this.startZoneFade();
                    this.state = 'FADING';
                    this.stateTime = 0;
                }
                break;
        }
    }

    /**
     * Render current frame - all zones composited
     */
    render() {
        const ctx = this.ctx;
        const canvas = this.canvas;

        // Clear canvas (transparent to show page background)
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Apply global transition alpha
        ctx.globalAlpha = this.transitionAlpha;

        // Draw background/intro image first
        if (this.backgroundImage) {
            this.drawImage(this.backgroundImage, 1);
        }

        // Draw all zones in order (each layer composites on top)
        for (const color of this.categories) {
            const zone = this.zones[color];
            if (!zone) continue;

            // Draw current image (fully opaque within this zone)
            if (zone.current) {
                this.drawImage(zone.current, 1);
            }

            // Draw incoming image with fade alpha
            if (zone.incoming && zone.alpha > 0) {
                this.drawImage(zone.incoming, zone.alpha);
            }
        }

        // Draw frame overlay on top of everything
        if (this.frameImage) {
            this.drawImage(this.frameImage, 1);
        }

        // Reset alpha
        ctx.globalAlpha = 1;
    }

    /**
     * Draw an image centered and scaled to fit canvas
     */
    drawImage(img, alpha) {
        const ctx = this.ctx;
        const canvas = this.canvas;

        // Calculate scaling to fit canvas while maintaining aspect ratio
        const scale = Math.min(
            canvas.width / img.width,
            canvas.height / img.height
        );
        const drawWidth = img.width * scale;
        const drawHeight = img.height * scale;
        const x = (canvas.width - drawWidth) / 2;
        const y = (canvas.height - drawHeight) / 2;

        ctx.globalAlpha = alpha * this.transitionAlpha;
        ctx.drawImage(img, x, y, drawWidth, drawHeight);
    }

    /**
     * Resize canvas
     */
    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;

        // Re-render immediately
        this.render();
    }
}

// Export
window.Animator = Animator;
