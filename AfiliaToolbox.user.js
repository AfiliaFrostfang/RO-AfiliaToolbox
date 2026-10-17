// ==UserScript==
// @name         Afilia Toolbox
// @namespace    https://afiliafrostfang.de/
// @version      1.14.0
// @description  Afilia Toolbox for Rescue Operator with an Applet Store.
// @author       AfiliaFrostfang
// @discord      https://discord.gg/h6HEjwaMpW
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
    const SCRIPT_VERSION = '1.14.0';
    const UPDATE_MANIFEST_URL =
        'https://afiliafrostfang.github.io/RO-AfiliaToolbox/version.json';
    const APPLET_MANIFEST_URL =
        'https://afiliafrostfang.github.io/RO-AfiliaToolbox/applets/manifest.json';
    const CHANGELOG_URL =
        'https://afiliafrostfang.github.io/RO-AfiliaToolbox/changelog.json';
    const APPLETS_BASE_URL =
        'https://afiliafrostfang.github.io/RO-AfiliaToolbox/';
    const PROJECT_URL =
        'https://github.com/AfiliaFrostfang/RO-AfiliaToolbox';

    const UPDATE_NOTICE_ID = 'afilia-aao-update-notice';
    const CHANGELOG_STORE_KEY = 'lastSeenVersion';
    const CHANGELOG_APPLETS_KEY = 'lastSeenAppletVersions';
    const CHANGELOG_POPUP_ID = 'afilia-changelog-popup';
    const ENABLED_APPLETS_KEY = 'enabledApplets';
    const STORE_PANEL_ID = 'afilia-applet-store';
    const STORE_BUTTON_CLASS = 'afilia-store-button';

    /* Alle Applet-Icons liegen gesammelt in einem aufklappbaren
       Slot direkt unter dem Toolbox-Button. Der Store-Button bleibt
       davon unberührt und steht weiterhin oben in der Leiste. */

    const TOOLBOX_BUTTON_CLASS = 'afilia-toolbox-button';
    const TOOLBOX_SLOT_CLASS = 'afilia-toolbox-slot';
    const TOOLBOX_SLOT_ITEM_HEIGHT = 48;
    const TOOLBOX_SLOT_MAX_ITEMS = 5;
    const TOOLBOX_SLOT_MAX_VIEWPORT = '40vh';

    /* =========================================================
       Runtime state
       ========================================================= */

    let db = null;

    let observer = null;
    let scanTimer = null;

    let lastStoreContainer = null;
    let lastToolboxContainer = null;
    let toolboxExpanded = false;

    const appletRegistry = new Map();
    let appletStates = {};

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

    /* =========================================================
       Applet context (public API for applets)
       ========================================================= */

    const appletContext = {
        dbGet,
        dbSet,
        escapeHTML,
        normalizeName,
        getAAOKey,
        createID,
        getAppletSlot,
        mountAppletButton
    };

    /* =========================================================
       Applet registry
       ========================================================= */

    function registerApplet(applet) {
        if (
            !applet ||
            typeof applet.id !== 'string' ||
            appletRegistry.has(applet.id)
        ) {
            return;
        }

        appletRegistry.set(applet.id, applet);
    }

    function collectQueuedApplets() {
        const queue = window.__AFILIA_APPLET_QUEUE__ || [];

        for (const applet of queue) {
            registerApplet(applet);
        }

        window.__AFILIA_APPLET_QUEUE__ = [];
    }

    /* =========================================================
       Runtime applet loading
       ========================================================= */

    async function fetchNoStore(url) {
        const response = await fetch(url, {
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status} for ${url}`
            );
        }

        return response;
    }

    async function loadRuntimeApplet(entry) {
        const url =
            `${APPLETS_BASE_URL}${entry.file}?v=${encodeURIComponent(entry.version)}`;

        const response = await fetchNoStore(url);

        const source = await response.text();

        const execute = new Function(
            `${source}\n//# sourceURL=${entry.file}`
        );

        execute();
    }

    async function loadRuntimeApplets() {
        let manifest;

        try {
            const response = await fetchNoStore(APPLET_MANIFEST_URL);

            manifest = await response.json();
        } catch (error) {
            console.error(
                '[Afilia Toolbox] Failed to fetch applet manifest:',
                error
            );

            return;
        }

        const entries = Object.entries(manifest || {});

        const results = await Promise.allSettled(
            entries.map(async ([id, entry]) => {
                try {
                    await loadRuntimeApplet(entry);

                    return { id, ok: true };
                } catch (error) {
                    return { id, ok: false, error };
                }
            })
        );

        for (const result of results) {
            if (!result.ok) {
                console.error(
                    '[Afilia Toolbox] Failed to load applet:',
                    result.value.id,
                    result.value.error
                );
            }
        }
    }

    /* =========================================================
       Applet states
       ========================================================= */

    async function loadAppletStates() {
        const stored = await dbGet(ENABLED_APPLETS_KEY);

        if (
            stored &&
            typeof stored === 'object' &&
            !Array.isArray(stored)
        ) {
            appletStates = stored;
        }
    }

    /* Bisherige Applets bleiben eingeschaltet, solange nichts
       gespeichert ist. Ein Applet kann sich mit
       'defaultEnabled: false' selbst als zunächst ausgeschaltet
       deklarieren - etwa eine Beta, die niemand automatisch
       bekommt. */

    function isAppletEnabled(id) {
        const stored = appletStates[id];

        if (typeof stored === 'boolean') {
            return stored;
        }

        const applet = appletRegistry.get(id);

        return !(applet && applet.defaultEnabled === false);
    }

    async function setAppletEnabled(id, enabled) {
        appletStates[id] = !!enabled;

        await dbSet(ENABLED_APPLETS_KEY, appletStates);
    }

    async function runAppletInit(applet) {
        if (typeof applet.init !== 'function') {
            return;
        }

        try {
            await applet.init(appletContext);
        } catch (error) {
            console.error(
                '[Afilia Toolbox] Applet init failed:',
                applet.id,
                error
            );
        }
    }

    async function runAppletDispose(applet) {
        if (typeof applet.dispose !== 'function') {
            return;
        }

        try {
            await applet.dispose(appletContext);
        } catch (error) {
            console.error(
                '[Afilia Toolbox] Applet dispose failed:',
                applet.id,
                error
            );
        }
    }

    async function initEnabledApplets() {
        for (const applet of appletRegistry.values()) {
            if (!isAppletEnabled(applet.id)) {
                continue;
            }

            await runAppletInit(applet);
        }
    }

    async function toggleApplet(id, enabled) {
        await setAppletEnabled(id, enabled);

        const applet = appletRegistry.get(id);

        if (!applet) {
            return;
        }

        if (enabled) {
            await runAppletInit(applet);

            if (typeof applet.onScan === 'function') {
                try {
                    applet.onScan(appletContext);
                } catch (error) {
                    console.error(
                        '[Afilia Toolbox] Applet scan failed:',
                        applet.id,
                        error
                    );
                }
            }
        } else {
            await runAppletDispose(applet);
        }

        /* Ein- und Ausschalten ändert die Zahl der Icons
           im aufklappbaren Slot. */

        scheduleScan();
    }

    /* =========================================================
       Update
       ========================================================= */

    function showUpdateNotice(manifest) {
        if (document.getElementById(UPDATE_NOTICE_ID)) {
            return;
        }

        const version = String(manifest.version).trim();

        const releaseURL = isHTTPURL(manifest.url)
            ? manifest.url
            : PROJECT_URL;

        const notice = document.createElement('div');

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

    async function loadChangelogData() {
        try {
            const response = await fetchNoStore(CHANGELOG_URL);

            return await response.json();
        } catch (error) {
            console.debug(
                '[Afilia Toolbox] Changelog not available:',
                error
            );

            return null;
        }
    }

    function pickNewerNotes(source, lastSeenVersion) {
        return Object.keys(source || {})
            .filter(version => {
                return (
                    compareVersions(version, lastSeenVersion) > 0 &&
                    Array.isArray(source[version]) &&
                    source[version].length > 0
                );
            })
            .sort((left, right) => compareVersions(right, left))
            .map(version => ({
                version,
                notes: source[version].map(note => String(note))
            }));
    }

    function collectAppletChangelog(data, seenApplets) {
        const entries = [];

        for (const applet of appletRegistry.values()) {
            const notes = pickNewerNotes(
                (data || {})[applet.id],
                seenApplets[applet.id] || '0'
            );

            if (notes.length === 0) {
                continue;
            }

            entries.push({
                id: applet.id,
                name: applet.name || applet.id,
                version: applet.version || '',
                notes
            });
        }

        return entries;
    }

    function markAppletsAsSeen(seenApplets) {
        const next = {
            ...seenApplets
        };

        for (const applet of appletRegistry.values()) {
            if (typeof applet.version === 'string' && applet.version) {
                next[applet.id] = applet.version;
            }
        }

        return next;
    }

    async function showChangelogPopup() {
        const data = await loadChangelogData();

        if (!data || typeof data !== 'object') {
            return;
        }

        const lastSeenVersion =
            (await dbGet(CHANGELOG_STORE_KEY)) || '';

        const seenApplets =
            (await dbGet(CHANGELOG_APPLETS_KEY)) || {};

        const toolboxEntries = pickNewerNotes(
            data.toolbox,
            lastSeenVersion
        );

        const appletEntries = collectAppletChangelog(
            data.applets,
            seenApplets
        );

        if (toolboxEntries.length === 0 && appletEntries.length === 0) {
            return;
        }

        renderChangelogPopup(toolboxEntries, appletEntries);

        await dbSet(CHANGELOG_STORE_KEY, SCRIPT_VERSION);
        await dbSet(
            CHANGELOG_APPLETS_KEY,
            markAppletsAsSeen(seenApplets)
        );
    }

    function renderChangelogPopup(toolboxEntries, appletEntries) {
        if (document.getElementById(CHANGELOG_POPUP_ID)) {
            return;
        }

        const toolboxSection = toolboxEntries.map(entry => `
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
        `).join('');

        const appletSection = appletEntries.length === 0
            ? ''
            : `
                <div class="afilia-changelog-section-title">
                    Applet-Updates
                </div>

                ${appletEntries.map(entry => `
                    <div class="afilia-changelog-applet">
                        <div class="afilia-changelog-applet-head">
                            <span class="afilia-changelog-applet-name">
                                <i class="fa-solid fa-shapes"></i>
                                ${escapeHTML(entry.name)}
                            </span>

                            ${
                                entry.version
                                    ? `
                                        <span class="afilia-changelog-applet-version">
                                            v${escapeHTML(entry.version)}
                                        </span>
                                    `
                                    : ''
                            }
                        </div>

                        ${entry.notes.map(note => `
                            <div class="afilia-changelog-version-title">
                                Version ${escapeHTML(note.version)}
                            </div>

                            <ul class="afilia-changelog-list">
                                ${note.notes.map(line => `
                                    <li>${escapeHTML(line)}</li>
                                `).join('')}
                            </ul>
                        `).join('')}
                    </div>
                `).join('')}
            `;

        const overlay = document.createElement('div');

        overlay.id = CHANGELOG_POPUP_ID;
        overlay.className = 'afilia-changelog-overlay';

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
                    ${toolboxSection}
                    ${appletSection}
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
                if (event.target === overlay) {
                    close();
                }
            }
        );

        keydownHandler = event => {
            if (event.key === 'Escape') {
                close();
            }
        };

        document.addEventListener('keydown', keydownHandler);

        document.body.appendChild(overlay);
    }

    /* =========================================================
       Applet Store UI
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

    function createStoreButton() {
        const button = document.createElement('button');

        button.type = 'button';

        button.className =
            `${STORE_BUTTON_CLASS} w-10 h-10 sm:w-10 sm:h-10 bg-dark rounded-lg shadow-lg border border-gray-800/80 hover:border-gray-700 transition-all duration-300 flex items-center justify-center cursor-pointer`;

        button.title = 'Applet Store öffnen';

        button.innerHTML =
            '<i class="fa-solid fa-puzzle-piece text-sm sm:text-sm text-white/80"></i>';

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            openStorePanel();
        });

        return button;
    }

    function hookStoreButton() {
        const container = findQuickAccessRail();

        if (!container) {
            lastStoreContainer = null;
            return;
        }

        const button = container.querySelector(
            `.${STORE_BUTTON_CLASS}`
        );

        if (
            container === lastStoreContainer &&
            button
        ) {
            return;
        }

        lastStoreContainer = container;

        if (button) {
            button.remove();
        }

        const newButton = createStoreButton();

        container.insertBefore(newButton, container.firstChild);
    }

    /* =========================================================
       Toolbox-Button und aufklappbarer Applet-Slot
       ========================================================= */

    function getToolboxButton() {
        const container = findQuickAccessRail();

        if (!container) {
            return null;
        }

        return container.querySelector(
            `.${TOOLBOX_BUTTON_CLASS}`
        );
    }

    function getAppletSlot() {
        const container = findQuickAccessRail();

        if (!container) {
            return null;
        }

        return container.querySelector(
            `.${TOOLBOX_SLOT_CLASS}`
        );
    }

    function createToolboxButton() {
        const button = document.createElement('button');

        button.type = 'button';

        button.className =
            `${TOOLBOX_BUTTON_CLASS} w-10 h-10 sm:w-10 sm:h-10 bg-dark rounded-lg shadow-lg border border-gray-800/80 hover:border-gray-700 transition-all duration-300 flex items-center justify-center cursor-pointer`;

        button.title =
            'Toolbox-Applets ein-/ausklappen';

        button.setAttribute('aria-haspopup', 'true');
        button.setAttribute('aria-expanded', 'false');

        button.innerHTML =
            '<i class="fa-solid fa-toolbox text-sm sm:text-sm text-white/80"></i>';

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            toggleToolboxSlot();
        });

        return button;
    }

    function createToolboxSlot() {
        const slot = document.createElement('div');

        slot.className =
            `${TOOLBOX_SLOT_CLASS} w-full flex flex-col items-center gap-2`;

        return slot;
    }

    /* Der Slot bekommt seine Höhe aus der Anzahl der eingehangten
       Icons, damit die Animation unabhängig von der Applet-Anzahl
       gleich schnell läuft. Ohne Icons bleibt er zu. */

    function getToolboxSlotHeight(slot) {
        const count = slot.querySelectorAll(
            ':scope > *'
        ).length;

        if (count === 0) {
            return 0;
        }

        const visible = Math.min(
            count,
            TOOLBOX_SLOT_MAX_ITEMS
        );

        return visible * TOOLBOX_SLOT_ITEM_HEIGHT;
    }

    function syncToolboxSlot() {
        const slot = getAppletSlot();

        if (!slot) {
            return;
        }

        const height = getToolboxSlotHeight(slot);

        const isOpen = toolboxExpanded && height > 0;

        slot.classList.toggle(
            'afilia-toolbox-open',
            isOpen
        );

        /* Nur schreiben, wenn sich der Wert ändert. Sonst meldet
           der MutationObserver den eigenen Scan als Änderung. */

        const maxHeight = isOpen
            ? `min(${height}px, ${TOOLBOX_SLOT_MAX_VIEWPORT})`
            : '0px';

        if (slot.style.maxHeight !== maxHeight) {
            slot.style.maxHeight = maxHeight;
        }

        const button = getToolboxButton();

        if (!button) {
            return;
        }

        button.setAttribute(
            'aria-expanded',
            isOpen ? 'true' : 'false'
        );

        button.classList.toggle(
            'afilia-toolbox-open',
            isOpen
        );
    }

    function setToolboxExpanded(expanded) {
        toolboxExpanded = !!expanded;

        syncToolboxSlot();
    }

    function toggleToolboxSlot() {
        setToolboxExpanded(!toolboxExpanded);
    }

    /* Applets hängen ihr Icon in den aufklappbaren Slot. Fehlt der
       Slot, weil der Kern noch nicht oder nicht mehr hängt, wird
       direkt in die Schnellzugriffsleiste zurückgefallen. */

    function mountAppletButton(button) {
        const slot = getAppletSlot();

        if (slot) {
            slot.appendChild(button);

            syncToolboxSlot();

            return slot;
        }

        const container = findQuickAccessRail();

        if (!container) {
            return null;
        }

        const spacer = container.querySelector(
            ':scope > div.h-20'
        );

        if (spacer) {
            spacer.after(button);
        } else {
            container.insertBefore(
                button,
                container.firstChild
            );
        }

        return container;
    }

    function hookToolboxButton() {
        const container = findQuickAccessRail();

        if (!container) {
            lastToolboxContainer = null;
            return;
        }

        const button = container.querySelector(
            `.${TOOLBOX_BUTTON_CLASS}`
        );

        const slot = container.querySelector(
            `.${TOOLBOX_SLOT_CLASS}`
        );

        if (
            container === lastToolboxContainer &&
            button &&
            slot
        ) {
            syncToolboxSlot();

            return;
        }

        lastToolboxContainer = container;

        if (button) {
            button.remove();
        }

        if (slot) {
            slot.remove();
        }

        const newButton = createToolboxButton();
        const newSlot = createToolboxSlot();

        const storeButton = container.querySelector(
            `.${STORE_BUTTON_CLASS}`
        );

        if (storeButton) {
            storeButton.after(newSlot);
            storeButton.after(newButton);
        } else {
            container.insertBefore(
                newSlot,
                container.firstChild
            );

            container.insertBefore(
                newButton,
                container.firstChild
            );
        }

        syncToolboxSlot();
    }

    function closeStorePanel() {
        const overlay = document.getElementById(STORE_PANEL_ID);

        if (overlay) {
            overlay.remove();
        }
    }
    function openStorePanel() {
        if (document.getElementById(STORE_PANEL_ID)) {
            return;
        }

        /* Beim Öffnen immer neutral starten. */

        storeActiveCategory = 'all';
        storeSearchQuery = '';
        storeActiveFilter = 'all';

        const overlay = document.createElement('div');

        overlay.id = STORE_PANEL_ID;

        overlay.className = 'afilia-store-overlay';

        overlay.innerHTML = `
            <div class="afilia-store-panel">
                <div class="afilia-store-header">
                    <div class="afilia-store-header-text">
                        <div class="afilia-store-title">
                            Applet Store
                        </div>

                        <div class="afilia-store-subtitle">
                            Wähle, welche Funktionen der Toolbox aktiv sein sollen.
                        </div>
                    </div>

                    <button
                        type="button"
                        class="afilia-store-close"
                        title="Schließen"
                        aria-label="Schließen"
                    >
                        ×
                    </button>
                </div>

                <div class="afilia-store-main">
                    <aside class="afilia-store-sidebar">
                        <div class="afilia-store-search">
                            <i class="fa-solid fa-magnifying-glass afilia-store-search-icon" aria-hidden="true"></i>

                            <input
                                type="text"
                                class="afilia-store-search-input"
                                placeholder="Funktionen suchen..."
                                aria-label="Funktionen suchen"
                                autocomplete="off"
                            >
                        </div>

                        <nav class="afilia-store-nav" aria-label="Kategorien">
                            ${renderStoreNav()}
                        </nav>
                    </aside>

                    <section class="afilia-store-content">
                        <div class="afilia-store-content-head">
                            <div class="afilia-store-content-heading">
                                <div class="afilia-store-content-title">
                                    ${getActiveStoreCategory().title}
                                </div>

                                <div class="afilia-store-content-subtitle">
                                    ${getActiveStoreCategory().subtitle}
                                </div>
                            </div>

                            <div class="afilia-store-counter" aria-live="polite">
                                ${renderStoreCounter()}
                            </div>
                        </div>

                        <div class="afilia-store-filters" role="group" aria-label="Applets filtern">
                            ${renderStoreFilters()}
                        </div>

                        <div class="afilia-store-body">
                            ${renderAppletRows()}
                        </div>
                    </section>
                </div>

                <div class="afilia-store-footer">
                    Änderungen werden sofort übernommen.
                </div>
            </div>
        `;

        let keydownHandler = null;

        const close = () => {
            overlay.remove();

            if (keydownHandler) {
                document.removeEventListener('keydown', keydownHandler);
            }
        };

        overlay.querySelector('.afilia-store-close')
            .addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();

                close();
            });

        overlay.addEventListener('click', event => {
            if (event.target === overlay) {
                close();
            }
        });

        keydownHandler = event => {
            if (event.key === 'Escape') {
                close();
            }
        };

        document.addEventListener('keydown', keydownHandler);

        document.body.appendChild(overlay);

        bindStoreNav();
        bindStoreToolbar();
        bindStoreToggles();
    }

    /* Funktionale Kategorien für die Sidebar. Sie werden rein im
       Kern gepflegt und ändern die Applet-Metadaten nicht. */

    const STORE_CATEGORIES = [
        {
            key: 'all',
            title: 'Alle Funktionen',
            subtitle: 'Alle verfügbaren Applets',
            section: ''
        },
        {
            key: 'alarmierung',
            title: 'Alarmierung',
            subtitle: 'Alarm-Hilfen für den Einsatz',
            section: 'Einsatz'
        },
        {
            key: 'aao',
            title: 'AAO',
            subtitle: 'Alarm-Ordnung verwalten',
            section: 'Einsatz'
        },
        {
            key: 'wachenbau',
            title: 'Wachenbau',
            subtitle: 'Hilfen beim Ausbau der Wache',
            section: 'Wache'
        },
        {
            key: 'karte',
            title: 'Karte',
            subtitle: 'Darstellung der Karte',
            section: 'Oberfläche'
        },
        {
            key: 'notizen',
            title: 'Notizen',
            subtitle: 'Eigene Notizen im Spiel',
            section: 'Oberfläche'
        },
        {
            key: 'sonstige',
            title: 'Weitere',
            subtitle: 'Nicht kategorisierte Applets',
            section: 'Weitere'
        }
    ];

    /* Zuordnung Applet-ID -> Kategorie. Unbekannte Applets landen
       automatisch unter "Weitere". */

    const STORE_APPLET_CATEGORIES = {
        alarmHotkey: 'alarmierung',
        fmsAlert: 'alarmierung',
        buildtimeAlarm: 'wachenbau',
        aaoCategories: 'aao',
        mapDarkmode: 'karte',
        notepad: 'notizen'
    };

    const STORE_FILTERS = [
        { key: 'all', label: 'Alle' },
        { key: 'active', label: 'Aktiv' },
        { key: 'inactive', label: 'Inaktiv' }
    ];

    let storeActiveCategory = 'all';
    let storeSearchQuery = '';
    let storeActiveFilter = 'all';

    /* Icon je Applet-ID für die Store-Darstellung. Bevorzugt wird
       das Icon, das das Applet selbst in der Toolbox verwendet.
       Unbekannte IDs fallen auf die generische Form zurück. */

    const STORE_APPLET_ICONS = {
        aaoCategories: 'fa-layer-group',
        notepad: 'fa-note-sticky',
        fmsAlert: 'fa-bell',
        mapDarkmode: 'fa-moon',
        buildtimeAlarm: 'fa-hammer',
        alarmHotkey: 'fa-keyboard'
    };

    function getAppletCategory(id) {
        return STORE_APPLET_CATEGORIES[id] || 'sonstige';
    }

    /* Kategorien mit ihren Applets. "Alle" enthält immer alles,
       leere Kategorien entfallen ganz. */

    function getStoreCategories() {
        const applets = Array.from(appletRegistry.values());

        return STORE_CATEGORIES.map(category => ({
            ...category,
            applets: category.key === 'all'
                ? applets
                : applets.filter(
                    applet => getAppletCategory(applet.id) === category.key
                )
        })).filter(
            category => category.key === 'all' || category.applets.length > 0
        );
    }

    function getActiveStoreCategory() {
        return getStoreCategories().find(
            category => category.key === storeActiveCategory
        ) || STORE_CATEGORIES[0];
    }

    function renderStoreNav() {
        let html = '';
        let section = null;

        getStoreCategories().forEach(category => {
            if (category.section && category.section !== section) {
                section = category.section;

                html += `
                    <div class="afilia-store-nav-section">
                        ${section}
                    </div>
                `;
            }

            const active = category.key === storeActiveCategory;

            html += `
                <button
                    type="button"
                    class="afilia-store-nav-item${
                        active ? ' afilia-store-nav-item-active' : ''
                    }"
                    data-store-category="${category.key}"
                    aria-pressed="${active ? 'true' : 'false'}"
                >
                    <span class="afilia-store-nav-text">
                        <span class="afilia-store-nav-title">
                            ${category.title}
                        </span>

                        <span class="afilia-store-nav-subtitle">
                            ${category.subtitle}
                        </span>
                    </span>

                    <span class="afilia-store-nav-count">
                        ${category.applets.length}
                    </span>
                </button>
            `;
        });

        return html;
    }

    function renderStoreFilters() {
        return STORE_FILTERS.map(filter => {
            const active = filter.key === storeActiveFilter;

            return `
                <button
                    type="button"
                    class="afilia-store-filter${
                        active ? ' afilia-store-filter-active' : ''
                    }"
                    data-store-filter="${filter.key}"
                    aria-pressed="${active ? 'true' : 'false'}"
                >
                    ${filter.label}
                </button>
            `;
        }).join('');
    }

    /* Der Zähler zeigt immer alle registrierten Applets, nicht
       nur die sichtbaren. */

    function renderStoreCounter() {
        const total = appletRegistry.size;

        const enabled = Array.from(appletRegistry.values())
            .filter(applet => isAppletEnabled(applet.id))
            .length;

        return `${enabled} / ${total} aktiv`;
    }

    /* Suche und Filter wirken nur auf die Anzeige, nie auf den
       Zustand eines Applets. */

    function getVisibleStoreApplets() {
        const category = storeActiveCategory;

        let applets = Array.from(appletRegistry.values());

        if (category !== 'all') {
            applets = applets.filter(
                applet => getAppletCategory(applet.id) === category
            );
        }

        const query = normalizeName(storeSearchQuery);

        return applets.filter(applet => {
            if (storeActiveFilter === 'active' &&
                !isAppletEnabled(applet.id)) {
                return false;
            }

            if (storeActiveFilter === 'inactive' &&
                isAppletEnabled(applet.id)) {
                return false;
            }

            if (!query) {
                return true;
            }

            const haystack = normalizeName(
                `${applet.name || ''} ${applet.description || ''}`
            );

            return haystack.includes(query);
        });
    }

    function renderAppletRows() {
        if (appletRegistry.size === 0) {
            return `
                <div class="afilia-store-empty">
                    Keine Applets verfügbar.
                </div>
            `;
        }

        const applets = getVisibleStoreApplets();

        if (applets.length === 0) {
            return `
                <div class="afilia-store-empty">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <div>Keine Funktion gefunden.</div>
                    <div class="afilia-store-empty-hint">
                        Prüfe deinen Suchbegriff, deine Kategorie oder den Filter.
                    </div>
                </div>
            `;
        }

        return applets.map(renderAppletRow).join('');
    }

    function renderAppletRow(applet) {
        const enabled = isAppletEnabled(applet.id);

        const version = applet.version
            ? `v${escapeHTML(String(applet.version))}`
            : '';

        const icon = STORE_APPLET_ICONS[applet.id] || 'fa-shapes';

        const name = escapeHTML(applet.name);

        return `
            <div class="afilia-store-applet" data-applet-id="${escapeHTML(applet.id)}">
                <div class="afilia-store-applet-icon">
                    <i class="fa-solid ${icon}" aria-hidden="true"></i>
                </div>

                <div class="afilia-store-applet-info">
                    <div class="afilia-store-applet-name">
                        ${name}

                        ${version ? `<span class="afilia-store-applet-version">${version}</span>` : ''}

                        ${applet.beta ? '<span class="afilia-store-applet-beta">Beta</span>' : ''}
                    </div>

                    <div class="afilia-store-applet-desc">
                        ${escapeHTML(applet.description || '')}
                    </div>
                </div>

                <label class="afilia-store-switch">
                    <input
                        type="checkbox"
                        role="switch"
                        aria-label="${name} aktivieren"
                        ${enabled ? 'checked' : ''}
                    >
                    <span class="afilia-store-switch-slider"></span>
                </label>
            </div>
        `;
    }

    function selectStoreCategory(key) {
        storeActiveCategory = key;

        const overlay = document.getElementById(STORE_PANEL_ID);

        if (!overlay) {
            return;
        }

        overlay.querySelectorAll('[data-store-category]').forEach(button => {
            const active = button.dataset.storeCategory === key;

            button.classList.toggle('afilia-store-nav-item-active', active);

            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        updateStoreHeading();
        refreshStoreList();
    }

    /* Überschrift des Inhalts an die aktive Kategorie anpassen. */

    function updateStoreHeading() {
        const overlay = document.getElementById(STORE_PANEL_ID);

        if (!overlay) {
            return;
        }

        const category = getActiveStoreCategory();

        const title = overlay.querySelector('.afilia-store-content-title');
        const subtitle = overlay.querySelector('.afilia-store-content-subtitle');

        if (title) {
            title.textContent = category.title;
        }

        if (subtitle) {
            subtitle.textContent = category.subtitle;
        }
    }

    /* Nur Liste und Zähler neu zeichnen, ohne das Suchfeld oder
       den Fokus anzufassen. */

    function refreshStoreList() {
        const overlay = document.getElementById(STORE_PANEL_ID);

        if (!overlay) {
            return;
        }

        const body = overlay.querySelector('.afilia-store-body');
        const counter = overlay.querySelector('.afilia-store-counter');

        if (body) {
            body.innerHTML = renderAppletRows();
        }

        if (counter) {
            counter.textContent = renderStoreCounter();
        }

        bindStoreToggles();
    }

    function bindStoreNav() {
        const overlay = document.getElementById(STORE_PANEL_ID);

        if (!overlay) {
            return;
        }

        overlay.querySelectorAll('[data-store-category]').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();

                selectStoreCategory(button.dataset.storeCategory);
            });
        });
    }

    /* Suche und Filter genau einmal binden. Der aktive Filter wird
       nur am Button umgeschaltet, damit keine doppelten Listener
       entstehen. Das Suchfeld behält beim Tippen den Fokus. */

    function syncStoreFilterState() {
        const overlay = document.getElementById(STORE_PANEL_ID);

        if (!overlay) {
            return;
        }

        overlay.querySelectorAll('[data-store-filter]').forEach(button => {
            const active = button.dataset.storeFilter === storeActiveFilter;

            button.classList.toggle('afilia-store-filter-active', active);

            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function bindStoreToolbar() {
        const overlay = document.getElementById(STORE_PANEL_ID);

        if (!overlay) {
            return;
        }

        const search = overlay.querySelector('.afilia-store-search-input');

        if (search) {
            search.addEventListener('input', () => {
                storeSearchQuery = search.value;

                refreshStoreList();
            });
        }

        overlay.querySelectorAll('[data-store-filter]').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();

                storeActiveFilter = button.dataset.storeFilter;

                syncStoreFilterState();
                refreshStoreList();
            });
        });
    }

    function bindStoreToggles() {
        const overlay = document.getElementById(STORE_PANEL_ID);

        if (!overlay) {
            return;
        }

        overlay.querySelectorAll('.afilia-store-applet').forEach(row => {
            const id = row.dataset.appletId;

            const input = row.querySelector('input[type="checkbox"]');

            if (!id || !input) {
                return;
            }

            input.addEventListener('change', async () => {
                const previous = isAppletEnabled(id);
                const enabled = input.checked;

                /* Solange der letzte Klick noch gespeichert wird,
                   wird nicht ein zweites Mal aktiviert. */

                if (row.dataset.storeBusy === 'true') {
                    input.checked = previous;

                    return;
                }

                /* Ein Event, das den Zustand nicht ändert, darf kein
                   erneutes Aktivieren auslösen. */

                if (enabled === previous) {
                    return;
                }

                row.dataset.storeBusy = 'true';

                try {
                    await toggleApplet(id, enabled);
                } catch (error) {
                    console.error(
                        '[Afilia Toolbox] Applet toggle failed:',
                        id,
                        error
                    );

                    /* Speichern fehlgeschlagen: Zustand und Schalter
                       auf den vorherigen Wert zurücksetzen. */

                    appletStates[id] = previous;
                    input.checked = previous;

                    return;
                } finally {
                    row.dataset.storeBusy = 'false';
                }

                refreshStoreList();
            });
        });
    }

    /* =========================================================
       CSS
       ========================================================= */

    function injectStyles() {
        if (document.getElementById('afilia-toolbox-core-styles')) {
            return;
        }

        const style = document.createElement('style');

        style.id = 'afilia-toolbox-core-styles';

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

            .afilia-changelog-section-title {
                margin-top: 20px;
                margin-bottom: 10px;
                padding-top: 14px;
                border-top: 1px solid #e5e7eb;
                font-size: 12px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.06em;
                color: #6b7280;
            }

            .afilia-changelog-applet {
                padding: 12px;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
                background: #f9fafb;
            }

            .afilia-changelog-applet + .afilia-changelog-applet {
                margin-top: 10px;
            }

            .afilia-changelog-applet-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                margin-bottom: 8px;
            }

            .afilia-changelog-applet-name {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                min-width: 0;
                font-size: 14px;
                font-weight: 700;
                color: #111827;
            }

            .afilia-changelog-applet-version {
                flex: 0 0 auto;
                padding: 2px 8px;
                border-radius: 999px;
                background: #e5e7eb;
                color: #374151;
                font-size: 11px;
                font-weight: 700;
            }

            .afilia-changelog-applet .afilia-changelog-version-title {
                color: #6b7280;
                font-size: 12px;
            }

            .afilia-changelog-applet .afilia-changelog-version-title + .afilia-changelog-list {
                margin-bottom: 8px;
            }

            .afilia-changelog-applet .afilia-changelog-list:last-child {
                margin-bottom: 0;
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
               Aufklappbarer Applet-Slot
               ===================================================== */

            .afilia-toolbox-slot {
                flex-shrink: 0;
                overflow-x: hidden;
                overflow-y: auto;
                opacity: 0;
                visibility: hidden;
                pointer-events: none;
                scrollbar-width: none;
                transition:
                    max-height 240ms ease,
                    opacity 160ms ease,
                    visibility 0s linear 240ms;
            }

            .afilia-toolbox-slot.afilia-toolbox-open {
                opacity: 1;
                visibility: visible;
                pointer-events: auto;
                transition:
                    max-height 240ms ease,
                    opacity 160ms ease,
                    visibility 0s linear 0s;
            }

            .afilia-toolbox-slot::-webkit-scrollbar {
                display: none;
            }

            /* Offen bleibt nur die Umrandung des Icons, damit sich
               der aktive Zustand vom Store-Button abhebt. */

            .afilia-toolbox-button.afilia-toolbox-open {
                border-color: rgba(99, 102, 241, 0.85);
            }

            /* =====================================================
               Applet Store
               ===================================================== */

            .afilia-store-overlay {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                background: rgba(8, 9, 13, 0.72);
            }

            .afilia-store-panel {
                width: min(880px, 100%);
                max-height: 82vh;
                display: flex;
                flex-direction: column;
                border: 1px solid #303440;
                border-radius: 14px;
                background: #17191F;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
                color: #F1F2F7;
                overflow: hidden;
            }

            .afilia-store-header {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 18px 20px;
                border-bottom: 1px solid #303440;
            }

            .afilia-store-header-text {
                flex: 1;
                min-width: 0;
            }

            .afilia-store-title {
                font-size: 17px;
                font-weight: 700;
                color: #F1F2F7;
            }

            .afilia-store-subtitle {
                margin-top: 3px;
                font-size: 12px;
                line-height: 1.4;
                color: #A0A6B5;
            }

            .afilia-store-close {
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                border: 1px solid transparent;
                border-radius: 8px;
                background: transparent;
                color: #858B9A;
                cursor: pointer;
                font-size: 20px;
                line-height: 1;
                transition:
                    color 0.15s ease,
                    background 0.15s ease,
                    border-color 0.15s ease;
            }

            .afilia-store-close:hover {
                background: #222631;
                color: #F1F2F7;
            }

            .afilia-store-main {
                display: flex;
                flex: 1 1 auto;
                min-height: 0;
            }

            .afilia-store-sidebar {
                flex: 0 0 232px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                padding: 14px 12px;
                border-right: 1px solid #303440;
                overflow-y: auto;
                scrollbar-width: thin;
                scrollbar-color: #303440 transparent;
            }

            .afilia-store-search {
                position: relative;
                display: flex;
                align-items: center;
            }

            .afilia-store-search-icon {
                position: absolute;
                left: 11px;
                color: #858B9A;
                font-size: 12px;
                pointer-events: none;
            }

            .afilia-store-search-input {
                width: 100%;
                box-sizing: border-box;
                padding: 8px 11px 8px 32px;
                border: 1px solid #303440;
                border-radius: 9px;
                background: #1C1F27;
                color: #F1F2F7;
                font-size: 13px;
                font-family: inherit;
                outline: none;
                transition:
                    border-color 0.15s ease,
                    box-shadow 0.15s ease;
            }

            .afilia-store-search-input::placeholder {
                color: #858B9A;
            }

            .afilia-store-search-input:focus {
                border-color: #7867F7;
                box-shadow: 0 0 0 3px rgba(120, 103, 247, 0.18);
            }

            .afilia-store-nav {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .afilia-store-nav-section {
                margin: 10px 10px 4px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                color: #858B9A;
            }

            .afilia-store-nav-item {
                display: flex;
                align-items: center;
                gap: 10px;
                width: 100%;
                box-sizing: border-box;
                padding: 8px 10px;
                border: 1px solid transparent;
                border-radius: 9px;
                background: transparent;
                color: #A0A6B5;
                text-align: left;
                cursor: pointer;
                font-family: inherit;
                transition:
                    color 0.15s ease,
                    background 0.15s ease,
                    border-color 0.15s ease;
            }

            .afilia-store-nav-item:hover {
                background: #222631;
                color: #F1F2F7;
            }

            .afilia-store-nav-item-active,
            .afilia-store-nav-item-active:hover {
                border-color: rgba(120, 103, 247, 0.45);
                background: rgba(120, 103, 247, 0.12);
                color: #F1F2F7;
            }

            .afilia-store-nav-text {
                display: flex;
                flex-direction: column;
                gap: 1px;
                flex: 1 1 auto;
                min-width: 0;
            }

            .afilia-store-nav-title {
                font-size: 13px;
                font-weight: 600;
                color: inherit;
            }

            .afilia-store-nav-subtitle {
                overflow: hidden;
                font-size: 11px;
                line-height: 1.35;
                color: #858B9A;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .afilia-store-nav-count {
                flex: 0 0 auto;
                min-width: 20px;
                padding: 1px 7px;
                border-radius: 999px;
                background: #262A33;
                color: #858B9A;
                font-size: 11px;
                font-weight: 700;
                text-align: center;
            }

            .afilia-store-nav-item-active .afilia-store-nav-count {
                background: rgba(120, 103, 247, 0.22);
                color: #CFC9FF;
            }

            .afilia-store-content {
                display: flex;
                flex: 1 1 auto;
                flex-direction: column;
                min-width: 0;
            }

            .afilia-store-content-head {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 12px;
                padding: 16px 20px 12px;
            }

            .afilia-store-content-heading {
                min-width: 0;
            }

            .afilia-store-content-title {
                font-size: 15px;
                font-weight: 700;
                color: #F1F2F7;
            }

            .afilia-store-content-subtitle {
                margin-top: 2px;
                font-size: 12px;
                line-height: 1.4;
                color: #858B9A;
            }

            .afilia-store-counter {
                flex: 0 0 auto;
                padding: 4px 10px;
                border: 1px solid #303440;
                border-radius: 999px;
                background: #1C1F27;
                color: #A0A6B5;
                font-size: 12px;
                font-weight: 600;
                white-space: nowrap;
            }

            .afilia-store-filters {
                display: inline-flex;
                flex-shrink: 0;
                gap: 4px;
                padding: 0 20px 12px;
            }

            .afilia-store-filter {
                padding: 5px 12px;
                border: 1px solid #303440;
                border-radius: 8px;
                background: transparent;
                color: #A0A6B5;
                font-size: 12px;
                font-weight: 600;
                font-family: inherit;
                cursor: pointer;
                transition:
                    color 0.15s ease,
                    background 0.15s ease,
                    border-color 0.15s ease;
            }

            .afilia-store-filter:hover {
                background: #222631;
                color: #F1F2F7;
            }

            .afilia-store-filter-active,
            .afilia-store-filter-active:hover {
                border-color: rgba(120, 103, 247, 0.55);
                background: rgba(120, 103, 247, 0.14);
                color: #F1F2F7;
            }

            .afilia-store-body {
                display: flex;
                flex: 1 1 auto;
                flex-direction: column;
                gap: 10px;
                min-height: 0;
                padding: 0 20px 18px;
                overflow-y: auto;
                scrollbar-width: thin;
                scrollbar-color: #303440 transparent;
            }

            .afilia-store-body::-webkit-scrollbar,
            .afilia-store-sidebar::-webkit-scrollbar {
                width: 8px;
            }

            .afilia-store-body::-webkit-scrollbar-thumb,
            .afilia-store-sidebar::-webkit-scrollbar-thumb {
                border-radius: 999px;
                background: #303440;
            }

            .afilia-store-empty {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                padding: 28px 20px;
                text-align: center;
                color: #A0A6B5;
                font-size: 13px;
            }

            .afilia-store-empty i {
                color: #414550;
                font-size: 20px;
            }

            .afilia-store-empty-hint {
                font-size: 12px;
                color: #858B9A;
            }

            .afilia-store-applet {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 13px 14px;
                border: 1px solid #303440;
                border-radius: 12px;
                background: #1C1F27;
                transition:
                    border-color 0.15s ease,
                    background 0.15s ease;
            }

            .afilia-store-applet:hover {
                background: #222631;
            }

            .afilia-store-applet:focus-within {
                border-color: #7867F7;
            }

            .afilia-store-applet-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 40px;
                width: 40px;
                height: 40px;
                border-radius: 10px;
                background: #252343;
                color: #B3A8FF;
                font-size: 16px;
            }

            .afilia-store-applet-info {
                flex: 1 1 auto;
                min-width: 0;
            }

            .afilia-store-applet-name {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 8px;
                font-size: 14px;
                font-weight: 600;
                color: #F1F2F7;
            }

            .afilia-store-applet-version {
                padding: 2px 7px;
                border-radius: 6px;
                background: #262A33;
                color: #858B9A;
                font-size: 11px;
                font-weight: 600;
            }

            .afilia-store-applet-beta {
                padding: 2px 7px;
                border-radius: 6px;
                background: rgba(120, 103, 247, 0.16);
                color: #B3A8FF;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.04em;
                text-transform: uppercase;
            }

            .afilia-store-applet-desc {
                margin-top: 3px;
                font-size: 12px;
                color: #A0A6B5;
                line-height: 1.45;
            }

            .afilia-store-switch {
                position: relative;
                flex: 0 0 auto;
                width: 40px;
                height: 22px;
                cursor: pointer;
            }

            .afilia-store-switch input {
                position: absolute;
                opacity: 0;
                width: 0;
                height: 0;
            }

            .afilia-store-switch-slider {
                position: absolute;
                inset: 0;
                border-radius: 999px;
                background: #414550;
                transition: background 160ms ease;
            }

            .afilia-store-switch-slider::before {
                position: absolute;
                content: '';
                width: 16px;
                height: 16px;
                top: 3px;
                left: 3px;
                border-radius: 50%;
                background: #FFFFFF;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
                transition: transform 160ms ease;
            }

            .afilia-store-switch input:checked
            + .afilia-store-switch-slider {
                background: #7867F7;
            }

            .afilia-store-switch input:checked
            + .afilia-store-switch-slider::before {
                transform: translateX(18px);
            }

            .afilia-store-switch input:focus-visible
            + .afilia-store-switch-slider {
                outline: 2px solid #7867F7;
                outline-offset: 2px;
            }

            .afilia-store-close:focus-visible,
            .afilia-store-nav-item:focus-visible,
            .afilia-store-filter:focus-visible {
                outline: 2px solid #7867F7;
                outline-offset: 2px;
            }

            .afilia-store-footer {
                padding: 12px 20px;
                border-top: 1px solid #303440;
                color: #858B9A;
                font-size: 12px;
                text-align: center;
            }

            @media (max-width: 700px) {
                .afilia-store-overlay {
                    padding: 12px;
                }

                .afilia-store-main {
                    flex-direction: column;
                }

                .afilia-store-sidebar {
                    flex: 0 0 auto;
                    gap: 10px;
                    border-right: 0;
                    border-bottom: 1px solid #303440;
                    padding: 12px;
                }

                .afilia-store-nav {
                    flex-direction: row;
                    gap: 6px;
                    overflow-x: auto;
                    padding-bottom: 2px;
                }

                .afilia-store-nav-section {
                    display: none;
                }

                .afilia-store-nav-item {
                    flex: 0 0 auto;
                    width: auto;
                    padding: 7px 10px;
                }

                .afilia-store-nav-subtitle {
                    display: none;
                }

                .afilia-store-content-head {
                    padding: 14px 14px 10px;
                }

                .afilia-store-filters {
                    flex-wrap: wrap;
                    padding: 0 14px 10px;
                }

                .afilia-store-body {
                    padding: 0 14px 14px;
                }

                .afilia-store-footer {
                    padding: 12px 14px;
                }
            }

            @media (prefers-reduced-motion: reduce) {
                .afilia-store-panel *,
                .afilia-store-panel *::before {
                    transition: none !important;
                }
            }
        `;

        document.head.appendChild(style);
    }

    /* =========================================================
       Main scanning
       ========================================================= */

    function scan() {
        hookStoreButton();
        hookToolboxButton();

        for (const applet of appletRegistry.values()) {
            if (
                !isAppletEnabled(applet.id) ||
                typeof applet.onScan !== 'function'
            ) {
                continue;
            }

            try {
                applet.onScan(appletContext);
            } catch (error) {
                console.error(
                    '[Afilia Toolbox] Applet scan failed:',
                    applet.id,
                    error
                );
            }
        }

        /* Erst nach den Applets: sie hängen ihre Icons in den
           Slot, dessen Höhe danach berechnet wird. */

        syncToolboxSlot();
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

        observer = new MutationObserver(mutations => {
            let relevant = false;

            for (const mutation of mutations) {
                if (
                    mutation.type === 'childList' ||
                    mutation.type === 'attributes'
                ) {
                    relevant = true;
                    break;
                }
            }

            if (relevant) {
                scheduleScan();
            }
        });

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
            db = await openDatabase();

            injectStyles();

            await loadAppletStates();

            await loadRuntimeApplets();

            collectQueuedApplets();

            await initEnabledApplets();

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