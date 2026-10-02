# RO-Afilia Toolbox [![Discord](https://img.shields.io/discord/1554176132012580894?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/h6HEjwaMpW)

Ein Quality-of-Life-Userscript für [Rescue Operator](https://game.rescue-operator.com/), das die AAO-Verwaltung und das Alarmierungsfenster übersichtlicher macht.

Es erweitert das Spiel ausschließlich um nützliche Komfortfunktionen und verwendet keine Automatisierungswerkzeuge oder andere durch die AGB verbotene Funktionen.

## Funktionen

### Applet Store
- Alle Funktionen der Toolbox sind als einzelne „Applets" umgesetzt.
- Über den Puzzle-Knopf in der Schnellzugriffsleiste lässt sich der Applet Store öffnen.
- Dort kann jede Funktion einzeln aktiviert oder deaktiviert werden – Änderungen werden sofort übernommen.
- Der Store ist in zwei Reiter aufgeteilt: „Funktionen" für die verfügbaren Applets und „Beta" für Functions in Entwicklung.
- Reiter mit keiner einzigen Funktion werden automatisch ausgeblendet.
- Die Aktivierung wird lokal gespeichert und beim nächsten Laden übernommen.

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

### Notizblock
- Fügt einen Notizblock zu den Rescue OS Schnelltasten hinzu.
- Speichert Notizen automatisch lokal.

### FMS-5-Alarm
- Die Glocke in der Schnellzugriffsleiste ist dauerhaft sichtbar und schaltet den **Alarmton des Applets** zwischen „an“ und „aus“. Der Ton des Spiels wird davon nicht berührt – die Auswahl wird lokal gespeichert.
- Liegt ein Sprechwunsch an, erscheint unter der Statusleiste im Seitenkopf ein rot pulsierender Balken mit dem Hinweis „Sprechwunsch!“. Dieser visuelle Hinweis ist **immer** sichtbar, unabhängig vom Tonmodus.
- Ist der Ton aus, gibt es ausschließlich den roten Balken. Ist er an, kommen Balken und Alarmton dazu; im Modus „mit Ton“ wird der Ton alle 5 Minuten wiederholt.
- Der Stummschalter des Spiels wird respektiert: Ist das Spiel global stummgeschaltet, bleibt der FMS-Alarm ohne Ton, der rote Balken aber weiterhin sichtbar. Die Glocke zeigt dann ein durchgestrichenes Lautsprecher-Icon.
- Icon-Übersicht: Glocke = Ton an, Glocke mit Schrägstrich = Ton per Applet aus, Lautsprecher durchgestrichen = Spiel global stumm.

### Bauzeit-Alarm (Beta)
- In der Erweiterungsübersicht einer Wache erscheint neben dem laufenden Countdown eine **Alarm**-Schaltfläche. Ein Klick setzt den Alarm, ein zweiter entfernt ihn wieder.
- Das Fenster (Hammer-Icon in der Toolbox) listet alle gesetzten Alarme mit **Wachenname**, Erweiterung und verbleibender Bauzeit auf, sortiert nach Dringlichkeit.
- Die Vorwarnzeit ist wählbar (1/5/10/15/30 Minuten, 1 Stunde). Reicht die Restzeit nicht mehr dafür, feuert der Alarm sofort.
- Der Countdown wird aus dem Spielbild gelesen und danach lokal weitergezählt. Der Alarm läuft also weiter, wenn das Stationsfenster inzwischen geschlossen ist.
- Es werden **keine Daten über die API abgerufen** – alles wird ausschließlich aus dem Spielbild gelesen.
- **Beta:** Das Applet liegt im eigenen Store-Reiter „Beta" und ist zunächst **ausgeschaltet**. Es muss dort bewusst aktiviert werden.
- Einschränkung: Ein Alarm kann nur gesetzt werden, während das Stationsfenster mit dem Tab „Erweiterungen" offen ist. Das Fenster zeigt daher nur Alarme, die bereits gesetzt wurden – nicht alle Wachen im Spiel.

### Updates
- Prüft beim Start die `version.json` auf GitHub Pages und weist auf Updates hin.
- Zeigt nach einem Update ein Popup mit den Neuerungen der Toolbox und der Applets.

## Installation

1. Einen Userscript-Manager installieren, z. B. [Tampermonkey](https://www.tampermonkey.net/).
2. Das Skript über die folgende Adresse installieren:
   [AfiliaToolbox.user.js](https://afiliafrostfang.github.io/RO-AfiliaToolbox/AfiliaToolbox.user.js)
3. In Rescue Operator neu laden – die Toolbox wird automatisch eingebunden.

## Datenschutz & Speicherung

- Kategorien, Zuordnungen und Notizen werden ausschließlich lokal im Browser über IndexedDB gespeichert.
- Es werden keine Daten an externe Server gesendet.

## Hinweis

Der Quellcode ist hier jederzeit einsehbar und kann von der Administration geprüft, genehmigt oder abgelehnt werden.

Die Funktionen „Fahrzeugliste" (Kilometerstände) und „Krankenhaus" (Bettenauslastung) sind vorerst deaktiviert und werden erst nach Veröffentlichung der öffentlichen API wieder eingebaut.

## Technischer Aufbau

Das Skript besteht aus einem Kern und mehreren Applets (vergleichbar mit [LSSM](https://lss-manager.de) und seinem Modul Store):

| Datei | Rolle |
| --- | --- |
| `AfiliaToolbox.user.js` | Kern: Applet-Registry, Applet Store, Update-Check und der Applet-Loader. |
| `applets/manifest.json` | Manifest: Liste aller Applets inkl. Datei und Version. Wird zum Start vom Kern geladen. |
| `applets/aaoCategories.js` | Applet „AAO-Kategorien": AAO-Verwaltung in den Einstellungen und kategorisierte Alarmierung. |
| `applets/notepad.js` | Applet „Notizblock": Notizblock in der rechten Schnellzugriffsleiste. |
| `applets/fmsAlert.js` | Applet „FMS-5-Alarm": Roter Statusbalken und optionaler Alarmton bei einem Sprechwunsch. |
| `applets/buildtimeAlarm.js` | Applet „Bauzeit-Alarm" (Beta): Alarm für die Restzeit einer Stationserweiterung mit Übersichtsfenster. Liest nur das Spielbild. |
| `changelog.json` | Versionshinweise der Toolbox und der Applets. Wird vom Kern geladen und im Update-Popup angezeigt. |
| `version.json` | Nur die aktuelle Kernversion, wird für den Update-Check verwendet. |

Die Applets werden nicht per `@require` eingebunden, sondern zur Laufzeit vom Kern geladen: Das Manifest wird mit `cache: 'no-store'` abgerufen, anschließend jede Applet-Datei mit ihrer Version als Cache-Buster (`applets/aaoCategories.js?v=1.0.1`). Dadurch erscheinen Applet-Updates automatisch, ohne dass die Toolbox selbst aktualisiert werden muss.

### Changelog

Das Changelog liegt bewusst **nicht** im Kernskript, sondern in `changelog.json`. So bleibt das Skript klein, auch wenn die Versionshinweise weiter wachsen. Die Datei hat zwei getrennte Bereiche:

```json
{
    "toolbox": {
        "1.11.0": ["Neuerungen der Toolbox."]
    },
    "applets": {
        "fmsAlert": {
            "1.0.1": ["Neuerungen des Applets."]
        }
    }
}
```

- `toolbox` –Versionshinweise des Kernskripts, geschlüsselt nach der Toolbox-Version.
- `applets` – geschlüsselt nach Applet-ID, darunter die Hinweise pro Applet-Version.

Beide Bereiche werden unabhängig voneinander ausgewertet. Das Update-Popup erscheint, sobald es für **eines** von beidem neue Hinweise gibt – ein Applet-Update erscheint also auch dann im Popup, wenn die Toolbox selbst nicht aktualisiert werden musste. Welche Hinweise bereits gesehen wurden, merkt sich der Kern lokal in IndexedDB (`lastSeenVersion` und `lastSeenAppletVersions`).

Beim Publishen einer neuen Version müssen deshalb drei Stellen angepasst werden: `@version` und `SCRIPT_VERSION` im Skript, `version.json` und der passende Eintrag in `changelog.json`. Bei einem Applet-Update zusätzlich die Applet-Version in `applets/manifest.json` **und** in der `version`-Angabe des Applets selbst (diese wird als Badge im Applet Store angezeigt).

## Geplante Features

- UI-Overhaul für diverse Fenster.
