## ReadMe

Direkte Integration von **AniList** in die **AniWorld Webseite**: Gesehene Episoden werden
automatisch getrackt (Episoden **und** Filme), und Status, Fortschritt und Wertung lassen sich direkt auf AniWorld ändern.

---
### Einrichtung
1. Im Popup auf **„Token bekommen"** klicken und bei AniList einloggen.
2. Den Token **oder die komplette Adresse** aus der Adressleiste ins Popup einfügen und **Speichern** klicken
   (der Token wird sofort geprüft).
3. AniWorld ganz normal weiter nutzen.

### Installation
Diese vorbereitete ZIP-Datei ist **für Firefox** gedacht (ab Firefox 142). Nach der Signierung installierst du die von Mozilla bereitgestellte `.xpi` über `about:addons` → Zahnrad-Menü → „Add-on aus Datei installieren“.

Für Chrome/Edge ist weiterhin ein Manifest mit `background.service_worker` erforderlich; diese Firefox-Ausgabe ist dafür nicht vorgesehen.

### Firefox-Signierung (Version 1.5.1)
Dieses Paket ist für Firefox vorbereitet. Für Firefox Release/Beta muss es über addons.mozilla.org signiert werden.
1. Öffne https://addons.mozilla.org/developers/ und melde dich an.
2. Wähle „Neues Add-on“ und anschließend die Option zur Verteilung außerhalb von AMO („Unlisted“ / selbst gehostet), falls du es nur selbst verwenden möchtest.
3. Lade `ALS-Firefox-AMO-upload.zip` hoch und folge der Validierung. Mozilla stellt nach erfolgreicher Signierung eine `.xpi`-Datei bereit.
4. Da die Erweiterung Anfragen an AniList sendet, veröffentliche `DATENSCHUTZ.md` unter einer öffentlichen URL und trage diese bei AMO als Datenschutzerklärung ein.

Die Signierung wurde nicht lokal durchgeführt; sie benötigt die Übermittlung über ein Mozilla-Konto.
