/* =========================================================
   Afilia Toolbox – Applet: Notizblock
   Wird als @require vom Kernskript geladen und registriert
   sich selbst in der globalen Applet-Warteschlange.
   ========================================================= */

(function () {
    'use strict';

    const NOTEPAD_BUTTON_CLASS = 'afilia-notepad-button';
    const NOTEPAD_PANEL_ID = 'afilia-notepad-panel';
    const NOTEPAD_TEXTAREA_CLASS = 'afilia-notepad-textarea';
    const NOTEPAD_STORE_KEY = 'notepad';
    const NOTEPAD_SAVE_DELAY = 400;
    const STYLES_ID = 'afilia-applet-notepad-styles';

    let api = null;

    let notepadText = '';
    let notepadSaveTimer = null;
    let lastNotepadContainer = null;

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
            .afilia-notepad-panel {
                position: fixed;
                top: 15%;
                right: 64px;
                z-index: 99998;
                width: min(340px, calc(100vw - 88px));
                max-height: calc(85vh - 15%);
                display: flex;
                flex-direction: column;
                border: 1px solid #3f3f46;
                border-radius: 12px;
                background: #18181b;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
                overflow: hidden;
            }

            .afilia-notepad-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                padding: 10px 12px;
                background: #27272a;
                border-bottom: 1px solid #3f3f46;
            }

            .afilia-notepad-title {
                font-size: 14px;
                font-weight: 700;
                color: #f4f4f5;
            }

            .afilia-notepad-close {
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

            .afilia-notepad-close:hover {
                background: #3f3f46;
                color: #f4f4f5;
            }

            .afilia-notepad-textarea {
                flex: 1;
                min-height: 180px;
                padding: 12px;
                border: 0;
                background: transparent;
                color: #f4f4f5;
                font-size: 13px;
                line-height: 1.5;
                resize: none;
                outline: none;
            }

            .afilia-notepad-textarea::placeholder {
                color: #71717a;
            }
        `;

        document.head.appendChild(style);
    }

    /* =========================================================
       UI
       ========================================================= */

    function findNotepadContainer() {
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

    function createNotepadButton() {
        const button = document.createElement('button');

        button.type = 'button';

        button.className =
            `${NOTEPAD_BUTTON_CLASS} w-10 h-10 sm:w-10 sm:h-10 bg-dark rounded-lg shadow-lg border border-gray-800/80 hover:border-gray-700 transition-all duration-300 flex items-center justify-center cursor-pointer`;

        button.setAttribute('aria-pressed', 'false');

        button.title = 'Notizblock öffnen/schließen';

        button.innerHTML =
            '<i class="fa-solid fa-note-sticky text-sm sm:text-sm text-white/80"></i>';

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            toggleNotepadPanel();
        });

        return button;
    }

    function hookNotepadButton() {
        const container = findNotepadContainer();

        if (!container) {
            lastNotepadContainer = null;
            return;
        }

        const button = container.querySelector(
            `.${NOTEPAD_BUTTON_CLASS}`
        );

        if (
            container === lastNotepadContainer &&
            button
        ) {
            return;
        }

        lastNotepadContainer = container;

        if (button) {
            button.remove();
        }

        const newButton = createNotepadButton();

        const spacer = container.querySelector(
            ':scope > div.h-20'
        );

        if (spacer) {
            spacer.after(newButton);
        } else {
            container.insertBefore(
                newButton,
                container.firstChild
            );
        }
    }

    function openNotepadPanel() {
        if (document.getElementById(NOTEPAD_PANEL_ID)) {
            return;
        }

        const panel = document.createElement('div');

        panel.id = NOTEPAD_PANEL_ID;
        panel.className = 'afilia-notepad-panel';

        panel.innerHTML = `
            <div class="afilia-notepad-header">
                <span class="afilia-notepad-title">
                    Notizblock
                </span>

                <button
                    type="button"
                    class="afilia-notepad-close"
                    title="Notizblock schließen"
                >
                    ×
                </button>
            </div>

            <textarea
                class="afilia-notepad-textarea"
                placeholder="Notizen eingeben …"
                spellcheck="false"
            ></textarea>
        `;

        const textarea = panel.querySelector(
            `.${NOTEPAD_TEXTAREA_CLASS}`
        );

        textarea.value = notepadText;

        panel.querySelector('.afilia-notepad-close')
            .addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();

                closeNotepadPanel();
            });

        textarea.addEventListener('input', () => {
            notepadText = textarea.value;

            scheduleSaveNotepad();
        });

        textarea.addEventListener('keydown', event => {
            event.stopPropagation();

            if (event.key === 'Escape') {
                event.preventDefault();
                closeNotepadPanel();
            }
        });

        document.body.appendChild(panel);

        updateNotepadButtonState();

        textarea.focus();
    }

    function closeNotepadPanel() {
        const panel = document.getElementById(NOTEPAD_PANEL_ID);

        if (panel) {
            panel.remove();
        }

        if (notepadSaveTimer) {
            clearTimeout(notepadSaveTimer);
            notepadSaveTimer = null;
        }

        saveNotepad();

        updateNotepadButtonState();
    }

    function toggleNotepadPanel() {
        const panel = document.getElementById(NOTEPAD_PANEL_ID);

        if (panel) {
            closeNotepadPanel();
        } else {
            openNotepadPanel();
        }
    }

    function updateNotepadButtonState() {
        const isOpen = !!document.getElementById(NOTEPAD_PANEL_ID);

        document.querySelectorAll(`.${NOTEPAD_BUTTON_CLASS}`)
            .forEach(button => {
                button.setAttribute(
                    'aria-pressed',
                    isOpen ? 'true' : 'false'
                );
            });
    }

    /* =========================================================
       Persistence
       ========================================================= */

    function scheduleSaveNotepad() {
        if (notepadSaveTimer) {
            clearTimeout(notepadSaveTimer);
        }

        notepadSaveTimer = setTimeout(() => {
            notepadSaveTimer = null;

            saveNotepad();
        }, NOTEPAD_SAVE_DELAY);
    }

    async function saveNotepad() {
        try {
            await api.dbSet(NOTEPAD_STORE_KEY, notepadText);
        } catch (error) {
            console.warn(
                '[Afilia Toolbox] Notepad save failed:',
                error
            );
        }
    }

    /* =========================================================
       Applet lifecycle
       ========================================================= */

    async function init(context) {
        api = context;

        notepadText =
            (await api.dbGet(NOTEPAD_STORE_KEY)) || '';

        injectStyles();
    }

    function onScan() {
        hookNotepadButton();
    }

    function dispose() {
        document
            .querySelectorAll(`.${NOTEPAD_BUTTON_CLASS}`)
            .forEach(button => button.remove());

        const panel = document.getElementById(NOTEPAD_PANEL_ID);

        if (panel) {
            panel.remove();
        }

        document.getElementById(STYLES_ID)?.remove();

        if (notepadSaveTimer) {
            clearTimeout(notepadSaveTimer);
            notepadSaveTimer = null;
        }

        notepadText = '';
        lastNotepadContainer = null;
        api = null;
    }

    window.__AFILIA_APPLET_QUEUE__ =
        window.__AFILIA_APPLET_QUEUE__ || [];

    window.__AFILIA_APPLET_QUEUE__.push({
        id: 'notepad',
        name: 'Notizblock',
        description:
            'Fügt einen Notizblock zu den Schnelltasten hinzu. Notizen werden automatisch lokal gespeichert.',
        version: '1.0.0',
        init,
        onScan,
        dispose
    });
})();