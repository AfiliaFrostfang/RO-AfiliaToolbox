/* =========================================================
   Afilia Toolbox – Applet: Tab Alarm
   Wird durch das Manifest vom Kernskript geladen und registriert
   sich selbst in der globalen Applet-Warteschlange.
   ========================================================= */

(function () {
    'use strict';

    const HOTKEY_STORE_KEY = 'alarmHotkey';
    const BUTTON_CLASS = 'afilia-alarm-hotkey-button';
    const PANEL_ID = 'afilia-alarm-hotkey-panel';
    const STYLES_ID = 'afilia-applet-alarm-hotkey-styles';

    /* Der Standard entspricht dem Original aus der Alex-Fassung:
       STRG gedrückt halten und wieder loslassen, solange dabei
       keine andere Taste gedrückt wurde. */

    const DEFAULT_HOTKEY = {
        key: 'control',
        ctrl: false,
        shift: false,
        alt: false,
        meta: false
    };

    const MODIFIER_KEYS = ['control', 'shift', 'alt', 'meta'];

    const KEY_LABELS = {
        control: 'STRG',
        shift: 'Umschalt',
        alt: 'ALT',
        meta: 'Meta',
        ' ': 'Leertaste',
        spacebar: 'Leertaste',
        escape: 'ESC',
        enter: 'Enter',
        tab: 'Tab',
        backspace: 'Rücktaste',
        delete: 'Entf',
        insert: 'Einfg',
        home: 'Pos1',
        end: 'Ende',
        pageup: 'Bild auf',
        pagedown: 'Bild ab',
        arrowup: '↑',
        arrowdown: '↓',
        arrowleft: '←',
        arrowright: '→',
        capslock: 'Feststelltaste',
        contextmenu: 'Menütaste',
        '+': 'Plus'
    };

    let api = null;
    let hotkey = { ...DEFAULT_HOTKEY };

    /* Zustand für reine Modifikatortasten (gedrückt halten und
       wieder loslassen – das Verhalten des Originals). */

    let hotkeyHeld = false;
    let hotkeyUsedOtherKey = false;

    /* Aufnahme-Modus: solange werden alle Tasten abgefangen und
       in die gewünschte Tastenkombination übersetzt. */

    let isRecording = false;
    let recordingModifiers = new Set();

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
            .afilia-alarm-hotkey-panel {
                position: fixed;
                top: 15%;
                right: 64px;
                z-index: 99998;
                width: min(330px, calc(100vw - 88px));
                display: flex;
                flex-direction: column;
                gap: 10px;
                padding: 12px;
                border: 1px solid #3f3f46;
                border-radius: 12px;
                background: #18181b;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
            }

            .afilia-alarm-hotkey-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
            }

            .afilia-alarm-hotkey-title {
                font-size: 14px;
                font-weight: 700;
                color: #f4f4f5;
            }

            .afilia-alarm-hotkey-close {
                width: 28px;
                height: 28px;
                border: 0;
                border-radius: 7px;
                background: transparent;
                color: #a1a1aa;
                cursor: pointer;
                font-size: 18px;
                line-height: 1;
            }

            .afilia-alarm-hotkey-close:hover {
                background: #3f3f46;
                color: #f4f4f5;
            }

            .afilia-alarm-hotkey-current {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                padding: 8px 10px;
                border: 1px solid #3f3f46;
                border-radius: 8px;
                background: #27272a;
            }

            .afilia-alarm-hotkey-label {
                font-size: 12px;
                color: #a1a1aa;
            }

            .afilia-alarm-hotkey-key {
                padding: 3px 8px;
                border: 1px solid #52525b;
                border-bottom-width: 2px;
                border-radius: 6px;
                background: #18181b;
                color: #f4f4f5;
                font-family: inherit;
                font-size: 12px;
                font-weight: 700;
                white-space: nowrap;
            }

            .afilia-alarm-hotkey-actions {
                display: flex;
                gap: 8px;
            }

            .afilia-alarm-hotkey-record,
            .afilia-alarm-hotkey-reset {
                flex: 1;
                padding: 7px 10px;
                border: 1px solid #3f3f46;
                border-radius: 8px;
                background: #27272a;
                color: #f4f4f5;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: border-color 0.2s ease, background 0.2s ease;
            }

            .afilia-alarm-hotkey-record:hover,
            .afilia-alarm-hotkey-reset:hover {
                border-color: #52525b;
                background: #3f3f46;
            }

            .afilia-alarm-hotkey-record-active {
                border-color: #ef4444;
                background: rgba(239, 68, 68, 0.15);
                color: #fca5a5;
                animation: afilia-alarm-hotkey-pulse 1.2s ease-in-out infinite;
            }

            @keyframes afilia-alarm-hotkey-pulse {
                0%, 100% {
                    opacity: 1;
                }

                50% {
                    opacity: 0.6;
                }
            }

            .afilia-alarm-hotkey-hint {
                margin: 0;
                font-size: 11px;
                line-height: 1.5;
                color: #a1a1aa;
            }

            .afilia-alarm-hotkey-hint-secondary {
                color: #71717a;
            }
        `;

        document.head.appendChild(style);
    }

    /* =========================================================
       Alarmierungsfenster
       ========================================================= */

    function findDispatchDialog() {
        const dialogs = Array.from(
            document.querySelectorAll(
                '[role="dialog"][data-slot="sheet-content"]'
            )
        );

        return dialogs.find(dialog => {
            const search = dialog.querySelector(
                'input[placeholder="AAO suchen..."], input[placeholder="Suchen..."]'
            );

            if (!search) {
                return false;
            }

            return Array.from(
                dialog.querySelectorAll('h2')
            ).some(h2 => {
                return h2.textContent.trim() ===
                    'Fahrzeuge alarmieren';
            });
        }) || null;
    }

    function findAlarmButton(dialog) {
        if (!dialog) {
            return null;
        }

        const buttons = Array.from(
            dialog.querySelectorAll('button')
        );

        /* -----------------------------------------------------
           Bevorzugt den Knopf mit dem Glocken-Symbol
           ----------------------------------------------------- */

        const bellButton = buttons.find(button => {
            const text =
                (button.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim();

            const bell = button.querySelector(
                'svg.lucide-bell, svg[class*="lucide-bell"]'
            );

            return (
                bell &&
                /^Alarmieren(?:\s*\(\d+\))?$/.test(text)
            );
        });

        if (bellButton) {
            return bellButton;
        }

        /* -----------------------------------------------------
           Fallback: nur nach Text suchen
           ----------------------------------------------------- */

        return buttons.find(button => {
            const text =
                (button.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim();

            return /^Alarmieren(?:\s*\(\d+\))?$/.test(text);
        }) || null;
    }

    function triggerAlarmButton() {
        const dialog = findDispatchDialog();

        if (!dialog) {
            return false;
        }

        const button = findAlarmButton(dialog);

        if (!button) {
            return false;
        }

        if (button.disabled) {
            return false;
        }

        button.click();

        return true;
    }

    /* =========================================================
       Tastenkombination
       ========================================================= */

    function normalizeKeyName(key) {
        return String(key || '').toLowerCase();
    }

    function isModifierKey(key) {
        return MODIFIER_KEYS.includes(key);
    }

    /* Beim Speichern bereinigt: eine reine Modifikatortaste darf
       nie zu einer Kombination werden – sonst würde STRG allein
       schon beim Tastendruck alarmieren, statt erst beim Loslassen. */

    function sanitizeHotkey(spec) {
        const key = normalizeKeyName(spec && spec.key);
        const isModifier = isModifierKey(key);

        return {
            key,
            ctrl: isModifier ? false : !!(spec && spec.ctrl),
            shift: isModifier ? false : !!(spec && spec.shift),
            alt: isModifier ? false : !!(spec && spec.alt),
            meta: isModifier ? false : !!(spec && spec.meta)
        };
    }

    function isValidHotkey(spec) {
        return (
            !!spec &&
            typeof spec === 'object' &&
            normalizeKeyName(spec.key) !== ''
        );
    }

    function isModifierOnly(spec) {
        return (
            isModifierKey(spec.key) &&
            !spec.ctrl &&
            !spec.shift &&
            !spec.alt &&
            !spec.meta
        );
    }

    function matchesHotkey(event) {
        return (
            normalizeKeyName(event.key) === hotkey.key &&
            !!event.ctrlKey === !!hotkey.ctrl &&
            !!event.shiftKey === !!hotkey.shift &&
            !!event.altKey === !!hotkey.alt &&
            !!event.metaKey === !!hotkey.meta
        );
    }

    /* Eine einfache Buchstaben-/Zahlentaste ohne Modifikatoren
       darf nicht feuern, während getippt wird – sonst würde die
       Alarmierung mitten in einer Nachricht losgehen. */

    function isPlainTypingKey(spec) {
        return (
            spec.key.length === 1 &&
            !spec.ctrl &&
            !spec.alt &&
            !spec.meta
        );
    }

    function isEditableTarget(target) {
        if (!target || typeof target.closest !== 'function') {
            return false;
        }

        return !!(
            target.closest('input, textarea, select') ||
            target.closest(
                '[contenteditable="true"], [contenteditable=""]'
            )
        );
    }

    function formatKeyLabel(key) {
        if (KEY_LABELS[key]) {
            return KEY_LABELS[key];
        }

        if (/^f\d{1,2}$/.test(key)) {
            return key.toUpperCase();
        }

        if (key.length === 1) {
            return key.toUpperCase();
        }

        return key.charAt(0).toUpperCase() + key.slice(1);
    }

    function formatHotkey(spec) {
        const parts = [];

        if (spec.ctrl) {
            parts.push('STRG');
        }

        if (spec.shift) {
            parts.push('Umschalt');
        }

        if (spec.alt) {
            parts.push('ALT');
        }

        if (spec.meta) {
            parts.push('Meta');
        }

        parts.push(formatKeyLabel(spec.key));

        return parts.join(' + ');
    }

    /* =========================================================
       Speicherung
       ========================================================= */

    async function loadHotkey() {
        try {
            const stored = await api.dbGet(HOTKEY_STORE_KEY);

            if (isValidHotkey(stored)) {
                hotkey = sanitizeHotkey(stored);

                return;
            }
        } catch (error) {
            console.warn(
                '[Afilia Toolbox] Schnellalarm-Taste nicht lesbar:',
                error
            );
        }

        hotkey = sanitizeHotkey(DEFAULT_HOTKEY);
    }

    async function saveHotkey() {
        try {
            await api.dbSet(HOTKEY_STORE_KEY, hotkey);
        } catch (error) {
            console.warn(
                '[Afilia Toolbox] Schnellalarm-Taste nicht gespeichert:',
                error
            );
        }
    }

    /* =========================================================
       Tastenverarbeitung
       ========================================================= */

    function applyHotkey(spec) {
        hotkey = sanitizeHotkey(spec);

        isRecording = false;
        recordingModifiers.clear();

        hotkeyHeld = false;
        hotkeyUsedOtherKey = false;

        updatePanelDisplay();
        updateButtonTitle();

        saveHotkey();
    }

    function handleKeydown(event) {
        if (isRecording) {
            handleRecordingKeydown(event);

            return;
        }

        const key = normalizeKeyName(event.key);

        /* -----------------------------------------------------
           Reine Modifikatortaste als Hotkey: gedrückt halten und
           wieder loslassen (Originalverhalten)
           ----------------------------------------------------- */

        if (isModifierOnly(hotkey)) {
            if (key === hotkey.key) {
                if (!event.repeat) {
                    hotkeyHeld = true;
                    hotkeyUsedOtherKey = false;
                }
            } else if (hotkeyHeld) {
                /* Eine weitere Taste wurde gedrückt, solange die
                   Hotkey-Taste gehalten wird. STRG+C, STRG+V usw.
                   lösen deshalb keinen Alarm aus. */

                hotkeyUsedOtherKey = true;
            }

            return;
        }

        /* -----------------------------------------------------
           Kombination oder eigene Taste: sofort auslösen
           ----------------------------------------------------- */

        if (event.repeat || !matchesHotkey(event)) {
            return;
        }

        if (
            isPlainTypingKey(hotkey) &&
            isEditableTarget(event.target)
        ) {
            return;
        }

        triggerAlarmButton();
    }

    function handleKeyup(event) {
        if (isRecording) {
            handleRecordingKeyup(event);

            return;
        }

        if (!isModifierOnly(hotkey)) {
            return;
        }

        if (normalizeKeyName(event.key) !== hotkey.key) {
            return;
        }

        if (hotkeyHeld && !hotkeyUsedOtherKey) {
            triggerAlarmButton();
        }

        hotkeyHeld = false;
        hotkeyUsedOtherKey = false;
    }

    function handleBlur() {
        hotkeyHeld = false;
        hotkeyUsedOtherKey = false;

        /* Ein Fensterwechsel würde die Aufnahme mit verwaisten
           Tastenzuständen zurücklassen – lieber abbrechen. */

        if (isRecording) {
            stopRecording();
        }
    }

    /* =========================================================
       Aufnahme der eigenen Taste
       ========================================================= */

    function startRecording() {
        isRecording = true;
        recordingModifiers = new Set();

        hotkeyHeld = false;
        hotkeyUsedOtherKey = false;

        updatePanelDisplay();
    }

    function stopRecording() {
        if (!isRecording) {
            return;
        }

        isRecording = false;
        recordingModifiers.clear();

        updatePanelDisplay();
    }

    function handleRecordingKeydown(event) {
        /* Während der Aufnahme gehen die Tasten weder ans Spiel
           noch an den Browser – F5 & Co. sollen nicht aus Versehen
           ausgelöst werden. */

        event.preventDefault();
        event.stopPropagation();

        if (event.repeat) {
            return;
        }

        const key = normalizeKeyName(event.key);

        if (key === 'escape') {
            stopRecording();

            return;
        }

        if (isModifierKey(key)) {
            /* Erst merken – ob es allein bleibt, entscheidet der
               Tastenloslass. */

            recordingModifiers.add(key);

            return;
        }

        applyHotkey({
            key,
            ctrl: event.ctrlKey,
            shift: event.shiftKey,
            alt: event.altKey,
            meta: event.metaKey
        });
    }

    function handleRecordingKeyup(event) {
        event.preventDefault();
        event.stopPropagation();

        const key = normalizeKeyName(event.key);

        if (!isModifierKey(key)) {
            return;
        }

        const wasSeenDown = recordingModifiers.has(key);

        recordingModifiers.delete(key);

        /* Wurde nur eine Modifikatortaste gedrückt und wieder
           losgelassen (z. B. STRG), wird genau diese Taste als
           Hotkey übernommen – so wie im Original. */

        if (!wasSeenDown || recordingModifiers.size > 0) {
            return;
        }

        applyHotkey({
            key,
            ctrl: false,
            shift: false,
            alt: false,
            meta: false
        });
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
            '<i class="fa-solid fa-keyboard text-sm sm:text-sm text-white/80"></i>';

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            togglePanel();
        });

        return button;
    }

    function updateButtonTitle() {
        const title =
            `Schnellalarm – aktuelle Taste: ${formatHotkey(hotkey)}. ` +
            'Klicken, um die Taste zu ändern.';

        document.querySelectorAll(`.${BUTTON_CLASS}`)
            .forEach(button => {
                button.setAttribute('title', title);
            });
    }

    function updateButtonState() {
        const isOpen = !!document.getElementById(PANEL_ID);

        document.querySelectorAll(`.${BUTTON_CLASS}`)
            .forEach(button => {
                button.setAttribute(
                    'aria-pressed',
                    isOpen ? 'true' : 'false'
                );
            });
    }

    function hookButton() {
        const slot = findButtonSlot();

        if (!slot) {
            lastButtonSlot = null;

            return;
        }

        const existing = slot.querySelector(`.${BUTTON_CLASS}`);

        if (
            slot === lastButtonSlot &&
            existing
        ) {
            updateButtonTitle();

            return;
        }

        lastButtonSlot = slot;

        if (existing) {
            existing.remove();
        }

        api.mountAppletButton(createButton());

        updateButtonTitle();
    }

    function updatePanelDisplay() {
        const panel = document.getElementById(PANEL_ID);

        if (!panel) {
            return;
        }

        const current = panel.querySelector('[data-role="current"]');

        if (current) {
            current.textContent = isRecording
                ? '…'
                : formatHotkey(hotkey);
        }

        const record = panel.querySelector('[data-role="record"]');

        if (record) {
            record.textContent = isRecording
                ? 'Aufnahme abbrechen'
                : 'Taste aufnehmen';

            record.classList.toggle(
                'afilia-alarm-hotkey-record-active',
                isRecording
            );
        }
    }

    function openPanel() {
        if (document.getElementById(PANEL_ID)) {
            return;
        }

        const panel = document.createElement('div');

        panel.id = PANEL_ID;
        panel.className = 'afilia-alarm-hotkey-panel';

        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Schnellalarm');

        panel.innerHTML = `
            <div class="afilia-alarm-hotkey-header">
                <span class="afilia-alarm-hotkey-title">
                    Schnellalarm
                </span>

                <button
                    type="button"
                    class="afilia-alarm-hotkey-close"
                    title="Schließen"
                    aria-label="Schließen"
                >×</button>
            </div>

            <div class="afilia-alarm-hotkey-current">
                <span class="afilia-alarm-hotkey-label">
                    Aktuelle Taste
                </span>

                <kbd class="afilia-alarm-hotkey-key" data-role="current"></kbd>
            </div>

            <div class="afilia-alarm-hotkey-actions">
                <button
                    type="button"
                    class="afilia-alarm-hotkey-record"
                    data-role="record"
                >Taste aufnehmen</button>

                <button
                    type="button"
                    class="afilia-alarm-hotkey-reset"
                    data-role="reset"
                >Zurücksetzen</button>
            </div>

            <p class="afilia-alarm-hotkey-hint">
                Die Taste alarmiert die ausgewählten Fahrzeuge,
                sobald das Fenster „Fahrzeuge alarmieren“ offen ist.
                Für eine Kombination (z. B. STRG + K) die
                Modifikatortasten halten und dabei eine zweite
                Taste drücken.
            </p>

            <p class="afilia-alarm-hotkey-hint afilia-alarm-hotkey-hint-secondary">
                Während der Aufnahme blockiert ESC die Aufnahme.
                Browser-Kürzel wie STRG + W oder STRG + T lassen
                sich nicht abfangen.
            </p>
        `;

        panel.querySelector('.afilia-alarm-hotkey-close')
            .addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();

                closePanel();
            });

        panel.querySelector('[data-role="record"]')
            .addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();

                if (isRecording) {
                    stopRecording();
                } else {
                    startRecording();
                }
            });

        panel.querySelector('[data-role="reset"]')
            .addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();

                applyHotkey(DEFAULT_HOTKEY);
            });

        panel.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !isRecording) {
                event.preventDefault();

                closePanel();
            }
        });

        document.body.appendChild(panel);

        updatePanelDisplay();
        updateButtonState();
    }

    function closePanel() {
        const panel = document.getElementById(PANEL_ID);

        if (panel) {
            panel.remove();
        }

        if (isRecording) {
            isRecording = false;
            recordingModifiers.clear();
        }

        updateButtonState();
    }

    function togglePanel() {
        if (document.getElementById(PANEL_ID)) {
            closePanel();
        } else {
            openPanel();
        }
    }

    /* =========================================================
       Applet lifecycle
       ========================================================= */

    async function init(context) {
        api = context;

        await loadHotkey();

        injectStyles();

        document.addEventListener('keydown', handleKeydown, true);
        document.addEventListener('keyup', handleKeyup, true);
        window.addEventListener('blur', handleBlur);

        hookButton();
        updateButtonState();
    }

    function onScan() {
        hookButton();
    }

    function dispose() {
        document.removeEventListener('keydown', handleKeydown, true);
        document.removeEventListener('keyup', handleKeyup, true);
        window.removeEventListener('blur', handleBlur);

        closePanel();

        document
            .querySelectorAll(`.${BUTTON_CLASS}`)
            .forEach(button => button.remove());

        document.getElementById(STYLES_ID)?.remove();

        hotkey = { ...DEFAULT_HOTKEY };
        hotkeyHeld = false;
        hotkeyUsedOtherKey = false;
        isRecording = false;
        recordingModifiers = new Set();
        lastButtonSlot = null;
        api = null;
    }

    window.__AFILIA_APPLET_QUEUE__ =
        window.__AFILIA_APPLET_QUEUE__ || [];

    window.__AFILIA_APPLET_QUEUE__.push({
        id: 'alarmHotkey',
        name: 'Tap Alarm',
        description:
            'Alarmiert die ausgewählten Fahrzeuge per frei wählbarer Taste – standardmäßig STRG. Die Taste lässt sich über das Tastatur-Icon ändern und wird lokal gespeichert.',
        version: '1.0.0',
        init,
        onScan,
        dispose
    });
})();
