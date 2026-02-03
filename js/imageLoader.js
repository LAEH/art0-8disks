/**
 * ImageLoader - Maximum Performance Image Preloader
 *
 * Optimizations:
 * - createImageBitmap for GPU-ready textures (when available)
 * - Adaptive batch sizes based on connection quality
 * - Fetch API with cache hints
 * - Memory pressure detection
 * - Fallback paths for all browsers
 */

class ImageLoader {
    constructor() {
        this.cache = new Map();
        this.bitmapCache = new Map(); // For createImageBitmap results
        this.abortControllers = new Map();

        // Feature detection
        this.supportsImageBitmap = typeof createImageBitmap === 'function';
        this.supportsAbortController = typeof AbortController === 'function';

        // Connection quality detection
        this.connectionQuality = this.detectConnectionQuality();

        // Listen for connection changes
        if (navigator.connection) {
            navigator.connection.addEventListener('change', () => {
                this.connectionQuality = this.detectConnectionQuality();
            });
        }
    }

    /**
     * Detect connection quality for adaptive loading
     */
    detectConnectionQuality() {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

        if (!conn) {
            // Assume good connection if API not available
            return { batchSize: 20, priority: 'high' };
        }

        const effectiveType = conn.effectiveType;
        const saveData = conn.saveData;

        // Respect data saver mode
        if (saveData) {
            return { batchSize: 4, priority: 'low' };
        }

        switch (effectiveType) {
            case 'slow-2g':
            case '2g':
                return { batchSize: 4, priority: 'low' };
            case '3g':
                return { batchSize: 10, priority: 'auto' };
            case '4g':
            default:
                return { batchSize: 25, priority: 'high' };
        }
    }

    /**
     * Check device memory pressure
     */
    isLowMemory() {
        // Check device memory API
        if (navigator.deviceMemory && navigator.deviceMemory < 4) {
            return true;
        }

        // Check if we've cached a lot of images
        if (this.cache.size > 200) {
            return true;
        }

        return false;
    }

    /**
     * Load a single image - maximum performance path
     */
    async loadImage(src, options = {}) {
        const { priority = this.connectionQuality.priority } = options;

        // Check bitmap cache first (fastest)
        if (this.bitmapCache.has(src)) {
            return this.bitmapCache.get(src);
        }

        // Check regular cache
        if (this.cache.has(src)) {
            return this.cache.get(src);
        }

        // Try createImageBitmap path (best performance)
        if (this.supportsImageBitmap) {
            try {
                return await this.loadWithBitmap(src, priority);
            } catch (e) {
                // Fallback to traditional loading
                console.warn('ImageBitmap failed, using fallback:', e.message);
            }
        }

        // Traditional Image loading
        return this.loadWithImage(src);
    }

    /**
     * Load using createImageBitmap (GPU-ready, best performance)
     */
    async loadWithBitmap(src, priority) {
        const controller = this.supportsAbortController ? new AbortController() : null;

        if (controller) {
            this.abortControllers.set(src, controller);
        }

        try {
            const fetchOptions = {
                mode: 'cors',
                credentials: 'omit',
                cache: 'force-cache', // Aggressive caching
            };

            if (controller) {
                fetchOptions.signal = controller.signal;
            }

            // Add priority hint if supported
            if (priority && 'fetchPriority' in HTMLImageElement.prototype) {
                fetchOptions.priority = priority;
            }

            const response = await fetch(src, fetchOptions);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const blob = await response.blob();

            // Create ImageBitmap with optimizations
            const bitmapOptions = {
                premultiplyAlpha: 'premultiply', // Pre-multiply for faster compositing
                colorSpaceConversion: 'default',
                imageOrientation: 'from-image'
            };

            const bitmap = await createImageBitmap(blob, bitmapOptions);

            this.bitmapCache.set(src, bitmap);
            this.abortControllers.delete(src);

            return bitmap;
        } catch (e) {
            this.abortControllers.delete(src);
            throw e;
        }
    }

    /**
     * Load using traditional Image element (fallback)
     */
    async loadWithImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';

            // Decoding hint for browsers that support it
            img.decoding = 'async';

            img.onload = async () => {
                try {
                    // Decode for jank-free rendering
                    if (img.decode) {
                        await img.decode();
                    }
                    this.cache.set(src, img);
                    resolve(img);
                } catch (e) {
                    // Decode failed but image loaded
                    this.cache.set(src, img);
                    resolve(img);
                }
            };

            img.onerror = () => {
                reject(new Error(`Failed to load: ${src}`));
            };

            img.src = src;
        });
    }

    /**
     * Preload multiple images with adaptive batching
     */
    async preloadAll(sources, onProgress = null) {
        const total = sources.length;
        let loaded = 0;
        const results = new Map();

        // Get already cached
        const toLoad = [];
        for (const src of sources) {
            if (this.bitmapCache.has(src)) {
                results.set(src, this.bitmapCache.get(src));
                loaded++;
            } else if (this.cache.has(src)) {
                results.set(src, this.cache.get(src));
                loaded++;
            } else {
                toLoad.push(src);
            }
        }

        if (onProgress && loaded > 0) {
            onProgress(loaded, total);
        }

        if (toLoad.length === 0) {
            return results;
        }

        // Adaptive batch size based on connection and memory
        let batchSize = this.connectionQuality.batchSize;

        if (this.isLowMemory()) {
            batchSize = Math.min(batchSize, 8);
        }

        // On mobile, reduce batch size further
        if (window.innerWidth < 600) {
            batchSize = Math.min(batchSize, 10);
        }

        // Process in batches
        for (let i = 0; i < toLoad.length; i += batchSize) {
            const batch = toLoad.slice(i, i + batchSize);

            const promises = batch.map(async (src) => {
                try {
                    const img = await this.loadImage(src);
                    results.set(src, img);
                } catch (e) {
                    console.warn(`Failed to load: ${src.substring(src.lastIndexOf('/') + 1)}`);
                }

                loaded++;
                if (onProgress) {
                    onProgress(loaded, total);
                }
            });

            await Promise.all(promises);

            // Small yield to prevent blocking UI
            await new Promise(r => setTimeout(r, 0));
        }

        return results;
    }

    /**
     * Preload with maximum parallelism (for fast connections)
     */
    async preloadAllParallel(sources, onProgress = null) {
        const total = sources.length;
        let loaded = 0;
        const results = new Map();

        const promises = sources.map(async (src) => {
            try {
                const img = await this.loadImage(src);
                results.set(src, img);
            } catch (e) {
                console.warn(`Failed to load: ${src.substring(src.lastIndexOf('/') + 1)}`);
            }

            loaded++;
            if (onProgress) {
                onProgress(loaded, total);
            }
        });

        await Promise.all(promises);
        return results;
    }

    /**
     * Get cached image (bitmap or HTMLImageElement)
     */
    get(src) {
        return this.bitmapCache.get(src) || this.cache.get(src) || null;
    }

    /**
     * Check if image is cached
     */
    has(src) {
        return this.bitmapCache.has(src) || this.cache.has(src);
    }

    /**
     * Clear all caches
     */
    clear() {
        // Close ImageBitmaps to free GPU memory
        for (const bitmap of this.bitmapCache.values()) {
            if (bitmap.close) {
                bitmap.close();
            }
        }
        this.bitmapCache.clear();
        this.cache.clear();
    }

    /**
     * Cancel all pending loads
     */
    cancelAll() {
        for (const controller of this.abortControllers.values()) {
            controller.abort();
        }
        this.abortControllers.clear();
    }

    /**
     * Get cache statistics
     */
    get stats() {
        return {
            images: this.cache.size,
            bitmaps: this.bitmapCache.size,
            total: this.cache.size + this.bitmapCache.size,
            supportsImageBitmap: this.supportsImageBitmap,
            connectionQuality: this.connectionQuality
        };
    }

    get size() {
        return this.cache.size + this.bitmapCache.size;
    }
}

// Export singleton
window.imageLoader = new ImageLoader();
