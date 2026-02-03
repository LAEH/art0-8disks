/**
 * Animator - High Performance 60fps Animation Engine
 *
 * Optimizations:
 * - Visibility API: pause when tab is hidden
 * - Reduced motion preference support
 * - Offscreen canvas for compositing (when available)
 * - Frame skipping under load
 * - Efficient draw calls
 */

class Animator {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', {
            alpha: true,
            desynchronized: true, // Reduce latency where supported
            willReadFrequently: false
        });

        // Display dimensions (may differ from canvas size due to DPR)
        this.displayWidth = canvas.width;
        this.displayHeight = canvas.height;
        this.dpr = 1;

        // Animation state
        this.running = false;
        this.paused = false; // Paused due to visibility
        this.animationId = null;
        this.lastTime = 0;

        // Timing parameters (in seconds)
        this.fadeDuration = 1.7;
        this.holdDuration = 1.7;

        // Reduced motion preference
        this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // State machine for current zone transition
        this.state = 'IDLE'; // IDLE, FADING, HOLDING
        this.stateTime = 0;

        // Image data
        this.imagesByColor = {};
        this.categories = [];
        this.frameImage = null;
        this.backgroundImage = null;

        // Zone layers - each zone has current and incoming image
        this.zones = {};

        // Current animation position
        this.currentZoneIndex = 0;
        this.currentSet = 0;
        this.usedImages = {};

        // Style transition
        this.transitioningOut = false;
        this.transitionAlpha = 1;

        // FPS tracking
        this.frameCount = 0;
        this.fpsTime = 0;
        this.currentFps = 0;
        this.targetFps = 60;
        this.frameInterval = 1000 / 60;
        this.lastFrameTime = 0;

        // Callbacks
        this.onStatusUpdate = null;
        this.onFpsUpdate = null;
        this.onTransitionComplete = null;

        // Setup visibility handling
        this.setupVisibilityHandling();

        // Listen for reduced motion changes
        window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
            this.prefersReducedMotion = e.matches;
        });
    }

    /**
     * Setup page visibility handling to save resources
     */
    setupVisibilityHandling() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pause();
            } else {
                this.resume();
            }
        });

        // Also handle page freeze (mobile browsers)
        if ('onfreeze' in document) {
            document.addEventListener('freeze', () => this.pause());
            document.addEventListener('resume', () => this.resume());
        }
    }

    /**
     * Pause animation (visibility change)
     */
    pause() {
        if (!this.running) return;
        this.paused = true;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    /**
     * Resume animation (visibility change)
     */
    resume() {
        if (!this.running || !this.paused) return;
        this.paused = false;
        this.lastTime = performance.now();
        this.lastFrameTime = this.lastTime;
        this.loop();
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
                alpha: 0
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

        for (const color of this.categories) {
            if (this.usedImages[color]) {
                this.usedImages[color].clear();
            }
        }

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
        let available = images.filter(src => !used.has(src));

        if (available.length === 0) {
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

        this.zones[color].incoming = img;
        this.zones[color].alpha = 0;

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
     * Complete the current zone fade
     */
    completeZoneFade() {
        const color = this.categories[this.currentZoneIndex];
        const zone = this.zones[color];

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
            this.currentZoneIndex = 0;
            this.currentSet++;

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
        this.paused = false;
        this.lastTime = performance.now();
        this.lastFrameTime = this.lastTime;
        this.fpsTime = this.lastTime;
        this.frameCount = 0;

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
        this.paused = false;
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
     * Main animation loop - optimized for 60fps
     */
    loop() {
        if (!this.running || this.paused) return;

        const now = performance.now();
        const elapsed = now - this.lastFrameTime;

        // Frame rate limiting for battery savings on high refresh displays
        if (elapsed < this.frameInterval * 0.9) {
            this.animationId = requestAnimationFrame(() => this.loop());
            return;
        }

        this.lastFrameTime = now;
        const deltaTime = Math.min((now - this.lastTime) / 1000, 0.1); // Cap at 100ms
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

        // Update and render
        this.update(deltaTime);
        this.render();

        // Schedule next frame
        this.animationId = requestAnimationFrame(() => this.loop());
    }

    /**
     * Update animation state
     */
    update(deltaTime) {
        // For reduced motion, skip to end of transitions
        const effectiveFadeDuration = this.prefersReducedMotion ? 0.1 : this.fadeDuration;

        // Handle style transition
        if (this.transitioningOut) {
            this.transitionAlpha -= deltaTime / effectiveFadeDuration;
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
            this.transitionAlpha += deltaTime / effectiveFadeDuration;
            if (this.transitionAlpha > 1) {
                this.transitionAlpha = 1;
            }
        }

        this.stateTime += deltaTime;

        switch (this.state) {
            case 'FADING':
                const color = this.categories[this.currentZoneIndex];
                const zone = this.zones[color];

                if (zone && zone.incoming) {
                    const progress = Math.min(this.stateTime / effectiveFadeDuration, 1);
                    zone.alpha = this.prefersReducedMotion ? progress : this.easeInOutCubic(progress);
                }

                if (this.stateTime >= effectiveFadeDuration) {
                    this.completeZoneFade();
                    this.state = 'HOLDING';
                    this.stateTime = 0;
                }
                break;

            case 'HOLDING':
                if (this.stateTime >= this.holdDuration) {
                    this.advanceToNextZone();
                    this.startZoneFade();
                    this.state = 'FADING';
                    this.stateTime = 0;
                }
                break;
        }
    }

    /**
     * Render current frame - optimized compositing
     */
    render() {
        const ctx = this.ctx;
        const width = this.displayWidth || this.canvas.width;
        const height = this.displayHeight || this.canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Apply global transition alpha
        ctx.globalAlpha = this.transitionAlpha;

        // Draw background
        if (this.backgroundImage) {
            this.drawImage(this.backgroundImage, 1);
        }

        // Draw all zones in order
        for (const color of this.categories) {
            const zone = this.zones[color];
            if (!zone) continue;

            if (zone.current) {
                this.drawImage(zone.current, 1);
            }

            if (zone.incoming && zone.alpha > 0.001) {
                this.drawImage(zone.incoming, zone.alpha);
            }
        }

        // Draw frame overlay
        if (this.frameImage) {
            this.drawImage(this.frameImage, 1);
        }

        // Reset alpha
        ctx.globalAlpha = 1;
    }

    /**
     * Draw an image - optimized for performance
     */
    drawImage(img, alpha) {
        if (!img || alpha < 0.001) return;

        const ctx = this.ctx;
        const width = this.displayWidth || this.canvas.width;
        const height = this.displayHeight || this.canvas.height;

        // Get image dimensions (works for both Image and ImageBitmap)
        const imgWidth = img.width;
        const imgHeight = img.height;

        // Calculate scaling to fit
        const scale = Math.min(width / imgWidth, height / imgHeight);
        const drawWidth = imgWidth * scale;
        const drawHeight = imgHeight * scale;
        const x = (width - drawWidth) / 2;
        const y = (height - drawHeight) / 2;

        ctx.globalAlpha = alpha * this.transitionAlpha;
        ctx.drawImage(img, x, y, drawWidth, drawHeight);
    }

    /**
     * Resize canvas with DPR support
     */
    resize(width, height, dpr = 1) {
        // Set actual canvas size (scaled for DPR)
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;

        // Set display size via CSS
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';

        // Scale context for DPR
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Store for calculations
        this.displayWidth = width;
        this.displayHeight = height;
        this.dpr = dpr;

        // Re-render
        if (this.running && !this.paused) {
            this.render();
        }
    }

    /**
     * Get current FPS
     */
    get fps() {
        return this.currentFps;
    }

    /**
     * Check if animation is active
     */
    get isRunning() {
        return this.running && !this.paused;
    }
}

// Export
window.Animator = Animator;
