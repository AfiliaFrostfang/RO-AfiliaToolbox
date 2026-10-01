/* =========================================================
   Afilia Toolbox – Applet: Map Darkmode
   Wird durch das Manifest vom Kernskript geladen und registriert
   sich selbst in der globalen Applet-Warteschlange.
   ========================================================= */

(function () {
    'use strict';

    /* Die Karte ist ein MapLibre-Canvas. Ein CSS-Filter auf
       diesem Canvas dunkelt Kacheln, Wasser und Linien ab.
       Wichtig ist das !important, damit ein Filter des Spiels
       nicht überlagert wird. */

    const CANVAS_SELECTOR = 'canvas.maplibregl-canvas';
    const CANVAS_ACTIVE_CLASS = 'afilia-map-darkmode-canvas';

    const DARK_FILTER =
        'brightness(0.55) contrast(1.15) saturate(0.65)';

    const BUTTON_CLASS = 'afilia-map-darkmode-button';
    const BUTTON_ACTIVE_CLASS =
        'afilia-map-darkmode-button-active';

    const STYLES_ID = 'afilia-applet-map-darkmode-styles';
    const STORE_KEY = 'mapDarkmode';

    let api = null;

    let darkMode = false;
    let lastButtonSlot = null;

    /* =========================================================
       Styles
       ========================================================= */

    function injectStyles() {
        if (document.getElementById(STYLES_ID)) {
            return;
        }

        const style = document.createElement('style');

        style.id = STYLES_ID;

        style.textContent = `
            .${CANVAS_ACTIVE_CLASS} {
                filter: ${DARK_FILTER} !important;
            }

            .${BUTTON_CLASS}:hover {
                border-color: #a1a1aa;
            }

            .${BUTTON_ACTIVE_CLASS} {
                border-color: rgba(129, 140, 248, 0.85);
            }

            .${BUTTON_ACTIVE_CLASS}:hover {
                border-color: #818cf8;
            }

            .${BUTTON_ACTIVE_CLASS} i {
                color: #c7d2fe;
            }
        `;

        document.head.appendChild(style);
    }

    /* =========================================================
       Karte
       ========================================================= */

    /* Das Spiel legt die Karte neu an, zum Beispiel beim Wechsel
       in einen neuen Einsatz. Deshalb werden alle vorhandenen
       Canvas jedes Mal neu geholt und nicht nur einer gecacht. */

    function getMapCanvases() {
        return document.querySelectorAll(CANVAS_SELECTOR);
    }

    function setCanvasDarkMode(canvas, enabled) {
        if (
            canvas.classList.contains(CANVAS_ACTIVE_CLASS) ===
            enabled
        ) {
            return;
        }

        canvas.classList.toggle(
            CANVAS_ACTIVE_CLASS,
            enabled
        );
    }

    function applyMap() {
        for (const canvas of getMapCanvases()) {
            setCanvasDarkMode(canvas, darkMode);
        }
    }

    function clearMap() {
        for (const canvas of getMapCanvases()) {
            setCanvasDarkMode(canvas, false);
        }
    }

    /* =========================================================
       Umschalten
       ========================================================= */

    function setDarkMode(enabled) {
        if (darkMode === !!enabled) {
            return;
        }

        darkMode = !!enabled;

        applyMap();
        updateButton();

        saveDarkMode();
    }

    function toggleDarkMode() {
        setDarkMode(!darkMode);
    }

    /* =========================================================
       Persistence
       ========================================================= */

    async function loadDarkMode() {
        try {
            const stored = await api.dbGet(STORE_KEY);

            darkMode = stored === true;
        } catch (error) {
            console.warn(
                '[Afilia Toolbox] Map Darkmode state failed:',
                error
            );

            darkMode = false;
        }
    }

    async function saveDarkMode() {
        try {
            await api.dbSet(STORE_KEY, darkMode);
        } catch (error) {
            console.warn(
                '[Afilia Toolbox] Map Darkmode save failed:',
                error
            );
        }
    }

    /* =========================================================
       UI
       ========================================================= */

    function findButtonSlot() {
        if (!api) {
            return null;
        }

        /* Das Icon hängt im aufklappbaren Slot der Toolbox. */

        return api.getAppletSlot();
    }

    function createButton() {
        const button = document.createElement('button');

        button.type = 'button';

        button.className =
            `${BUTTON_CLASS} w-10 h-10 sm:w-10 sm:h-10 bg-dark rounded-lg shadow-lg border border-gray-800/80 hover:border-gray-700 transition-all duration-300 flex items-center justify-center cursor-pointer`;

        button.setAttribute('aria-pressed', 'false');

        button.innerHTML =
            '<i class="fa-solid fa-moon text-sm sm:text-sm text-white/80"></i>';

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            toggleDarkMode();
        });

        return button;
    }

    function hookButton() {
        const slot = findButtonSlot();

        if (!slot) {
            lastButtonSlot = null;

            return;
        }

        const existing = slot.querySelector(`.${BUTTON_CLASS}`);

        if (slot === lastButtonSlot && existing) {
            updateButton();

            return;
        }

        lastButtonSlot = slot;

        if (existing) {
            existing.remove();
        }

        api.mountAppletButton(createButton());

        updateButton();
    }

    function updateButton() {
        const button = lastButtonSlot?.querySelector(
            `.${BUTTON_CLASS}`
        );

        if (!button) {
            return;
        }

        button.setAttribute(
            'aria-pressed',
            darkMode ? 'true' : 'false'
        );

        button.title = darkMode
            ? 'Karte aufhellen'
            : 'Karte abdunkeln';

        button.classList.toggle(
            BUTTON_ACTIVE_CLASS,
            darkMode
        );

        const icon = button.querySelector('i');

        if (!icon) {
            return;
        }

        icon.classList.toggle('fa-moon', !darkMode);
        icon.classList.toggle('fa-sun', darkMode);
    }

    /* =========================================================
       Applet lifecycle
       ========================================================= */

    async function init(context) {
        api = context;

        injectStyles();

        await loadDarkMode();

        applyMap();
    }

    function onScan() {
        applyMap();

        hookButton();
    }

    function dispose() {
        document
            .querySelectorAll(`.${BUTTON_CLASS}`)
            .forEach(button => button.remove());

        clearMap();

        document.getElementById(STYLES_ID)?.remove();

        darkMode = false;
        lastButtonSlot = null;
        api = null;
    }

    window.__AFILIA_APPLET_QUEUE__ =
        window.__AFILIA_APPLET_QUEUE__ || [];

    window.__AFILIA_APPLET_QUEUE__.push({
        id: 'mapDarkmode',
        name: 'Map Darkmode',
        description:
            'Blendet die Karte ab. Lässt sich wechseln über das Sonne/Mond-Icon in der Toolbox.',
        version: '1.0.0',
        init,
        onScan,
        dispose
    });
})();