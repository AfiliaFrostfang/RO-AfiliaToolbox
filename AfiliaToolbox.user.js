// ==UserScript==
// @name         Afilia Toolbox
// @namespace    https://afiliafrostfang.de/
// @version      1.7.4
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
    const SCRIPT_VERSION = '1.7.4';
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

    const VEHICLE_SORT_CLUSTER_ID = 'afilia-vehicle-sort-cluster';
    const VEHICLE_KM_CLASS = 'afilia-vehicle-km';
    const VEHICLE_KM_WARNING_CLASS =
        'afilia-vehicle-km-warning';
    const VEHICLE_MILEAGE_WARNING_POPUP_ID =
        'afilia-vehicle-mileage-warning-popup';
    const VEHICLE_HIGH_MILEAGE_KM = 30000;
    const VEHICLE_CATALOG_KEY = 'vehicleCatalog';
    const VEHICLE_DISTANCE_KEY = 'vehicleDistanceCache';
    const VEHICLE_SORT_PREFS_KEY = 'vehicleSortPrefs';
    const VEHICLE_STATIONS_URL =
        '/api/game/stations/getAllStationsWithVehicles';
    const VEHICLE_DATA_URL =
        '/api/game/vehicle/getVehicleData';
    const VEHICLE_STATION_PAGE_SIZE = 50;
    const VEHICLE_STATION_MAX_PAGES = 20;
    const VEHICLE_CATALOG_TTL = 5 * 60 * 1000;
    const VEHICLE_DISTANCE_TTL = 30 * 60 * 1000;
    const VEHICLE_DISTANCE_CONCURRENCY = 8;
    const VEHICLE_DISTANCE_BATCH_DELAY = 80;
    const VEHICLE_SAVE_DELAY = 1200;
    const VEHICLE_DONE_HIDE_DELAY = 4000;
    const VEHICLE_DISTANCE_RELOAD_DELAY =
        10000;

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

    let notepadText = '';
    let notepadSaveTimer = null;
    let lastNotepadContainer = null;

    let vehicleHooksInstalled = false;
    let gameSessionID = '';
    let vehicleCatalog = new Map();
    let vehicleCatalogByCallsign = new Map();
    let vehicleDistance = new Map();
    let vehicleSortActive = false;
    let vehicleLoadPromise = null;
    let vehicleSaveTimer = null;
    let vehicleTabPresent = false;
    let vehicleStatusLockUntil = 0;
    let vehicleStatusDoneUntil = 0;
    let vehicleStatusHideTimer = null;
    let vehicleNextLoadAt = 0;
    let vehicleMileageWarningPopup = null;
    const vehicleNativeOrder = new Map();

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

    function delay(milliseconds) {
        return new Promise(resolve => {
            setTimeout(resolve, milliseconds);
        });
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

        notepadText = (await dbGet(NOTEPAD_STORE_KEY)) || '';

        const cachedCatalog =
            await dbGet(VEHICLE_CATALOG_KEY);

        if (
            cachedCatalog &&
            Array.isArray(cachedCatalog.entries)
        ) {
            buildVehicleCatalogFromEntries(
                cachedCatalog.entries
            );
        }

        const cachedDistance =
            await dbGet(VEHICLE_DISTANCE_KEY);

        if (
            cachedDistance &&
            cachedDistance.entries
        ) {
            for (const [id, entry] of Object.entries(
                cachedDistance.entries
            )) {
                if (
                    entry &&
                    typeof entry.km === 'number'
                ) {
                    vehicleDistance.set(id, {
                        km: entry.km,
                        fetchedAt: entry.fetchedAt || 0
                    });
                }
            }
        }

        const prefs =
            await dbGet(VEHICLE_SORT_PREFS_KEY);

        if (prefs) {
            vehicleSortActive = !!prefs.active;
        }
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

    function getAAOsForCategory(categoryID) {
        return Array.from(
            aaoCatalog.values()
        )
            .filter(aao => {
                return assignments[aao.key] ===
                    categoryID;
            })
            .sort((a, b) => {
                return a.name.localeCompare(
                    b.name,
                    'de',
                    {
                        sensitivity: 'base'
                    }
                );
            });
    }

    function getUncategorizedAAOs() {
        return Array.from(
            aaoCatalog.values()
        )
            .filter(aao => {
                return !getCategoryForAAO(
                    aao.key
                );
            })
            .sort((a, b) => {
                return a.name.localeCompare(
                    b.name,
                    'de',
                    {
                        sensitivity: 'base'
                    }
                );
            });
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
            originalCatalog
                .filter(aao => {
                    return !getCategoryForAAO(
                        aao.key
                    );
                })
                .filter(aao => {
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
                })
                .sort((a, b) => {
                    return a.name.localeCompare(
                        b.name,
                        'de',
                        {
                            sensitivity: 'base'
                        }
                    );
                });

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
                Array.from(
                    aaoCatalog.values()
                )
                    .filter(aao => {
                        return assignments[
                            aao.key
                        ] === category.id;
                    })
                    .sort((a, b) => {
                        return a.name.localeCompare(
                            b.name,
                            'de',
                            {
                                sensitivity:
                                    'base'
                            }
                        );
                    });

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
       Vehicle kilometre sort
       ========================================================= */

    function buildVehicleCatalogFromEntries(entries) {
        vehicleCatalog = new Map();
        vehicleCatalogByCallsign = new Map();

        for (const entry of entries) {
            if (!entry || !entry.id) {
                continue;
            }

            vehicleCatalog.set(entry.id, entry);

            if (entry.callsign) {
                vehicleCatalogByCallsign.set(
                    getAAOKey(entry.callsign),
                    entry.id
                );
            }
        }
    }

    function addVehicleEntries(entries) {
        for (const entry of entries) {
            if (!entry || !entry.id) {
                continue;
            }

            if (!vehicleCatalog.has(entry.id)) {
                vehicleCatalog.set(entry.id, entry);

                if (entry.callsign) {
                    vehicleCatalogByCallsign.set(
                        getAAOKey(entry.callsign),
                        entry.id
                    );
                }
            }
        }
    }

    function scheduleVehicleSave() {
        if (vehicleSaveTimer) {
            clearTimeout(vehicleSaveTimer);
        }

        vehicleSaveTimer = setTimeout(() => {
            vehicleSaveTimer = null;

            saveVehicleData().catch(console.error);
        }, VEHICLE_SAVE_DELAY);
    }

    async function saveVehicleData() {
        const catalogEntries =
            Array.from(vehicleCatalog.values());

        const distanceEntries = {};

        for (const [id, entry] of vehicleDistance) {
            distanceEntries[id] = {
                km: entry.km,
                fetchedAt: entry.fetchedAt
            };
        }

        await Promise.all([
            dbSet(VEHICLE_CATALOG_KEY, {
                entries: catalogEntries,
                savedAt: Date.now()
            }),
            dbSet(VEHICLE_DISTANCE_KEY, {
                entries: distanceEntries,
                savedAt: Date.now()
            })
        ]);
    }

    function trackGameSessionIDFromURL(url) {
        if (
            !url ||
            typeof url !== 'string' ||
            gameSessionID
        ) {
            return;
        }

        const match =
            url.match(/[?&]gameSessionId=([^&]+)/);

        if (match) {
            gameSessionID =
                decodeURIComponent(match[1]);
        }
    }

    function resolveGameSessionID() {
        if (gameSessionID) {
            return gameSessionID;
        }

        const match =
            location.pathname.match(
                /\/game\/([^/]+)/
            );

        if (match) {
            gameSessionID =
                decodeURIComponent(match[1]);
        }

        return gameSessionID;
    }

    function handleStationListPayload(payload) {
        const stations = Array.isArray(payload)
            ? payload
            : (
                payload &&
                Array.isArray(payload.data)
                    ? payload.data
                    : null
            );

        if (!stations) {
            return;
        }

        const entries = [];

        for (const station of stations) {
            for (const vehicle of station?.vehicles || []) {
                if (!vehicle || !vehicle.id) {
                    continue;
                }

                entries.push({
                    id: vehicle.id,
                    callsign:
                        vehicle.callsign ||
                        vehicle.name ||
                        '',
                    name:
                        vehicle.name || '',
                    stationName:
                        station.name || ''
                });
            }
        }

        if (entries.length > 0) {
            addVehicleEntries(entries);
            scheduleVehicleSave();
        }
    }

    function extractVehicleDataFromPayload(
        payload,
        idHint
    ) {
        if (
            !payload ||
            typeof payload !== 'object'
        ) {
            return null;
        }

        const hasId =
            typeof payload.id === 'number' ||
            typeof payload.id === 'string';

        const hasKm =
            typeof payload.total_driven_kilometers ===
            'number';

        if (hasId && hasKm) {
            if (
                !idHint ||
                String(payload.id) ===
                    String(idHint)
            ) {
                return payload;
            }

            return null;
        }

        if (Array.isArray(payload)) {
            for (const item of payload) {
                const found =
                    extractVehicleDataFromPayload(
                        item,
                        idHint
                    );

                if (found) {
                    return found;
                }
            }

            return null;
        }

        for (const key of Object.keys(payload)) {
            const value = payload[key];

            if (
                value &&
                typeof value === 'object'
            ) {
                const found =
                    extractVehicleDataFromPayload(
                        value,
                        idHint
                    );

                if (found) {
                    return found;
                }
            }
        }

        return null;
    }

    function extractVehicleIdFromURL(url) {
        if (!url) {
            return '';
        }

        const match =
            url.match(/[?&]vehicleId=([^&]+)/);

        return match
            ? decodeURIComponent(match[1])
            : '';
    }

    function handleVehicleDataPayload(
        payload,
        idHint
    ) {
        const vehicle =
            extractVehicleDataFromPayload(
                payload,
                idHint
            );

        if (
            !vehicle ||
            typeof vehicle.total_driven_kilometers !==
                'number'
        ) {
            return;
        }

        const vehicleId =
            typeof vehicle.id === 'number' ||
            typeof vehicle.id === 'string'
                ? vehicle.id
                : idHint;

        if (!vehicleId) {
            return;
        }

        vehicleDistance.set(vehicleId, {
            km: vehicle.total_driven_kilometers,
            fetchedAt: Date.now()
        });

        scheduleVehicleSave();
    }

    function installVehicleNetworkHooks() {
        if (vehicleHooksInstalled) {
            return;
        }

        vehicleHooksInstalled = true;

        const originalFetch = window.fetch;

        if (typeof originalFetch === 'function') {
            window.fetch = function (
                input,
                init
            ) {
                const url =
                    typeof input === 'string'
                        ? input
                        : (
                            input &&
                            typeof input.url === 'string'
                                ? input.url
                                : ''
                        );

                trackGameSessionIDFromURL(url);

                const request =
                    originalFetch.apply(
                        this,
                        arguments
                    );

                if (
                    url.includes(
                        VEHICLE_STATIONS_URL
                    )
                ) {
                    request.then(response => {
                        if (
                            response &&
                            response.ok
                        ) {
                            response
                                .clone()
                                .json()
                                .then(
                                    handleStationListPayload
                                )
                                .catch(() => {});
                        }
                    }).catch(() => {});
                } else if (
                    url.includes(
                        VEHICLE_DATA_URL
                    )
                ) {
                    request.then(response => {
                        if (
                            response &&
                            response.ok
                        ) {
                            response
                                .clone()
                                .json()
                                .then(payload => {
                                    handleVehicleDataPayload(
                                        payload,
                                        extractVehicleIdFromURL(
                                            url
                                        )
                                    );
                                })
                                .catch(() => {});
                        }
                    }).catch(() => {});
                }

                return request;
            };
        }

        const originalOpen =
            XMLHttpRequest.prototype.open;

        XMLHttpRequest.prototype.open =
            function (method, url) {
                this._afiliaRequestURL =
                    String(url || '');

                trackGameSessionIDFromURL(
                    this._afiliaRequestURL
                );

                return originalOpen.apply(
                    this,
                    arguments
                );
            };

        const originalSend =
            XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.send =
            function () {
                this.addEventListener(
                    'load',
                    () => {
                        try {
                            const url =
                                this._afiliaRequestURL ||
                                '';

                            if (
                                !url ||
                                this.status < 200 ||
                                this.status >= 300 ||
                                !this.responseText
                            ) {
                                return;
                            }

                            const payload =
                                JSON.parse(
                                    this.responseText
                                );

                            if (
                                url.includes(
                                    VEHICLE_STATIONS_URL
                                )
                            ) {
                                handleStationListPayload(
                                    payload
                                );
                            } else if (
                                url.includes(
                                    VEHICLE_DATA_URL
                                )
                            ) {
                                handleVehicleDataPayload(
                                    payload,
                                    extractVehicleIdFromURL(
                                        url
                                    )
                                );
                            }
                        } catch (error) {
                            /* ignore malformed payloads */
                        }
                    }
                );

                return originalSend.apply(
                    this,
                    arguments
                );
            };
    }

    async function ensureVehicleCatalog(force) {
        if (!resolveGameSessionID()) {
            return;
        }

        if (
            vehicleCatalog.size === 0 &&
            !force
        ) {
            const cached =
                await dbGet(VEHICLE_CATALOG_KEY);

            if (
                cached &&
                Array.isArray(cached.entries)
            ) {
                buildVehicleCatalogFromEntries(
                    cached.entries
                );
            }
        }

        if (vehicleCatalog.size > 0 && !force) {
            return;
        }

        const entries = [];
        let page = 1;

        for (;;) {
            let stations = [];

            try {
                const params =
                    new URLSearchParams({
                        gameSessionId: gameSessionID,
                        page: String(page),
                        per_page: String(
                            VEHICLE_STATION_PAGE_SIZE
                        )
                    });

                const response =
                    await fetch(
                        `${VEHICLE_STATIONS_URL}?${params}`,
                        {
                            credentials: 'include'
                        }
                    );

                if (!response.ok) {
                    break;
                }

                const payload =
                    await response.json();

                stations =
                    Array.isArray(payload)
                        ? payload
                        : (
                            payload &&
                            Array.isArray(payload.data)
                                ? payload.data
                                : []
                        );
            } catch (error) {
                console.debug(
                    '[Afilia Toolbox] Vehicle list fetch failed:',
                    error
                );

                break;
            }

            for (const station of stations) {
                for (const vehicle of station?.vehicles || []) {
                    if (!vehicle || !vehicle.id) {
                        continue;
                    }

                    entries.push({
                        id: vehicle.id,
                        callsign:
                            vehicle.callsign ||
                            vehicle.name ||
                            '',
                        name:
                            vehicle.name || '',
                        stationName:
                            station.name || ''
                    });
                }
            }

            if (
                stations.length <
                VEHICLE_STATION_PAGE_SIZE
            ) {
                break;
            }

            if (
                page >= VEHICLE_STATION_MAX_PAGES
            ) {
                break;
            }

            page += 1;
        }

        if (entries.length === 0) {
            return;
        }

        addVehicleEntries(entries);

        try {
            await dbSet(VEHICLE_CATALOG_KEY, {
                entries: Array.from(
                    vehicleCatalog.values()
                ),
                savedAt: Date.now()
            });
        } catch (error) {
            console.debug(
                '[Afilia Toolbox] Vehicle catalog save failed:',
                error
            );
        }
    }

    function isVehicleDistanceFresh(id) {
        const entry =
            vehicleDistance.get(id);

        return (
            !!entry &&
            Date.now() - entry.fetchedAt <
                VEHICLE_DISTANCE_TTL
        );
    }

    async function fetchVehicleDistance(id) {
        if (!resolveGameSessionID()) {
            return false;
        }

        try {
            const params =
                new URLSearchParams({
                    gameSessionId: gameSessionID,
                    vehicleId: id
                });

            const response =
                await fetch(
                    `${VEHICLE_DATA_URL}?${params}`,
                    {
                        credentials: 'include',
                        headers: {
                            accept: 'application/json'
                        }
                    }
                );

            if (!response.ok) {
                return false;
            }

            const payload =
                await response.json();

            const vehicle =
                extractVehicleDataFromPayload(
                    payload,
                    id
                );

            if (
                vehicle &&
                typeof vehicle.total_driven_kilometers ===
                    'number'
            ) {
                const vehicleId =
                    typeof vehicle.id === 'number' ||
                    typeof vehicle.id === 'string'
                        ? vehicle.id
                        : id;

                vehicleDistance.set(vehicleId, {
                    km:
                        vehicle.total_driven_kilometers,
                    fetchedAt: Date.now()
                });

                return true;
            }

            return false;
        } catch (error) {
            return false;
        }
    }

    async function loadVehicleDistances(
        onProgress,
        force
    ) {
        if (vehicleLoadPromise) {
            return vehicleLoadPromise;
        }

        if (
            !force &&
            Date.now() < vehicleNextLoadAt
        ) {
            return Promise.resolve();
        }

        vehicleLoadPromise = (async () => {
            try {
                await ensureVehicleCatalog(force);

                const ids =
                    Array.from(
                        vehicleCatalog.keys()
                    );

                const missing = force
                    ? ids.slice()
                    : ids.filter(id => {
                          return !isVehicleDistanceFresh(
                              id
                          );
                      });

                if (missing.length === 0) {
                    return;
                }

                let known =
                    ids.length - missing.length;
                let failed = 0;

                for (
                    let index = 0;
                    index < missing.length;
                    index +=
                        VEHICLE_DISTANCE_CONCURRENCY
                ) {
                    const batch = missing.slice(
                        index,
                        index +
                            VEHICLE_DISTANCE_CONCURRENCY
                    );

                    const results =
                        await Promise.all(
                            batch.map(
                                fetchVehicleDistance
                            )
                        );

                    known +=
                        results.filter(
                            Boolean
                        ).length;

                    failed +=
                        results.filter(
                            result => !result
                        ).length;

                    if (onProgress) {
                        onProgress(
                            known,
                            failed,
                            ids.length,
                            false
                        );
                    }

                    if (
                        index +
                            VEHICLE_DISTANCE_CONCURRENCY >=
                            missing.length ||
                        known %
                            (VEHICLE_DISTANCE_CONCURRENCY *
                                3) ===
                            0
                    ) {
                        refreshVehicleSortView();
                    }

                    await delay(
                        VEHICLE_DISTANCE_BATCH_DELAY
                    );
                }

                if (onProgress) {
                    onProgress(
                        known,
                        failed,
                        ids.length,
                        true
                    );
                }

                if (failed > 0) {
                    console.debug(
                        '[Afilia Toolbox] Vehicle km fetch failed:',
                        failed,
                        'of',
                        ids.length
                    );
                }

                scheduleVehicleSave();
            } finally {
                vehicleLoadPromise = null;

                vehicleNextLoadAt =
                    Date.now() +
                    VEHICLE_DISTANCE_RELOAD_DELAY;
            }
        })();

        return vehicleLoadPromise;
    }

    function forceReloadVehicleDistances() {
        if (vehicleLoadPromise) {
            return;
        }

        vehicleNextLoadAt = 0;

        loadVehicleDistances(
            (
                known,
                failed,
                total,
                completed
            ) => {
                updateVehicleSortStatus(
                    known,
                    failed,
                    total,
                    completed
                );

                refreshVehicleSortView();
            },
            true
        ).catch(() => {});
    }

    function formatKilometers(km) {
        const number = Number(km);

        if (Number.isNaN(number)) {
            return '–';
        }

        return number.toLocaleString('de-DE', {
            maximumFractionDigits:
                number % 1 === 0 ? 0 : 1
        });
    }

    function findVehicleRows() {
        return Array.from(
            document.querySelectorAll(
                'div[class*="cursor-pointer"]'
            )
        ).filter(element => {
            return isVehicleRow(element);
        });
    }

    function isVehicleRow(element) {
        if (
            !element ||
            element.nodeType !== 1
        ) {
            return false;
        }

        if (
            !Array.from(
                element.classList
            ).includes(
                'cursor-pointer'
            )
        ) {
            return false;
        }

        const badge = element.querySelector(
            ':scope > span[title^="Status "]'
        );

        const name =
            getVehicleRowNameElement(element);

        return !!(badge && name);
    }

    function getVehicleRowNameElement(row) {
        const direct = row.querySelector(
            ':scope > span.text-gray-700.truncate.flex-1[title]'
        );

        if (direct) {
            return direct;
        }

        return Array.from(
            row.children
        ).find(child => {
            if (child.tagName !== 'SPAN') {
                return false;
            }

            const title =
                child.getAttribute('title');

            return (
                !!title &&
                !title.startsWith('Status ')
            );
        }) || null;
    }

    function getVehicleRowCallsign(row) {
        const name =
            getVehicleRowNameElement(row);

        if (!name) {
            return '';
        }

        return (
            name.getAttribute('title') ||
            name.textContent ||
            ''
        ).trim();
    }

    function getVehicleIDForCallsign(
        callsign
    ) {
        if (!callsign) {
            return '';
        }

        return (
            vehicleCatalogByCallsign.get(
                getAAOKey(callsign)
            ) || ''
        );
    }

    function getRowKilometers(row) {
        const id = getVehicleIDForCallsign(
            getVehicleRowCallsign(row)
        );

        const entry =
            id ? vehicleDistance.get(id) : null;

        return entry ? entry.km : null;
    }

    function setRowKilometers(row, km) {
        let label = row.querySelector(
            `.${VEHICLE_KM_CLASS}`
        );

        if (!label) {
            label =
                document.createElement('span');

            label.className =
                `${VEHICLE_KM_CLASS} flex-shrink-0`;

            row.appendChild(label);
        }

        const text =
            km == null
                ? '–'
                : `${formatKilometers(km)} km`;

        if (label.textContent !== text) {
            label.textContent = text;
        }

        updateRowMileageWarning(row, label, km);
    }

    function updateRowMileageWarning(row, label, km) {
        let warning = row.querySelector(
            `.${VEHICLE_KM_WARNING_CLASS}`
        );

        const needsWarning =
            typeof km === 'number' &&
            km >= VEHICLE_HIGH_MILEAGE_KM;

        if (!needsWarning) {
            if (warning) {
                warning.remove();
            }

            return;
        }

        if (!warning) {
            warning =
                document.createElement('button');

            warning.type = 'button';

            warning.className =
                `${VEHICLE_KM_WARNING_CLASS} flex-shrink-0`;

            warning.title = 'Erhöhte Laufleistung';

            warning.setAttribute(
                'aria-label',
                'Warnung: erhöhte Laufleistung'
            );

            warning.textContent = '⚠';

            warning.addEventListener(
                'click',
                event => {
                    event.preventDefault();
                    event.stopPropagation();

                    showVehicleMileageWarningPopup(
                        warning
                    );
                }
            );

            label.insertAdjacentElement(
                'afterend',
                warning
            );
        }
    }

    function showVehicleMileageWarningPopup(anchor) {
        closeVehicleMileageWarningPopup();

        const popup =
            document.createElement('div');

        popup.id =
            VEHICLE_MILEAGE_WARNING_POPUP_ID;

        popup.className =
            'afilia-vehicle-mileage-warning-popup';

        popup.setAttribute('role', 'dialog');

        popup.innerHTML = `
            <div class="afilia-vehicle-mileage-warning-popup-title">⚠ Erhöhte Laufleistung</div>
            <div class="afilia-vehicle-mileage-warning-popup-text">Fahrzeug weist erhöhte Laufleistung auf. Reparatur könnte bald teurer werden.</div>
            <button type="button" class="afilia-vehicle-mileage-warning-popup-close">Verstanden</button>
        `;

        document.body.appendChild(popup);

        positionVehicleMileageWarningPopup(
            popup,
            anchor
        );

        const closeButton = popup.querySelector(
            '.afilia-vehicle-mileage-warning-popup-close'
        );

        closeButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            closeVehicleMileageWarningPopup();
        });

        const onDocumentClick = event => {
            if (popup.contains(event.target)) {
                return;
            }

            closeVehicleMileageWarningPopup();
        };

        const onKeydown = event => {
            if (event.key === 'Escape') {
                closeVehicleMileageWarningPopup();
            }
        };

        const onViewportChange = () => {
            closeVehicleMileageWarningPopup();
        };

        vehicleMileageWarningPopup = {
            popup,
            onDocumentClick,
            onKeydown,
            onViewportChange
        };

        setTimeout(() => {
            if (
                !vehicleMileageWarningPopup ||
                vehicleMileageWarningPopup.popup !==
                    popup
            ) {
                return;
            }

            document.addEventListener(
                'click',
                onDocumentClick
            );

            document.addEventListener(
                'keydown',
                onKeydown
            );

            window.addEventListener(
                'scroll',
                onViewportChange,
                true
            );

            window.addEventListener(
                'resize',
                onViewportChange
            );
        }, 0);
    }

    function positionVehicleMileageWarningPopup(
        popup,
        anchor
    ) {
        if (!anchor || !anchor.getBoundingClientRect) {
            popup.style.left = '50%';
            popup.style.top = '50%';
            popup.style.transform =
                'translate(-50%, -50%)';

            return;
        }

        const anchorRect =
            anchor.getBoundingClientRect();

        const popupRect =
            popup.getBoundingClientRect();

        const margin = 8;

        let left =
            anchorRect.right - popupRect.width;

        left = Math.max(
            margin,
            Math.min(
                left,
                window.innerWidth -
                    popupRect.width -
                    margin
            )
        );

        let top = anchorRect.bottom + margin;

        if (
            top + popupRect.height >
            window.innerHeight - margin
        ) {
            top =
                anchorRect.top -
                popupRect.height -
                margin;
        }

        top = Math.max(
            margin,
            Math.min(
                top,
                window.innerHeight -
                    popupRect.height -
                    margin
            )
        );

        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
    }

    function closeVehicleMileageWarningPopup() {
        if (!vehicleMileageWarningPopup) {
            return;
        }

        const {
            popup,
            onDocumentClick,
            onKeydown,
            onViewportChange
        } = vehicleMileageWarningPopup;

        document.removeEventListener(
            'click',
            onDocumentClick
        );

        document.removeEventListener(
            'keydown',
            onKeydown
        );

        window.removeEventListener(
            'scroll',
            onViewportChange,
            true
        );

        window.removeEventListener(
            'resize',
            onViewportChange
        );

        if (popup && popup.parentElement) {
            popup.remove();
        }

        vehicleMileageWarningPopup = null;
    }

    function clearRowKilometers(row) {
        for (const selector of [
            `.${VEHICLE_KM_CLASS}`,
            `.${VEHICLE_KM_WARNING_CLASS}`
        ]) {
            const element =
                row.querySelector(selector);

            if (element) {
                element.remove();
            }
        }
    }

    function getVehicleRowGroups() {
        const groups = new Map();

        for (const row of findVehicleRows()) {
            const parent = row.parentElement;

            if (!parent) {
                continue;
            }

            if (!groups.has(parent)) {
                groups.set(parent, []);
            }

            groups.get(parent).push(row);
        }

        return groups;
    }

    function sameElementOrder(left, right) {
        if (left.length !== right.length) {
            return false;
        }

        for (
            let index = 0;
            index < left.length;
            index += 1
        ) {
            if (left[index] !== right[index]) {
                return false;
            }
        }

        return true;
    }

    function captureNativeVehicleOrder(groups) {
        for (const [parent, rows] of groups) {
            const callsigns =
                rows.map(getVehicleRowCallsign);

            const existing =
                vehicleNativeOrder.get(parent);

            if (!existing) {
                vehicleNativeOrder.set(
                    parent,
                    callsigns
                );
            } else {
                const known = new Set(existing);

                for (const callsign of callsigns) {
                    if (!known.has(callsign)) {
                        existing.push(callsign);
                    }
                }
            }
        }
    }

    function applyVehicleSortToGroups() {
        const groups =
            getVehicleRowGroups();

        for (const [parent, rows] of groups) {
            const mapped = rows
                .map(row => ({
                    row,
                    km: getRowKilometers(row)
                }))
                .sort((left, right) => {
                    const leftKM =
                        left.km == null
                            ? -1
                            : left.km;

                    const rightKM =
                        right.km == null
                            ? -1
                            : right.km;

                    if (rightKM === leftKM) {
                        return getVehicleRowCallsign(
                            left.row
                        ).localeCompare(
                            getVehicleRowCallsign(
                                right.row
                            ),
                            'de',
                            {
                                sensitivity:
                                    'base'
                            }
                        );
                    }

                    return rightKM - leftKM;
                });

            if (
                mapped.every(
                    item => item.km == null
                )
            ) {
                continue;
            }

            const desired =
                mapped.map(item => item.row);

            if (
                !sameElementOrder(
                    rows,
                    desired
                )
            ) {
                for (const item of mapped) {
                    parent.appendChild(
                        item.row
                    );
                }
            }
        }
    }

    function restoreNativeVehicleOrder() {
        for (const [parent, callsigns] of
            vehicleNativeOrder) {
            if (
                !parent ||
                !parent.isConnected
            ) {
                continue;
            }

            const rowsByCallsign =
                new Map();

            for (const child of Array.from(
                parent.children
            )) {
                if (isVehicleRow(child)) {
                    rowsByCallsign.set(
                        getVehicleRowCallsign(
                            child
                        ),
                        child
                    );
                }
            }

            const restored =
                callsigns.map(callsign => {
                    return rowsByCallsign.get(
                        callsign
                    );
                }).filter(Boolean);

            const known =
                new Set(callsigns);

            const remaining =
                Array.from(
                    rowsByCallsign.keys()
                ).filter(callsign => {
                    return !known.has(
                        callsign
                    );
                });

            const current =
                Array.from(
                    parent.children
                ).filter(isVehicleRow);

            const desired =
                restored.concat(
                    remaining.map(callsign => {
                        return rowsByCallsign.get(
                            callsign
                        );
                    })
                );

            if (
                !sameElementOrder(
                    current,
                    desired
                )
            ) {
                for (const row of restored) {
                    parent.appendChild(row);
                }

                for (const callsign of remaining) {
                    parent.appendChild(
                        rowsByCallsign.get(
                            callsign
                        )
                    );
                }
            }
        }

        vehicleNativeOrder.clear();
    }

    function findVehicleSortAnchor() {
        return Array.from(
            document.querySelectorAll(
                'button[data-slot="tooltip-trigger"], [data-slot="tooltip-trigger"]'
            )
        ).find(button => {
            if (
                !button.isConnected ||
                button.id ===
                    VEHICLE_SORT_CLUSTER_ID ||
                button.closest(
                    `#${VEHICLE_SORT_CLUSTER_ID}`
                )
            ) {
                return false;
            }

            if (
                !button.querySelector(
                    'i[class*="fa-wrench"]'
                )
            ) {
                return false;
            }

            const rects =
                button.getClientRects();

            return rects.length > 0;
        }) || null;
    }

    function upsertVehicleSortCluster() {
        const anchor =
            findVehicleSortAnchor();

        const rows =
            findVehicleRows();

        if (
            !anchor &&
            rows.length === 0
        ) {
            return false;
        }

        const useAnchor =
            !!anchor &&
            anchor.isConnected;

        const insertionPoint =
            useAnchor
                ? anchor
                : (
                    rows.length > 0
                        ? rows[0].parentElement
                        : null
                );

        if (
            !insertionPoint ||
            !insertionPoint.parentElement
        ) {
            return false;
        }

        const root =
            insertionPoint.parentElement;

        let cluster =
            document.getElementById(
                VEHICLE_SORT_CLUSTER_ID
            );

        if (
            cluster &&
            cluster.parentElement !== root
        ) {
            root.insertBefore(
                cluster,
                useAnchor
                    ? anchor.nextSibling
                    : insertionPoint
            );
        }

        if (!cluster) {
            cluster =
                document.createElement('div');

            cluster.id =
                VEHICLE_SORT_CLUSTER_ID;

            cluster.className =
                'afilia-vehicle-sort-cluster';

            if (useAnchor) {
                cluster.classList.add(
                    'afilia-vehicle-sort-cluster-inline'
                );
            } else {
                cluster.classList.add(
                    'afilia-vehicle-sort-cluster-block'
                );
            }

            root.insertBefore(
                cluster,
                useAnchor
                    ? anchor.nextSibling
                    : insertionPoint
            );
        }

        return true;
    }

    function renderVehicleSortClusterContent() {
        const cluster =
            document.getElementById(
                VEHICLE_SORT_CLUSTER_ID
            );

        if (!cluster) {
            return;
        }

        if (
            !cluster.querySelector(
                '.afilia-vehicle-sort-toggle'
            )
        ) {
            cluster.innerHTML = `
                <button
                    type="button"
                    class="afilia-vehicle-sort-toggle"
                    aria-pressed="${vehicleSortActive ? 'true' : 'false'}"
                    title="Fahrzeuge nach gefahrenen Kilometern sortieren"
                >
                    <span class="afilia-vehicle-sort-toggle-icon">↕</span>
                    <span class="afilia-vehicle-sort-toggle-label">
                        ${
                            vehicleSortActive
                                ? 'Nach km sortiert'
                                : 'Nach km sortieren'
                        }
                    </span>
                </button>

                <span class="afilia-vehicle-sort-status"></span>

                <button
                    type="button"
                    class="afilia-vehicle-sort-reload"
                    title="Kilometerstände jetzt neu laden"
                    aria-label="Kilometerstände jetzt neu laden"
                >
                    <span class="afilia-vehicle-sort-reload-icon">⟳</span>
                </button>
            `;

            cluster.querySelector(
                '.afilia-vehicle-sort-toggle'
            ).addEventListener(
                'click',
                event => {
                    event.preventDefault();
                    event.stopPropagation();

                    toggleVehicleSort();
                }
            );

            cluster.querySelector(
                '.afilia-vehicle-sort-reload'
            ).addEventListener(
                'click',
                event => {
                    event.preventDefault();
                    event.stopPropagation();

                    forceReloadVehicleDistances();
                }
            );
        }

        const toggle = cluster.querySelector(
            '.afilia-vehicle-sort-toggle'
        );

        toggle.setAttribute(
            'aria-pressed',
            vehicleSortActive
                ? 'true'
                : 'false'
        );

        toggle.querySelector(
            '.afilia-vehicle-sort-toggle-label'
        ).textContent =
            vehicleSortActive
                ? 'Nach km sortiert'
                : 'Nach km sortieren';

        const reload = cluster.querySelector(
            '.afilia-vehicle-sort-reload'
        );

        if (reload) {
            reload.hidden = !vehicleSortActive;
        }
    }

    function updateVehicleSortStatus(
        known,
        failed,
        total,
        completed
    ) {
        const cluster =
            document.getElementById(
                VEHICLE_SORT_CLUSTER_ID
            );

        if (!cluster) {
            return;
        }

        const status = cluster.querySelector(
            '.afilia-vehicle-sort-status'
        );

        if (!status) {
            return;
        }

        if (!vehicleSortActive) {
            vehicleStatusLockUntil = 0;
            vehicleStatusDoneUntil = 0;

            if (vehicleStatusHideTimer) {
                clearTimeout(
                    vehicleStatusHideTimer
                );

                vehicleStatusHideTimer = null;
            }

            if (status.textContent) {
                status.textContent = '';
            }

            return;
        }

        if (
            typeof known === 'number' &&
            typeof total === 'number'
        ) {
            const failedCount =
                typeof failed === 'number'
                    ? failed
                    : 0;

            const isCompleted =
                completed === true;

            let text =
                `km geladen: ${known}/${total}`;

            if (
                isCompleted &&
                failedCount > 0
            ) {
                text +=
                    ` (${failedCount} fehlgeschlagen)`;
            } else if (
                isCompleted &&
                known >= total
            ) {
                text += ' ✓';
            }

            if (status.textContent !== text) {
                status.textContent = text;
            }

            if (isCompleted) {
                vehicleStatusDoneUntil =
                    Date.now() +
                    VEHICLE_DONE_HIDE_DELAY;

                if (vehicleStatusHideTimer) {
                    clearTimeout(
                        vehicleStatusHideTimer
                    );
                }

                vehicleStatusHideTimer =
                    setTimeout(() => {
                        vehicleStatusHideTimer =
                            null;

                        vehicleStatusDoneUntil = 0;

                        const clusterElement =
                            document.getElementById(
                                VEHICLE_SORT_CLUSTER_ID
                            );

                        const statusElement =
                            clusterElement?.querySelector(
                                '.afilia-vehicle-sort-status'
                            );

                        if (
                            statusElement &&
                            statusElement.textContent
                        ) {
                            statusElement.textContent =
                                '';
                        }
                    }, VEHICLE_DONE_HIDE_DELAY);
            } else {
                vehicleStatusDoneUntil = 0;

                if (vehicleStatusHideTimer) {
                    clearTimeout(
                        vehicleStatusHideTimer
                    );

                    vehicleStatusHideTimer = null;
                }
            }

            vehicleStatusLockUntil =
                Date.now() + 2500;

            return;
        }

        if (Date.now() < vehicleStatusLockUntil) {
            return;
        }

        if (Date.now() < vehicleStatusDoneUntil) {
            return;
        }

        if (vehicleStatusDoneUntil > 0) {
            vehicleStatusDoneUntil = 0;

            if (status.textContent) {
                status.textContent = '';
            }
        } else if (vehicleLoadPromise) {
            if (
                status.textContent !==
                'km werden geladen …'
            ) {
                status.textContent =
                    'km werden geladen …';
            }
        } else if (status.textContent) {
            status.textContent = '';
        }
    }

    function refreshVehicleSortView() {
        if (!vehicleSortActive) {
            restoreNativeVehicleOrder();

            for (const row of findVehicleRows()) {
                clearRowKilometers(row);
            }

            updateVehicleSortStatus(
                0,
                0
            );

            return;
        }

        const groups =
            getVehicleRowGroups();

        if (groups.size > 0) {
            captureNativeVehicleOrder(
                groups
            );
        }

        applyVehicleSortToGroups();

        for (const row of findVehicleRows()) {
            setRowKilometers(
                row,
                getRowKilometers(row)
            );
        }

        updateVehicleSortStatus();
    }

    async function toggleVehicleSort() {
        vehicleSortActive =
            !vehicleSortActive;

        try {
            await dbSet(
                VEHICLE_SORT_PREFS_KEY,
                { active: vehicleSortActive }
            );
        } catch (error) {
            console.debug(
                '[Afilia Toolbox] Sort pref save failed:',
                error
            );
        }

        renderVehicleSortClusterContent();

        refreshVehicleSortView();

        if (vehicleSortActive) {
            vehicleNextLoadAt = 0;

            loadVehicleDistances(
                (
                    known,
                    failed,
                    total,
                    completed
                ) => {
                    updateVehicleSortStatus(
                        known,
                        failed,
                        total,
                        completed
                    );
                }
            ).catch(() => {});
        }
    }

    function updateVehicleSortView() {
        const hasRows =
            findVehicleRows().length > 0;

        if (!hasRows) {
            vehicleTabPresent = false;

            vehicleNativeOrder.clear();

            return;
        }

        if (!upsertVehicleSortCluster()) {
            return;
        }

        renderVehicleSortClusterContent();

        refreshVehicleSortView();

        if (
            vehicleSortActive &&
            !vehicleLoadPromise &&
            Date.now() >= vehicleNextLoadAt
        ) {
            loadVehicleDistances(
                (
                    known,
                    failed,
                    total,
                    completed
                ) => {
                    updateVehicleSortStatus(
                        known,
                        failed,
                        total,
                        completed
                    );

                    refreshVehicleSortView();
                }
            ).catch(() => {});
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
               Vehicle kilometre sort
               ===================================================== */

            .afilia-vehicle-sort-cluster {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .afilia-vehicle-sort-cluster-block {
                width: 100%;
                padding: 6px 8px;
                margin-bottom: 4px;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
                background: #ffffff;
            }

            .afilia-vehicle-sort-toggle {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 5px 10px;
                border: 1px solid #d1d5db;
                border-radius: 8px;
                background: #ffffff;
                color: #111827;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
            }

            .afilia-vehicle-sort-cluster-inline
            .afilia-vehicle-sort-toggle {
                height: 32px;
                padding: 0 10px;
                border-color: #d1d5db;
            }

            .afilia-vehicle-sort-toggle:hover {
                background: #f3f4f6;
            }

            .afilia-vehicle-sort-toggle[aria-pressed="true"] {
                border-color: #ef4444;
                background: #fef2f2;
                color: #dc2626;
            }

            .afilia-vehicle-sort-reload {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                width: 32px;
                height: 32px;
                padding: 0;
                border: 1px solid #d1d5db;
                border-radius: 8px;
                background: #ffffff;
                color: #374151;
                font-size: 16px;
                line-height: 1;
                cursor: pointer;
            }

            .afilia-vehicle-sort-reload:hover {
                background: #f3f4f6;
            }

            .afilia-vehicle-sort-reload[hidden] {
                display: none;
            }

            .afilia-vehicle-sort-cluster-inline
            .afilia-vehicle-sort-reload {
                height: 32px;
            }

            .afilia-vehicle-sort-status {
                font-size: 11px;
                color: #6b7280;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .afilia-vehicle-sort-cluster-inline
            .afilia-vehicle-sort-status {
                max-width: 120px;
            }

            .afilia-vehicle-km {
                flex-shrink: 0;
                font-size: 11px;
                color: #6b7280;
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
            }

            .afilia-vehicle-km-warning {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                width: 18px;
                height: 18px;
                padding: 0;
                border: 1px solid #fcd34d;
                border-radius: 5px;
                background: #fef3c7;
                color: #b45309;
                font-size: 12px;
                line-height: 1;
                cursor: pointer;
            }

            .afilia-vehicle-km-warning:hover {
                background: #fde68a;
            }

            .afilia-vehicle-mileage-warning-popup {
                position: fixed;
                z-index: 2147483000;
                width: min(300px, calc(100vw - 24px));
                padding: 12px 14px;
                border: 1px solid #fcd34d;
                border-radius: 10px;
                background: #fffbeb;
                box-shadow: 0 12px 32px rgba(17, 24, 39, 0.25);
                color: #78350f;
                font-size: 13px;
                box-sizing: border-box;
            }

            .afilia-vehicle-mileage-warning-popup-title {
                margin-bottom: 6px;
                color: #92400e;
                font-size: 13px;
                font-weight: 700;
            }

            .afilia-vehicle-mileage-warning-popup-text {
                margin-bottom: 10px;
                line-height: 1.5;
            }

            .afilia-vehicle-mileage-warning-popup-close {
                padding: 5px 12px;
                border: 1px solid #f59e0b;
                border-radius: 6px;
                background: #f59e0b;
                color: #ffffff;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
            }

            .afilia-vehicle-mileage-warning-popup-close:hover {
                background: #d97706;
                border-color: #d97706;
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

        updateVehicleSortView();
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

            installVehicleNetworkHooks();

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
