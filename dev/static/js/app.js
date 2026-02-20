/**
 * Art0 Studio - Main Application
 * Loads images from GCS CDN for optimal performance
 */

(function() {
    'use strict';

    // Terminal logging
    const terminalContent = document.getElementById('terminal-content');
    let startTime = Date.now();

    function log(message, type = 'info') {
        const elapsed = Date.now() - startTime;
        const seconds = Math.floor(elapsed / 1000);
        const ms = elapsed % 1000;
        const timestamp = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}:${String(Math.floor(ms / 10)).padStart(2, '0')}`;

        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        line.innerHTML = `<span class="timestamp">${timestamp}</span><span class="message">${message}</span>`;

        terminalContent.appendChild(line);
        terminalContent.scrollTop = terminalContent.scrollHeight;

        // Keep only last 100 lines
        while (terminalContent.children.length > 100) {
            terminalContent.removeChild(terminalContent.firstChild);
        }
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
    const zoneProgress = document.getElementById('zone-progress');
    const zoneSegs = zoneProgress.querySelectorAll('.zone-seg');

    // App state
    let appData = null;
    let cdnBase = null;
    let currentStyle = null;
    let currentResolution = null;
    let animator = null;

    /**
     * Get full CDN URL for an asset path
     */
    function cdnUrl(path) {
        return `${cdnBase}/${path}`;
    }

    /**
     * Initialize the application
     */
    async function init() {
        log('initializing...', 'system');

        // Create animator
        animator = new Animator(canvas);

        // Set up animator callbacks
        animator.onStatusUpdate = (status) => {
            log(`zone <span class="highlight">${status.color}</span> → set ${status.set}`, 'zone');
            updateZoneProgress(status);
        };

        animator.onFpsUpdate = null; // Don't spam the log

        // Set up resize handler
        window.addEventListener('resize', handleResize);
        handleResize();

        // Set up UI handlers
        setupUIHandlers();

        // Load initial data
        await loadAppData();

        // Auto-select default style (prefer "louvre" which has 1680px)
        if (Object.keys(appData.styles).length > 0) {
            const defaultStyle = appData.styles['louvre'] ? 'louvre' : Object.keys(appData.styles)[0];
            styleSelect.value = defaultStyle;
            await loadStyle(defaultStyle);
        }
    }

    /**
     * Load app data from API
     */
    async function loadAppData() {
        try {
            log('fetching config...', 'info');
            const response = await fetch('/api/styles');
            appData = await response.json();
            cdnBase = appData.cdn;

            log(`cdn: <span class="highlight">${cdnBase.replace('https://', '')}</span>`, 'config');

            // Log available styles
            const styleList = Object.keys(appData.styles);
            log(`found <span class="highlight">${styleList.length}</span> styles: ${styleList.join(', ')}`, 'config');

            // Populate style selector
            styleSelect.innerHTML = '';
            for (const style of Object.keys(appData.styles).sort()) {
                const option = document.createElement('option');
                option.value = style;
                option.textContent = style.charAt(0).toUpperCase() + style.slice(1);
                styleSelect.appendChild(option);
            }
            styleSelect.disabled = false;

            // Populate frame selector with friendly names
            frameSelect.innerHTML = '';
            const frameLabels = {
                'none': 'None',
                '3l': '3L',
                '3l-inverted': '3L Inverted',
                '5l': '5L',
                '5l-inverted': '5L Inverted'
            };
            // Order frames logically
            const frameOrder = ['none', '5l', '5l-inverted', '3l', '3l-inverted'];
            for (const name of frameOrder) {
                if (appData.frames.hasOwnProperty(name)) {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = frameLabels[name] || name;
                    frameSelect.appendChild(option);
                }
            }
            // Default to 5l-inverted
            if (appData.frames['5l-inverted']) {
                frameSelect.value = '5l-inverted';
            }

        } catch (e) {
            console.error('Failed to load app data:', e);
            log(`error: ${e.message}`, 'error');
            loadingText.textContent = 'Failed to load. Refresh to retry.';
        }
    }

    /**
     * Load a style and its images
     */
    async function loadStyle(styleName, resolution = null) {
        if (!styleName) return;

        log(`loading style <span class="highlight">${styleName}</span>...`, 'event');

        // Show loading
        showLoading('Loading style...');

        // Stop current animation
        animator.stop();
        animator.reset();

        try {
            // Fetch style data
            let url = `/api/style/${styleName}`;
            if (resolution) {
                url += `/${resolution}`;
            }

            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            currentStyle = styleName;
            currentResolution = data.resolution;

            log(`resolution: <span class="highlight">${data.resolution}px</span>`, 'config');

            // Update resolution selector
            updateResolutionSelector(styleName, data.resolution);

            // Collect all image URLs (using CDN)
            const allImages = [];
            for (const color of appData.categories) {
                const images = data.images[color] || [];
                for (const imgPath of images) {
                    allImages.push(cdnUrl(imgPath));
                }
            }

            // Find best matching intro resolution
            let introUrl = null;
            const bgType = backgroundSelect.value;
            if (bgType !== 'none' && appData.intros) {
                const introRes = findBestIntroResolution(data.resolution);
                if (introRes && appData.intros[introRes]) {
                    const introsForRes = appData.intros[introRes];
                    const introPath = introsForRes[bgType] || null;
                    if (introPath) {
                        introUrl = cdnUrl(introPath);
                        allImages.push(introUrl);
                    }
                }
            }

            // Count images per zone
            let zoneInfo = [];
            for (const color of appData.categories) {
                const count = (data.images[color] || []).length;
                zoneInfo.push(`${color}:${count}`);
            }
            log(`zones: ${zoneInfo.join(' ')}`, 'config');

            loadingText.textContent = `Loading ${allImages.length} images...`;
            log(`preloading <span class="highlight">${allImages.length}</span> images from CDN...`, 'info');

            // Preload all images with parallel loading
            let lastLoggedPercent = 0;
            const loadedImages = await window.imageLoader.preloadAll(
                allImages,
                (loaded, total) => {
                    const percent = Math.round((loaded / total) * 100);
                    progressFill.style.width = `${percent}%`;
                    loadingText.textContent = `Loading images... ${loaded}/${total}`;

                    // Log every 25%
                    if (percent >= lastLoggedPercent + 25) {
                        log(`loaded ${percent}% <span class="dim">(${loaded}/${total})</span>`, 'info');
                        lastLoggedPercent = percent - (percent % 25);
                    }
                }
            );

            log('preload complete ✓', 'system');

            // Set background/intro image
            if (introUrl) {
                const bgImg = window.imageLoader.get(introUrl);
                animator.setBackground(bgImg);
                log(`background: <span class="highlight">${bgType}</span>`, 'config');
            } else {
                animator.setBackground(null);
            }

            // Organize loaded images by color (using CDN URLs)
            const imagesByColor = {};
            for (const color of appData.categories) {
                imagesByColor[color] = (data.images[color] || []).map(
                    path => cdnUrl(path)
                );
            }

            // Set up animator
            animator.setImages(imagesByColor, appData.categories);

            // Load frame if selected
            await updateFrame();

            // Log animation config
            log(`fade: <span class="highlight">${animator.fadeDuration}s</span> hold: <span class="highlight">${animator.holdDuration}s</span>`, 'config');

            // Hide loading and start
            hideLoading();
            animator.start();
            log('animation started ▶', 'system');

        } catch (e) {
            console.error('Failed to load style:', e);
            log(`error: ${e.message}`, 'error');
            loadingText.textContent = `Error: ${e.message}`;
        }
    }

    /**
     * Update resolution selector for current style
     */
    function updateResolutionSelector(styleName, currentRes) {
        const resolutions = appData.styles[styleName] || [];

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

    /**
     * Update frame overlay
     */
    async function updateFrame() {
        const frameName = frameSelect.value;

        if (frameName === 'none' || !appData.frames[frameName]) {
            animator.setFrame(null);
            log('frame: <span class="dim">none</span>', 'config');
            return;
        }

        const frameUrl = cdnUrl(appData.frames[frameName]);

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

    /**
     * Find the best matching intro resolution for a given zone resolution
     */
    function findBestIntroResolution(targetRes) {
        if (!appData.intros) return null;

        const available = Object.keys(appData.intros).map(Number).sort((a, b) => a - b);
        if (available.length === 0) return null;

        // Find exact match or closest smaller resolution
        let best = available[0];
        for (const res of available) {
            if (res <= targetRes) {
                best = res;
            }
        }
        return best;
    }

    /**
     * Update zone progress bar
     */
    function updateZoneProgress(status) {
        const categories = appData ? appData.categories : [];
        const idx = categories.indexOf(status.color);
        if (idx === -1) return;

        zoneSegs.forEach((seg, i) => {
            seg.classList.remove('active');
            if (i < idx) {
                seg.classList.add('done');
                seg.querySelector('span').style.width = '100%';
            } else if (i === idx) {
                seg.classList.remove('done');
                seg.classList.add('active');
                seg.querySelector('span').style.width = '0%';
            } else {
                seg.classList.remove('done');
                seg.querySelector('span').style.width = '0%';
            }
        });
    }

    /**
     * Update zone progress fill during fade
     */
    function startZoneProgressTick() {
        function tick() {
            if (!animator || !animator.running) return;
            const idx = animator.currentZoneIndex;
            const seg = zoneSegs[idx];
            if (seg && animator.state === 'FADING') {
                const progress = Math.min(animator.stateTime / animator.fadeDuration, 1) * 100;
                seg.querySelector('span').style.width = `${progress}%`;
            } else if (seg && animator.state === 'HOLDING') {
                seg.querySelector('span').style.width = '100%';
                seg.classList.add('done');
            }
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    /**
     * Show loading overlay
     */
    function showLoading(text = 'Loading...') {
        loadingText.textContent = text;
        progressFill.style.width = '0%';
        loadingOverlay.classList.remove('hidden');
        zoneProgress.classList.remove('visible');
    }

    /**
     * Hide loading overlay
     */
    function hideLoading() {
        loadingOverlay.classList.add('hidden');
        zoneProgress.classList.add('visible');
        // Reset zone segments
        zoneSegs.forEach(seg => {
            seg.classList.remove('active', 'done');
            seg.querySelector('span').style.width = '0%';
        });
        startZoneProgressTick();
    }

    /**
     * Handle window resize
     */
    function handleResize() {
        const container = document.getElementById('canvas-container');
        const rect = container.getBoundingClientRect();

        // Use 1:1 aspect ratio (square artwork)
        const size = Math.min(rect.width, rect.height);

        animator.resize(Math.floor(size), Math.floor(size));
    }

    /**
     * Set up UI event handlers
     */
    function setupUIHandlers() {
        // Style selector
        styleSelect.addEventListener('change', (e) => {
            loadStyle(e.target.value);
        });

        // Resolution selector
        resolutionSelect.addEventListener('change', (e) => {
            loadStyle(currentStyle, parseInt(e.target.value));
        });

        // Settings toggle
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

        // Fade duration
        fadeDuration.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            fadeValue.textContent = `${value.toFixed(1)}s`;
            animator.fadeDuration = value;
        });

        fadeDuration.addEventListener('change', (e) => {
            log(`fade duration → <span class="highlight">${animator.fadeDuration}s</span>`, 'event');
        });

        // Hold duration
        holdDuration.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            holdValue.textContent = `${value.toFixed(1)}s`;
            animator.holdDuration = value;
        });

        holdDuration.addEventListener('change', (e) => {
            log(`hold duration → <span class="highlight">${animator.holdDuration}s</span>`, 'event');
        });

        // Frame selector
        frameSelect.addEventListener('change', () => {
            updateFrame();
        });

        // Background selector
        backgroundSelect.addEventListener('change', () => {
            updateBackground();
        });
    }

    /**
     * Update background/intro image
     */
    async function updateBackground() {
        const bgType = backgroundSelect.value;

        if (bgType === 'none' || !appData.intros || !currentResolution) {
            animator.setBackground(null);
            log(`background: <span class="dim">none</span>`, 'config');
            return;
        }

        const introRes = findBestIntroResolution(currentResolution);
        if (!introRes || !appData.intros[introRes]) {
            animator.setBackground(null);
            return;
        }

        const introsForRes = appData.intros[introRes];
        const introPath = introsForRes[bgType];

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

    // Start application
    document.addEventListener('DOMContentLoaded', init);

})();
