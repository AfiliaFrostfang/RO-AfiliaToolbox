/* =========================================================
   Afilia Toolbox – Applet: Bauzeit-Alarm (Beta)
   Wird durch das Manifest vom Kernskript geladen und registriert
   sich selbst in der globalen Applet-Warteschlange.

   Beta-Hinweis: Das Applet ist über 'beta: true' und
   'defaultEnabled: false' gekennzeichnet. Es wird also nicht
   automatisch aktiviert und muss im Applet Store bewusst
   eingeschaltet werden.

   Datenquelle: ausschliesslich das DOM des Spiels. Es wird
   keine API abgerufen. Die verbleibende Bauzeit wird aus dem
   Baubalken gelesen und danach lokal weitergezaehlt, damit ein
   Alarm auch weiterlaeuft, wenn das Stationsfenster zu ist.

   ----------------------------------------------
   DOM-Struktur, auf die sich dieses Applet stuetzt
   ----------------------------------------------
   Der Baubalken ist ein absolut positioniertes Overlay ueber
   der Erweiterungs-Karte:

     div.absolute.bottom-0  (Overlay)
       div.flex.items-center.justify-between
         div.flex.items-center.gap-2
           i.fas.fa-hard-hat
           span  -> "Erweiterung wird gebaut"   <- Anker
         div.flex.items-center.gap-3
           div -> "6%"                          <- Fortschritt in Prozent
           div -> "5:38:43"                    <- Restzeit, h:mm:ss
       div.w-full.bg-orange-200.rounded-full.h-1
         div[style="width: 5.91%"]             <- Fortschrittsbalken

   Die Restzeit steht NICHT in einem einzelnen Textknoten:
   Stunden, Doppelpunkte, Minuten und Sekunden liegen in
   getrennten span-Elementen. Nur das textContent des
   zusammenhaengenden Containers ergibt wieder "5:38:43".

   Die Karte darunter (div.relative.flex... mit ring-2
   ring-orange-500) nennt die Erweiterung in einem h3.
   Der Stationsname und eine stabile Support-ID stehen im
   Sheet-Kopf (h2[data-slot="sheet-title"]).
   ========================================================= */

(function () {
    'use strict';

    /* =========================================================
       Konfiguration
       ========================================================= */

    /* IndexedDB-Schluessel. Der Store ist ein flacher
       Key/Value-Raum, deshalb jeder Schluessel mit Prefix. */

    const ALARMS_STORE_KEY = 'buildtimeAlarmAlarms';
    const DEFAULT_LEAD_STORE_KEY = 'buildtimeAlarmDefaultLead';
    const AUDIO_STORE_KEY = 'buildtimeAlarmAudio';

    /* Der Alarmton ist derselbe wie beim FMS-5-Alarm, damit
       keine neue Audiodatei noetig ist. */

    const AUDIO_URL =
        'https://afiliafrostfang.github.io/RO-AfiliaToolbox/assets/Bau.mp3';

    /* Der Scan laeuft nicht bei jeder Mutation. Das Spiel
       aktualisiert den Countdown selbst, ein Scan alle zwei
       Sekunden reicht voellig. */

    const DOM_SCAN_INTERVAL = 2000;
    const TICK_INTERVAL = 1000;

    /* Solange die Bauzeit im Alarmfenster liegt, wird der Alarm
       jede Minute wiederholt - so geht er nicht unter, wenn man
       gerade nicht hinsieht. */

    const REPEAT_INTERVAL = 60 * 1000;

    /* Der Alarm gilt ab diesem unteren Wert als ausgeloest und
       beendet, damit er nicht ewig weiterlaeuft. */

    const DONE_THRESHOLD = 0;

    /* Reicht die Restzeit nicht mehr fuer die gewaehlte
       Vorwarnzeit, gilt der Alarm trotzdem als gesetzt - er
       feuert dann sofort. */

    const DEFAULT_LEAD_MS = 5 * 60 * 1000;

    const LEAD_PRESETS = [
        { label: '1 Min.', value: 60 * 1000 },
        { label: '5 Min.', value: 5 * 60 * 1000 },
        { label: '10 Min.', value: 10 * 60 * 1000 },
        { label: '15 Min.', value: 15 * 60 * 1000 },
        { label: '30 Min.', value: 30 * 60 * 1000 },
        { label: '1 Std.', value: 60 * 60 * 1000 }
    ];

    /* =========================================================
       Selektoren des Spiels
       ========================================================= */

    const SELECTORS = {
        /* Sheet, in dem die Erweiterungen liegen. Radix-Dialog. */
        sheet: '[role="dialog"][data-slot="sheet-content"]',

        /* Kopf des Sheets mit Name und Support-ID. */
        sheetTitle: 'h2[data-slot="sheet-title"]',

        /* Der Stationsname ist der einzige klickbare Text im
           Titelbereich. Die Support-ID steckt im aria-label
           des Kopier-Knopfes daneben. */
        stationName: 'span.cursor-pointer',
        supportId: 'button[aria-label^="Support-ID "]',

        /* Der Text, an dem der Baubalken zu erkennen ist. */
        buildtimeLabel: 'Erweiterung wird gebaut',

        /* Das Overlay, das direkt ueber der Erweiterungs-Karte
           liegt. Die Karte selbst ist sein Elternelement. */
        overlay: 'div.absolute.bottom-0',

        /* Name der Erweiterung in der Karte. */
        extensionTitle: 'h3'
    };

    const CLASSES = {
        button: 'afilia-buildtime-alarm-button',
        label: 'afilia-buildtime-alarm-label',
        active: 'afilia-buildtime-alarm-button-active',
        done: 'afilia-buildtime-alarm-button-done'
    };

    const TOOLBOX_BUTTON_CLASS = 'afilia-buildtime-alarm-toolbox-button';
    const PANEL_ID = 'afilia-buildtime-alarm-window';
    const TOAST_ID = 'afilia-buildtime-alarm-toast';
    const STYLES_ID = 'afilia-applet-buildtime-alarm-styles';

    /* =========================================================
       Laufzeitzustand
       ========================================================= */

    let api = null;
    let audio = null;
    let isBlocked = false;

    let alarms = [];

    let defaultLeadMs = DEFAULT_LEAD_MS;
    let audioEnabled = true;

    let tickTimer = null;
    let lastDomScan = 0;
    let lastDomSignature = '';
    let repeatTimer = null;

    let lastButtonSlot = null;

    let barButtons = new Map();

    let toastTimer = null;

    /* =========================================================
       Hilfsfunktionen
       ========================================================= */

    /* Nimmt sowohl ein Element als auch einen fertigen String -
       parseRemaining bekommt die Restzeit als Text und nicht
       als Knoten uebergeben. */

    function readText(value) {
        const source = typeof value === 'string'
            ? value
            : (value && value.textContent) || '';

        return source
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /* Nur tatsaechlich sichtbare Elemente zaehlen. Versteckte
       Tabs stehen weiter im DOM. */

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

        return true;
    }

    /* =========================================================
       Restzeit lesen
       ========================================================= */

    /* Die Restzeit wird ausschliesslich aus einem exakten
       Treffer wie "5:38:43" oder "38:07" gelesen. Bewusst
       streng: die Karten zeigen sonst noch Angaben wie
       "24 Stunden" (Bauzeit beim Kauf) oder eine
       Prozentangabe, die nichts mit dem Countdown zu tun
       haben.

       Zwei Teile bedeuten M:SS, drei Teile H:MM:SS. */

    const CLOCK_PATTERN = /^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/;

    /* Stunden, Doppelpunkte, Minuten und Sekunden liegen in
       getrennten span-Elementen. Zwischen ihnen kann
       Whitespace stehen, der bei readText zu Leerzeichen
       fuehrt - "5 : 38 : 43". Zum Vergleichen wird er
       entfernt. */

    function compactClockText(text) {
        return readText(text).replace(/\s+/g, '');
    }

    function parseRemaining(text) {
        const match = compactClockText(text).match(CLOCK_PATTERN);

        if (!match) {
            return null;
        }

        const first = Number(match[1]);
        const second = Number(match[2]);
        const third = match[3] === undefined ? null : Number(match[3]);

        if (third !== null) {
            return ((first * 60 + second) * 60 + third) * 1000;
        }

        return (first * 60 + second) * 1000;
    }

    function formatDuration(milliseconds) {
        const total = Math.max(0, Math.round(milliseconds / 1000));

        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;

        const pad = value => String(value).padStart(2, '0');

        if (hours > 0) {
            return `${hours}:${pad(minutes)}:${pad(seconds)}`;
        }

        return `${pad(minutes)}:${pad(seconds)}`;
    }

    function formatLead(milliseconds) {
        if (milliseconds >= 60 * 60 * 1000) {
            return `${Math.round(milliseconds / (60 * 60 * 1000))} Std.`;
        }

        if (milliseconds >= 60 * 1000) {
            return `${Math.round(milliseconds / 60000)} Min.`;
        }

        return `${Math.round(milliseconds / 1000)} Sek.`;
    }

    /* =========================================================
       Station und Erweiterung im DOM finden
       ========================================================= */

    /* Die Support-ID ist die verlaesslichste Kennung. Sie
       aendert sich allerdings mit dem Spiel, deshalb wird sie
       nur als Schluessel verwendet, waehrend der Name fuer die
       Anzeige erhalten bleibt. */

    function readSupportId(dialog) {
        const button = dialog.querySelector(SELECTORS.supportId);

        if (!button) {
            return '';
        }

        const match = (button.getAttribute('aria-label') || '')
            .match(/Support-ID\s+(\S+)/);

        return match ? match[1] : '';
    }

    function readStationName(dialog) {
        const direct = dialog.querySelector(
            `${SELECTORS.sheetTitle} ${SELECTORS.stationName}`
        );

        if (direct) {
            return readText(direct);
        }

        /* Notausweg: der laengste Text im Titelbereich, der
           keine Prozentangabe und keine Badge ist. */

        const title = dialog.querySelector(SELECTORS.sheetTitle);

        if (!title) {
            return '';
        }

        const candidates = Array.from(title.querySelectorAll('span'))
            .map(span => readText(span))
            .filter(value => value.length > 2 && !/^\d+\s*%/.test(value));

        return candidates.sort((a, b) => b.length - a.length)[0] || '';
    }

    /* Findet das Sheet mit der Stationsanzeige. Der Bauzeit-
       Anker ist das eigentliche Kriterium: ohne ihn gibt es
       nichts zu ueberwachen, auch wenn das Sheet offen ist. */

    function findStationContext() {
        const anchors = findBuildtimeAnchors();

        if (anchors.length === 0) {
            return null;
        }

        for (const dialog of document.querySelectorAll(SELECTORS.sheet)) {
            const name = readStationName(dialog);

            if (!name) {
                continue;
            }

            return { name, supportId: readSupportId(dialog) };
        }

        return null;
    }

    /* Alle Elemente, deren Text der Bauanzeige entspricht. Der
       Text ist stabil, die Klassen darum sind es nicht. */

    function findBuildtimeAnchors() {
        const found = [];

        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT
        );

        let node = walker.nextNode();

        while (node) {
            const value = (node.nodeValue || '').trim();

            if (value === SELECTORS.buildtimeLabel) {
                const parent = node.parentElement;

                if (parent && isElementVisible(parent)) {
                    found.push(parent);
                }
            }

            node = walker.nextNode();
        }

        return found;
    }

    /* Aus dem Anker wird das Overlay, aus dem Overlay die
       Restzeit und aus der Karte der Erweiterungsname. */

    function readOverlay(anchor) {
        const overlay = anchor.closest(SELECTORS.overlay);

        if (!overlay || !isElementVisible(overlay)) {
            return null;
        }

        const remaining = parseRemaining(readOverlayRemaining(overlay));

        if (remaining === null) {
            return null;
        }

        const card = overlay.parentElement;

        const extension = card
            ? readText(card.querySelector(SELECTORS.extensionTitle))
            : '';

        return { overlay, card, remaining, extension };
    }

    /* Sucht die Box mit der Restzeit. Sie ist der einzige
       Container im Overlay, dessen Text exakt dem Countdown
       entspricht - unabhaengig davon, ob die Zeiger links
       oder rechts davon stehen. */

    function readOverlayRemaining(overlay) {
        const nodes = overlay.querySelectorAll('div, span');

        for (const node of nodes) {
            if (node.closest(`.${CLASSES.button}`)) {
                continue;
            }

            const text = compactClockText(node);

            if (CLOCK_PATTERN.test(text)) {
                return text;
            }
        }

        return '';
    }

    /* =========================================================
       Alarme
       ========================================================= */

    function toStationKey(name) {
        return api ? api.normalizeName(name) : String(name).trim().toLowerCase();
    }

    /* Schluessel einer Erweiterung: Support-ID der Wache plus
       Name der Erweiterung. Damit sind zwei Erweiterungen an
       derselben Wache getrennt erfassbar. */

    function toAlarmKey(station, extension) {
        const stationPart = station.supportId
            ? `id:${station.supportId}`
            : `name:${toStationKey(station.name)}`;

        return `${stationPart}::${toStationKey(extension)}`;
    }

    function createAlarm(station, extension, remainingMs) {
        return {
            key: toAlarmKey(station, extension),
            stationName: station.name,
            supportId: station.supportId || '',
            extensionName: extension,
            remainingMs,
            capturedAt: Date.now(),
            leadMs: defaultLeadMs,
            fired: false
        };
    }

    function findAlarm(key) {
        return alarms.find(alarm => alarm.key === key) || null;
    }

    /* Die beim Setzen gelesene Restzeit wird um die seitdem
       vergangene Zeit verkuerzt. So laeuft der Alarm auch
       weiter, wenn das Stationsfenster inzwischen zu ist. */

    function getRemaining(alarm, now) {
        const current = now === undefined ? Date.now() : now;

        return alarm.remainingMs - (current - alarm.capturedAt);
    }

    function isDone(alarm) {
        return getRemaining(alarm) <= DONE_THRESHOLD;
    }

    function getDisplayName(alarm) {
        return alarm.extensionName
            ? `${alarm.stationName} – ${alarm.extensionName}`
            : alarm.stationName;
    }

    function sortAlarms() {
        alarms.sort((left, right) => getRemaining(left) - getRemaining(right));
    }

    async function saveAlarms() {
        try {
            await api.dbSet(
                ALARMS_STORE_KEY,
                alarms.map(alarm => ({ ...alarm }))
            );
        } catch (error) {
            console.warn(
                '[Afilia Toolbox] Bauzeit-Alarm konnte nicht gespeichert werden:',
                error
            );
        }
    }

    function toggleAlarm(station, extension, remainingMs) {
        const key = toAlarmKey(station, extension);

        const existing = findAlarm(key);

        if (existing) {
            alarms = alarms.filter(alarm => alarm !== existing);

            saveAlarms();

            afterAlarmChange();

            showToast(
                'Bauzeit-Alarm entfernt',
                getDisplayName(existing),
                'fa-solid fa-bell-slash'
            );

            return false;
        }

        const alarm = createAlarm(station, extension, remainingMs);

        alarms.push(alarm);

        sortAlarms();

        saveAlarms();

        afterAlarmChange();

        /* Reicht die Restzeit nicht fuer die Vorwarnzeit, wird
           sofort ausgeloest - sonst wartet man vergebens. */

        if (getRemaining(alarm) <= alarm.leadMs) {
            fireAlarm(alarm);

            return true;
        }

        showToast(
            `Alarm ${formatLead(alarm.leadMs)} vorher`,
            getDisplayName(alarm),
            'fa-solid fa-bell'
        );

        return true;
    }

    function setLead(alarm, leadMs) {
        alarm.leadMs = leadMs;
        alarm.fired = false;

        saveAlarms();

        afterAlarmChange();
    }

    function removeAlarm(key) {
        if (!findAlarm(key)) {
            return;
        }

        alarms = alarms.filter(alarm => alarm.key !== key);

        saveAlarms();

        afterAlarmChange();
    }

    function removeAllAlarms() {
        if (alarms.length === 0) {
            return;
        }

        alarms = [];

        saveAlarms();

        afterAlarmChange();

        showToast('Alle Alarme entfernt', '', 'fa-solid fa-trash');
    }

    function afterAlarmChange() {
        updateButtons();
        renderWindow();
    }

    /* =========================================================
       Alarmausloesung
       ========================================================= */

    function isSilent() {
        return !audioEnabled || isBlocked;
    }

    function createAudio() {
        if (audio) {
            return audio;
        }

        const element = new Audio();

        element.preload = 'auto';
        element.src = AUDIO_URL;
        element.volume = 0.7;

        audio = element;

        return element;
    }

    function playAlert() {
        if (!audio || !audioEnabled) {
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

                        updateButtons();
                    })
                    .catch(() => {
                        isBlocked = true;

                        updateButtons();
                    });
            }
        } catch (error) {
            isBlocked = true;

            console.warn(
                '[Afilia Toolbox] Bauzeit-Alarmton konnte nicht abgespielt werden:',
                error
            );
        }
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

    /* Der erste Klick entsperrt den Ton: Browser blockieren
       Autoplay, solange keine Nutzeraktion erfolgt ist. */

    function unlockAudio() {
        if (!audio || !audioEnabled) {
            isBlocked = false;

            updateButtons();

            return;
        }

        try {
            const playback = audio.play();

            if (playback && typeof playback.then === 'function') {
                playback
                    .then(() => {
                        isBlocked = false;

                        stopAudio();

                        updateButtons();
                    })
                    .catch(() => {
                        isBlocked = true;

                        updateButtons();
                    });

                return;
            }
        } catch (error) {
            isBlocked = true;
        }

        isBlocked = false;

        updateButtons();
    }

    function fireAlarm(alarm) {
        if (alarm.fired) {
            return;
        }

        alarm.fired = true;

        playAlert();

        showToast(
            `Bauzeit endet in ${formatLead(alarm.leadMs)}`,
            getDisplayName(alarm),
            'fa-solid fa-bell'
        );

        saveAlarms();

        scheduleRepeat();

        updateButtons();
        renderWindow();
    }

    function stopRepeat() {
        if (repeatTimer) {
            clearTimeout(repeatTimer);

            repeatTimer = null;
        }
    }

    function scheduleRepeat() {
        stopRepeat();

        if (isSilent()) {
            return;
        }

        const pending = alarms.some(alarm => {
            const remaining = getRemaining(alarm);

            return (
                alarm.fired &&
                remaining <= alarm.leadMs &&
                remaining > DONE_THRESHOLD
            );
        });

        if (!pending) {
            return;
        }

        repeatTimer = setTimeout(() => {
            repeatTimer = null;

            syncAlarms();

            scheduleRepeat();
        }, REPEAT_INTERVAL);
    }

    function syncAlarms() {
        if (!api) {
            return;
        }

        sortAlarms();

        for (const alarm of alarms) {
            if (alarm.fired) {
                continue;
            }

            if (getRemaining(alarm) <= alarm.leadMs) {
                fireAlarm(alarm);
            }
        }
    }

    /* =========================================================
       Laden und Speichern
       ========================================================= */

    async function loadState() {
        try {
            const stored = await api.dbGet(ALARMS_STORE_KEY);

            alarms = Array.isArray(stored)
                ? stored.filter(isValidAlarm).map(normalizeAlarm)
                : [];
        } catch (error) {
            console.warn('[Afilia Toolbox] Bauzeit-Alarme nicht lesbar:', error);

            alarms = [];
        }

        try {
            const storedLead = await api.dbGet(DEFAULT_LEAD_STORE_KEY);

            if (Number(storedLead) > 0) {
                defaultLeadMs = Number(storedLead);
            }
        } catch (error) {
            /* Voreinstellung behalten. */
        }

        try {
            const storedAudio = await api.dbGet(AUDIO_STORE_KEY);

            if (typeof storedAudio === 'boolean') {
                audioEnabled = storedAudio;
            }
        } catch (error) {
            /* Voreinstellung behalten. */
        }

        sortAlarms();
    }

    /* Aeltere Eintraege ohne stabilen Schluessel bekommen ihn
       nachtraeglich aus Station und Erweiterung. */

    function normalizeAlarm(alarm) {
        const stationName = String(alarm.stationName || alarm.name || '');
        const extensionName = String(alarm.extensionName || '');

        const supportId = String(alarm.supportId || '');

        return {
            key: alarm.key
                ? String(alarm.key)
                : toAlarmKey({ name: stationName, supportId }, extensionName),
            stationName,
            supportId,
            extensionName,
            remainingMs: Number(alarm.remainingMs),
            capturedAt: Number(alarm.capturedAt),
            leadMs: Number(alarm.leadMs) || defaultLeadMs,
            fired: alarm.fired === true
        };
    }

    function isValidAlarm(alarm) {
        return (
            alarm &&
            typeof (alarm.stationName || alarm.name) === 'string' &&
            (alarm.stationName || alarm.name).length > 0 &&
            Number.isFinite(Number(alarm.remainingMs)) &&
            Number.isFinite(Number(alarm.capturedAt))
        );
    }

    async function setDefaultLead(milliseconds) {
        defaultLeadMs = milliseconds;

        try {
            await api.dbSet(DEFAULT_LEAD_STORE_KEY, milliseconds);
        } catch (error) {
            console.warn('[Afilia Toolbox] Vorwahl nicht gespeichert:', error);
        }
    }

    async function setAudioEnabled(enabled) {
        audioEnabled = !!enabled;

        if (!audioEnabled) {
            stopRepeat();

            stopAudio();
        } else {
            unlockAudio();

            scheduleRepeat();
        }

        updateButtons();

        try {
            await api.dbSet(AUDIO_STORE_KEY, audioEnabled);
        } catch (error) {
            console.warn('[Afilia Toolbox] Ton-Einstellung nicht gespeichert:', error);
        }
    }

    /* =========================================================
       Knopf im Baubalken
       ========================================================= */

    function setAttributeIfChanged(element, name, value) {
        if (element.getAttribute(name) !== value) {
            element.setAttribute(name, value);
        }
    }

    function setTextIfChanged(element, text) {
        if (element && element.textContent !== text) {
            element.textContent = text;
        }
    }

    function createBarButton() {
        const button = document.createElement('button');

        button.type = 'button';

        button.className =
            `${CLASSES.button} flex items-center gap-1 ` +
            'px-2 h-6 rounded-full border text-[11px] font-bold ' +
            'whitespace-nowrap cursor-pointer transition-colors';

        button.innerHTML =
            '<i class="fa-solid fa-bell text-[11px]"></i>' +
            `<span class="${CLASSES.label}"></span>`;

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            handleBarButtonClick(button);
        });

        return button;
    }

    function handleBarButtonClick(button) {
        const remaining = Number(button.dataset.remaining);

        const station = {
            name: button.dataset.stationName || '',
            supportId: button.dataset.supportId || ''
        };

        const extension = button.dataset.extensionName || '';

        if (!station.name || !extension) {
            return;
        }

        const existing = findAlarm(button.dataset.alarmKey);

        if (existing) {
            toggleAlarm(station, extension);

            return;
        }

        /* Setzen ist eine Nutzeraktion - hier den Ton
           entsperren, damit der Alarm spaeter hoerbar ist. */

        unlockAudio();

        toggleAlarm(station, extension, remaining);
    }

    function updateBarButton(button) {
        const alarm = findAlarm(button.dataset.alarmKey);

        const icon = button.querySelector('i');
        const label = button.querySelector(`.${CLASSES.label}`);

        if (alarm) {
            const done = isDone(alarm);

            button.classList.toggle(CLASSES.active, true);
            button.classList.toggle(CLASSES.done, done);

            if (icon) {
                setAttributeIfChanged(
                    icon,
                    'class',
                    done
                        ? 'fa-solid fa-flag-checkered text-[11px]'
                        : 'fa-solid fa-bell text-[11px]'
                );
            }

            setTextIfChanged(
                label,
                done ? 'fertig' : `−${formatLead(alarm.leadMs)}`
            );

            setAttributeIfChanged(
                button,
                'title',
                done
                    ? `${getDisplayName(alarm)}: Bauzeit abgelaufen. Klicken, um den Alarm zu entfernen.`
                    : `${getDisplayName(alarm)}: Alarm ${formatLead(alarm.leadMs)} vor Fertigstellung. Klicken, um den Alarm zu entfernen.`
            );

            setAttributeIfChanged(
                button,
                'aria-label',
                'Bauzeit-Alarm aktiv – entfernen'
            );

            return;
        }

        const name = button.dataset.stationName || '';
        const extension = button.dataset.extensionName || '';

        button.classList.toggle(CLASSES.active, false);
        button.classList.toggle(CLASSES.done, false);

        if (icon) {
            setAttributeIfChanged(icon, 'class', 'fa-solid fa-bell text-[11px]');
        }

        setTextIfChanged(label, 'Alarm');

        const title = extension
            ? `${name} – ${extension}`
            : name;

        setAttributeIfChanged(
            button,
            'title',
            `Alarm ${formatLead(defaultLeadMs)} vor Fertigstellung setzen: ${title}`
        );

        setAttributeIfChanged(button, 'aria-label', 'Bauzeit-Alarm setzen');
    }

    function updateButtons() {
        barButtons.forEach(updateBarButton);

        updateToolboxButton();
    }

    /* Der Knopf sitzt links neben der Prozentangabe, damit er
       mit Restzeit und Fortschritt zusammen eine Zeile bildet.
       Wird er vor die Prozentbox gesetzt, bleibt deren
       Position als Leseanker unberuehrt. */

    function findInsertHost(overlay) {
        const percent = Array.from(overlay.querySelectorAll('div')).find(node => {
            return /^\d+\s*%$/.test(readText(node));
        });

        if (!percent) {
            return null;
        }

        return percent.parentElement || overlay;
    }

    function hookBars(force) {
        if (!api) {
            return;
        }

        const now = Date.now();

        if (!force && now - lastDomScan < DOM_SCAN_INTERVAL) {
            return;
        }

        lastDomScan = now;

        const station = findStationContext();

        if (!station) {
            /* Ohne Stationsnamen laesst sich der Balken nicht
               zuordnen. Lieber keine Schaltflaeche anbieten als
               eine, die ins Leere zeigt. */

            if (barButtons.size > 0) {
                for (const button of barButtons.values()) {
                    button.remove();
                }

                barButtons = new Map();

                lastDomSignature = '';
            }

            return;
        }

        const overlays = new Map();

        for (const anchor of findBuildtimeAnchors()) {
            const info = readOverlay(anchor);

            if (info) {
                overlays.set(info.overlay, info);
            }
        }

        const signature = buildSignature(station, overlays);

        if (signature === lastDomSignature) {
            return;
        }

        lastDomSignature = signature;

        for (const [overlay, info] of overlays) {
            let button = barButtons.get(overlay);

            if (!button || !button.isConnected) {
                button = createBarButton();

                barButtons.set(overlay, button);
            }

            const key = station
                ? toAlarmKey(station, info.extension)
                : '';

            button.dataset.alarmKey = key;
            button.dataset.stationName = station ? station.name : '';
            button.dataset.supportId = station ? station.supportId : '';
            button.dataset.extensionName = info.extension;
            button.dataset.remaining = String(info.remaining);

            const host = findInsertHost(overlay);

            if (host && button.parentElement !== host) {
                const percent = host.querySelector('div');

                if (percent && percent.nextElementSibling !== button) {
                    host.insertBefore(button, percent);
                } else {
                    host.appendChild(button);
                }
            }

            updateBarButton(button);
        }

        /* Balken, die es nicht mehr gibt, mitnehmen. React baut
           das Sheet gelegentlich neu auf, dann ist der alte
           Knoten nicht mehr connected. */

        for (const [overlay, button] of barButtons) {
            if (!overlays.has(overlay) || !overlay.isConnected) {
                button.remove();

                barButtons.delete(overlay);
            }
        }

        if (station) {
            refreshStoredAlarms(station, overlays);
        }
    }

    /* Haelt die gespeicherte Restzeit nach, solange der Balken
       sichtbar ist. Verhindert Drift und setzt einen bereits
       ausgeloesten Alarm zurueck, falls die Bauzeit wieder
       deutlich ueber dem Alarmfenster liegt. */

    function refreshStoredAlarms(station, overlays) {
        let changed = false;

        for (const info of overlays.values()) {
            if (!info.extension) {
                continue;
            }

            const alarm = findAlarm(toAlarmKey(station, info.extension));

            if (!alarm) {
                continue;
            }

            if (alarm.remainingMs !== info.remaining) {
                alarm.remainingMs = info.remaining;
                alarm.capturedAt = Date.now();
                changed = true;
            }

            if (alarm.fired && getRemaining(alarm) > alarm.leadMs + REPEAT_INTERVAL) {
                alarm.fired = false;

                changed = true;
            }
        }

        if (changed) {
            saveAlarms();

            scheduleRepeat();
        }
    }

    /* Nur bei einer echten Aenderung wird das DOM angefasst.
       Der MutationObserver des Kerns lauscht auf class/style/
       data-state und wuerde sonst jeden Scan erneut ausloesen. */

    function buildSignature(station, overlays) {
        const parts = [`${station.supportId}|${station.name}`];

        for (const [overlay, info] of overlays) {
            parts.push(
                `${toStationKey(info.extension)}=${info.remaining}@${overlay.isConnected}`
            );
        }

        return parts.sort().join('#');
    }

    /* =========================================================
       Toolbox-Knopf
       ========================================================= */

    function findButtonSlot() {
        if (!api) {
            return null;
        }

        return api.getAppletSlot();
    }

    function createToolboxButton() {
        const button = document.createElement('button');

        button.type = 'button';

        button.className =
            `${TOOLBOX_BUTTON_CLASS} w-10 h-10 sm:w-10 sm:h-10 bg-dark rounded-lg shadow-lg ` +
            'border border-gray-800/80 hover:border-gray-700 transition-all duration-300 ' +
            'flex items-center justify-center cursor-pointer';

        button.innerHTML =
            '<i class="fa-solid fa-hammer text-sm sm:text-sm text-white/80"></i>';

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            toggleWindow();
        });

        return button;
    }

    function updateToolboxButton() {
        const button = document.querySelector(`.${TOOLBOX_BUTTON_CLASS}`);

        if (!button) {
            return;
        }

        const count = alarms.length;

        const fired = alarms.some(alarm => alarm.fired && !isDone(alarm));

        button.classList.toggle(CLASSES.active, count > 0);
        button.classList.toggle(CLASSES.done, fired);

        const icon = button.querySelector('i');

        if (icon) {
            setAttributeIfChanged(
                icon,
                'class',
                fired
                    ? 'fa-solid fa-bell text-sm sm:text-sm'
                    : 'fa-solid fa-hammer text-sm sm:text-sm'
            );
        }

        const label = count === 1 ? 'Erweiterung' : 'Erweiterungen';

        setAttributeIfChanged(
            button,
            'data-afilia-buildtime-alarm-count',
            String(count)
        );

        setAttributeIfChanged(
            button,
            'aria-label',
            count > 0
                ? `Bauzeit-Alarm: ${count} ${label}`
                : 'Bauzeit-Alarm öffnen'
        );

        setAttributeIfChanged(
            button,
            'title',
            count > 0
                ? `Bauzeit-Alarm: ${count} ${label} überwacht. Klicken für die Übersicht.`
                : 'Bauzeit-Alarm: noch kein Alarm gesetzt. Klicken für die Übersicht.'
        );
    }

    function hookToolboxButton() {
        const slot = findButtonSlot();

        if (!slot) {
            lastButtonSlot = null;

            return;
        }

        const existing = slot.querySelector(`.${TOOLBOX_BUTTON_CLASS}`);

        if (slot === lastButtonSlot && existing) {
            updateToolboxButton();

            return;
        }

        lastButtonSlot = slot;

        if (existing) {
            existing.remove();
        }

        api.mountAppletButton(createToolboxButton());

        updateToolboxButton();
    }

    /* =========================================================
       Fenster
       ========================================================= */

    function toggleWindow() {
        if (document.getElementById(PANEL_ID)) {
            closeWindow();

            return;
        }

        openWindow();
    }

    function closeWindow() {
        document.getElementById(PANEL_ID)?.remove();

        if (window._afiliaBuildtimeKeydown) {
            window.removeEventListener(
                'keydown',
                window._afiliaBuildtimeKeydown
            );

            window._afiliaBuildtimeKeydown = null;
        }
    }

    function openWindow() {
        if (document.getElementById(PANEL_ID)) {
            renderWindow();

            return;
        }

        const overlay = document.createElement('div');

        overlay.id = PANEL_ID;

        overlay.className = 'afilia-bta-overlay';

        overlay.innerHTML = `
            <div class="afilia-bta-panel" role="dialog" aria-modal="true">
                <div class="afilia-bta-header">
                    <div>
                        <div class="afilia-bta-title">
                            Bauzeit-Alarm

                            <span class="afilia-bta-beta">Beta</span>
                        </div>

                        <div class="afilia-bta-subtitle" data-role="subtitle"></div>
                    </div>

                    <button
                        type="button"
                        class="afilia-bta-close"
                        title="Schließen"
                        aria-label="Schließen"
                    >&times;</button>
                </div>

                <div class="afilia-bta-controls">
                    <label class="afilia-bta-field">
                        <span>Vorwarnzeit</span>

                        <select data-role="lead"></select>
                    </label>

                    <label class="afilia-bta-field afilia-bta-field-check">
                        <input type="checkbox" data-role="audio">

                        <span>Alarmton</span>
                    </label>

                    <button
                        type="button"
                        class="afilia-bta-danger"
                        data-role="clear"
                    >Alle Alarme entfernen</button>
                </div>

                <div class="afilia-bta-body" data-role="body"></div>

                <div class="afilia-bta-footer">
                    <span data-role="count"></span>

                    <span class="afilia-bta-hint">
                        Werte kommen aus dem Spielbild und werden lokal weitergezählt.
                    </span>
                </div>
            </div>
        `;

        overlay.querySelector('.afilia-bta-close').addEventListener(
            'click',
            event => {
                event.preventDefault();
                event.stopPropagation();

                closeWindow();
            }
        );

        overlay.addEventListener('click', event => {
            if (event.target === overlay) {
                closeWindow();
            }
        });

        window._afiliaBuildtimeKeydown = event => {
            if (event.key === 'Escape') {
                closeWindow();
            }
        };

        window.addEventListener('keydown', window._afiliaBuildtimeKeydown);

        document.body.appendChild(overlay);

        bindWindowControls();

        renderWindow();
    }

    function bindWindowControls() {
        const overlay = document.getElementById(PANEL_ID);

        if (!overlay) {
            return;
        }

        const lead = overlay.querySelector('[data-role="lead"]');

        lead.innerHTML = renderLeadOptions(defaultLeadMs);

        lead.addEventListener('change', () => {
            setDefaultLead(Number(lead.value));
        });

        const audioBox = overlay.querySelector('[data-role="audio"]');

        audioBox.checked = audioEnabled;

        audioBox.addEventListener('change', () => {
            setAudioEnabled(audioBox.checked);
        });

        overlay.querySelector('[data-role="clear"]').addEventListener(
            'click',
            () => {
                removeAllAlarms();
            }
        );
    }

    function renderLeadOptions(selectedValue) {
        return LEAD_PRESETS.map(preset => {
            const selected = preset.value === selectedValue ? ' selected' : '';

            return `<option value="${preset.value}"${selected}>${preset.label}</option>`;
        }).join('');
    }

    function renderWindow() {
        const overlay = document.getElementById(PANEL_ID);

        if (!overlay) {
            return;
        }

        const subtitle = overlay.querySelector('[data-role="subtitle"]');
        const body = overlay.querySelector('[data-role="body"]');
        const count = overlay.querySelector('[data-role="count"]');
        const lead = overlay.querySelector('[data-role="lead"]');

        if (lead && lead.value !== String(defaultLeadMs)) {
            lead.value = String(defaultLeadMs);
        }

        sortAlarms();

        if (isSilent() && alarms.some(alarm => alarm.fired)) {
            setTextIfChanged(
                subtitle,
                'Der Alarmton ist blockiert – ein Klick auf die Glocke im Baubalken schaltet ihn frei.'
            );
        } else {
            setTextIfChanged(
                subtitle,
                'Alarm X vor Fertigstellung der Erweiterung.'
            );
        }

        if (alarms.length === 0) {
            body.innerHTML = `
                <div class="afilia-bta-empty">
                    <i class="fa-solid fa-bell-slash"></i>

                    <p>Noch kein Alarm gesetzt.</p>

                    <p class="afilia-bta-empty-hint">
                        Öffne im Spiel eine Wache, wechsle auf
                        „Erweiterungen" und klicke neben einer laufenden
                        Erweiterung auf „Alarm".
                    </p>
                </div>
            `;

            setTextIfChanged(count, '0 Alarme');

            return;
        }

        body.innerHTML = '';

        for (const alarm of alarms) {
            body.appendChild(createRow(alarm));
        }

        setTextIfChanged(count, formatCount());
    }

    function formatCount() {
        return `${alarms.length} Alarm${alarms.length === 1 ? '' : 'e'}`;
    }

    function createRow(alarm) {
        const row = document.createElement('div');

        row.className = 'afilia-bta-row';
        row.dataset.alarmKey = alarm.key;

        const stationName = escapeHTML(alarm.stationName);
        const extensionName = escapeHTML(alarm.extensionName);

        row.innerHTML = `
            <div class="afilia-bta-row-head">
                <div class="afilia-bta-row-station" title="${stationName}">
                    ${stationName}
                </div>

                <div class="afilia-bta-row-extension" title="${extensionName}">
                    ${extensionName}
                </div>
            </div>

            <div class="afilia-bta-row-time" data-role="time"></div>

            <div class="afilia-bta-row-sub" data-role="sub"></div>

            <div class="afilia-bta-row-actions">
                <select data-role="lead" aria-label="Vorwarnzeit">
                    ${renderLeadOptions(alarm.leadMs)}
                </select>

                <button
                    type="button"
                    class="afilia-bta-remove"
                    data-role="remove"
                    title="Diesen Alarm entfernen"
                    aria-label="Diesen Alarm entfernen"
                >&times;</button>
            </div>
        `;

        row.querySelector('[data-role="lead"]').addEventListener(
            'change',
            event => {
                setLead(alarm, Number(event.target.value));
            }
        );

        row.querySelector('[data-role="remove"]').addEventListener(
            'click',
            () => {
                removeAlarm(alarm.key);
            }
        );

        updateRow(row, alarm);

        return row;
    }

    function updateRow(row, alarm) {
        const remaining = getRemaining(alarm);

        const done = isDone(alarm);

        const time = row.querySelector('[data-role="time"]');
        const sub = row.querySelector('[data-role="sub"]');

        row.classList.toggle('afilia-bta-row-fired', alarm.fired);

        if (done) {
            setTextIfChanged(time, 'fertig');

            setTextIfChanged(
                sub,
                'Bauzeit abgelaufen – der Alarm kann entfernt werden.'
            );

            return;
        }

        setTextIfChanged(time, formatDuration(remaining));

        const text = alarm.fired
            ? `Alarm läuft – Ende in ${formatDuration(remaining)}.`
            : `${formatLead(remaining)} verbleiben, Alarm ${formatLead(alarm.leadMs)} vorher.`;

        setTextIfChanged(sub, text);
    }

    function escapeHTML(value) {
        return api ? api.escapeHTML(value) : String(value);
    }

    /* Das Fenster wird einmal pro Sekunde aktualisiert. Angefasst
       werden nur die Textknoten, damit der Observer des Kerns
       nicht pro Render einen Scan ausloest. */

    function tickWindow() {
        const overlay = document.getElementById(PANEL_ID);

        if (!overlay) {
            return;
        }

        for (const row of overlay.querySelectorAll('.afilia-bta-row')) {
            const alarm = findAlarm(row.dataset.alarmKey);

            if (alarm) {
                updateRow(row, alarm);
            }
        }

        const count = overlay.querySelector('[data-role="count"]');

        if (count) {
            setTextIfChanged(count, formatCount());
        }
    }

    /* =========================================================
       Kurzmeldung
       ========================================================= */

    function showToast(title, subtitle, iconClass) {
        if (!api) {
            return;
        }

        let toast = document.getElementById(TOAST_ID);

        if (!toast) {
            toast = document.createElement('div');

            toast.id = TOAST_ID;

            toast.className = 'afilia-bta-toast';

            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');

            document.body.appendChild(toast);
        }

        toast.innerHTML = `
            <i class="${iconClass}"></i>

            <div class="afilia-bta-toast-text">
                <div class="afilia-bta-toast-title">${api.escapeHTML(title)}</div>

                ${
                    subtitle
                        ? `<div class="afilia-bta-toast-sub">${api.escapeHTML(subtitle)}</div>`
                        : ''
                }
            </div>
        `;

        if (toastTimer) {
            clearTimeout(toastTimer);
        }

        toast.classList.add('afilia-bta-toast-visible');

        toastTimer = setTimeout(() => {
            toastTimer = null;

            if (toast) {
                toast.classList.remove('afilia-bta-toast-visible');
            }
        }, 5000);
    }

    /* =========================================================
       Takt
       ========================================================= */

    function startTick() {
        stopTick();

        tickTimer = setInterval(() => {
            syncAlarms();
            tickWindow();
            updateButtons();
        }, TICK_INTERVAL);
    }

    function stopTick() {
        if (tickTimer) {
            clearInterval(tickTimer);

            tickTimer = null;
        }
    }

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
            .${TOOLBOX_BUTTON_CLASS} {
                border-color: rgba(245, 158, 11, 0.35);
            }

            .${TOOLBOX_BUTTON_CLASS} i {
                color: #fcd34d;
            }

            .${TOOLBOX_BUTTON_CLASS}.${CLASSES.active} {
                border-color: #f59e0b;
            }

            .${TOOLBOX_BUTTON_CLASS}.${CLASSES.done} i {
                color: #ef4444;
                animation: afilia-bta-pulse 1.4s ease-in-out infinite;
            }

            @keyframes afilia-bta-pulse {
                0%, 100% { opacity: 1; }

                50% { opacity: 0.35; }
            }

            .${CLASSES.button} {
                border-color: rgba(234, 88, 12, 0.45);
                background: rgba(255, 255, 255, 0.7);
                color: #c2410c;
            }

            .${CLASSES.button}:hover {
                border-color: #ea580c;
                background: #ffffff;
            }

            .${CLASSES.button}.${CLASSES.active} {
                border-color: #ea580c;
                background: #ea580c;
                color: #ffffff;
            }

            .${CLASSES.button}.${CLASSES.done} {
                border-color: #dc2626;
                background: #dc2626;
                color: #ffffff;
            }

            .${CLASSES.label} {
                font-variant-numeric: tabular-nums;
            }

            .afilia-bta-overlay {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                background: rgba(17, 24, 39, 0.45);
            }

            .afilia-bta-panel {
                display: flex;
                flex-direction: column;
                width: min(660px, 100%);
                max-height: 78vh;
                border: 1px solid #e5e7eb;
                border-radius: 14px;
                background: #ffffff;
                box-shadow: 0 20px 50px rgba(17, 24, 39, 0.35);
                overflow: hidden;
            }

            .afilia-bta-header {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 16px;
                padding: 16px 18px;
                border-bottom: 1px solid #e5e7eb;
            }

            .afilia-bta-title {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 17px;
                font-weight: 800;
                color: #111827;
            }

            .afilia-bta-beta {
                padding: 2px 7px;
                border-radius: 999px;
                background: #fef3c7;
                color: #b45309;
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.04em;
            }

            .afilia-bta-subtitle {
                margin-top: 3px;
                font-size: 12px;
                color: #6b7280;
            }

            .afilia-bta-close {
                flex-shrink: 0;
                width: 30px;
                height: 30px;
                border: 0;
                border-radius: 8px;
                background: transparent;
                color: #6b7280;
                font-size: 22px;
                line-height: 1;
                cursor: pointer;
            }

            .afilia-bta-close:hover {
                background: #f3f4f6;
                color: #111827;
            }

            .afilia-bta-controls {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 14px;
                padding: 12px 18px;
                border-bottom: 1px solid #f3f4f6;
                background: #f9fafb;
            }

            .afilia-bta-field {
                display: flex;
                align-items: center;
                gap: 7px;
                font-size: 12px;
                font-weight: 600;
                color: #374151;
            }

            .afilia-bta-field-check {
                cursor: pointer;
            }

            .afilia-bta-field select,
            .afilia-bta-row-actions select {
                padding: 5px 8px;
                border: 1px solid #d1d5db;
                border-radius: 8px;
                background: #ffffff;
                color: #111827;
                font-size: 12px;
                font-weight: 600;
            }

            .afilia-bta-danger {
                margin-left: auto;
                padding: 6px 10px;
                border: 1px solid #fecaca;
                border-radius: 8px;
                background: #fef2f2;
                color: #b91c1c;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
            }

            .afilia-bta-danger:hover {
                border-color: #ef4444;
            }

            .afilia-bta-body {
                flex: 1;
                min-height: 120px;
                overflow-y: auto;
            }

            .afilia-bta-row {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 6px 14px;
                padding: 12px 18px;
            }

            .afilia-bta-row + .afilia-bta-row {
                border-top: 1px solid #f3f4f6;
            }

            .afilia-bta-row-fired {
                background: #fef2f2;
            }

            .afilia-bta-row-head {
                display: flex;
                flex: 1;
                min-width: 0;
                flex-direction: column;
                gap: 1px;
            }

            .afilia-bta-row-station {
                font-size: 14px;
                font-weight: 700;
                color: #111827;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .afilia-bta-row-extension {
                font-size: 12px;
                color: #6b7280;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .afilia-bta-row-time {
                font-size: 20px;
                font-weight: 800;
                color: #ea580c;
                font-variant-numeric: tabular-nums;
            }

            .afilia-bta-row-fired .afilia-bta-row-time {
                color: #dc2626;
            }

            .afilia-bta-row-sub {
                flex-basis: 100%;
                font-size: 11px;
                color: #6b7280;
            }

            .afilia-bta-row-actions {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .afilia-bta-remove {
                width: 26px;
                height: 26px;
                border: 1px solid #fecaca;
                border-radius: 8px;
                background: #ffffff;
                color: #b91c1c;
                font-size: 16px;
                line-height: 1;
                cursor: pointer;
            }

            .afilia-bta-remove:hover {
                border-color: #ef4444;
            }

            .afilia-bta-empty {
                padding: 34px 18px;
                text-align: center;
                color: #6b7280;
            }

            .afilia-bta-empty i {
                font-size: 22px;
                color: #d1d5db;
            }

            .afilia-bta-empty p {
                margin: 8px 0 0;
                font-size: 13px;
                font-weight: 600;
                color: #374151;
            }

            .afilia-bta-empty-hint {
                font-weight: 400 !important;
                color: #9ca3af !important;
                line-height: 1.5;
            }

            .afilia-bta-footer {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 11px 18px;
                border-top: 1px solid #e5e7eb;
                background: #f9fafb;
                font-size: 11px;
                color: #6b7280;
            }

            .afilia-bta-toast {
                position: fixed;
                top: 16px;
                right: 16px;
                z-index: 99999;
                display: flex;
                align-items: center;
                gap: 12px;
                max-width: min(420px, calc(100vw - 32px));
                padding: 12px 14px;
                border: 1px solid #fde68a;
                border-radius: 10px;
                background: #fffbeb;
                box-shadow: 0 8px 24px rgba(17, 24, 39, 0.16);
                color: #92400e;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.2s ease;
            }

            .afilia-bta-toast i {
                font-size: 17px;
                color: #f59e0b;
            }

            .afilia-bta-toast-visible {
                opacity: 1;
            }

            .afilia-bta-toast-title {
                font-size: 13px;
                font-weight: 700;
            }

            .afilia-bta-toast-sub {
                font-size: 12px;
                color: #b45309;
            }
        `;

        document.head.appendChild(style);
    }

    /* =========================================================
       Applet lifecycle
       ========================================================= */

    async function init(context) {
        api = context;

        await loadState();

        injectStyles();

        createAudio();

        hookBars(true);
        hookToolboxButton();

        startTick();

        scheduleRepeat();
    }

    function onScan() {
        hookBars();
        hookToolboxButton();
    }

    function dispose() {
        stopTick();
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
            .querySelectorAll(`.${CLASSES.button}`)
            .forEach(button => button.remove());

        document
            .querySelectorAll(`.${TOOLBOX_BUTTON_CLASS}`)
            .forEach(button => button.remove());

        document.getElementById(PANEL_ID)?.remove();
        document.getElementById(TOAST_ID)?.remove();
        document.getElementById(STYLES_ID)?.remove();

        if (toastTimer) {
            clearTimeout(toastTimer);

            toastTimer = null;
        }

        alarms = [];
        barButtons = new Map();
        isBlocked = false;
        audioEnabled = true;
        defaultLeadMs = DEFAULT_LEAD_MS;
        lastButtonSlot = null;
        lastDomScan = 0;
        lastDomSignature = '';
        api = null;
    }

    /* Diagnosehilfe fuer die Beta-Phase. In der Konsole
       aufrufbar, solange eine Erweiterung gebaut wird. */

    function probe() {
        const station = findStationContext();

        const rows = findBuildtimeAnchors().map(anchor => {
            const info = readOverlay(anchor);

            if (!info) {
                return { error: 'Overlay oder Restzeit nicht lesbar' };
            }

            return {
                station: station ? station.name : '(kein Sheet gefunden)',
                supportId: station ? station.supportId : '',
                extension: info.extension,
                remaining: formatDuration(info.remaining),
                overlayFound: true,
                insertHost: findInsertHost(info.overlay)
                    ? 'ja'
                    : 'nein'
            };
        });

        console.table(rows);

        if (rows.length === 0) {
            console.warn(
                '[Afilia Toolbox] Kein Baubalken gefunden. Erwartet wird der Text "%s" im geoeffneten Stationsfenster, Tab „Erweiterungen".',
                SELECTORS.buildtimeLabel
            );
        }

        return rows;
    }

    window.__AFILIA_BUILDTIME_PROBE__ = probe;

    window.__AFILIA_APPLET_QUEUE__ =
        window.__AFILIA_APPLET_QUEUE__ || [];

    window.__AFILIA_APPLET_QUEUE__.push({
        id: 'buildtimeAlarm',
        name: 'Bauzeit-Alarm',
        description:
            'Setzt einen Alarm für die Restzeit einer Stationserweiterung. Im Baubalken erscheint eine Schaltfläche, die Übersicht zeigt Wache, Erweiterung und verbleibende Bauzeit. Liest nur das Spielbild, ruft keine API. (Beta – erst nach Feedback freischalten.)',
        version: '1.0.0',
        beta: true,
        defaultEnabled: false,
        init,
        onScan,
        dispose
    });
})();