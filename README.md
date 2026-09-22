# RO-Afilia Toolbox

Ein Quality-of-Life-Userscript für [Rescue Operator](https://game.rescue-operator.com/), das die AAO-Verwaltung, das Alarmierungsfenster und die Fahrzeugliste übersichtlicher macht.

Es erweitert das Spiel ausschließlich um nützliche Komfortfunktionen und verwendet keine Automatisierungswerkzeuge oder andere durch die AGB verbotene Funktionen.

## Funktionen

### AAO-Verwaltung
- Erkennt vorhandene AAOs im Spiel automatisch.
- Sortiert AAOs in eigene Kategorien wie Brandbekämpfung, Technische Hilfe und Rettungsdienst.
- Ermöglicht das individuelle Verschieben und Sortieren der Kategorien per Drag-and-Drop.
- AAOs lassen sich innerhalb der Kategorien und der unzugeordneten Liste frei per Drag-and-Drop sortieren.
- Bietet Suche, Ein-/Ausblenden, Bearbeiten und Löschen von AAOs.
- Synchronisiert die Ansicht automatisch mit Änderungen im Spiel.

### Alarmierung
- Ersetzt die AAO-Auswahl im Alarmierungsfenster durch eine kategorisierte Ansicht.
- Hält die Suchfilter zwischen Ansicht und Spiel synchron.

### Fahrzeugliste
- Lädt den gefahrenen Kilometerstand aller Fahrzeuge und zeigt ihn in der Fahrzeugliste an.
- Sortiert die Fahrzeugliste auf Wunsch nach gefahrenen Kilometern (absteigend).
- Warnt bei Fahrzeugen mit mehr als 30.000 gefahrenen Kilometern mit einem klickbaren Warnsymbol.
- Bietet einen Aktualisieren-Knopf, um die Kilometerstände manuell neu zu laden.
- Zwischenspeichert die Daten lokal, damit nicht bei jedem Öffnen alles neu geladen werden muss.
- Speichert Kilometerstände und Fahrzeugdaten getrennt pro Spiel, damit Einträge aus anderen Spielen nicht angezeigt werden.

### Krankenhaus
- Zeigt die Bettenauslastung aller Krankenhäuser als Statusanzeige oben rechts an (belegte/maximale Betten inkl. Auslastung in Prozent).
- Die Auslastung wird automatisch aus den Spieldaten gelesen und pro Spiel lokal zwischengespeichert.

### Notizblock
- Fügt einen Notizblock zu den Rescue OS Schnelltasten hinzu.
- Speichert Notizen automatisch lokal.

### Updates
- Prüft beim Start die `version.json` auf GitHub Pages und weist auf Updates hin.
- Zeigt nach einem Update ein Popup mit den Neuerungen der neuen Version.

## Installation

1. Einen Userscript-Manager installieren, z. B. [Tampermonkey](https://www.tampermonkey.net/).
2. Das Skript über die folgende Adresse installieren:
   [AfiliaToolbox.user.js](https://afiliafrostfang.github.io/RO-AfiliaToolbox/AfiliaToolbox.user.js)
3. In Rescue Operator neu laden – die Toolbox wird automatisch eingebunden.

## Datenschutz & Speicherung

- Kategorien, Zuordnungen, Notizen sowie zwischengespeicherte Fahrzeug- und Krankenhausdaten werden ausschließlich lokal im Browser über IndexedDB gespeichert.
- Es werden keine Daten an externe Server gesendet.

## Hinweis

Der Quellcode ist hier jederzeit einsehbar und kann von der Administration geprüft, genehmigt oder abgelehnt werden.

## Geplante Features

- UI-Overhaul für diverse Fenster, z. B. Krankenhausübersicht.
- „Applet Store", um die Toolbox und ihre Funktionen zu personalisieren.
