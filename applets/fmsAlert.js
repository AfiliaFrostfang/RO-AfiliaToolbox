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

    /* Der Warnmodus bestimmt, ob zusätzlich zum roten Statusbalken
       ein Alarmton abgespielt wird. Gespeichert wird der Modus,
       der alte Stummschalter wird beim ersten Start migriert. */

    const MODE_STORE_KEY = 'fmsAlertMode';
    const LEGACY_MUTED_STORE_KEY = 'fmsAlertMuted';

    const MODE_AUDIO = 'audio';
    const MODE_VISUAL = 'visual';

    /* Der Global-Mute-Schalter der Seite ist an diesem Icon zu erkennen.
       Unsere eigene Anzeige nutzt abweichend 'text-sm sm:text-sm' und wird
       über den Button-Kontext ohnehin ausgeschlossen. */
    const GLOBAL_MUTE_ICON_CLASS = 'fa-volume-xmark';
    const GLOBAL_MUTE_ICON_COLOR_CLASS = 'text-white/80';

    /* Anker-Icons der Statusleiste im Kopf der Seite. Der Container
       darüber wird gesucht, damit der Sprechwunsch-Balken direkt
       darunter eingehängt werden kann. */
    const STATUS_ANCHOR_ICONS = [
        'fa-money-bill',
        'fa-arrow-trend-down',
        'fa-star'
    ];

    const STATUS_MIN_ANCHORS = 2;

    const BUTTON_CLASS = 'afilia-fms-alert-button';
    const BUTTON_ACTIVE_CLASS = 'afilia-fms-alert-button-active';
    const BUTTON_AUDIO_CLASS = 'afilia-fms-alert-button-audio';
    const BUTTON_VISUAL_CLASS = 'afilia-fms-alert-button-visual';
    const BUTTON_SILENT_CLASS = 'afilia-fms-alert-button-silent';
    const STATUS_CLASS = 'afilia-fms-alert-status';
    const STYLES_ID = 'afilia-applet-fms-alert-styles';

    let api = null;
    let audio = null;

    let repeatTimer = null;
    let watchTimer = null;

    let lastButtonRail = null;

    let statusBar = null;
    let lastStatusHost = null;

    let isActive = false;
    let isBlocked = false;
    let isGlobalMute = false;
    let mode = MODE_AUDIO;

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
                border-color: rgba(239, 68, 68, 0.35);
            }

            .${BUTTON_CLASS}:hover {
                border-color: #ef4444;
            }

            .${BUTTON_CLASS} i {
                color: #fca5a5;
            }

            .${BUTTON_VISUAL_CLASS} {
                border-color: rgba(113, 113, 122, 0.6);
            }

            .${BUTTON_VISUAL_CLASS} i {
                color: #a1a1aa;
            }

            .${BUTTON_AUDIO_CLASS} {
                border-color: rgba(239, 68, 68, 0.55);
            }

            .${BUTTON_AUDIO_CLASS} i {
                color: #fca5a5;
            }

            .${BUTTON_ACTIVE_CLASS} {
                border-color: #ef4444;
                box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.35);
            }

            .${BUTTON_ACTIVE_CLASS}.${BUTTON_AUDIO_CLASS} i {
                color: #ef4444;
                animation: afilia-fms-alert-pulse 1.4s ease-in-out infinite;
            }

            .${BUTTON_ACTIVE_CLASS}.${BUTTON_VISUAL_CLASS} i {
                color: #ef4444;
            }

            /* Stiller Alarm: eigener Mute oder globaler Mute des
               Spiels. Gleiche Spezifitaet wie die Regeln darueber,
               steht aber weiter hinten und gewinnt daher. */

            .${BUTTON_CLASS}.${BUTTON_SILENT_CLASS} i {
                color: #71717a;
                animation: none;
            }

            .${BUTTON_CLASS}.${BUTTON_SILENT_CLASS} {
                border-color: rgba(113, 113, 122, 0.6);
            }

            @keyframes afilia-fms-alert-pulse {
                0%, 100% {
                    opacity: 1;
                }

                50% {
                    opacity: 0.35;
                }
            }

            .${STATUS_CLASS} {
                width: 100%;
                margin-top: 6px;
                border: 1px solid rgba(239, 68, 68, 0.45);
                border-radius: 8px;
                background: rgba(239, 68, 68, 0.12);
                box-shadow: 0 0 12px rgba(239, 68, 68, 0.18);
                animation: afilia-fms-alert-status-glow 1.4s ease-in-out infinite;
            }

            .${STATUS_CLASS} i {
                animation: afilia-fms-alert-pulse 1.4s ease-in-out infinite;
            }

            @keyframes afilia-fms-alert-status-glow {
                0%, 100% {
                    border-color: rgba(239, 68, 68, 0.45);
                    background: rgba(239, 68, 68, 0.12);
                }

                50% {
                    border-color: rgba(239, 68, 68, 0.95);
                    background: rgba(239, 68, 68, 0.28);
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

    function detectGlobalMute() {
        const icons = document.querySelectorAll(
            `i.${GLOBAL_MUTE_ICON_CLASS}`
        );

        for (const icon of icons) {
            /* Unser eigenes Icon darf nicht mitgezählt werden. */
            if (icon.closest(`.${BUTTON_CLASS}`)) {
                continue;
            }

            if (
                icon.classList.contains(GLOBAL_MUTE_ICON_COLOR_CLASS) &&
                isElementVisible(icon)
            ) {
                return true;
            }
        }

        return false;
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

    /* Unser Alarm bleibt stumm, wenn wir selbst auf 'nur visuell'
       stehen oder das Spiel global stummgeschaltet ist. Das unterdrueckt
       ausschliesslich den Ton des Applets - der Mute-Schalter des
       Spiels wird dabei nie veraendert, und der visuelle Balken in der
       Statusleiste bleibt in beiden Faellen sichtbar. */

    function isSilent() {
        return !isAudioEnabled() || (isBlocked && mode === MODE_AUDIO);
    }

    /* Das Icon zeigt an, WARUM es stumm ist: der globale Mute des
       Spiels schlaegt unsere eigene Einstellung, damit man nicht
       einen Alarm fuer eingeschaltet haelt, der gar nicht laeuft. */

    function getButtonIconClass() {
        if (isGlobalMute) {
            return 'fa-solid fa-volume-xmark text-sm sm:text-sm';
        }

        if (mode === MODE_VISUAL) {
            return 'fa-solid fa-bell-slash text-sm sm:text-sm';
        }

        if (isBlocked) {
            return 'fa-solid fa-volume-xmark text-sm sm:text-sm';
        }

        return 'fa-solid fa-bell text-sm sm:text-sm';
    }

    function isAudioEnabled() {
        return mode === MODE_AUDIO && !isGlobalMute;
    }

    function playAlert() {
        if (!audio || !isAudioEnabled()) {
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

        if (!isActive || !isAudioEnabled()) {
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
        hookStatusBar();
    }

    function syncState() {
        if (!api) {
            return;
        }

        const globalMuteChanged = syncGlobalMute();

        const active = isBadgeActive();

        setActive(active);

        if (globalMuteChanged && active && !isGlobalMute) {
            playAlert();

            scheduleRepeat();
        }
    }

    /* Liefert true, sobald sich der Global-Mute-Zustand geändert hat. */

    function syncGlobalMute() {
        const muted = detectGlobalMute();

        if (muted === isGlobalMute) {
            return false;
        }

        isGlobalMute = muted;

        if (isGlobalMute) {
            stopRepeat();

            stopAudio();
        }

        updateButton();

        return true;
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

    async function loadMode() {
        try {
            const stored = await api.dbGet(MODE_STORE_KEY);

            if (stored === MODE_AUDIO || stored === MODE_VISUAL) {
                return stored;
            }

            /* Erster Start nach dem Update: der alte
               Stummschalter wird in einen Modus überführt. */

            const legacy = await api.dbGet(LEGACY_MUTED_STORE_KEY);

            if (legacy === true || legacy === false) {
                return legacy ? MODE_VISUAL : MODE_AUDIO;
            }
        } catch (error) {
            console.warn(
                '[Afilia Toolbox] FMS-Alarm Modus nicht lesbar:',
                error
            );
        }

        return MODE_AUDIO;
    }

    async function setMode(nextMode) {
        if (nextMode !== MODE_AUDIO && nextMode !== MODE_VISUAL) {
            return;
        }

        mode = nextMode;

        if (!isAudioEnabled()) {
            stopRepeat();

            stopAudio();
        } else if (isActive) {
            playAlert();

            scheduleRepeat();
        }

        updateButton();

        try {
            await api.dbSet(MODE_STORE_KEY, mode);
        } catch (error) {
            console.warn(
                '[Afilia Toolbox] FMS-Alarm Modus nicht gespeichert:',
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

        if (mode === MODE_AUDIO && isBlocked) {
            unlockAudio();

            return;
        }

        setMode(mode === MODE_AUDIO ? MODE_VISUAL : MODE_AUDIO);
    }

    function unlockAudio() {
        if (!audio) {
            return;
        }

        if (!isAudioEnabled()) {
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

    function setAttributeIfChanged(element, name, value) {
        if (element.getAttribute(name) !== value) {
            element.setAttribute(name, value);
        }
    }

    function getButtonTitle() {
        if (mode === MODE_AUDIO && isBlocked) {
            return 'Ton freigeben – Klicken, damit der FMS-Alarm wiedergegeben werden darf';
        }

        if (isGlobalMute) {
            return 'Global stummgeschaltet – FMS-Alarm bleibt ohne Ton. Klicken, um zwischen Ton und rein visueller Warnung zu wechseln';
        }

        if (mode === MODE_VISUAL) {
            return 'FMS-Alarm ohne Ton – nur der rote Balken warnt dich. Klicken, um wieder den Alarmton zu aktivieren';
        }

        if (isActive) {
            return 'FMS-Alarm mit Ton aktiv – alle 5 Minuten, solange eine Meldung anliegt. Klicken, um nur noch visuell zu warnen';
        }

        return 'FMS-Alarm mit Ton – alle 5 Minuten, solange eine Meldung anliegt. Klicken, um nur noch visuell zu warnen';
    }

    /* Nur tatsächlich geänderte Attribute schreiben. */

    function updateButton() {
        const button = document.querySelector(
            `.${BUTTON_CLASS}`
        );

        if (!button) {
            return;
        }

        const icon = button.querySelector('i');

        if (icon) {
            setAttributeIfChanged(
                icon,
                'class',
                getButtonIconClass()
            );
        }

        /* classList.toggle mit Sollwert fasst nichts an, wenn der
           Zustand schon passt - der Kernskript-Observer lauscht auf
           class/style und würde sonst jeden Scan erneut auslösen. */

        button.classList.toggle(BUTTON_ACTIVE_CLASS, isActive);

        const isAudioMode = mode === MODE_AUDIO;

        button.classList.toggle(BUTTON_AUDIO_CLASS, isAudioMode);

        button.classList.toggle(BUTTON_VISUAL_CLASS, !isAudioMode);

        button.classList.toggle(BUTTON_SILENT_CLASS, isSilent());

        setAttributeIfChanged(
            button,
            'data-afilia-fms-alert-mode',
            mode
        );

        setAttributeIfChanged(
            button,
            'data-afilia-fms-alert-silent',
            isSilent() ? 'true' : 'false'
        );

        setAttributeIfChanged(
            button,
            'data-afilia-fms-alert-active',
            isActive ? 'true' : 'false'
        );

        setAttributeIfChanged(
            button,
            'aria-label',
            isActive
                ? 'FMS 5 Sprechwunsch aktiv'
                : 'FMS 5 Alarm'
        );

        setAttributeIfChanged(
            button,
            'title',
            getButtonTitle()
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
       Statusleiste im Seitenkopf
       ========================================================= */

    /* Die Statusleiste des Spiels nutzt wechselnde Build-Hash-Klassen
       (jsx-...). Verankert wird deshalb an den Icons der Einträge:
       gesucht wird die gemeinsame Zeile und darüber der Container. */

    function countStatusAnchors(row) {
        return STATUS_ANCHOR_ICONS.filter(iconClass => {
            return row.querySelector(`i.${iconClass}`);
        }).length;
    }

    function findStatusRow(icon) {
        let node = icon.parentElement;

        while (node && node !== document.body) {
            if (node.classList.contains('flex-row')) {
                /* Nur die eigentliche Statuszeile, nicht irgendein
                   darüberliegender Flex-Container. */
                return countStatusAnchors(node) >= STATUS_MIN_ANCHORS
                    ? node
                    : null;
            }

            node = node.parentElement;
        }

        return null;
    }

    function findStatusHost() {
        for (const iconClass of STATUS_ANCHOR_ICONS) {
            const icons = document.querySelectorAll(`i.${iconClass}`);

            for (const icon of icons) {
                const row = findStatusRow(icon);

                const host = row ? row.parentElement : null;

                if (host && host !== document.body) {
                    return host;
                }
            }
        }

        return null;
    }

    function createStatusBar() {
        const bar = document.createElement('div');

        bar.className =
            `${STATUS_CLASS} flex flex-row items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md`;

        bar.setAttribute('role', 'status');
        bar.setAttribute('aria-live', 'polite');

        bar.innerHTML = `
            <i class="fa-solid fa-bell text-red-400 text-xs sm:text-base"></i>

            <div class="flex flex-col items-center leading-none sm:leading-tight">
                <span class="text-[9px] sm:text-[10px] text-red-300">
                    FMS 5
                </span>

                <span class="font-semibold text-white">
                    Sprechwunsch!
                </span>
            </div>
        `;

        return bar;
    }

    function removeStatusBar() {
        /* Nicht nur die zuletzt eingefügte Instanz entfernen: baut das
           Spiel den Kopfbereich per Clone neu auf, existiert unser
           Balken sonst doppelt. */

        document
            .querySelectorAll(`.${STATUS_CLASS}`)
            .forEach(bar => bar.remove());

        statusBar = null;
        lastStatusHost = null;
    }

    function hookStatusBar() {
        if (!isActive) {
            removeStatusBar();

            return;
        }

        const host = findStatusHost();

        if (!host) {
            return;
        }

        /* Das Spiel baut den Kopfbereich gelegentlich neu auf. */

        if (
            statusBar &&
            host === lastStatusHost &&
            host.nextElementSibling === statusBar
        ) {
            return;
        }

        removeStatusBar();

        lastStatusHost = host;

        statusBar = createStatusBar();

        host.after(statusBar);
    }

    /* =========================================================
       Applet lifecycle
       ========================================================= */

    async function init(context) {
        api = context;

        mode = await loadMode();

        injectStyles();

        createAudio();

        syncState();

        startWatch();

        hookButton();
    }

    function onScan() {
        hookButton();

        syncState();

        hookStatusBar();
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

        document
            .querySelectorAll(`.${STATUS_CLASS}`)
            .forEach(bar => bar.remove());

        document.getElementById(STYLES_ID)?.remove();

        isActive = false;
        isBlocked = false;
        isGlobalMute = false;
        lastButtonRail = null;
        statusBar = null;
        lastStatusHost = null;
        mode = MODE_AUDIO;
        api = null;
    }

    window.__AFILIA_APPLET_QUEUE__ =
        window.__AFILIA_APPLET_QUEUE__ || [];

    window.__AFILIA_APPLET_QUEUE__.push({
        id: 'fmsAlert',
        name: 'FMS-5-Alarm',
        description:
            'Warnt bei einem Sprechwunsch mit einem roten Balken in der Statusleiste. Über die Glocke lässt sich zwischen Alarmton und rein visueller Warnung umschalten.',
        version: '1.1.0',
        init,
        onScan,
        dispose
    });
})();
