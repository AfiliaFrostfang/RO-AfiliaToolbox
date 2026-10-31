/* =========================================================
   Afilia Toolbox – Applet: Einsatzliste nach Name sortieren
   ========================================================= */

(function () {
    'use strict';

    const GROUP_MARK = 'data-afilia-dvs-sorted';
    const OWN_PANEL_SELECTOR = '#afilia-aao-dispatch-panel';

    /* -----------------------------------------------------
       Alarmierungsfenster
       ----------------------------------------------------- */

    function findDialog() {
        const dialogs = Array.from(
            document.querySelectorAll(
                '[role="dialog"][data-slot="sheet-content"], ' +
                '[role="dialog"][data-slot="dialog-content"]'
            )
        );

        return dialogs.find(dialog => {
            return Array.from(
                dialog.querySelectorAll('h2')
            ).some(h2 => {
                return (h2.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .includes('Fahrzeuge alarmieren');
            });
        }) || null;
    }

    /* -----------------------------------------------------
       Fahrzeugzeilen

       Das Spiel rendert die Fahrzeuge als Zeilen mit
       „data-drag-vehicle-id". Ältere Fassungen hatten die ID
       nur am umgebenden Element. Deshalb werden beide Formen
       unterstützt und am Ende nur die innerste Zeile benutzt.
       ----------------------------------------------------- */

    function cleanText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isStatusText(value) {
        return /^Status\b/i.test(cleanText(value));
    }

    function isDistanceText(value) {
        return /^\d+(?:[.,]\d+)?\s*(?:km|m|min)$/i.test(
            cleanText(value)
        );
    }

    function getVehicleNameElement(row) {
        /* Bekannte Zeilenform: der Funkrufname steht als
           direktes span[title] in der Zeile. */
        const known = row.querySelector(
            ':scope > span.text-gray-700.truncate.flex-1[title]'
        );

        if (known) {
            return known;
        }

        for (const child of Array.from(row.children)) {
            if (child.tagName !== 'SPAN') {
                continue;
            }

            const title = cleanText(
                child.getAttribute('title')
            );

            if (title && !isStatusText(title)) {
                return child;
            }
        }

        /* Neuere Kartenform: Name steht in einem .truncate,
           aber nicht in der Überschrift und nicht im Badge. */
        const truncates = row.querySelectorAll('.truncate');

        for (const element of truncates) {
            if (element.closest(OWN_PANEL_SELECTOR)) {
                continue;
            }

            if (
                element.closest('h3') ||
                element.closest('[data-slot="badge"]')
            ) {
                continue;
            }

            const title = cleanText(
                element.getAttribute('title')
            );

            if (isStatusText(title)) {
                continue;
            }

            const text = cleanText(element.textContent);

            if (
                !text ||
                /^\d+$/.test(text) ||
                isStatusText(text) ||
                isDistanceText(text)
            ) {
                continue;
            }

            return element;
        }

        /* Letzter Fallback: irgendein span[title], das kein
           Status-Badge ist. */
        const titled = row.querySelectorAll('span[title]');

        for (const element of titled) {
            const title = cleanText(
                element.getAttribute('title')
            );

            if (!title || isStatusText(title)) {
                continue;
            }

            return element;
        }

        /* Falls die Karte den Namen in einer Überschrift trägt. */
        const heading = row.querySelector('h3');

        if (heading && !heading.closest(OWN_PANEL_SELECTOR)) {
            const text = cleanText(heading.textContent);

            if (text && !isStatusText(text) && !isDistanceText(text)) {
                return heading;
            }
        }

        return null;
    }

    function getVehicleName(row) {
        const element = getVehicleNameElement(row);

        if (!element) {
            return '';
        }

        return cleanText(element.textContent) ||
            cleanText(element.getAttribute('title'));
    }

    function containsMultipleRows(element) {
        return (
            element.querySelectorAll('[data-drag-vehicle-id]').length > 1 ||
            element.querySelectorAll('span[title^="Status "]').length > 1
        );
    }

    function isVehicleRow(element) {
        if (!element || element.nodeType !== 1) {
            return false;
        }

        if (element.closest(OWN_PANEL_SELECTOR)) {
            return false;
        }

        if (containsMultipleRows(element)) {
            return false;
        }

        return !!getVehicleNameElement(element);
    }

    function collectRows(element, rows) {
        if (!element || element.nodeType !== 1) {
            return;
        }

        if (isVehicleRow(element)) {
            rows.add(element);
            return;
        }

        const inner = element.querySelectorAll('div.cursor-pointer');

        for (const candidate of inner) {
            if (isVehicleRow(candidate)) {
                rows.add(candidate);
            }
        }
    }

    function collectFromStatusBadges(dialog, rows) {
        const badges = dialog.querySelectorAll(
            'span[title^="Status "]'
        );

        for (const badge of badges) {
            let element = badge.parentElement;

            while (element && element !== dialog) {
                if (isVehicleRow(element)) {
                    rows.add(element);
                    break;
                }

                element = element.parentElement;
            }
        }
    }

    function getVehicleRows(dialog) {
        const rows = new Set();

        const dragRows = dialog.querySelectorAll(
            '[data-drag-vehicle-id]'
        );

        if (dragRows.length > 0) {
            for (const element of dragRows) {
                collectRows(element, rows);
            }
        }

        /* Status-Badges sind in allen bekannten Fassungen
           vorhanden und helfen, wenn die Zeilen selbst kein
           data-drag-vehicle-id tragen. */
        collectFromStatusBadges(dialog, rows);

        if (rows.size === 0) {
            /* Fallback für Fassungen ohne (brauchbares)
               data-drag-vehicle-id. */
            const candidates = dialog.querySelectorAll(
                'div.cursor-pointer'
            );

            for (const element of candidates) {
                if (isVehicleRow(element)) {
                    rows.add(element);
                }
            }
        }

        /* Nur die innerste Zeile behalten, falls ID und Zeile
           verschachtelt sind. */
        const list = Array.from(rows);

        return list.filter(row => {
            return !list.some(other => {
                return other !== row && row.contains(other);
            });
        });
    }

    /* -----------------------------------------------------
       Gruppierung

       Bei der alten Zeilenform sind alle Fahrzeuge einer Wache
       direkte Geschwister. Neuere Fassungen können jede Zeile
       zusätzlich in ein eigenes Element verpacken. Deshalb wird
       der nächste Vorfahre gesucht, der mindestens zwei
       Fahrzeugzeilen enthält, und darin werden ganze Einheiten
       (Zeile oder deren Hülle) verschoben.
       ----------------------------------------------------- */

    function findGroupContainer(row, rows, dialog) {
        let element = row.parentElement;

        while (element && element !== dialog) {
            let contained = 0;

            for (const candidate of rows) {
                if (element.contains(candidate)) {
                    contained += 1;
                }
            }

            if (contained >= 2) {
                return element;
            }

            element = element.parentElement;
        }

        return row.parentElement;
    }

    function findRowUnit(container, row) {
        let unit = row;

        while (
            unit.parentElement &&
            unit.parentElement !== container
        ) {
            unit = unit.parentElement;
        }

        return unit.parentElement === container ? unit : row;
    }

    function getGroups(rows, dialog) {
        const groups = new Map();

        for (const row of rows) {
            const container = findGroupContainer(row, rows, dialog);

            if (!container) {
                continue;
            }

            if (!groups.has(container)) {
                groups.set(container, new Map());
            }

            const units = groups.get(container);
            const unit = findRowUnit(container, row);

            if (!units.has(unit)) {
                units.set(unit, []);
            }

            units.get(unit).push(row);
        }

        return groups;
    }

    /* -----------------------------------------------------
       Sortieren
       ----------------------------------------------------- */

    function compareNames(left, right) {
        return left.localeCompare(right, 'de', {
            numeric: true,
            sensitivity: 'base'
        });
    }

    function sortUnits(units) {
        return units.slice().sort((left, right) => {
            return compareNames(
                getVehicleName(left.rows[0]),
                getVehicleName(right.rows[0])
            );
        });
    }

    function sameOrder(left, right) {
        if (left.length !== right.length) {
            return false;
        }

        for (let index = 0; index < left.length; index += 1) {
            if (left[index] !== right[index]) {
                return false;
            }
        }

        return true;
    }

    function applyOrder(container, units, sorted) {
        /* Platzhalter an den alten Positionen halten die
           Reihenfolge der übrigen Elemente (z. B. Wachenköpfe)
           unverändert. */
        const placeholders = units.map(unit => {
            const placeholder = document.createComment(
                'afilia-dvs'
            );

            container.replaceChild(placeholder, unit);

            return placeholder;
        });

        for (let index = 0; index < sorted.length; index += 1) {
            const placeholder = placeholders[index];

            if (
                placeholder &&
                placeholder.parentNode === container
            ) {
                container.replaceChild(sorted[index].unit, placeholder);
            }
        }
    }

    function run() {
        const dialog = findDialog();

        if (!dialog) {
            return;
        }

        const rows = getVehicleRows(dialog);

        if (rows.length < 2) {
            return;
        }

        const groups = getGroups(rows, dialog);

        groups.forEach((units, container) => {
            if (units.size < 2) {
                return;
            }

            const list = Array.from(units, ([unit, unitRows]) => ({
                unit,
                rows: unitRows
            }));

            const current = list.map(item => item.unit);
            const sorted = sortUnits(list);
            const desired = sorted.map(item => item.unit);

            if (!sameOrder(current, desired)) {
                applyOrder(container, current, sorted);
            }

            container.setAttribute(GROUP_MARK, '1');
        });
    }

    /* -----------------------------------------------------
       Applet lifecycle
       ----------------------------------------------------- */

    function init() {
        run();
    }

    function onScan() {
        run();
    }

    function dispose() {
        document.querySelectorAll(`[${GROUP_MARK}]`).forEach(element => {
            element.removeAttribute(GROUP_MARK);
        });
    }

    window.__AFILIA_APPLET_QUEUE__ =
        window.__AFILIA_APPLET_QUEUE__ || [];

    window.__AFILIA_APPLET_QUEUE__.push({
        id: 'dispatchVehicleSort',
        name: 'Einsatzliste nach Name sortieren',
        description:
            'Sortiert Fahrzeuge im Fenster „Fahrzeuge alarmieren“ innerhalb jeder Wache alphabetisch nach Namen – auch im Entfernungsmodus, in dem das Spiel sonst nach Entfernung sortiert.',
        version: '1.0.0',
        beta: false,
        defaultEnabled: false,
        init,
        onScan,
        dispose
    });
})();
