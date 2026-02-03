/**
 * Art0 Studio - Static Production Build
 * Loads config from config.json, images from GCS CDN
 *
 * Performance: Adaptive quality tiers for sustained 60fps
 */

(function() {
    'use strict';

    // Terminal logging
    const terminalContent = document.getElementById('terminal-content');
    const mobileZone = document.getElementById('mobile-zone');
    const statCached = document.getElementById('stat-cached');
    const statFps = document.getElementById('stat-fps');
    const fpsFill = document.getElementById('fps-fill');
    let startTime = Date.now();
    let currentQualityTier = 'A';

    function log(message, type = 'info') {
        // Skip logging on mobile/tablet where terminal is hidden
        if (window.innerWidth < 1000) return;

        const elapsed = Date.now() - startTime;
        const seconds = Math.floor(elapsed / 1000);
        const ms = elapsed % 1000;
        const timestamp = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}:${String(Math.floor(ms / 10)).padStart(2, '0')}`;

        const tagMap = {
            'system': 'SYS',
            'config': 'CFG',
            'zone': 'ZNE',
            'info': 'INF',
            'event': 'EVT',
            'error': 'ERR',
            'perf': 'PRF'
        };

        const tag = tagMap[type] || 'LOG';

        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        line.innerHTML = `<span class="timestamp">${timestamp}</span><span class="message"><span class="tag">${tag}</span>${message}</span>`;

        terminalContent.appendChild(line);
        terminalContent.scrollTop = terminalContent.scrollHeight;

        while (terminalContent.children.length > 80) {
            terminalContent.removeChild(terminalContent.firstChild);
        }
    }

    // Update terminal footer stats
    function updateStats() {
        if (window.innerWidth < 1000) return;

        const cached = window.imageLoader.size;
        if (statCached) statCached.textContent = cached;
    }

    // DOM Elements
    const styleSelect = document.getElementById('style-select');
    const resolutionSelect = document.getElementById('resolution-select');
    const settingsToggle = document.getElementById('settings-toggle');
    const settingsPanel = document.getElementById('settings-panel');
    const fadeDuration = document.getElementById('fade-duration');
    const fadeValue = document.getElementById('fade-value');
    const holdDuration = document.getElementById('hold-duration');
    const holdValue = document.getElementById('hold-value');
    const frameSelect = document.getElementById('frame-select');
    const backgroundSelect = document.getElementById('background-select');
    const canvas = document.getElementById('art-canvas');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const progressFill = document.getElementById('progress-fill');

    // App state
    let config = null;
    let currentStyle = null;
    let currentResolution = null;
    let animator = null;

    /**
     * Get full CDN URL for an asset path
     */
    function cdnUrl(path) {
        return `${config.cdn}/${path}`;
    }

    /**
     * Apply performance quality tier
     * Tier A: Full effects (Safari, high-end)
     * Tier B: Reduced blur (mid-range)
     * Tier C: Minimal effects (low-end)
     */
    function applyQualityTier(tier) {
        if (tier === currentQualityTier) return;

        const body = document.body;

        // Remove existing tier classes
        body.classList.remove('perf-tier-a', 'perf-tier-b', 'perf-tier-c');

        // Apply new tier
        if (tier === 'B') {
            body.classList.add('perf-tier-b');
        } else if (tier === 'C') {
            body.classList.add('perf-tier-c');
        }
        // Tier A is default (no class needed)

        currentQualityTier = tier;
    }

    /**
     * Initialize the application
     */
    async function init() {
        log('initializing...', 'system');

        // Log device capabilities
        const stats = window.imageLoader.stats;
        const ua = navigator.userAgent;
        const isChrome = ua.includes('Chrome');
        const isSafari = ua.includes('Safari') && !isChrome;
        const isFirefox = ua.includes('Firefox');
        const browser = isChrome ? 'Chrome' : isSafari ? 'Safari' : isFirefox ? 'Firefox' : 'Other';

        log(`browser: <span class="highlight">${browser}</span>`, 'perf');
        log(`ImageBitmap: <span class="highlight">${stats.supportsImageBitmap ? 'enabled' : 'disabled'}</span>`, 'perf');
        log(`batch size: <span class="highlight">${stats.connectionQuality.batchSize}</span> parallel`, 'perf');

        if (navigator.deviceMemory) {
            log(`device RAM: <span class="highlight">${navigator.deviceMemory}GB</span>`, 'perf');
        }

        if (isMobile()) {
            log('viewport: <span class="highlight">mobile</span>', 'config');
        }

        // Create animator
        animator = new Animator(canvas);

        animator.onStatusUpdate = (status) => {
            log(`<span class="highlight">${status.color}</span> → image ${status.set}`, 'zone');

            // Update mobile status
            if (mobileZone) {
                mobileZone.textContent = status.color;
            }
        };

        animator.onFpsUpdate = (fps) => {
            if (statFps) statFps.textContent = fps;
            if (fpsFill) fpsFill.style.width = `${Math.min(fps / 60 * 100, 100)}%`;
        };

        // Adaptive quality: respond to tier changes
        animator.onQualityChange = (tier, fps) => {
            applyQualityTier(tier);
            log(`quality → <span class="highlight">Tier ${tier}</span> (${Math.round(fps)}fps)`, 'perf');
        };

        // Apply initial quality tier
        applyQualityTier(animator.qualityTier);
        log(`quality: <span class="highlight">Tier ${animator.qualityTier}</span>`, 'perf');

        // Debounced resize for better mobile performance
        let resizeTimeout;
        const debouncedResize = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(handleResize, 100);
        };

        window.addEventListener('resize', debouncedResize);
        window.addEventListener('orientationchange', () => {
            // Delay to let orientation change complete
            setTimeout(handleResize, 200);
        });
        handleResize();

        setupUIHandlers();

        await loadConfig();

        // Auto-select default style
        if (Object.keys(config.styles).length > 0) {
            const defaultStyle = config.styles['louvre'] ? 'louvre' : Object.keys(config.styles)[0];
            styleSelect.value = defaultStyle;
            await loadStyle(defaultStyle);
        }
    }

    /**
     * Load static config
     */
    async function loadConfig() {
        try {
            log('fetching config...', 'info');
            const response = await fetch('config.json');
            config = await response.json();

            const cdnHost = config.cdn.replace('https://', '').split('/')[0];
            log(`CDN: <span class="highlight">${cdnHost}</span>`, 'config');

            const styleList = Object.keys(config.styles);
            log(`styles: <span class="highlight">${styleList.join(', ')}</span>`, 'config');

            // Populate style selector
            styleSelect.innerHTML = '';
            for (const style of Object.keys(config.styles).sort()) {
                const option = document.createElement('option');
                option.value = style;
                option.textContent = style.charAt(0).toUpperCase() + style.slice(1);
                styleSelect.appendChild(option);
            }
            styleSelect.disabled = false;

            // Populate frame selector
            frameSelect.innerHTML = '';
            const frameLabels = {
                'none': 'None',
                '3l': '3L',
                '3l-inverted': '3L Inverted',
                '5l': '5L',
                '5l-inverted': '5L Inverted'
            };
            const frameOrder = ['none', '5l', '5l-inverted', '3l', '3l-inverted'];
            for (const name of frameOrder) {
                if (config.frames.hasOwnProperty(name)) {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = frameLabels[name] || name;
                    frameSelect.appendChild(option);
                }
            }
            if (config.frames['5l-inverted']) {
                frameSelect.value = '5l-inverted';
            }

            log('config loaded ✓', 'system');

        } catch (e) {
            console.error('Failed to load config:', e);
            log(`error: ${e.message}`, 'error');
            loadingText.textContent = 'Failed to load config. Refresh to retry.';
        }
    }

    /**
     * Load a style and its images
     */
    async function loadStyle(styleName, resolution = null) {
        if (!styleName) return;

        log(`loading style <span class="highlight">${styleName}</span>...`, 'event');

        showLoading('Loading style...');

        animator.stop();
        animator.reset();

        // Clear old cache if switching styles to free memory
        if (currentStyle && currentStyle !== styleName) {
            window.imageLoader.clear();
            log('cache cleared for style switch', 'info');
        }

        try {
            // Get resolution (use optimal for device)
            const resolutions = config.styles[styleName];
            const selectedRes = resolution || getOptimalResolution(resolutions);

            currentStyle = styleName;
            currentResolution = selectedRes;

            log(`resolution: <span class="highlight">${selectedRes}px</span>`, 'config');

            updateResolutionSelector(styleName, selectedRes);

            // Get images from static config
            const images = config.styleImages[styleName][selectedRes];

            // Collect all image URLs
            const allImages = [];
            for (const color of config.categories) {
                const colorImages = images[color] || [];
                for (const imgPath of colorImages) {
                    allImages.push(cdnUrl(imgPath));
                }
            }

            // Find intro
            let introUrl = null;
            const bgType = backgroundSelect.value;
            if (bgType !== 'none' && config.intros) {
                const introRes = findBestIntroResolution(selectedRes);
                if (introRes && config.intros[introRes]) {
                    const introPath = config.intros[introRes][bgType];
                    if (introPath) {
                        introUrl = cdnUrl(introPath);
                        allImages.push(introUrl);
                    }
                }
            }

            // Log zone counts
            let totalImages = 0;
            for (const color of config.categories) {
                totalImages += (images[color] || []).length;
            }
            log(`zones: <span class="highlight">8</span> colors, <span class="highlight">${totalImages}</span> images`, 'config');

            loadingText.textContent = `Loading ${allImages.length} images...`;
            log(`preloading <span class="highlight">${allImages.length}</span> assets...`, 'info');

            const loadStartTime = performance.now();
            let lastLoggedPercent = 0;

            await window.imageLoader.preloadAll(
                allImages,
                (loaded, total) => {
                    const percent = Math.round((loaded / total) * 100);
                    progressFill.style.width = `${percent}%`;
                    loadingText.textContent = `Loading images... ${loaded}/${total}`;

                    if (percent >= lastLoggedPercent + 20) {
                        log(`loaded <span class="highlight">${percent}%</span> <span class="dim">(${loaded}/${total})</span>`, 'info');
                        lastLoggedPercent = percent - (percent % 20);
                    }

                    updateStats();
                }
            );

            const loadTime = ((performance.now() - loadStartTime) / 1000).toFixed(2);
            log(`preload complete in <span class="highlight">${loadTime}s</span> ✓`, 'system');

            // Set background
            if (introUrl) {
                const bgImg = window.imageLoader.get(introUrl);
                animator.setBackground(bgImg);
                log(`background: <span class="highlight">${bgType}</span>`, 'config');
            } else {
                animator.setBackground(null);
            }

            // Organize images by color
            const imagesByColor = {};
            for (const color of config.categories) {
                imagesByColor[color] = (images[color] || []).map(path => cdnUrl(path));
            }

            animator.setImages(imagesByColor, config.categories);

            await updateFrame();

            log(`timing: fade <span class="highlight">${animator.fadeDuration}s</span>, hold <span class="highlight">${animator.holdDuration}s</span>`, 'config');

            hideLoading();
            animator.start();
            log('animation started ▶', 'system');

            updateStats();

        } catch (e) {
            console.error('Failed to load style:', e);
            log(`error: ${e.message}`, 'error');
            loadingText.textContent = `Error: ${e.message}`;
        }
    }

    function updateResolutionSelector(styleName, currentRes) {
        const resolutions = config.styles[styleName] || [];

        resolutionSelect.innerHTML = '';
        for (const res of resolutions) {
            const option = document.createElement('option');
            option.value = res;
            option.textContent = `${res}px`;
            if (res === currentRes) {
                option.selected = true;
            }
            resolutionSelect.appendChild(option);
        }
        resolutionSelect.disabled = resolutions.length <= 1;
    }

    async function updateFrame() {
        const frameName = frameSelect.value;

        if (frameName === 'none' || !config.frames[frameName]) {
            animator.setFrame(null);
            log('frame: <span class="dim">none</span>', 'config');
            return;
        }

        const frameUrl = cdnUrl(config.frames[frameName]);

        try {
            const img = await window.imageLoader.loadImage(frameUrl);
            animator.setFrame(img);
            log(`frame: <span class="highlight">${frameName}</span>`, 'config');
        } catch (e) {
            console.warn('Failed to load frame:', e);
            log(`frame error: ${e.message}`, 'error');
            animator.setFrame(null);
        }
    }

    function findBestIntroResolution(targetRes) {
        if (!config.intros) return null;

        const available = Object.keys(config.intros).map(Number).sort((a, b) => a - b);
        if (available.length === 0) return null;

        let best = available[0];
        for (const res of available) {
            if (res <= targetRes) {
                best = res;
            }
        }
        return best;
    }

    function showLoading(text = 'Loading...') {
        loadingText.textContent = text;
        progressFill.style.width = '0%';
        loadingOverlay.classList.remove('hidden');
    }

    function hideLoading() {
        loadingOverlay.classList.add('hidden');
    }

    function handleResize() {
        const container = document.getElementById('canvas-container');
        const rect = container.getBoundingClientRect();

        // On desktop, account for terminal width (fixed position doesn't affect layout)
        let availableWidth = rect.width;
        if (window.innerWidth >= 1000) {
            const terminalWidth = window.innerWidth >= 1400 ? 340 : 300;
            const terminalMargin = 28 + 28; // right margin + extra spacing
            availableWidth = rect.width - terminalWidth - terminalMargin;
        }

        const size = Math.min(availableWidth, rect.height);
        // Use device pixel ratio for crisp rendering, but cap at 2 for performance
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        animator.resize(Math.floor(size), Math.floor(size), dpr);
    }

    /**
     * Check if device is mobile based on screen size
     */
    function isMobile() {
        return window.innerWidth < 600 || window.innerHeight < 600;
    }

    /**
     * Get optimal resolution for current device
     */
    function getOptimalResolution(availableResolutions) {
        if (!availableResolutions || availableResolutions.length === 0) {
            return null;
        }

        // On mobile, prefer smaller resolution for performance
        if (isMobile()) {
            // Prefer 1680 or lower on mobile
            const mobilePreferred = availableResolutions.filter(r => r <= 1680);
            if (mobilePreferred.length > 0) {
                return Math.max(...mobilePreferred);
            }
        }

        // On desktop, prefer 1680 for best quality/performance balance
        if (availableResolutions.includes(1680)) {
            return 1680;
        }

        // Fallback to first available
        return availableResolutions[0];
    }

    function setupUIHandlers() {
        styleSelect.addEventListener('change', (e) => {
            loadStyle(e.target.value);
        });

        resolutionSelect.addEventListener('change', (e) => {
            loadStyle(currentStyle, parseInt(e.target.value));
        });

        settingsToggle.addEventListener('click', () => {
            const isVisible = settingsPanel.classList.contains('visible');
            if (isVisible) {
                settingsPanel.classList.remove('visible');
                settingsPanel.classList.add('hidden');
            } else {
                settingsPanel.classList.remove('hidden');
                settingsPanel.classList.add('visible');
            }
            settingsToggle.classList.toggle('active');
        });

        fadeDuration.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            fadeValue.textContent = `${value.toFixed(1)}s`;
            animator.fadeDuration = value;
        });

        fadeDuration.addEventListener('change', () => {
            log(`fade → <span class="highlight">${animator.fadeDuration}s</span>`, 'event');
        });

        holdDuration.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            holdValue.textContent = `${value.toFixed(1)}s`;
            animator.holdDuration = value;
        });

        holdDuration.addEventListener('change', () => {
            log(`hold → <span class="highlight">${animator.holdDuration}s</span>`, 'event');
        });

        frameSelect.addEventListener('change', () => {
            updateFrame();
        });

        backgroundSelect.addEventListener('change', () => {
            updateBackground();
        });
    }

    async function updateBackground() {
        const bgType = backgroundSelect.value;

        if (bgType === 'none' || !config.intros || !currentResolution) {
            animator.setBackground(null);
            log(`background: <span class="dim">none</span>`, 'config');
            return;
        }

        const introRes = findBestIntroResolution(currentResolution);
        if (!introRes || !config.intros[introRes]) {
            animator.setBackground(null);
            return;
        }

        const introPath = config.intros[introRes][bgType];

        if (!introPath) {
            animator.setBackground(null);
            return;
        }

        try {
            const introUrl = cdnUrl(introPath);
            const img = await window.imageLoader.loadImage(introUrl);
            animator.setBackground(img);
            log(`background: <span class="highlight">${bgType}</span>`, 'config');
        } catch (e) {
            console.warn('Failed to load background:', e);
            animator.setBackground(null);
        }
    }

    document.addEventListener('DOMContentLoaded', init);

})();
