# ALL-INKL Zugänge – Chrome Extension

Verwaltet beliebig viele ALL-INKL Zugangsdaten mit **frei wählbarer Beschreibung**.
Ein Klick auf einen Eintrag öffnet die passende Login-Seite in einem neuen Tab,
füllt Benutzer und Passwort aus und meldet automatisch an.

Genau das, was Chromes eigener Passwortmanager nicht kann: Die dort hinterlegte
Notiz wird in der Auswahlliste nicht angezeigt – hier ist die Beschreibung das
Hauptmerkmal.

## Installation

1. `chrome://extensions` öffnen
2. Oben rechts **Entwicklermodus** aktivieren
3. **Entpackte Erweiterung laden** klicken
4. Diesen Ordner auswählen: `chrome-ext-allinkl`

Die Extension erscheint in der Symbolleiste (ggf. über das Puzzle-Icon anpinnen).
Tastenkürzel zum Öffnen: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd>
(änderbar unter `chrome://extensions/shortcuts`).

## Unterstützte Logins

Jeder Eintrag gehört zu genau einem Dienst. Die Liste ist nach Dienst gruppiert
(Gruppen sind ein-/ausklappbar), sodass z. B. 20 KAS- und 5 MembersArea-Zugänge
sauber getrennt bleiben.

| Dienst | Login-Seite | Benutzerfeld |
|---|---|---|
| MembersArea | `all-inkl.com/members/` | Kundennummer |
| KAS | `kas.all-inkl.com/login` | Loginname / Domain |
| WebMail | `webmail.all-inkl.com` | E-Mail-Adresse |
| WebFTP | `webftp.all-inkl.com` | FTP-Benutzer |

## Bedienung

- **Klick auf einen Eintrag** → neuer Tab, Felder ausgefüllt, automatisch angemeldet
- **Suchfeld** durchsucht Beschreibung, Benutzer und Notizen; <kbd>Enter</kbd>
  meldet direkt beim ersten Treffer an
- **Chips** oben filtern auf einen einzelnen Dienst
- **☆** markiert Favoriten (stehen innerhalb ihrer Gruppe oben)
- Beim Überfahren eines Eintrags: Benutzer kopieren, Passwort kopieren, bearbeiten

## Einstellungen

- **Login immer in neuem Tab öffnen** (Standard: an). Aus: eine bereits geöffnete
  ALL-INKL Login-Seite wird wiederverwendet.
- **Formular automatisch absenden** (Standard: an). Aus: es wird nur ausgefüllt.
- **Sortierung**: Beschreibung (A–Z) oder zuletzt verwendet.
- **Master-Passwort** (optional, empfohlen): verschlüsselt alle Zugänge mit
  AES-GCM-256, Schlüsselableitung per PBKDF2-SHA256 (310 000 Runden). Der
  abgeleitete Schlüssel liegt in `chrome.storage.session`, also nur im
  Arbeitsspeicher – nach einem Chrome-Neustart ist einmal zu entsperren.
  **Ohne** Master-Passwort liegen die Passwörter unverschlüsselt im
  Chrome-Profil (nur für diese Extension lesbar).
  Ein vergessenes Master-Passwort kann nicht wiederhergestellt werden.
- **Export/Import** als JSON – für Backup oder zur Weitergabe im Team.
  Achtung: der Export enthält die Passwörter im Klartext.

## Dateien

| Datei | Zweck |
|---|---|
| `manifest.json` | Manifest V3, Berechtigungen, Tastenkürzel |
| `services.js` | Die vier Dienste inkl. Formularfeldnamen und Login-URLs |
| `vault.js` | Speicherung, Verschlüsselung, Einträge, Einstellungen |
| `background.js` | Service Worker: Tab öffnen, warten, Formular ausfüllen und absenden |
| `popup.html/.css/.js` | Oberfläche |
| `icons/` | Icons (16/32/48/128 px) – ALL-INKL Logo, aus `all-inkl.com/images/favicon-256x256.png` skaliert |

## Berechtigungen

- `storage` – Zugänge und Einstellungen speichern
- `tabs`, `scripting` – Login-Tab öffnen und das Formular ausfüllen
- `clipboardWrite` – Benutzer/Passwort kopieren
- Host-Zugriff ausschließlich auf `all-inkl.com`, `kas.`, `webmail.` und
  `webftp.all-inkl.com`

Es werden keine Daten an Dritte übertragen; alles bleibt lokal im Browserprofil.

## Wenn der Login nicht klappt

- Meldung „kein Login-Formular gefunden“: Der Dienst ist in diesem Tab meist
  schon angemeldet – vorher abmelden.
- Ändert ALL-INKL die Feldnamen, genügt eine Anpassung in `services.js`
  (`fields.user` / `fields.pass`); geprüfter Stand: September 2026.
