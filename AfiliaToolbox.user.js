// ==UserScript==
// @name         Afilia Toolbox
// @namespace    https://afiliafrostfang.de/
// @version      1.9.0
// @description  Afilia Toolbox for Rescue Operator with several Functions.
// @author       AfiliaFrostfang
// @match        https://game.rescue-operator.com/*
// @updateURL    https://afiliafrostfang.github.io/RO-AfiliaToolbox/AfiliaToolbox.user.js
// @downloadURL  https://afiliafrostfang.github.io/RO-AfiliaToolbox/AfiliaToolbox.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /* =========================================================
       Configuration
       ========================================================= */

    const DB_NAME = 'AfiliaToolboxDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'settings';
    const SCRIPT_NAME = 'Afilia Toolbox';
    const SCRIPT_VERSION = '1.9.0';
    const UPDATE_MANIFEST_URL =
        'https://afiliafrostfang.github.io/RO-AfiliaToolbox/version.json';
    const PROJECT_URL =
        'https://github.com/AfiliaFrostfang/RO-AfiliaToolbox';

    const SETTINGS_PANEL_ID = 'afilia-aao-category-panel';
    const DISPATCH_PANEL_ID = 'afilia-aao-dispatch-panel';
    const UPDATE_NOTICE_ID = 'afilia-aao-update-notice';
    const NOTEPAD_BUTTON_CLASS = 'afilia-notepad-button';
    const NOTEPAD_PANEL_ID = 'afilia-notepad-panel';
    const NOTEPAD_TEXTAREA_CLASS = 'afilia-notepad-textarea';
    const NOTEPAD_STORE_KEY = 'notepad';
    const NOTEPAD_SAVE_DELAY = 400;
    const CHANGELOG_STORE_KEY = 'lastSeenVersion';
    const CHANGELOG_POPUP_ID = 'afilia-changelog-popup';
    const UNCATEGORIZED_ORDER_KEY =
        'aaoUncategorizedOrder';

    const DEFAULT_CATEGORIES = [
        {
            id: 'fire',
            name: 'Brandbekämpfung',
            collapsed: false
        },
        {
            id: 'technical',
            name: 'Technische Hilfe',
            collapsed: false
        },
        {
            id: 'medical',
            name: 'Rettungsdienst',
            collapsed: false
        }
    ];

    const CHANGELOG = {
        '1.9.0': [
            'Entfernt: Die Funktionen „Fahrzeugliste“ (Kilometerstände) und „Bettenauslastung“, diese Funktionen bleiben deaktiviert bzw. entfernt bis zum Public API Release.'
        ],
        '1.8.3': [
            'Krankenhaus-Bettenauslastung: Bugfix – Die Anzeige wird jetzt automatisch alle 60 Sekunden aktualisiert, auch ohne das Stations-Panel zu öffnen. (Der Poll ruft jetzt die Stationsdaten statt der Sitzungsdaten ab.)'
        ],
        '1.8.2': [
            'AAO-Kategorien: AAOs lassen sich jetzt frei per Drag & Drop sortieren (an der Griffleiste „⋮⋮" ziehen), anstatt zwangsweise alphabetisch sortiert zu werden. Die Reihenfolge gilt auch in der Fahrzeug-Alarmierung und wird gespeichert.'
        ],
        '1.8.1': [
            'Krankenhaus-Bettenauslastung: Bugfix – Die Anzeige der Bettenauslastung wird jetzt korrekt aktualisiert, wenn sich die Bettenanzahl ändert. (Fetched alle 60sec die Daten neu.)'
        ],
        '1.8.0': [
            'Neue Anzeige „Bettenauslastung" in der Statusleiste oben rechts: zeigt belegte und maximale Betten aller Krankenhäuser sowie die Auslastung in Prozent.',
            'Die Auslastung wird automatisch aus den Spieldaten ausgelesen und pro Spiel lokal zwischengespeichert.'
        ],
        '1.7.5': [
            'Bugfix: Kilometerstände und Fahrzeugdaten werden jetzt getrennt pro Spiel gespeichert. Einträge aus anderen Spielen werden ignoriert und nicht mehr versucht abzurufen (Endete in einem Cacheloop mit Websocket Fehlern).'
        ],
        '1.7.4': [
            'Fahrzeugliste: Ein neuer Aktualisieren-Knopf lädt die Kilometerstände aller Fahrzeuge sofort neu.'
        ],
        '1.7.3': [
            'Fahrzeugliste: Fahrzeuge mit mehr als 30.000 gefahrenen Kilometern erhalten ein Warnsymbol neben dem Kilometerstand.',
            'Ein Klick auf das Warnsymbol öffnet einen Hinweis zur erhöhten Laufleistung und möglichen Reparaturkosten.'
        ],
        '1.7.2': [
            'Fahrzeugliste: Die Fortschrittsanzeige beim Laden der Kilometerstände verschwindet nach dem Laden automatisch.',
            'Fahrzeugliste: Kilometerstände werden robuster aus der API gelesen; fehlgeschlagene Abrufe werden angezeigt.'
        ],
        '1.7.0': [
            'Fahrzeugliste: Der gefahrene Kilometerstand wird automatisch für alle Fahrzeuge geladen und neben jedem Fahrzeug angezeigt.',
            'Neuer Schalter „Nach km sortieren" sortiert die Fahrzeugliste nach gefahrenen Kilometern (absteigend).',
            'Fahrzeugdaten werden lokal zwischengespeichert, damit nicht bei jedem Öffnen erneut alle Daten geladen werden.'
        ],
        '1.6.0': [
            'Neuer Notizblock in der rechten Leiste – Notizen werden automatisch lokal gespeichert.',
            'Nach einem Update erscheint dieses Popup mit den Neuerungen der neuen Version.'
        ]
    };

    /* =========================================================
       Runtime state
       ========================================================= */

    let db = null;

    let categories = [];
    let assignments = {};

    const aaoCatalog = new Map();
    const selectedAAOs = new Set();
    const originalAAORows = new Map();

    let observer = null;
    let scanTimer = null;

    let lastDispatchContainer = null;
    let lastSettingsContainer = null;

    let dispatchSearchValue = '';
    let draggedCategoryID = null;
    let draggedAAOKey = null;
    let uncategorizedAAOOrder = [];

    let notepadText = '';
    let notepadSaveTimer = null;
    let lastNotepadContainer = null;

    /* =========================================================
       IndexedDB
       ========================================================= */

    function openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = event => {
                const database = event.target.result;

                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME);
                }
            };

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    function dbGet(key) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
                STORE_NAME,
                'readonly'
            );

            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    function dbSet(key, value) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
                STORE_NAME,
                'readwrite'
            );

            const store = transaction.objectStore(STORE_NAME);

            store.put(value, key);

            transaction.oncomplete = () => {
                resolve();
            };

            transaction.onerror = () => {
                reject(transaction.error);
            };
        });
    }

    /* =========================================================
       Utility
       ========================================================= */

    function normalizeName(name) {
        return String(name || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
    }

    function getAAOKey(name) {
        return normalizeName(name);
    }

    function escapeHTML(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function createID(prefix = 'id') {
        return `${prefix}_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`;
    }

    function compareVersions(left, right) {
        const leftParts = String(left)
            .split('.')
            .map(part => Number.parseInt(part, 10) || 0);

        const rightParts = String(right)
            .split('.')
            .map(part => Number.parseInt(part, 10) || 0);

        const length = Math.max(
            leftParts.length,
            rightParts.length
        );

        for (let index = 0; index < length; index += 1) {
            const difference =
                (leftParts[index] || 0) -
                (rightParts[index] || 0);

            if (difference !== 0) {
                return difference;
            }
        }

        return 0;
    }

    function isHTTPURL(value) {
        try {
            const url = new URL(value);

            return url.protocol === 'http:' ||
                url.protocol === 'https:';
        } catch {
            return false;
        }
    }

    function showUpdateNotice(manifest) {
        if (
            document.getElementById(
                UPDATE_NOTICE_ID
            )
        ) {
            return;
        }

        const version =
            String(manifest.version).trim();

        const releaseURL =
            isHTTPURL(manifest.url)
                ? manifest.url
                : PROJECT_URL;

        const notice =
            document.createElement('div');

        notice.id = UPDATE_NOTICE_ID;
        notice.className = 'afilia-update-notice';

        notice.innerHTML = `
            <div class="afilia-update-notice-content">
                <strong>Update verfügbar</strong>
                <span>
                    ${escapeHTML(SCRIPT_NAME)} ${escapeHTML(version)} ist verfügbar.
                </span>
            </div>

            <a
                class="afilia-update-notice-link"
                href="${escapeHTML(releaseURL)}"
                target="_blank"
                rel="noopener noreferrer"
            >
                Update öffnen
            </a>

            <button
                type="button"
                class="afilia-update-notice-close"
                title="Update-Hinweis schließen"
            >
                ×
            </button>
        `;

        notice.querySelector(
            '.afilia-update-notice-close'
        ).addEventListener(
            'click',
            () => notice.remove()
        );

        document.body.appendChild(notice);
    }

    async function checkForUpdates() {
        try {
            const response = await fetch(
                UPDATE_MANIFEST_URL,
                {
                    cache: 'no-store'
                }
            );

            if (!response.ok) {
                return;
            }

            const manifest = await response.json();

            if (
                !manifest ||
                typeof manifest.version !== 'string' ||
                compareVersions(
                    manifest.version,
                    SCRIPT_VERSION
                ) <= 0
            ) {
                return;
            }

            showUpdateNotice(manifest);
        } catch (error) {
            console.debug(
                '[Afilia Toolbox] Update check skipped:',
                error
            );
        }
    }

    /* =========================================================
       Changelog
       ========================================================= */

    async function showChangelogPopup() {
        const lastSeenVersion =
            (await dbGet(
                CHANGELOG_STORE_KEY
            )) || '';

        if (
            compareVersions(
                SCRIPT_VERSION,
                lastSeenVersion
            ) <= 0
        ) {
            return;
        }

        const entries = Object.keys(
            CHANGELOG
        )
            .filter(version => {
                return (
                    compareVersions(
                        version,
                        lastSeenVersion
                    ) > 0 &&
                    Array.isArray(
                        CHANGELOG[version]
                    )
                );
            })
            .sort((left, right) => {
                return compareVersions(
                    right,
                    left
                );
            })
            .map(version => ({
                version,
                notes: CHANGELOG[version]
            }));

        if (entries.length === 0) {
            return;
        }

        renderChangelogPopup(entries);

        await dbSet(
            CHANGELOG_STORE_KEY,
            SCRIPT_VERSION
        );
    }

    function renderChangelogPopup(entries) {
        if (
            document.getElementById(
                CHANGELOG_POPUP_ID
            )
        ) {
            return;
        }

        const overlay =
            document.createElement('div');

        overlay.id = CHANGELOG_POPUP_ID;
        overlay.className =
            'afilia-changelog-overlay';

        overlay.innerHTML = `
            <div class="afilia-changelog-popup">
                <div class="afilia-changelog-popup-header">
                    <div class="afilia-changelog-popup-title">
                        Update installiert – Was ist neu?
                    </div>

                    <button
                        type="button"
                        class="afilia-changelog-popup-close"
                        title="Schließen"
                    >
                        ×
                    </button>
                </div>

                <div class="afilia-changelog-popup-body">
                    ${entries.map(entry => `
                        <div class="afilia-changelog-version">
                            <div class="afilia-changelog-version-title">
                                Version ${escapeHTML(entry.version)}
                            </div>

                            <ul class="afilia-changelog-list">
                                ${entry.notes.map(note => `
                                    <li>${escapeHTML(note)}</li>
                                `).join('')}
                            </ul>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        let keydownHandler = null;

        const close = () => {
            overlay.remove();

            if (keydownHandler) {
                document.removeEventListener(
                    'keydown',
                    keydownHandler
                );
            }
        };

        overlay
            .querySelector(
                '.afilia-changelog-popup-close'
            )
            .addEventListener(
                'click',
                event => {
                    event.preventDefault();
                    event.stopPropagation();

                    close();
                }
            );

        overlay.addEventListener(
            'click',
            event => {
                if (
                    event.target ===
                    overlay
                ) {
                    close();
                }
            }
        );

        keydownHandler = event => {
            if (
                event.key === 'Escape'
            ) {
                close();
            }
        };

        document.addEventListener(
            'keydown',
            keydownHandler
        );

        document.body.appendChild(overlay);
    }

    function findCategory(categoryID) {
        return categories.find(
            category => category.id === categoryID
        );
    }

    async function moveCategoryBefore(
        categoryID,
        targetCategoryID
    ) {
        const sourceIndex = categories.findIndex(
            category => category.id === categoryID
        );

        const targetIndex = categories.findIndex(
            category => category.id === targetCategoryID
        );

        if (
            sourceIndex < 0 ||
            targetIndex < 0 ||
            sourceIndex === targetIndex
        ) {
            return;
        }

        const [category] = categories.splice(
            sourceIndex,
            1
        );

        const adjustedTargetIndex =
            sourceIndex < targetIndex
                ? targetIndex - 1
                : targetIndex;

        categories.splice(
            adjustedTargetIndex,
            0,
            category
        );

        await saveCategories();

        renderSettingsPanel();
        renderDispatchPanel();
    }

    function getCategoryForAAO(key) {
        const categoryID = assignments[key];

        if (!categoryID) {
            return null;
        }

        return findCategory(categoryID) || null;
    }

    /* =========================================================
       Load / save
       ========================================================= */

    async function loadData() {
        categories = await dbGet('categories');

        if (!Array.isArray(categories) || categories.length === 0) {
            categories = DEFAULT_CATEGORIES.map(category => ({
                ...category
            }));

            await dbSet('categories', categories);
        }

        assignments = await dbGet('assignments') || {};

        uncategorizedAAOOrder = await dbGet(
            UNCATEGORIZED_ORDER_KEY
        );

        if (!Array.isArray(uncategorizedAAOOrder)) {
            uncategorizedAAOOrder = [];
        }

        notepadText = (await dbGet(NOTEPAD_STORE_KEY)) || '';

    }

    async function saveCategories() {
        await dbSet('categories', categories);
    }

    async function saveAssignments() {
        await dbSet('assignments', assignments);
    }

    /* =========================================================
       AAO discovery
       ========================================================= */

    function getAAOContainers() {
        return Array.from(
            document.querySelectorAll(
                '[data-slot="sortable-content"]'
            )
        );
    }

    function isSettingsAAOContainer(container) {
        if (!container) {
            return false;
        }

        return !!container.querySelector(
            '[data-slot="sortable-item-handle"][title="AAO verschieben"]'
        );
    }

    function findSettingsAAOContainer() {
        return getAAOContainers().find(
            isSettingsAAOContainer
        ) || null;
    }

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

    function findDispatchList(dialog) {
        if (!dialog) {
            return null;
        }

        const searchInput = dialog.querySelector(
            'input[placeholder="AAO suchen..."], input[placeholder="Suchen..."]'
        );

        if (!searchInput) {
            return null;
        }

        const candidates = Array.from(
            dialog.querySelectorAll('div.space-y-2')
        );

        for (const candidate of candidates) {
            const cards = getDispatchCards(candidate);

            if (cards.length > 0) {
                return candidate;
            }
        }

        return null;
    }

    function isDispatchAAOModeEnabled(dialog) {
        if (!dialog) {
            return false;
        }

        if (dialog.querySelector('[data-drag-vehicle-id]')) {
            return false;
        }

        const modeControl = Array.from(
            dialog.querySelectorAll(
                'button, [role="button"], [role="switch"], input[type="checkbox"]'
            )
        ).find(control => {
            const label = (
                control.getAttribute('aria-label') ||
                control.getAttribute('title') ||
                control.textContent
            )
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();

            return label === 'aao modus' ||
                label === 'aao mode' ||
                label.includes('aao-modus');
        });

        if (!modeControl) {
            return true;
        }

        const state = modeControl.getAttribute('data-state');
        const pressed = modeControl.getAttribute('aria-pressed');
        const checked = modeControl.getAttribute('aria-checked');

        return state !== 'off' &&
            state !== 'unchecked' &&
            pressed !== 'false' &&
            checked !== 'false' &&
            (!('checked' in modeControl) || modeControl.checked);
    }

    function removeDispatchPanel(dialog, list) {
        const panel = dialog && dialog.querySelector(
            `#${DISPATCH_PANEL_ID}`
        );

        if (panel) {
            panel.remove();
        }

        if (list) {
            list.style.display = '';
        }

        selectedAAOs.clear();
    }

    function getDispatchCards(container) {
        if (!container) {
            return [];
        }

        return Array.from(container.children).filter(child => {
            return child.matches('[data-slot="card"]') ||
                !!child.querySelector(
                    'div.font-semibold.text-sm.text-gray-900'
                );
        });
    }

    function discoverAAOs() {
        let changed = false;

        /* -----------------------------------------------------
           Settings AAOs
           ----------------------------------------------------- */

        const settingsContainer =
            findSettingsAAOContainer();

        if (settingsContainer) {
            const seenSettingsKeys = new Set();

            const rows = Array.from(
                settingsContainer.querySelectorAll(
                    ':scope > [data-slot="sortable-item"]'
                )
            );

            for (const row of rows) {
                const nameElement = row.querySelector(
                    'span.font-semibold'
                );

                if (!nameElement) {
                    continue;
                }

                const name = nameElement.textContent.trim();

                if (!name) {
                    continue;
                }

                const key = getAAOKey(name);
                seenSettingsKeys.add(key);

                const summaryElement = row.querySelector(
                    'span.font-mono'
                );

                const summary = summaryElement
                    ? summaryElement.textContent.trim()
                    : '';

                const existing = aaoCatalog.get(key);

                aaoCatalog.set(key, {
                    key,
                    name,
                    summary,
                    source: 'settings',
                    row
                });

                originalAAORows.set(key, row);

                if (
                    !existing ||
                    existing.name !== name ||
                    existing.summary !== summary
                ) {
                    changed = true;
                }
            }

            for (const [key, aao] of aaoCatalog) {
                if (
                    aao.source === 'settings' &&
                    !seenSettingsKeys.has(key)
                ) {
                    aaoCatalog.delete(key);
                    originalAAORows.delete(key);
                    selectedAAOs.delete(key);

                    if (assignments[key]) {
                        delete assignments[key];

                        saveAssignments()
                            .catch(console.error);
                    }

                    changed = true;
                }
            }
        }

        /* -----------------------------------------------------
           Dispatch AAOs
           ----------------------------------------------------- */

        const dispatchDialog =
            findDispatchDialog();

        if (dispatchDialog) {
            const list =
                findDispatchList(dispatchDialog);

            if (list) {
                const cards =
                    getDispatchCards(list);

                for (const card of cards) {
                    const nameElement =
                        card.querySelector(
                            'div.font-semibold.text-sm.text-gray-900'
                        );

                    if (!nameElement) {
                        continue;
                    }

                    const name =
                        nameElement.textContent.trim();

                    if (!name) {
                        continue;
                    }

                    const key = getAAOKey(name);

                    const summaryElement =
                        card.querySelector(
                            'div.text-xs.text-gray-500.font-mono'
                        );

                    const summary =
                        summaryElement
                            ? summaryElement.textContent.trim()
                            : '';

                    const existing =
                        aaoCatalog.get(key);

                    aaoCatalog.set(key, {
                        key,
                        name,
                        summary,
                        source: 'dispatch',
                        row: card
                    });

                    originalAAORows.set(key, card);

                    if (
                        !existing ||
                        existing.name !== name ||
                        existing.summary !== summary
                    ) {
                        changed = true;
                    }
                }
            }
        }

        return changed;
    }

    /* =========================================================
       Dispatch selection
       ========================================================= */

    function isAAOSelected(key) {
        return selectedAAOs.has(key);
    }

    function setSelectedVisual(element, selected) {
        if (!element) {
            return;
        }

        const icon =
            element.querySelector('.afilia-aao-icon');

        const iconElement =
            element.querySelector('.afilia-aao-icon i');

        const name =
            element.querySelector('.afilia-aao-name');

        if (selected) {
            element.classList.add(
                'afilia-aao-selected'
            );

            element.setAttribute(
                'aria-pressed',
                'true'
            );

            element.style.borderColor =
                '#ef4444';

            element.style.backgroundColor =
                '#fef2f2';

            element.style.boxShadow =
                '0 1px 2px rgba(239,68,68,0.12), 0 8px 20px -6px rgba(239,68,68,0.25)';

            if (icon) {
                icon.style.backgroundColor =
                    '#fee2e2';
            }

            if (iconElement) {
                iconElement.style.color =
                    '#ef4444';
            }

            if (name) {
                name.style.color =
                    '#dc2626';
            }
        } else {
            element.classList.remove(
                'afilia-aao-selected'
            );

            element.setAttribute(
                'aria-pressed',
                'false'
            );

            element.style.borderColor =
                '#e5e7eb';

            element.style.backgroundColor =
                '#ffffff';

            element.style.boxShadow =
                '0 1px 2px rgba(16,24,40,0.04), 0 8px 20px -6px rgba(16,24,40,0.16)';

            if (icon) {
                icon.style.backgroundColor =
                    '#eff6ff';
            }

            if (iconElement) {
                iconElement.style.color =
                    '#3b82f6';
            }

            if (name) {
                name.style.color =
                    '#111827';
            }
        }
    }

    /* =========================================================
       Trigger native AAO
       ========================================================= */

    function triggerOriginalAAO(key) {
        let original =
            originalAAORows.get(key);

        /* -----------------------------------------------------
           Try current dispatch dialog first
           ----------------------------------------------------- */

        const dispatchDialog =
            findDispatchDialog();

        if (dispatchDialog) {
            const list =
                findDispatchList(dispatchDialog);

            if (list) {
                const cards =
                    getDispatchCards(list);

                for (const card of cards) {
                    const nameElement =
                        card.querySelector(
                            'div.font-semibold.text-sm.text-gray-900'
                        );

                    if (!nameElement) {
                        continue;
                    }

                    const name =
                        nameElement.textContent.trim();

                    if (getAAOKey(name) === key) {
                        original = card;

                        originalAAORows.set(
                            key,
                            card
                        );

                        break;
                    }
                }
            }
        }

        /* -----------------------------------------------------
           Fall back to settings AAO
           ----------------------------------------------------- */

        if (
            !original ||
            !original.isConnected
        ) {
            const settingsContainer =
                findSettingsAAOContainer();

            if (settingsContainer) {
                const rows = Array.from(
                    settingsContainer.querySelectorAll(
                        ':scope > [data-slot="sortable-item"]'
                    )
                );

                for (const row of rows) {
                    const nameElement =
                        row.querySelector(
                            'span.font-semibold'
                        );

                    if (!nameElement) {
                        continue;
                    }

                    if (
                        getAAOKey(
                            nameElement.textContent.trim()
                        ) === key
                    ) {
                        original = row;

                        originalAAORows.set(
                            key,
                            row
                        );

                        break;
                    }
                }
            }
        }

        /* -----------------------------------------------------
           Click native AAO
           ----------------------------------------------------- */

        if (
            original &&
            typeof original.click === 'function'
        ) {
            original.click();

            return true;
        }

        console.warn(
            '[Afilia Toolbox] Could not find original AAO:',
            key
        );

        return false;
    }

    function toggleAAOSelection(key) {
        const currentlySelected =
            selectedAAOs.has(key);

        if (currentlySelected) {
            selectedAAOs.delete(key);
        } else {
            selectedAAOs.add(key);
        }

        updateAllDispatchItems();

        triggerOriginalAAO(key);

        setTimeout(() => {
            updateAllDispatchItems();
        }, 50);

        setTimeout(() => {
            updateAllDispatchItems();
        }, 150);

        setTimeout(() => {
            updateAllDispatchItems();
        }, 300);
    }

    /* =========================================================
       Dispatch category UI
       ========================================================= */

    function sortAAOs(aaos, order) {
        const ordering = Array.isArray(order)
            ? order
            : [];

        return aaos.slice().sort((left, right) => {
            const leftIndex =
                ordering.indexOf(left.key);

            const rightIndex =
                ordering.indexOf(right.key);

            const leftKnown =
                leftIndex !== -1;

            const rightKnown =
                rightIndex !== -1;

            if (leftKnown && rightKnown) {
                return leftIndex - rightIndex;
            }

            if (leftKnown) {
                return -1;
            }

            if (rightKnown) {
                return 1;
            }

            return 0;
        });
    }

    function syncAAOOrders() {
        let changed = false;

        for (const category of categories) {
            if (!Array.isArray(category.aaoOrder)) {
                category.aaoOrder = [];

                for (const key of aaoCatalog.keys()) {
                    if (assignments[key] === category.id) {
                        category.aaoOrder.push(key);
                    }
                }

                changed = true;
            } else {
                for (const key of aaoCatalog.keys()) {
                    if (
                        assignments[key] ===
                            category.id &&
                        !category.aaoOrder.includes(
                            key
                        )
                    ) {
                        category.aaoOrder.push(key);
                        changed = true;
                    }
                }
            }
        }

        if (!Array.isArray(uncategorizedAAOOrder)) {
            uncategorizedAAOOrder = [];
            changed = true;
        }

        for (const key of aaoCatalog.keys()) {
            if (
                !assignments[key] &&
                !uncategorizedAAOOrder.includes(
                    key
                )
            ) {
                uncategorizedAAOOrder.push(key);
                changed = true;
            }
        }

        return changed;
    }

    function ensureAAOOrdersSynced() {
        if (!syncAAOOrders()) {
            return;
        }

        saveCategories().catch(console.error);
        saveUncategorizedAAOOrder()
            .catch(console.error);
    }

    async function saveUncategorizedAAOOrder() {
        await dbSet(
            UNCATEGORIZED_ORDER_KEY,
            uncategorizedAAOOrder
        );
    }

    async function moveAAOBefore(sourceKey, targetKey) {
        if (
            !sourceKey ||
            !targetKey ||
            sourceKey === targetKey
        ) {
            return;
        }

        const sourceCategory =
            getCategoryForAAO(sourceKey);

        const targetCategory =
            getCategoryForAAO(targetKey);

        const sourceGroup = sourceCategory
            ? sourceCategory.id
            : '';

        const targetGroup = targetCategory
            ? targetCategory.id
            : '';

        if (sourceGroup !== targetGroup) {
            return;
        }

        let order;

        if (sourceGroup) {
            const category =
                findCategory(sourceGroup);

            if (!category) {
                return;
            }

            if (!Array.isArray(category.aaoOrder)) {
                category.aaoOrder = [];
            }

            order = category.aaoOrder;
        } else {
            order = uncategorizedAAOOrder;
        }

        const sourceIndex =
            order.indexOf(sourceKey);

        if (sourceIndex >= 0) {
            order.splice(sourceIndex, 1);
        }

        const adjustedTargetIndex =
            order.indexOf(targetKey);

        if (adjustedTargetIndex >= 0) {
            order.splice(
                adjustedTargetIndex,
                0,
                sourceKey
            );
        } else {
            order.push(sourceKey);
        }

        await Promise.all([
            saveCategories(),
            saveUncategorizedAAOOrder()
        ]);

        renderSettingsPanel();
        renderDispatchPanel();
    }

    function getAAOsForCategory(categoryID) {
        const category =
            findCategory(categoryID);

        return sortAAOs(
            Array.from(
                aaoCatalog.values()
            ).filter(aao => {
                return assignments[aao.key] ===
                    categoryID;
            }),
            category ? category.aaoOrder : []
        );
    }

    function getUncategorizedAAOs() {
        return sortAAOs(
            Array.from(
                aaoCatalog.values()
            ).filter(aao => {
                return !getCategoryForAAO(
                    aao.key
                );
            }),
            uncategorizedAAOOrder
        );
    }

    function createDispatchAAOElement(aao) {
        const selected =
            isAAOSelected(aao.key);

        const element =
            document.createElement('div');

        element.className =
            'afilia-aao-dispatch-item flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all';

        element.setAttribute(
            'data-afilia-aao-key',
            aao.key
        );

        element.setAttribute(
            'role',
            'button'
        );

        element.setAttribute(
            'tabindex',
            '0'
        );

        element.setAttribute(
            'aria-pressed',
            selected ? 'true' : 'false'
        );

        element.title =
            `AAO auswählen: ${aao.name}`;

        element.innerHTML = `
            <div
                class="afilia-aao-icon w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style="background:${selected ? '#fee2e2' : '#eff6ff'}"
            >
                <i
                    class="fa-solid text-sm fa-shuffle"
                    style="color:${selected ? '#ef4444' : '#3b82f6'}"
                ></i>
            </div>

            <div class="flex-1 min-w-0">
                <div
                    class="afilia-aao-name font-semibold text-sm"
                    style="color:${selected ? '#dc2626' : '#111827'}"
                >
                    ${escapeHTML(aao.name)}
                </div>

                <div
                    class="text-xs text-gray-500 font-mono truncate"
                >
                    ${escapeHTML(aao.summary)}
                </div>
            </div>
        `;

        element.addEventListener(
            'click',
            event => {
                event.preventDefault();
                event.stopPropagation();

                toggleAAOSelection(
                    aao.key
                );
            }
        );

        element.addEventListener(
            'keydown',
            event => {
                if (
                    event.key === 'Enter' ||
                    event.key === ' '
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    toggleAAOSelection(
                        aao.key
                    );
                }
            }
        );

        setSelectedVisual(
            element,
            selected
        );

        return element;
    }

    function renderDispatchPanel() {
        const dialog =
            findDispatchDialog();

        if (!dialog) {
            return;
        }

        const list =
            findDispatchList(dialog);

        if (!list) {
            return;
        }

        ensureAAOOrdersSynced();

        let panel =
            dialog.querySelector(
                `#${DISPATCH_PANEL_ID}`
            );

        if (!panel) {
            panel =
                document.createElement('div');

            panel.id =
                DISPATCH_PANEL_ID;

            panel.className =
                'afilia-dispatch-panel';

            list.parentElement.insertBefore(
                panel,
                list
            );
        }

        list.style.display = 'none';

        panel.innerHTML = '';

        const search =
            dispatchSearchValue
                .trim()
                .toLowerCase();

        const originalCatalog =
            Array.from(
                aaoCatalog.values()
            );

        /* -----------------------------------------------------
           Categorized AAOs
           ----------------------------------------------------- */

        for (const category of categories) {
            const items =
                getAAOsForCategory(
                    category.id
                ).filter(aao => {
                    if (!search) {
                        return true;
                    }

                    return (
                        aao.name
                            .toLowerCase()
                            .includes(search) ||
                        aao.summary
                            .toLowerCase()
                            .includes(search)
                    );
                });

            if (items.length === 0) {
                continue;
            }

            const wrapper =
                document.createElement('div');

            wrapper.className =
                'afilia-dispatch-category';

            const header =
                document.createElement('button');

            header.type = 'button';

            header.className =
                'afilia-dispatch-category-header';

            header.innerHTML = `
                <span class="afilia-dispatch-category-arrow">
                    ${category.collapsed ? '▶' : '▼'}
                </span>

                <span class="afilia-dispatch-category-name">
                    ${escapeHTML(category.name)}
                </span>

                <span class="afilia-dispatch-category-count">
                    ${items.length}
                </span>
            `;

            const content =
                document.createElement('div');

            content.className =
                'afilia-dispatch-category-content';

            if (category.collapsed) {
                content.style.display =
                    'none';
            }

            for (const aao of items) {
                content.appendChild(
                    createDispatchAAOElement(
                        aao
                    )
                );
            }

            header.addEventListener(
                'click',
                event => {
                    event.preventDefault();
                    event.stopPropagation();

                    category.collapsed =
                        !category.collapsed;

                    saveCategories()
                        .catch(console.error);

                    renderDispatchPanel();
                }
            );

            wrapper.appendChild(header);
            wrapper.appendChild(content);

            panel.appendChild(wrapper);
        }

        /* -----------------------------------------------------
           Uncategorized
           ----------------------------------------------------- */

        const uncategorized =
            sortAAOs(
                originalCatalog.filter(
                    aao => {
                        return !getCategoryForAAO(
                            aao.key
                        );
                    }
                ).filter(aao => {
                    if (!search) {
                        return true;
                    }

                    return (
                        aao.name
                            .toLowerCase()
                            .includes(search) ||
                        aao.summary
                            .toLowerCase()
                            .includes(search)
                    );
                }),
                uncategorizedAAOOrder
            );

        if (uncategorized.length > 0) {
            const wrapper =
                document.createElement('div');

            wrapper.className =
                'afilia-dispatch-category';

            const header =
                document.createElement('div');

            header.className =
                'afilia-dispatch-category-header afilia-dispatch-uncategorized';

            header.innerHTML = `
                <span class="afilia-dispatch-category-arrow">
                    ▼
                </span>

                <span class="afilia-dispatch-category-name">
                    Nicht zugeordnet
                </span>

                <span class="afilia-dispatch-category-count">
                    ${uncategorized.length}
                </span>
            `;

            const content =
                document.createElement('div');

            content.className =
                'afilia-dispatch-category-content';

            for (const aao of uncategorized) {
                content.appendChild(
                    createDispatchAAOElement(
                        aao
                    )
                );
            }

            wrapper.appendChild(header);
            wrapper.appendChild(content);

            panel.appendChild(wrapper);
        }

        updateAllDispatchItems();
    }

    function updateAllDispatchItems() {
        const panel =
            document.querySelector(
                `#${DISPATCH_PANEL_ID}`
            );

        if (!panel) {
            return;
        }

        panel.querySelectorAll(
            '[data-afilia-aao-key]'
        ).forEach(element => {
            const key =
                element.getAttribute(
                    'data-afilia-aao-key'
                );

            if (!key) {
                return;
            }

            setSelectedVisual(
                element,
                selectedAAOs.has(key)
            );
        });
    }

    /* =========================================================
       Settings UI
       ========================================================= */

    function createSettingsPanel() {
        const panel =
            document.createElement('div');

        panel.id =
            SETTINGS_PANEL_ID;

        return panel;
    }

    function renderSettingsPanel() {
        const container =
            findSettingsAAOContainer();

        if (!container) {
            return;
        }

        let panel =
            document.querySelector(
                `#${SETTINGS_PANEL_ID}`
            );

        if (!panel) {
            panel =
                createSettingsPanel();

            container.parentElement.insertBefore(
                panel,
                container
            );
        }

        container.style.display =
            'none';

        ensureAAOOrdersSynced();

        panel.innerHTML = '';

        const header =
            document.createElement('div');

        header.className =
            'afilia-settings-header';

        header.innerHTML = `
            <div>
                <div class="afilia-settings-title">
                    AAO Kategorien
                </div>

                <div class="afilia-settings-subtitle">
                    Ordne jede AAO einer Kategorie zu.
                </div>
            </div>

            <button
                type="button"
                class="afilia-add-category"
            >
                + Kategorie
            </button>
        `;

        panel.appendChild(header);

        header.querySelector(
            '.afilia-add-category'
        ).addEventListener(
            'click',
            async event => {
                event.preventDefault();
                event.stopPropagation();

                const name =
                    prompt(
                        'Name der neuen Kategorie:'
                    );

                if (
                    !name ||
                    !name.trim()
                ) {
                    return;
                }

                categories.push({
                    id: createID(
                        'category'
                    ),
                    name: name.trim(),
                    collapsed: false
                });

                await saveCategories();

                renderSettingsPanel();
                renderDispatchPanel();
            }
        );

        /* -----------------------------------------------------
           Categories
           ----------------------------------------------------- */

        for (const category of categories) {
            const section =
                document.createElement('div');

            section.className =
                'afilia-settings-category';

            section.dataset.categoryID =
                category.id;

            const categoryHeader =
                document.createElement('div');

            categoryHeader.className =
                'afilia-settings-category-header';

            categoryHeader.innerHTML = `
                <span
                    class="afilia-category-drag-handle"
                    draggable="true"
                    title="Kategorie verschieben"
                    aria-label="Kategorie verschieben"
                >
                    ⋮⋮
                </span>

                <button
                    type="button"
                    class="afilia-category-collapse"
                >
                    ${category.collapsed ? '▶' : '▼'}
                </button>

                <span class="afilia-category-name">
                    ${escapeHTML(category.name)}
                </span>

                <span class="afilia-category-actions">
                    <button
                        type="button"
                        class="afilia-category-rename"
                        title="Kategorie umbenennen"
                    >
                        ✎
                    </button>

                    <button
                        type="button"
                        class="afilia-category-delete"
                        title="Kategorie löschen"
                    >
                        ×
                    </button>
                </span>
            `;

            section.appendChild(
                categoryHeader
            );

            const dragHandle =
                categoryHeader.querySelector(
                    '.afilia-category-drag-handle'
                );

            dragHandle.addEventListener(
                'dragstart',
                event => {
                    draggedCategoryID = category.id;
                    section.classList.add(
                        'afilia-category-dragging'
                    );

                    event.dataTransfer.effectAllowed =
                        'move';
                    event.dataTransfer.setData(
                        'text/plain',
                        category.id
                    );
                }
            );

            dragHandle.addEventListener(
                'dragend',
                () => {
                    draggedCategoryID = null;

                    document.querySelectorAll(
                        '.afilia-category-dragging, .afilia-category-drop-target'
                    ).forEach(element => {
                        element.classList.remove(
                            'afilia-category-dragging',
                            'afilia-category-drop-target'
                        );
                    });
                }
            );

            section.addEventListener(
                'dragover',
                event => {
                    if (
                        !draggedCategoryID ||
                        draggedCategoryID === category.id
                    ) {
                        return;
                    }

                    event.preventDefault();
                    event.dataTransfer.dropEffect =
                        'move';

                    section.classList.add(
                        'afilia-category-drop-target'
                    );
                }
            );

            section.addEventListener(
                'dragleave',
                event => {
                    if (
                        event.relatedTarget &&
                        section.contains(
                            event.relatedTarget
                        )
                    ) {
                        return;
                    }

                    section.classList.remove(
                        'afilia-category-drop-target'
                    );
                }
            );

            section.addEventListener(
                'drop',
                async event => {
                    event.preventDefault();

                    const sourceCategoryID =
                        event.dataTransfer.getData(
                            'text/plain'
                        ) || draggedCategoryID;

                    section.classList.remove(
                        'afilia-category-drop-target'
                    );

                    if (
                        !sourceCategoryID ||
                        sourceCategoryID === category.id
                    ) {
                        return;
                    }

                    await moveCategoryBefore(
                        sourceCategoryID,
                        category.id
                    );
                }
            );

            const content =
                document.createElement('div');

            content.className =
                'afilia-settings-category-content';

            if (category.collapsed) {
                content.style.display =
                    'none';
            }

            const aaos =
                sortAAOs(
                    Array.from(
                        aaoCatalog.values()
                    ).filter(aao => {
                        return assignments[
                            aao.key
                        ] === category.id;
                    }),
                    category.aaoOrder
                );

            for (const aao of aaos) {
                content.appendChild(
                    createSettingsAAORow(
                        aao
                    )
                );
            }

            /* -------------------------------------------------
               Collapse
               ------------------------------------------------- */

            categoryHeader.querySelector(
                '.afilia-category-collapse'
            ).addEventListener(
                'click',
                async event => {
                    event.preventDefault();
                    event.stopPropagation();

                    category.collapsed =
                        !category.collapsed;

                    await saveCategories();

                    renderSettingsPanel();
                    renderDispatchPanel();
                }
            );

            /* -------------------------------------------------
               Rename
               ------------------------------------------------- */

            categoryHeader.querySelector(
                '.afilia-category-rename'
            ).addEventListener(
                'click',
                async event => {
                    event.preventDefault();
                    event.stopPropagation();

                    const newName =
                        prompt(
                            'Neuer Kategoriename:',
                            category.name
                        );

                    if (
                        !newName ||
                        !newName.trim()
                    ) {
                        return;
                    }

                    category.name =
                        newName.trim();

                    await saveCategories();

                    renderSettingsPanel();
                    renderDispatchPanel();
                }
            );

            /* -------------------------------------------------
               Delete
               ------------------------------------------------- */

            categoryHeader.querySelector(
                '.afilia-category-delete'
            ).addEventListener(
                'click',
                async event => {
                    event.preventDefault();
                    event.stopPropagation();

                    const usedBy =
                        Object.values(
                            assignments
                        ).filter(
                            id =>
                                id ===
                                category.id
                        ).length;

                    const message =
                        usedBy > 0
                            ? `Die Kategorie "${category.name}" enthält ${usedBy} AAO(s).\n\nDiese AAOs werden anschließend nicht zugeordnet sein.\n\nKategorie löschen?`
                            : `Kategorie "${category.name}" löschen?`;

                    if (!confirm(message)) {
                        return;
                    }

                    for (
                        const key of
                        Object.keys(
                            assignments
                        )
                    ) {
                        if (
                            assignments[key] ===
                            category.id
                        ) {
                            delete assignments[
                                key
                            ];
                        }
                    }

                    categories =
                        categories.filter(
                            item =>
                                item.id !==
                                category.id
                        );

                    await saveCategories();
                    await saveAssignments();

                    renderSettingsPanel();
                    renderDispatchPanel();
                }
            );

            section.appendChild(content);
            panel.appendChild(section);
        }

        /* -----------------------------------------------------
           Uncategorized
           ----------------------------------------------------- */

        const uncategorized =
            getUncategorizedAAOs();

        if (uncategorized.length > 0) {
            const section =
                document.createElement('div');

            section.className =
                'afilia-settings-category afilia-uncategorized';

            const headerElement =
                document.createElement('div');

            headerElement.className =
                'afilia-settings-category-header';

            headerElement.innerHTML = `
                <div>
                    <div class="afilia-category-name">
                        Nicht zugeordnet
                    </div>

                    <div class="afilia-settings-subtitle">
                        ${uncategorized.length} AAO(s)
                    </div>
                </div>
            `;

            section.appendChild(
                headerElement
            );

            const content =
                document.createElement('div');

            content.className =
                'afilia-settings-category-content';

            for (const aao of uncategorized) {
                content.appendChild(
                    createSettingsAAORow(
                        aao
                    )
                );
            }

            section.appendChild(content);

            panel.appendChild(section);
        }
    }

    function createSettingsAAORow(aao) {
        const row =
            document.createElement('div');

        row.className =
            'afilia-settings-aao-row';

        const currentCategory =
            getCategoryForAAO(
                aao.key
            );

        row.innerHTML = `
            <span
                class="afilia-aao-drag-handle"
                draggable="true"
                title="AAO verschieben"
                aria-label="AAO verschieben"
            >
                ⋮⋮
            </span>

            <div class="afilia-settings-aao-info">
                <div class="afilia-settings-aao-name">
                    ${escapeHTML(aao.name)}
                </div>

                <div class="afilia-settings-aao-summary">
                    ${escapeHTML(aao.summary)}
                </div>
            </div>

            <select class="afilia-settings-aao-select">
                <option value="">
                    Nicht zugeordnet
                </option>

                ${categories.map(category => `
                    <option
                        value="${escapeHTML(category.id)}"
                        ${
                            currentCategory &&
                            currentCategory.id ===
                                category.id
                                ? 'selected'
                                : ''
                        }
                    >
                        ${escapeHTML(
                            category.name
                        )}
                    </option>
                `).join('')}
            </select>

            <button
                type="button"
                class="afilia-settings-edit"
                title="AAO bearbeiten"
            >
                ✎
            </button>

            <button
                type="button"
                class="afilia-settings-delete"
                title="AAO löschen"
            >
                ×
            </button>
        `;

        const dragHandle =
            row.querySelector(
                '.afilia-aao-drag-handle'
            );

        dragHandle.addEventListener(
            'dragstart',
            event => {
                draggedAAOKey = aao.key;
                row.classList.add(
                    'afilia-aao-dragging'
                );

                event.dataTransfer.effectAllowed =
                    'move';
                event.dataTransfer.setData(
                    'text/plain',
                    aao.key
                );
            }
        );

        dragHandle.addEventListener(
            'dragend',
            () => {
                draggedAAOKey = null;

                document.querySelectorAll(
                    '.afilia-aao-dragging, .afilia-aao-drop-target'
                ).forEach(element => {
                    element.classList.remove(
                        'afilia-aao-dragging',
                        'afilia-aao-drop-target'
                    );
                });
            }
        );

        row.addEventListener(
            'dragover',
            event => {
                if (
                    !draggedAAOKey ||
                    draggedAAOKey === aao.key
                ) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect =
                    'move';

                row.classList.add(
                    'afilia-aao-drop-target'
                );
            }
        );

        row.addEventListener(
            'dragleave',
            event => {
                if (
                    event.relatedTarget &&
                    row.contains(
                        event.relatedTarget
                    )
                ) {
                    return;
                }

                row.classList.remove(
                    'afilia-aao-drop-target'
                );
            }
        );

        row.addEventListener(
            'drop',
            async event => {
                event.preventDefault();
                event.stopPropagation();

                row.classList.remove(
                    'afilia-aao-drop-target'
                );

                const sourceKey =
                    event.dataTransfer.getData(
                        'text/plain'
                    ) || draggedAAOKey;

                if (
                    !sourceKey ||
                    sourceKey === aao.key
                ) {
                    return;
                }

                await moveAAOBefore(
                    sourceKey,
                    aao.key
                );
            }
        );

        const select =
            row.querySelector(
                '.afilia-settings-aao-select'
            );

        select.addEventListener(
            'change',
            async event => {
                event.preventDefault();
                event.stopPropagation();

                const value =
                    select.value;

                if (value) {
                    assignments[
                        aao.key
                    ] = value;
                } else {
                    delete assignments[
                        aao.key
                    ];
                }

                await saveAssignments();

                renderSettingsPanel();
                renderDispatchPanel();
            }
        );

        row.querySelector(
            '.afilia-settings-edit'
        ).addEventListener(
            'click',
            event => {
                event.preventDefault();
                event.stopPropagation();

                const original =
                    originalAAORows.get(
                        aao.key
                    );

                if (!original) {
                    return;
                }

                const editButton =
                    Array.from(
                        original.querySelectorAll(
                            'button'
                        )
                    ).find(button => {
                        const svg =
                            button.querySelector(
                                'svg'
                            );

                        return (
                            svg &&
                            (
                                svg.classList.contains(
                                    'lucide-pencil'
                                ) ||
                                svg
                                    .getAttribute(
                                        'class'
                                    )
                                    ?.includes(
                                        'pencil'
                                    )
                            )
                        );
                    });

                if (editButton) {
                    editButton.click();
                }
            }
        );

        row.querySelector(
            '.afilia-settings-delete'
        ).addEventListener(
            'click',
            event => {
                event.preventDefault();
                event.stopPropagation();

                const original =
                    originalAAORows.get(
                        aao.key
                    );

                if (!original) {
                    return;
                }

                const deleteButton =
                    Array.from(
                        original.querySelectorAll(
                            'button'
                        )
                    ).find(button => {
                        const svg =
                            button.querySelector(
                                'svg'
                            );

                        const svgClass =
                            svg?.getAttribute(
                                'class'
                            ) || '';

                        return (
                            svgClass.includes('trash') ||
                            /löschen|loeschen|delete/i.test(
                                button.textContent || ''
                            ) ||
                            /löschen|loeschen|delete/i.test(
                                button.getAttribute(
                                    'title'
                                ) || ''
                            )
                        );
                    });

                if (deleteButton) {
                    deleteButton.click();
                }
            }
        );

        return row;
    }

    /* =========================================================
       Search synchronization
       ========================================================= */

    function hookDispatchSearch(dialog) {
        const input =
            dialog?.querySelector(
                'input[placeholder="AAO suchen..."], input[placeholder="Suchen..."]'
            );

        if (!input) {
            return;
        }

        if (
            input.dataset.afiliaSearchHooked ===
            'true'
        ) {
            return;
        }

        input.dataset.afiliaSearchHooked =
            'true';

        input.addEventListener(
            'input',
            () => {
                dispatchSearchValue =
                    input.value || '';

                renderDispatchPanel();
            }
        );
    }

    /* =========================================================
       Notepad
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
        const button =
            document.createElement('button');

        button.type = 'button';

        button.className =
            `${NOTEPAD_BUTTON_CLASS} w-10 h-10 sm:w-10 sm:h-10 bg-dark rounded-lg shadow-lg border border-gray-800/80 hover:border-gray-700 transition-all duration-300 flex items-center justify-center cursor-pointer`;

        button.setAttribute(
            'aria-pressed',
            'false'
        );

        button.title =
            'Notizblock öffnen/schließen';

        button.innerHTML =
            '<i class="fa-solid fa-note-sticky text-sm sm:text-sm text-white/80"></i>';

        button.addEventListener(
            'click',
            event => {
                event.preventDefault();
                event.stopPropagation();

                toggleNotepadPanel();
            }
        );

        return button;
    }

    function hookNotepadButton() {
        const container =
            findNotepadContainer();

        if (!container) {
            lastNotepadContainer = null;
            return;
        }

        const button =
            container.querySelector(
                `.${NOTEPAD_BUTTON_CLASS}`
            );

        if (
            container ===
                lastNotepadContainer &&
            button
        ) {
            return;
        }

        lastNotepadContainer =
            container;

        if (button) {
            button.remove();
        }

        const newButton =
            createNotepadButton();

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
        if (
            document.getElementById(
                NOTEPAD_PANEL_ID
            )
        ) {
            return;
        }

        const panel =
            document.createElement('div');

        panel.id = NOTEPAD_PANEL_ID;
        panel.className =
            'afilia-notepad-panel';

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

        const textarea =
            panel.querySelector(
                `.${NOTEPAD_TEXTAREA_CLASS}`
            );

        textarea.value = notepadText;

        panel
            .querySelector(
                '.afilia-notepad-close'
            )
            .addEventListener(
                'click',
                event => {
                    event.preventDefault();
                    event.stopPropagation();

                    closeNotepadPanel();
                }
            );

        textarea.addEventListener(
            'input',
            () => {
                notepadText =
                    textarea.value;

                scheduleSaveNotepad();
            }
        );

        textarea.addEventListener(
            'keydown',
            event => {
                event.stopPropagation();

                if (
                    event.key === 'Escape'
                ) {
                    event.preventDefault();
                    closeNotepadPanel();
                }
            }
        );

        document.body.appendChild(panel);

        updateNotepadButtonState();

        textarea.focus();
    }

    function closeNotepadPanel() {
        const panel =
            document.getElementById(
                NOTEPAD_PANEL_ID
            );

        if (panel) {
            panel.remove();
        }

        if (notepadSaveTimer) {
            clearTimeout(
                notepadSaveTimer
            );
            notepadSaveTimer = null;
        }

        saveNotepad();

        updateNotepadButtonState();
    }

    function toggleNotepadPanel() {
        const panel =
            document.getElementById(
                NOTEPAD_PANEL_ID
            );

        if (panel) {
            closeNotepadPanel();
        } else {
            openNotepadPanel();
        }
    }

    function updateNotepadButtonState() {
        const isOpen =
            !!document.getElementById(
                NOTEPAD_PANEL_ID
            );

        document
            .querySelectorAll(
                `.${NOTEPAD_BUTTON_CLASS}`
            )
            .forEach(button => {
                button.setAttribute(
                    'aria-pressed',
                    isOpen
                        ? 'true'
                        : 'false'
                );
            });
    }

    function scheduleSaveNotepad() {
        if (notepadSaveTimer) {
            clearTimeout(
                notepadSaveTimer
            );
        }

        notepadSaveTimer = setTimeout(
            () => {
                notepadSaveTimer = null;

                saveNotepad();
            },
            NOTEPAD_SAVE_DELAY
        );
    }

    async function saveNotepad() {
        try {
            await dbSet(
                NOTEPAD_STORE_KEY,
                notepadText
            );
        } catch (error) {
            console.warn(
                '[Afilia Toolbox] Notepad save failed:',
                error
            );
        }
    }

    /* =========================================================
       CSS
       ========================================================= */

    function injectStyles() {
        if (
            document.getElementById(
                'afilia-aao-category-styles'
            )
        ) {
            return;
        }

        const style =
            document.createElement('style');

        style.id =
            'afilia-aao-category-styles';

        style.textContent = `
            .afilia-update-notice {
                position: fixed;
                top: 16px;
                right: 16px;
                z-index: 99999;
                display: flex;
                align-items: center;
                gap: 12px;
                max-width: min(560px, calc(100vw - 32px));
                padding: 12px 14px;
                border: 1px solid #fecaca;
                border-radius: 10px;
                background: #fff7f7;
                box-shadow: 0 8px 24px rgba(17, 24, 39, 0.16);
                color: #7f1d1d;
                font-size: 13px;
            }

            .afilia-update-notice-content {
                display: flex;
                flex-direction: column;
                gap: 2px;
                min-width: 0;
            }

            .afilia-update-notice-link {
                flex-shrink: 0;
                padding: 7px 10px;
                border-radius: 7px;
                background: #dc2626;
                color: white;
                font-weight: 600;
                text-decoration: none;
            }

            .afilia-update-notice-link:hover {
                background: #b91c1c;
            }

            .afilia-update-notice-close {
                flex-shrink: 0;
                width: 28px;
                height: 28px;
                border: 0;
                border-radius: 6px;
                background: transparent;
                color: #991b1b;
                cursor: pointer;
                font-size: 20px;
                line-height: 1;
            }

            .afilia-update-notice-close:hover {
                background: #fee2e2;
            }

            /* =====================================================
               Changelog
               ===================================================== */

            .afilia-changelog-overlay {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                background: rgba(17, 24, 39, 0.45);
            }

            .afilia-changelog-popup {
                width: min(520px, 100%);
                max-height: 70vh;
                display: flex;
                flex-direction: column;
                border: 1px solid #e5e7eb;
                border-radius: 14px;
                background: #ffffff;
                box-shadow: 0 20px 50px rgba(17, 24, 39, 0.35);
                overflow: hidden;
            }

            .afilia-changelog-popup-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 14px 16px;
                background: #f9fafb;
                border-bottom: 1px solid #e5e7eb;
            }

            .afilia-changelog-popup-title {
                font-size: 16px;
                font-weight: 700;
                color: #111827;
            }

            .afilia-changelog-popup-close {
                width: 30px;
                height: 30px;
                border: 0;
                border-radius: 8px;
                background: transparent;
                color: #6b7280;
                cursor: pointer;
                font-size: 20px;
                line-height: 1;
            }

            .afilia-changelog-popup-close:hover {
                background: #e5e7eb;
                color: #111827;
            }

            .afilia-changelog-popup-body {
                padding: 16px;
                overflow-y: auto;
            }

            .afilia-changelog-version + .afilia-changelog-version {
                margin-top: 16px;
            }

            .afilia-changelog-version-title {
                margin-bottom: 6px;
                font-size: 14px;
                font-weight: 700;
                color: #dc2626;
            }

            .afilia-changelog-list {
                margin: 0;
                padding-left: 20px;
                display: flex;
                flex-direction: column;
                gap: 6px;
                color: #374151;
                font-size: 13px;
                line-height: 1.5;
            }

            /* =====================================================
               Settings
               ===================================================== */

            #${SETTINGS_PANEL_ID} {
                position: relative;
                z-index: 10;
                width: 100%;
                margin-bottom: 12px;
            }

            .afilia-settings-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 12px 14px;
                margin-bottom: 10px;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
                background: #ffffff;
            }

            .afilia-settings-title {
                font-size: 18px;
                font-weight: 700;
                color: #111827;
            }

            .afilia-settings-subtitle {
                margin-top: 2px;
                font-size: 12px;
                color: #6b7280;
            }

            .afilia-add-category {
                border: 0;
                border-radius: 8px;
                padding: 8px 12px;
                background: #ef4444;
                color: white;
                font-weight: 600;
                cursor: pointer;
            }

            .afilia-add-category:hover {
                background: #dc2626;
            }

            .afilia-settings-category {
                margin-bottom: 10px;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
                overflow: hidden;
                background: white;
            }

            .afilia-settings-category-header {
                display: flex;
                align-items: center;
                gap: 8px;
                min-height: 46px;
                padding: 8px 12px;
                background: #f9fafb;
                border-bottom: 1px solid #e5e7eb;
            }

            .afilia-category-collapse {
                width: 28px;
                height: 28px;
                border: 0;
                background: transparent;
                cursor: pointer;
                color: #6b7280;
            }

            .afilia-category-drag-handle {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 28px;
                color: #9ca3af;
                cursor: grab;
                font-size: 16px;
                letter-spacing: 0;
                user-select: none;
            }

            .afilia-category-drag-handle:hover {
                color: #4b5563;
            }

            .afilia-category-drag-handle:active {
                cursor: grabbing;
            }

            .afilia-category-dragging {
                opacity: 0.55;
            }

            .afilia-category-drop-target {
                border-color: #ef4444;
                box-shadow: 0 0 0 2px #fee2e2;
            }

            .afilia-category-name {
                flex: 1;
                font-weight: 700;
                color: #111827;
            }

            .afilia-category-actions {
                display: flex;
                gap: 4px;
            }

            .afilia-category-actions button {
                width: 30px;
                height: 30px;
                border: 0;
                border-radius: 7px;
                background: transparent;
                cursor: pointer;
                color: #6b7280;
            }

            .afilia-category-actions button:hover {
                background: #e5e7eb;
                color: #111827;
            }

            .afilia-category-actions button:disabled {
                opacity: 0.35;
                cursor: default;
            }

            .afilia-category-actions button:disabled:hover {
                background: transparent;
                color: #6b7280;
            }

            .afilia-category-delete:hover {
                color: #dc2626 !important;
                background: #fee2e2 !important;
            }

            .afilia-settings-category-content {
                padding: 8px;
            }

            .afilia-settings-aao-row {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 9px 10px;
                border-radius: 9px;
            }

            .afilia-settings-aao-row:hover {
                background: #f9fafb;
            }

            .afilia-settings-aao-info {
                flex: 1;
                min-width: 0;
            }

            .afilia-settings-aao-name {
                font-size: 14px;
                font-weight: 600;
                color: #111827;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .afilia-settings-aao-summary {
                margin-top: 2px;
                font-size: 11px;
                font-family: monospace;
                color: #6b7280;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .afilia-settings-aao-select {
                min-width: 170px;
                max-width: 230px;
                height: 34px;
                padding: 0 8px;
                border: 1px solid #d1d5db;
                border-radius: 8px;
                background: white;
                color: #111827;
                cursor: pointer;
            }

            .afilia-settings-edit {
                width: 34px;
                height: 34px;
                flex-shrink: 0;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                background: white;
                cursor: pointer;
            }

            .afilia-settings-edit:hover {
                background: #f3f4f6;
            }

            .afilia-settings-delete {
                width: 34px;
                height: 34px;
                flex-shrink: 0;
                border: 1px solid #fecaca;
                border-radius: 8px;
                background: white;
                color: #dc2626;
                cursor: pointer;
            }

            .afilia-settings-delete:hover {
                background: #fee2e2;
            }

            .afilia-aao-drag-handle {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                width: 20px;
                height: 28px;
                color: #9ca3af;
                cursor: grab;
                font-size: 16px;
                letter-spacing: 0;
                user-select: none;
            }

            .afilia-aao-drag-handle:hover {
                color: #4b5563;
            }

            .afilia-aao-drag-handle:active {
                cursor: grabbing;
            }

            .afilia-aao-dragging {
                opacity: 0.55;
            }

            .afilia-aao-drop-target {
                border-color: #ef4444;
                box-shadow: 0 0 0 2px #fee2e2;
            }

            /* =====================================================
               Dispatch
               ===================================================== */

            #${DISPATCH_PANEL_ID} {
                width: 100%;
                padding-bottom: 6px;
            }

            .afilia-dispatch-category {
                margin-bottom: 8px;
            }

            .afilia-dispatch-category-header {
                width: 100%;
                min-height: 42px;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
                background: #f9fafb;
                color: #111827;
                cursor: pointer;
                text-align: left;
            }

            .afilia-dispatch-category-header:hover {
                background: #f3f4f6;
            }

            .afilia-dispatch-category-arrow {
                width: 18px;
                flex-shrink: 0;
                color: #6b7280;
                font-size: 11px;
            }

            .afilia-dispatch-category-name {
                flex: 1;
                font-weight: 700;
                font-size: 14px;
            }

            .afilia-dispatch-category-count {
                min-width: 24px;
                padding: 2px 7px;
                border-radius: 999px;
                background: #e5e7eb;
                color: #4b5563;
                font-size: 11px;
                font-weight: 700;
                text-align: center;
            }

            .afilia-dispatch-category-content {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding-top: 8px;
            }

            .afilia-dispatch-category-content
            > [data-afilia-aao-key] {
                min-height: 60px;
            }

            .afilia-dispatch-category-content
            > [data-afilia-aao-key]:hover {
                border-color: #fca5a5 !important;
            }

            .afilia-dispatch-uncategorized {
                cursor: default;
            }

            .afilia-dispatch-uncategorized:hover {
                background: #f9fafb;
            }

            .afilia-aao-selected {
                border-color: #ef4444 !important;
                background-color: #fef2f2 !important;
            }

            .afilia-aao-dispatch-item {
                user-select: none;
                -webkit-user-select: none;
            }

            .afilia-aao-dispatch-item:focus-visible {
                outline: 2px solid #ef4444;
                outline-offset: 2px;
            }

            .afilia-aao-dispatch-item:hover {
                transform: translateY(-1px);
            }

            /* =====================================================
               Notepad
               ===================================================== */

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

            /* =====================================================
               Mobile
               ===================================================== */

            @media (max-width: 640px) {
                .afilia-settings-aao-row {
                    flex-wrap: wrap;
                }

                .afilia-settings-aao-info {
                    width: 100%;
                    flex-basis: 100%;
                }

                .afilia-settings-aao-select {
                    flex: 1;
                    min-width: 0;
                    max-width: none;
                }
            }
        `;

        document.head.appendChild(style);
    }

    /* =========================================================
       Main scanning
       ========================================================= */

    function scan() {
        hookNotepadButton();

        const catalogChanged =
            discoverAAOs();

        /* -----------------------------------------------------
           Settings
           ----------------------------------------------------- */

        const settingsContainer =
            findSettingsAAOContainer();

        if (settingsContainer) {
            if (
                settingsContainer !==
                    lastSettingsContainer ||
                !document.querySelector(
                    `#${SETTINGS_PANEL_ID}`
                ) ||
                catalogChanged
            ) {
                lastSettingsContainer =
                    settingsContainer;

                renderSettingsPanel();
            }
        } else {
            lastSettingsContainer = null;
        }

        /* -----------------------------------------------------
           Dispatch
           ----------------------------------------------------- */

        const dispatchDialog =
            findDispatchDialog();

        if (dispatchDialog) {
            hookDispatchSearch(
                dispatchDialog
            );

            const list =
                findDispatchList(
                    dispatchDialog
                );

            if (list) {
                if (!isDispatchAAOModeEnabled(dispatchDialog)) {
                    removeDispatchPanel(
                        dispatchDialog,
                        list
                    );

                    lastDispatchContainer =
                        dispatchDialog;
                } else if (
                    dispatchDialog !==
                        lastDispatchContainer ||
                    !document.querySelector(
                        `#${DISPATCH_PANEL_ID}`
                    ) ||
                    catalogChanged
                ) {
                    lastDispatchContainer =
                        dispatchDialog;

                    renderDispatchPanel();
                } else {
                    updateAllDispatchItems();
                }
            }
        } else {
            if (lastDispatchContainer) {
                selectedAAOs.clear();
            }

            lastDispatchContainer = null;
        }

    }

    function scheduleScan() {
        if (scanTimer) {
            clearTimeout(scanTimer);
        }

        scanTimer = setTimeout(() => {
            scanTimer = null;

            try {
                scan();
            } catch (error) {
                console.error(
                    '[Afilia Toolbox] Scan failed:',
                    error
                );
            }
        }, 100);
    }

    /* =========================================================
       MutationObserver
       ========================================================= */

    function startObserver() {
        if (observer) {
            observer.disconnect();
        }

        observer =
            new MutationObserver(
                mutations => {
                    let relevant = false;

                    for (
                        const mutation of mutations
                    ) {
                        if (
                            mutation.type ===
                                'childList' ||
                            mutation.type ===
                                'attributes'
                        ) {
                            relevant = true;
                            break;
                        }
                    }

                    if (relevant) {
                        scheduleScan();
                    }
                }
            );

        observer.observe(
            document.body,
            {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: [
                    'class',
                    'style',
                    'data-state'
                ]
            }
        );
    }

    /* =========================================================
       Initialization
       ========================================================= */

    async function initialize() {
        try {
            db =
                await openDatabase();

            await loadData();

            injectStyles();

            discoverAAOs();

            scan();

            startObserver();

            checkForUpdates();

            showChangelogPopup();

            console.info(
                '[Afilia Toolbox] initialized.'
            );
        } catch (error) {
            console.error(
                '[Afilia Toolbox] initialization failed:',
                error
            );
        }
    }

    initialize();
})();
