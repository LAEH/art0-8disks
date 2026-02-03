/**
 * Art0 Studio - Static Production Build
 * Loads config from config.json, images from GCS CDN
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
     * Initialize the application
     */
    async function init() {
        log('initializing...', 'system');

        // Create animator
        animator = new Animator(canvas);

        animator.onStatusUpdate = (status) => {
            log(`zone <span class="highlight">${status.color}</span> → set ${status.set}`, 'zone');
        };

        animator.onFpsUpdate = null;

        window.addEventListener('resize', handleResize);
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

            log(`cdn: <span class="highlight">${config.cdn.replace('https://', '').substring(0, 40)}...</span>`, 'config');

            const styleList = Object.keys(config.styles);
            log(`found <span class="highlight">${styleList.length}</span> styles: ${styleList.join(', ')}`, 'config');

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

        try {
            // Get resolution (default to first available, prefer 1680)
            const resolutions = config.styles[styleName];
            const selectedRes = resolution || (resolutions.includes(1680) ? 1680 : resolutions[0]);

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
            let zoneInfo = [];
            for (const color of config.categories) {
                const count = (images[color] || []).length;
                zoneInfo.push(`${color}:${count}`);
            }
            log(`zones: ${zoneInfo.join(' ')}`, 'config');

            loadingText.textContent = `Loading ${allImages.length} images...`;
            log(`preloading <span class="highlight">${allImages.length}</span> images from CDN...`, 'info');

            let lastLoggedPercent = 0;
            await window.imageLoader.preloadAll(
                allImages,
                (loaded, total) => {
                    const percent = Math.round((loaded / total) * 100);
                    progressFill.style.width = `${percent}%`;
                    loadingText.textContent = `Loading images... ${loaded}/${total}`;

                    if (percent >= lastLoggedPercent + 25) {
                        log(`loaded ${percent}% <span class="dim">(${loaded}/${total})</span>`, 'info');
                        lastLoggedPercent = percent - (percent % 25);
                    }
                }
            );

            log('preload complete ✓', 'system');

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

            log(`fade: <span class="highlight">${animator.fadeDuration}s</span> hold: <span class="highlight">${animator.holdDuration}s</span>`, 'config');

            hideLoading();
            animator.start();
            log('animation started ▶', 'system');

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
        const size = Math.min(rect.width, rect.height);
        animator.resize(Math.floor(size), Math.floor(size));
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
            log(`fade duration → <span class="highlight">${animator.fadeDuration}s</span>`, 'event');
        });

        holdDuration.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            holdValue.textContent = `${value.toFixed(1)}s`;
            animator.holdDuration = value;
        });

        holdDuration.addEventListener('change', () => {
            log(`hold duration → <span class="highlight">${animator.holdDuration}s</span>`, 'event');
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
