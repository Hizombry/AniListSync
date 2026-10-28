# AniList-AniWorld Integration

## ⚙ Funktionen (umgesetzt)
- Automatisches Tracking nach 2:30 min auf einer Episoden- oder Filmseite (pausierbar)
- AniList-Leiste auf Anime-, Staffel-, Episoden- und Filmseiten:
  Community-Score, Status (inkl. „Zur Liste hinzufügen"), Fortschritt, eigene Wertung
- Wertung wird ins AniList-Scoreformat des Nutzers umgerechnet (3/5/10/100 Punkte)

### Zuordnung AniWorld → AniList
AniWorld und AniList teilen Serien oft unterschiedlich auf. Deshalb wird fortlaufend gezählt:
`Gesamtnummer = Episoden aller früheren AniWorld-Staffeln + aktuelle Episode`
und an der AniList-Sequel-Kette „abgewickelt".
- **Gintama-Fall:** Mehrere AniWorld-Staffeln liegen in *einem* AniList-Eintrag → bleibt im selben Eintrag.
- **Cour-Splits:** Läuft die Nummer über das Ende eines Eintrags hinaus, geht es im nächsten TV-Eintrag weiter.
- **Attack-on-Titan-Fall:** Gibt es keine TV-Fortsetzung mehr, werden OVAs/Specials als Fortsetzung genutzt
  (die letzten Folgen, die AniWorld als normale Episoden zeigt).
- Weicht eine AniWorld-Staffelgrenze nur minimal (≤ 3 Folgen, z. B. Recap-Folge) von einer AniList-Grenze ab,
  rastet die Zuordnung auf die Grenze ein.
- Die Episodenzahlen der AniWorld-Staffeln werden von der Seite gelesen und 3 Tage zwischengespeichert.

### Filme-Tab (`/filme/film-N`)
- Die Filmliste von AniWorld wird gelesen; der Filmtitel wird mit MOVIE/OVA/ONA/SPECIAL des AniList-Franchise abgeglichen.
- Ist der Titel nicht eindeutig, wird nach Erscheinungsdatum zugeordnet – aber nur, wenn die Anzahl der
  AniWorld-Filme exakt zur Anzahl der AniList-Kandidaten passt. Sonst wird **nicht geraten**,
  die Leiste meldet „Film konnte auf AniList nicht eindeutig zugeordnet werden".
- Ein Film gilt nach dem Tracking als komplett (Status COMPLETED, Bewertungsabfrage).

### QuickLink AniList → AniWorld (`anilist.co/anime/<id>`)
- Auf jeder AniList-Anime-Seite erscheint ein Button „▶ AniWorld · Staffel N" (bzw. „Filme" bei MOVIE/OVA/Special).
- Ablauf: AniList-Prequel-Kette bis zur Wurzel → Titelsuche über `POST /ajax/search` auf AniWorld → Treffer per Titelähnlichkeit (≥ 0.6) →
  Staffel über die Summe der Vorgänger-Episoden gegen die AniWorld-Staffelgrößen (gleiche Toleranz wie beim Tracking, ≤ 3 Folgen).
- Kein eindeutiger Treffer → Button „AniWorld suchen" (öffnet die AniWorld-Suche). Ergebnisse werden 3 Tage zwischengespeichert.

## 🔜 Mögliche Erweiterungen
1. QuickLink auf der **AniWorld-Startseite**
2. Automatisch „Deutsch Sub" auswählen
3. Timer nur zählen lassen, wenn der Tab sichtbar ist
