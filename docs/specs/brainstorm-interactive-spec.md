# Brainstorm Interactive Specification

## Ziel

Der `brainstorm`-Step soll der erste vollwertige interaktive Workflow-Step
werden, in dem User und LLM gemeinsam ein belastbares fachliches Fundament fuer
ein `Item` erarbeiten.

Der Step ist kein einfacher Review-Dialog. Er ist ein kollaborativer
Arbeitsmodus, in dem noch keine stabile Produktdefinition vorausgesetzt wird.

Am Ende des Steps soll kein loser Chat-Verlauf stehen, sondern ein
strukturierter, nachvollziehbarer Arbeitsstand, aus dem ein formales
`Concept` erzeugt werden kann.

## Rolle im Gesamtworkflow

`brainstorm` bleibt eine echte Board-Spalte auf `Item`-Ebene:

- `idea`
- `brainstorm`
- `requirements`
- `implementation`
- `done`

Dabei gilt:

- `idea -> brainstorm` ist weiterhin direkt moeglich
- innerhalb von `brainstorm` arbeitet der User interaktiv mit dem LLM
- der Uebergang `brainstorm -> requirements` bleibt an ein freigegebenes
  `Concept` gebunden

Der interaktive Brainstorm-Step ersetzt also nicht den Concept-Step, sondern
liefert dessen vorbereiteten Input.

Aktueller Implementierungsstand:

- `brainstorm:promote` startet zusaetzlich direkt einen advisory
  Planning-Review-Run im generischen Review-Core fuer `requirements_engineering`
- dieser Review-Lauf ist in V1 eine zusaetzliche Entscheidungs- und
  Readiness-Sicht, aber kein hartes Gate

## Grundprinzip

Der Chat ist nicht die Quelle der Wahrheit.

Die fachliche Quelle der Wahrheit im Brainstorm ist ein strukturierter
`BrainstormDraft`, der waehrend der Session fortlaufend aktualisiert wird.

Das bedeutet:

- die Unterhaltung darf frei, explorativ und iterativ sein
- Entscheidungen, Annahmen und Verdichtungen muessen strukturiert persistiert
  werden
- die UI zeigt immer den aktuellen Draft als belastbaren Arbeitsstand
- der spaetere Concept-Step arbeitet aus dem Draft heraus, nicht aus rohen
  Chatnachrichten

## Produktcharakter des Steps

Der Brainstorm-Step ist ein moderierter Workshop zwischen User und LLM.

Das LLM soll dabei:

- gezielte Rueckfragen stellen
- Unklarheiten und Widersprueche sichtbar machen
- Antworten clustern und verdichten
- Optionen vergleichbar machen
- Annahmen klar markieren
- auf Konvergenz hinarbeiten

Der Step soll nicht zu einem unendlichen freien Chat werden.

## Interaktionsmodi

Innerhalb eines Brainstorm-Laufs gibt es vier interne Modi:

### `explore`

Ziel:

- Problemraum oeffnen
- Ziele, Nutzer, Probleme und Ideen sammeln

Typische LLM-Aktionen:

- 1 bis 3 gezielte Rueckfragen
- Zusammenfassung der bisherigen Aussagen
- Markierung fehlender Kerninformationen

### `shape`

Ziel:

- Inhalte ordnen
- Scope schaerfen
- widerspruechliche Aussagen explizit machen

Typische LLM-Aktionen:

- Themen clustern
- Scope und Non-Goals formulieren
- Risiken und offene Fragen ausweisen

### `compare`

Ziel:

- mehrere plausible Richtungen gegeneinanderstellen

Typische LLM-Aktionen:

- 2 bis 3 Loesungsrichtungen formulieren
- Vor- und Nachteile benennen
- Auswirkungen auf MVP, Komplexitaet und Risiko erklaeren

### `converge`

Ziel:

- einen belastbaren Arbeitsstand herstellen
- den Draft `ready_for_concept` machen

Typische LLM-Aktionen:

- empfohlene Richtung benennen
- verbleibende Annahmen offen markieren
- Zusammenfassung fuer den Concept-Entwurf vorbereiten

Diese Modi sind keine manuell schiebbaren UI-Spalten. Sie sind interne
Zustandsmarker des Brainstorm-Laufs.

## Kernobjekte

Der Step braucht drei zentrale Objekte.

### `BrainstormSession`

Container fuer den interaktiven Lauf.

Beispielhafte Felder:

- `id`
- `itemId`
- `status`
- `mode`
- `startedAt`
- `updatedAt`
- `resolvedAt`
- `lastAssistantMessageId`
- `lastUserMessageId`

Empfohlene Statuswerte:

- `open`
- `waiting_for_user`
- `synthesizing`
- `ready_for_concept`
- `resolved`
- `cancelled`

Empfohlene Moduswerte:

- `explore`
- `shape`
- `compare`
- `converge`

### `BrainstormMessage`

Persistierte Unterhaltung innerhalb der Session.

Beispielhafte Felder:

- `id`
- `sessionId`
- `role`
- `content`
- `createdAt`
- `structuredPayloadJson`
- `derivedUpdatesJson`

`role`:

- `system`
- `assistant`
- `user`

`derivedUpdatesJson` kann enthalten:

- extrahierte Entscheidungen
- erkannte offene Fragen
- vorgeschlagene Draft-Updates

### `BrainstormDraft`

Strukturierter Arbeitsstand fuer das Item.

Beispielhafte Felder:

- `id`
- `itemId`
- `sessionId`
- `revision`
- `status`
- `problem`
- `targetUsers`
- `coreOutcome`
- `useCases`
- `constraints`
- `nonGoals`
- `risks`
- `openQuestions`
- `candidateDirections`
- `recommendedDirection`
- `scopeNotes`
- `assumptions`
- `lastUpdatedAt`
- `lastUpdatedFromMessageId`

Im aktuellen Implementierungsstand kann ein `BrainstormDraft` auch direkt als
`planning review`-Quelle verwendet werden:

- `sourceType=brainstorm_draft`

Wenn ein Planning Review automatisch aus `brainstorm:promote` gestartet wird,
wird der Lauf aktuell mit `automationLevel=auto_comment` persistiert.

Empfohlene Statuswerte:

- `drafting`
- `needs_input`
- `ready_for_concept`
- `superseded`

## Quelle der Wahrheit

Fachlich relevante Informationen muessen in den Draft oder in explizite
Entscheidungsobjekte ueberfuehrt werden.

Der Chat alleine darf nicht ausreichend sein fuer:

- Konzeptgenerierung
- Autorun-Fortsetzung
- UI-Fortschrittsanzeige
- Nachvollziehbarkeit spaeterer Entscheidungen

## Optionale Zusatzobjekte

### `BrainstormDecision`

Explizite Entscheidungen, die im Verlauf getroffen wurden.

Beispiele:

- `B2B zuerst`
- `kein mobiler Scope im MVP`
- `Self-Service statt Sales-Setup`

Beispielhafte Felder:

- `id`
- `sessionId`
- `itemId`
- `category`
- `label`
- `rationale`
- `decidedAt`
- `sourceMessageId`

### `BrainstormQuestion`

Offene fachliche Fragen, die das LLM oder der User explizit festhaelt.

Beispielhafte Felder:

- `id`
- `sessionId`
- `itemId`
- `question`
- `status`
- `answer`
- `resolvedAt`

Status:

- `open`
- `answered`
- `dismissed`

Diese Objekte sind fuer den ersten Slice optional, aber fuer die UI spaeter
wertvoll.

## Interner Ablauf

Ein Brainstorm-Lauf soll in einer kontrollierten Schleife funktionieren.

### 1. Session starten

Ausgangspunkt:

- `Item.currentColumn = brainstorm`
- entweder neues Item aus `idea`
- oder Wiederaufnahme eines bestehenden Brainstorm-Laufs

Die Engine erzeugt oder oeffnet eine `BrainstormSession` und einen initialen
`BrainstormDraft`.

### 2. Kontext bauen

Vor jeder LLM-Antwort baut die Engine einen fokussierten Brainstorm-Kontext.

Der Kontext sollte enthalten:

- `Item`-Metadaten
- bisherigen `BrainstormDraft`
- relevante fruehere Entscheidungen
- letzte Chat-Nachrichten im begrenzten Fenster
- offene Fragen
- gewuenschten Session-Modus

Der Kontext soll bewusst klein und zustandsbezogen bleiben.

### 3. LLM-Antwort erzeugen

Das LLM bekommt nicht nur Chat-Historie, sondern einen klaren Auftrag:

- den aktuellen Stand zusammenfassen
- die naechste beste Rueckfrage oder Verdichtung liefern
- strukturierte Draft-Aenderungen vorschlagen
- auf Konvergenz statt Endlos-Dialog hinarbeiten

### 4. Strukturierte Ableitungen speichern

Aus jeder Assistant-Nachricht koennen strukturierte Updates abgeleitet werden:

- Draft-Feldupdates
- neue offene Fragen
- neue oder geaenderte Richtungen
- neue Entscheidungen

Diese Updates werden nicht blind geschrieben. Entweder:

- sie werden engine-seitig deterministisch angewandt
- oder sie werden als vorgeschlagene Updates gespeichert und in der UI bestaetigt

### 5. Session-Status neu bewerten

Nach jeder relevanten Nachricht bewertet die Engine:

- fehlt noch Pflichtkontext
- gibt es widerspruechliche Richtungen
- ist der Draft belastbar genug
- ist `ready_for_concept` erreicht

### 6. Abschlussaktion

Der User oder spaeter die UI kann den Brainstorm-Lauf mit einer klaren Aktion
beenden:

- `continue_brainstorm`
- `accept_draft_updates`
- `choose_direction`
- `promote_to_concept`
- `promote_to_concept_and_autorun`
- `cancel`

## Draft-Struktur

Der `BrainstormDraft` sollte fuer das UI sauber renderbar und editierbar sein.

Empfohlene Sektionen:

- `problem`
- `targetUsers`
- `coreOutcome`
- `useCases`
- `constraints`
- `nonGoals`
- `risks`
- `assumptions`
- `openQuestions`
- `candidateDirections`
- `recommendedDirection`
- `scopeNotes`

Optional pro Feld:

- `confidence`
- `source`
- `updatedAt`

Damit kann das UI kenntlich machen:

- was gesichert ist
- was nur Annahme ist
- was noch offen ist

## UI-Abbildung

Der Brainstorm-Step sollte spaeter nicht als simples Chatfenster dargestellt
werden.

Empfohlene UI-Zonen:

### 1. Conversation Pane

Enthaelt:

- laufenden Austausch mit dem LLM
- Rueckfragen
- Zusammenfassungen
- Optionen und Empfehlungen

### 2. Working Draft Pane

Enthaelt den strukturierten `BrainstormDraft`.

Eigenschaften:

- live aktualisiert
- pro Feld editierbar
- Annahmen und offene Fragen sichtbar
- Unterschiede zur letzten Revision nachvollziehbar

### 3. Decision Pane

Enthaelt die naechsten sinnvollen Aktionen:

- `Weiter vertiefen`
- `Entscheidung treffen`
- `Richtung waehlen`
- `Concept-Entwurf erzeugen`
- `Concept erzeugen und Autorun fortsetzen`

### 4. Status Header

Zeigt eindeutig:

- `Item`
- Brainstorm-Status
- internen Modus
- letzte Aktualisierung
- ob der Draft bereits `ready_for_concept` ist

## UI-Verhalten

Die UI darf den Workflow fachlich nicht selbst schieben.

Das bedeutet:

- die UI zeigt den engine-seitigen Session- und Draft-Zustand
- die UI sendet User-Nachrichten und Abschlussaktionen an die Engine
- die Engine entscheidet, ob der Brainstorm-Lauf offen bleibt, in
  `ready_for_concept` wechselt oder ein `Concept` erzeugt wird

Auch spaeter im UI bleibt die Quelle der Wahrheit engine-owned.

## Uebergang zu Concept

Der wichtigste Abschluss des Brainstorm-Steps ist nicht `approve`, sondern:

- `promote_to_concept`
- optional `promote_to_concept_and_autorun`

Semantik:

1. Brainstorm-Draft wird eingefroren oder versioniert
2. daraus wird ein formaler Concept-Entwurf erzeugt
3. der Concept-Step uebernimmt wieder die formale Review-/Approval-Logik
4. erst nach freigegebenem Concept ist `brainstorm -> requirements` erlaubt

Das haelt die Trennung sauber:

- Brainstorm = explorieren, verdichten, entscheiden
- Concept = formalisieren, reviewen, freigeben

## Autorun-Integration

`autorun` soll im Brainstorm nicht frei weiterlaufen.

Der Brainstorm-Step ist grundsaetzlich interaktiv.

Zulaessig ist nur:

- `promote_to_concept_and_autorun`

Dabei gilt:

1. Brainstorm wird strukturiert abgeschlossen
2. Concept-Entwurf wird erzeugt
3. falls die Produktregel es erlaubt, wird der anschliessende Concept-Review-
   und Approval-Pfad uebernommen

Fuer den ersten Slice sollte `autorun` Brainstorm selbst nicht simulieren.

## LLM-Verhaltensregeln

Das Modell im Brainstorm soll strenger gefuehrt werden als in einem freien
Chat.

Empfohlene Regeln:

- nie mehr als 1 bis 3 neue Rueckfragen gleichzeitig
- regelmaessig den Stand zusammenfassen
- Annahmen klar kennzeichnen
- Widersprueche explizit benennen
- Optionen vergleichbar formulieren
- nicht vorschnell loesen, wenn der Problemraum noch unklar ist
- nicht endlos offen bleiben, sondern auf Konvergenz hinarbeiten

## Abgrenzung zu anderen interaktiven Steps

`brainstorm` ist nicht dasselbe wie:

- `review`
- `approval`
- `qa resolution`
- `documentation review`

Unterschied:

- Brainstorm erzeugt und formt das Artefakt erst
- Review bewertet ein vorhandenes Artefakt
- Approval setzt eine formale Workflow-Entscheidung

Diese Trennung sollte sich in Engine und UI widerspiegeln.

## CLI- und API-Shape

Moegliche erste Kommandos:

- `brainstorm:start --item-id <id>`
- `brainstorm:show --item-id <id>`
- `brainstorm:chat --session-id <id> --message "..."`
- `brainstorm:draft --session-id <id>`
- `brainstorm:promote --session-id <id>`
- `brainstorm:promote --session-id <id> --autorun`
- `planning-review:start --source-type brainstorm_session --source-id <id> --step requirements_engineering ...`
- `planning-review:start --source-type brainstorm_draft --source-id <id> --step requirements_engineering ...`

Fuer eine spaetere API/UI sind dieselben Operationen als strukturierte Endpunkte
oder Commands abzubilden.

Der aktuelle CLI-Stand liefert bei `brainstorm:promote` neben `conceptId` und
`draftRevision` auch das Ergebnis des advisory Planning Reviews zurueck.

## Persistenz- und Versionsstrategie

Empfohlen:

- `BrainstormDraft` ist revisioniert
- jede groessere Verdichtung erzeugt eine neue Revision
- `promote_to_concept` referenziert die verwendete Draft-Revision

Damit bleibt spaeter nachvollziehbar:

- welche Aussagen in welches Concept eingeflossen sind
- wann Richtungen verworfen wurden
- welche Annahmen zum Zeitpunkt der Promotion offen waren

## Implementierungsstrategie

### Phase 1

Minimal nutzbarer Slice:

- `BrainstormSession`
- `BrainstormMessage`
- `BrainstormDraft`
- Chat mit LLM
- strukturierte Draft-Verdichtung
- `promote_to_concept`

### Phase 2

Produktive Verbesserung:

- Richtungsvergleich
- explizite `BrainstormDecision`
- UI mit Conversation, Draft und Action Panel
- `promote_to_concept_and_autorun`

### Phase 3

Weiterer Ausbau:

- offene Fragen als first-class Objekt
- differenzierte Draft-Aenderungsvorschlaege
- bessere Heuristik fuer Moduswechsel
- gemeinsame interaktive Infrastruktur fuer weitere Workflow-Steps

## Offene Entscheidungen

Vor der Implementierung muessen folgende Punkte festgelegt werden:

- duerfen Draft-Updates automatisch geschrieben werden oder muessen sie immer
  bestaetigt werden
- wie stark darf das LLM den Draft direkt umformulieren
- wann gilt ein Brainstorm-Lauf als `ready_for_concept`
- ob mehrere parallele Brainstorm-Sessions pro `Item` erlaubt sind
- ob das UI Feld-fuer-Feld manuelle Edits speichern darf oder nur strukturierte
  LLM-Updates

## Empfehlung

Der Brainstorm-Step sollte der erste vollwertige interaktive Workflow-Step
werden.

Er ist fachlich der staerkste Ort fuer Human-in-the-Loop und spaeter fuer eine
gute UI.

Die richtige Kernstruktur dafuer ist:

- Chat fuer Exploration
- strukturierter Draft als Wahrheit
- explizite Entscheidungen
- klarer Abschluss `promote_to_concept`

So bleibt der Workflow kontrolliert, das UI nachvollziehbar und der Uebergang
zum bestehenden Approval- und Autorun-System sauber.
