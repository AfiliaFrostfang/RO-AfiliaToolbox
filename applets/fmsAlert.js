/* =========================================================
   Afilia Toolbox – Applet: FMS-Alarm
   Wird durch das Manifest vom Kernskript geladen und registriert
   sich selbst in der globalen Applet-Warteschlange.
   ========================================================= */

(function () {
    'use strict';

    /* Der rote Zähler-Badge wird anhand seiner Struktur-Klassen
       erkannt, damit der Text (Anzahl der Meldungen) egal ist. */

    const BADGE_SELECTOR =
        'div.absolute[class~="-top-2"][class~="-right-2"]' +
        '[class~="bg-red-500"][class~="text-white"]' +
        '[class~="w-6"][class~="h-6"][class~="rounded-full"]' +
        '[class~="border-gray-900"][class~="z-10"]';

    const AUDIO_URL =
        'https://afiliafrostfang.github.io/RO-AfiliaToolbox/assets/FMS5.mp3';

    const REPEAT_INTERVAL = 5 * 60 * 1000;
    const WATCH_INTERVAL = 1000;
    const MUTED_STORE_KEY = 'fmsAlertMuted';

    const BUTTON_CLASS = 'afilia-fms-alert-button';
    const BUTTON_ACTIVE_CLASS = 'afilia-fms-alert-button-active';
    const STYLES_ID = 'afilia-applet-fms-alert-styles';

    let api = null;
    let audio = null;

    let repeatTimer = null;
    let watchTimer = null;

    let lastButtonRail = null;

    let isActive = false;
    let isMuted = false;
    let isBlocked = false;

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
            .${BUTTON_CLASS} {
                border-color: rgba(239, 68, 68, 0.55);
            }

            .${BUTTON_CLASS}:hover {
                border-color: #ef4444;
            }

            .${BUTTON_CLASS} i {
                color: #fca5a5;
            }

            .${BUTTON_ACTIVE_CLASS} {
                border-color: #ef4444;
                box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.35);
            }

            .${BUTTON_ACTIVE_CLASS} i {
                color: #ef4444;
                animation: afilia-fms-alert-pulse 1.4s ease-in-out infinite;
            }

            .${BUTTON_CLASS}[data-afilia-fms-alert-muted="true"] i {
                color: #71717a;
                animation: none;
            }

            @keyframes afilia-fms-alert-pulse {
                0%, 100% {
                    opacity: 1;
                }

                50% {
                    opacity: 0.35;
                }
            }
        `;

        document.head.appendChild(style);
    }

    /* =========================================================
       Badge detection
       ========================================================= */

    function isElementVisible(element) {
        if (!element || !element.isConnected) {
            return false;
        }

        const rect = element.getBoundingClientRect();

        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        const style = window.getComputedStyle(element);

        if (style.display === 'none') {
            return false;
        }

        if (style.visibility === 'hidden' || style.visibility === 'collapse') {
            return false;
        }

        if (Number.parseFloat(style.opacity) === 0) {
            return false;
        }

        return true;
    }

    function isBadgeActive() {
        return isElementVisible(
            document.querySelector(BADGE_SELECTOR)
        );
    }

    /* =========================================================
       Audio
       ========================================================= */

    function createAudio() {
        if (audio) {
            return audio;
        }

        const element = new Audio();

        element.preload = 'auto';
        element.src = AUDIO_URL;
        element.volume = 1;

        audio = element;

        return audio;
    }

    function playAlert() {
        if (!audio || isMuted) {
            return;
        }

        try {
            audio.currentTime = 0;
        } catch (error) {
            /* Manche Browser verweigern das Setzen vor dem Laden. */
        }

        try {
            const playback = audio.play();

            if (playback && typeof playback.then === 'function') {
                playback
                    .then(() => {
                        isBlocked = false;

                        updateButton();
                    })
                    .catch(() => {
                        isBlocked = true;

                        updateButton();
                    });
            }
        } catch (error) {
            isBlocked = true;

            console.warn(
                '[Afilia Toolbox] FMS-Alarm konnte nicht abgespielt werden:',
                error
            );
        }

        updateButton();
    }

    function stopAudio() {
        if (!audio) {
            return;
        }

        try {
            audio.pause();
            audio.currentTime = 0;
        } catch (error) {
            /* Ignorieren. */
        }
    }

    /* =========================================================
       Repeat timer
       ========================================================= */

    function stopRepeat() {
        if (repeatTimer) {
            clearTimeout(repeatTimer);

            repeatTimer = null;
        }
    }

    function scheduleRepeat() {
        stopRepeat();

        if (!isActive) {
            return;
        }

        repeatTimer = setTimeout(() => {
            repeatTimer = null;

            syncState();

            if (isActive) {
                playAlert();

                scheduleRepeat();
            }
        }, REPEAT_INTERVAL);
    }

    /* =========================================================
       State
       ========================================================= */

    function setActive(active) {
        if (active === isActive) {
            return;
        }

        isActive = active;

        if (isActive) {
            playAlert();

            scheduleRepeat();
        } else {
            stopRepeat();

            stopAudio();
        }

        updateButton();
    }

    function syncState() {
        if (!api) {
            return;
        }

        setActive(isBadgeActive());
    }

    function startWatch() {
        stopWatch();

        watchTimer = setInterval(() => {
            syncState();
        }, WATCH_INTERVAL);
    }

    function stopWatch() {
        if (watchTimer) {
            clearInterval(watchTimer);

            watchTimer = null;
        }
    }

    async function setMuted(muted) {
        isMuted = !!muted;

        if (isMuted) {
            stopAudio();
        }

        updateButton();

        try {
            await api.dbSet(MUTED_STORE_KEY, isMuted);
        } catch (error) {
            console.warn(
                '[Afilia Toolbox] FMS-Alarm Stummschaltung nicht gespeichert:',
                error
            );
        }
    }

    /* =========================================================
       UI
       ========================================================= */

    function findQuickAccessRail() {
        const icon = document.querySelector(
            'i.fa-light-emergency-on'
        );

        if (!icon) {
            return null;
        }

        return icon.closest(
            'div.absolute.flex.flex-col'
        ) || null;
    }

    function createButton() {
        const button = document.createElement('button');

        button.type = 'button';

        button.className =
            `${BUTTON_CLASS} w-10 h-10 sm:w-10 sm:h-10 bg-dark rounded-lg shadow-lg border border-gray-800/80 hover:border-gray-700 transition-all duration-300 flex items-center justify-center cursor-pointer`;

        button.innerHTML =
            '<i class="fa-solid fa-bell text-sm sm:text-sm text-white/80"></i>';

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            handleButtonClick();
        });

        return button;
    }

    function handleButtonClick() {
        /* ------------------------------------------------------------
           Der Browser blockiert Ton, solange keine Nutzeraktion
           erfolgt ist. Der erste Klick entsperrt das Audio.
           ------------------------------------------------------------ */

        if (isBlocked) {
            unlockAudio();

            return;
        }

        if (isActive) {
            setMuted(!isMuted);
        }
    }

    function unlockAudio() {
        if (!audio) {
            return;
        }

        if (isMuted) {
            isBlocked = false;

            updateButton();

            return;
        }

        try {
            const playback = audio.play();

            if (playback && typeof playback.then === 'function') {
                playback
                    .then(() => {
                        isBlocked = false;

                        updateButton();
                    })
                    .catch(() => {
                        isBlocked = true;

                        updateButton();
                    });

                return;
            }
        } catch (error) {
            isBlocked = true;
        }

        isBlocked = false;

        updateButton();
    }

    function shouldShowButton() {
        return isActive || isBlocked;
    }

    function setAttributeIfChanged(element, name, value) {
        if (element.getAttribute(name) !== value) {
            element.setAttribute(name, value);
        }
    }

    /* Nur tatsächlich geänderte Attribute schreiben. Der Kernskript-
       Observer lauscht auf class/style und würde sonst jeden Scan
       erneut auslösen. */

    function updateButton() {
        const button = document.querySelector(
            `.${BUTTON_CLASS}`
        );

        if (!button) {
            return;
        }

        if (!shouldShowButton()) {
            button.remove();

            return;
        }

        const icon = button.querySelector('i');

        if (icon) {
            const iconClass = isBlocked
                ? 'fa-solid fa-volume-xmark text-sm sm:text-sm'
                : 'fa-solid fa-bell text-sm sm:text-sm';

            setAttributeIfChanged(icon, 'class', iconClass);
        }

        if (button.classList.contains(BUTTON_ACTIVE_CLASS) !== isActive) {
            button.classList.toggle(BUTTON_ACTIVE_CLASS, isActive);
        }

        setAttributeIfChanged(
            button,
            'data-afilia-fms-alert-muted',
            isMuted ? 'true' : 'false'
        );

        setAttributeIfChanged(
            button,
            'title',
            isBlocked
                ? 'Ton freigeben – Klicken, damit der FMS-Alarm wiedergegeben werden darf'
                : isMuted
                    ? 'FMS-Alarm stummgeschaltet – Klicken zum Anmelden'
                    : 'FMS-Alarm aktiv – alle 5 Minuten, solange eine Meldung anliegt'
        );
    }

    function hookButton() {
        const rail = findQuickAccessRail();

        if (!rail) {
            lastButtonRail = null;

            return;
        }

        const existing = rail.querySelector(`.${BUTTON_CLASS}`);

        if (rail === lastButtonRail && existing) {
            updateButton();

            return;
        }

        lastButtonRail = rail;

        if (existing) {
            existing.remove();
        }

        if (!shouldShowButton()) {
            return;
        }

        const button = createButton();

        const spacer = rail.querySelector(':scope > div.h-20');

        if (spacer) {
            spacer.after(button);
        } else {
            rail.insertBefore(button, rail.firstChild);
        }

        updateButton();
    }

    /* =========================================================
       Applet lifecycle
       ========================================================= */

    async function init(context) {
        api = context;

        try {
            isMuted = (await api.dbGet(MUTED_STORE_KEY)) === true;
        } catch (error) {
            isMuted = false;
        }

        injectStyles();

        createAudio();

        syncState();

        startWatch();

        hookButton();
    }

    function onScan() {
        hookButton();

        syncState();
    }

    function dispose() {
        stopWatch();

        stopRepeat();

        if (audio) {
            try {
                audio.pause();
                audio.removeAttribute('src');
            } catch (error) {
                /* Ignorieren. */
            }

            audio = null;
        }

        document
            .querySelectorAll(`.${BUTTON_CLASS}`)
            .forEach(button => button.remove());

        document.getElementById(STYLES_ID)?.remove();

        isActive = false;
        isBlocked = false;
        lastButtonRail = null;
        api = null;
    }

    window.__AFILIA_APPLET_QUEUE__ =
        window.__AFILIA_APPLET_QUEUE__ || [];

    window.__AFILIA_APPLET_QUEUE__.push({
        id: 'fmsAlert',
        name: 'FMS-Alarm',
        description:
            'Spielt alle 5 Minuten einen Alarmton ab, solange ein Sprechwunsch vorliegt.',
        version: '1.0.0',
        init,
        onScan,
        dispose
    });
})();
