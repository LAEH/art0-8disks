/**
 * ImageLoader - Optimized for CDN loading with parallel fetches
 */

class ImageLoader {
    constructor() {
        this.cache = new Map();
        this.onProgress = null;
    }

    /**
     * Load a single image with decode (handles CORS for CDN)
     * @param {string} src - Image URL
     * @returns {Promise<HTMLImageElement>}
     */
    async loadImage(src) {
        // Check cache first
        if (this.cache.has(src)) {
            return this.cache.get(src);
        }

        return new Promise((resolve, reject) => {
            const img = new Image();

            // Enable CORS for CDN images (required for canvas drawing)
            img.crossOrigin = 'anonymous';

            img.onload = async () => {
                try {
                    // Decode for jank-free rendering
                    await img.decode();
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
     * Preload multiple images with optimized parallel loading
     * @param {string[]} sources - Array of image URLs
     * @param {function} onProgress - Callback(loaded, total)
     * @returns {Promise<Map<string, HTMLImageElement>>}
     */
    async preloadAll(sources, onProgress = null) {
        const total = sources.length;
        let loaded = 0;
        const results = new Map();

        // Filter out already cached images
        const toLoad = sources.filter(src => !this.cache.has(src));

        // Add cached images to results immediately
        for (const src of sources) {
            if (this.cache.has(src)) {
                results.set(src, this.cache.get(src));
                loaded++;
            }
        }

        if (onProgress && loaded > 0) {
            onProgress(loaded, total);
        }

        // If all cached, return immediately
        if (toLoad.length === 0) {
            return results;
        }

        // Load remaining images in larger parallel batches for CDN
        // GCS handles high concurrency well
        const batchSize = 20;

        for (let i = 0; i < toLoad.length; i += batchSize) {
            const batch = toLoad.slice(i, i + batchSize);

            const promises = batch.map(async (src) => {
                try {
                    const img = await this.loadImage(src);
                    results.set(src, img);
                } catch (e) {
                    console.warn(`Failed to load image: ${src}`);
                }

                loaded++;
                if (onProgress) {
                    onProgress(loaded, total);
                }
            });

            await Promise.all(promises);
        }

        return results;
    }

    /**
     * Preload images with full parallel loading (no batching)
     * Use for smaller sets or when speed is critical
     * @param {string[]} sources - Array of image URLs
     * @param {function} onProgress - Callback(loaded, total)
     * @returns {Promise<Map<string, HTMLImageElement>>}
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
                console.warn(`Failed to load image: ${src}`);
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
     * Get cached image
     * @param {string} src - Image URL
     * @returns {HTMLImageElement|null}
     */
    get(src) {
        return this.cache.get(src) || null;
    }

    /**
     * Check if image is cached
     * @param {string} src - Image URL
     * @returns {boolean}
     */
    has(src) {
        return this.cache.has(src);
    }

    /**
     * Clear cache
     */
    clear() {
        this.cache.clear();
    }

    /**
     * Get cache size
     * @returns {number}
     */
    get size() {
        return this.cache.size;
    }
}

// Export singleton
window.imageLoader = new ImageLoader();
