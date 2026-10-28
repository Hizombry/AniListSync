# Datenschutzhinweise – AniWorld → AniList Tracker

**Stand:** Version 1.6.0

## Welche Daten verarbeitet die Erweiterung?

Die Erweiterung liest auf `aniworld.to` Informationen, die für die Zuordnung eines Anime benötigt werden, insbesondere Titel, Staffel, Episode bzw. Filmtitel. Sie kann außerdem Anime-Daten von AniList abrufen, um passende Einträge zu finden und Status, Fortschritt oder Wertung darzustellen.

Wenn du die Erweiterung mit deinem AniList-Konto verwendest, werden für die entsprechenden Funktionen Anfragen an die AniList-GraphQL-API unter `https://graphql.anilist.co` gesendet. Je nach Aktion können diese Anfragen Suchbegriffe/Titel, AniList-Medien-IDs, Episodenfortschritt, Listenstatus und Bewertungen enthalten. Bei authentifizierten Anfragen wird dein AniList-Zugriffstoken im HTTP-Authorization-Header an AniList übermittelt.

Auf `anilist.co/anime/…` liest die Erweiterung die Anime-ID aus der Adresse. Für den QuickLink zu AniWorld werden Titel des Anime (aus der öffentlichen AniList-API, ohne Token) als Suchbegriff an `https://aniworld.to` gesendet.

## Wo werden die Daten verarbeitet?

- **Lokal im Browser:** Der AniList-Zugriffstoken wird im Erweiterungsspeicher des Browsers (`storage.local`) gespeichert. Die Erweiterung sendet die beschriebenen Funktionsanfragen direkt an AniList und betreibt keinen eigenen Server für diese Daten.
- **AniWorld:** Auf der aktuell geöffneten AniWorld-Seite kann die Erweiterung weitere Informationen same-origin abrufen, die für die Ermittlung von Staffel- und Episodenzahlen benötigt werden.
- **AniList:** An AniList übermittelte Daten unterliegen zusätzlich den Datenschutzbedingungen und der technischen Verarbeitung durch AniList.

Die Erweiterung enthält keine eigene Analyse- oder Telemetrieübermittlung. Sie sendet keine Daten an einen vom Erweiterungsautor betriebenen Server.

## Löschung und Kontrolle

Du kannst den gespeicherten AniList-Token in den Erweiterungsdaten bzw. durch Entfernen der Erweiterung löschen. Fortschritt, Status und Bewertungen, die erfolgreich an AniList übermittelt wurden, werden in deinem AniList-Konto gespeichert und müssen dort verwaltet oder gelöscht werden.
