# Interactive Review Specification

## Ziel

Diese Spezifikation beschreibt interaktive Review- und Feedback-Schritte fuer
bestehende Workflow-Artefakte.

Anders als beim interaktiven `brainstorm` geht es hier nicht darum, einen
Problemraum offen zu erkunden, sondern vorhandene Artefakte gezielt zu:

- verstehen
- kommentieren
- korrigieren
- verfeinern
- freigeben
- oder zur Ueberarbeitung zurueckgeben

Die Spez soll sowohl die Engine-Logik als auch die spaetere UI-Abbildung
tragen.

## Anwendungsfaelle

Interaktive Review-Sessions sollen fuer folgende Artefakte moeglich sein:

- `Concept`
- `UserStories` eines `Project`
- `Architecture`
- `ImplementationPlan`
- `QaRun`
- `DocumentationRun`

Spaeter optional:

- `AppVerificationRun`
- `StoryReviewRun`
- Remediation-Entscheidungen mit User-Beteiligung

## Abgrenzung zu Brainstorm

`brainstorm` und `interactive review` sind bewusst getrennte Modi.

Unterschied:

- `brainstorm` ist divergierend und artefaktbildend
- `interactive review` ist konvergierend und artefaktbewertend

Das bedeutet:

- im Review gibt es bereits ein konkretes Arbeitsobjekt
- das LLM hilft beim Verstehen, Kommentieren und Scharfstellen
- der Abschluss ist eine formale Resolution mit Workflow-Effekt

## Grundprinzip

Auch im Review gilt:

- der Chat ist nicht die Quelle der Wahrheit
- die fachliche Quelle der Wahrheit ist das Artefakt plus strukturierte
  Review-Daten
- die Engine bleibt workflow-owned
- die UI darf keine fachlichen Status direkt setzen

Das LLM kann Vorschlaege machen, Feedback strukturieren und Konsequenzen
erklaeren, aber der Workflow-Fortschritt entsteht nur durch eine formale
Resolution.

## Review-Typen

Die interaktive Infrastruktur soll mehrere Review-Typen tragen.

### `artifact_review`

Fuer ein einzelnes Artefakt.

Beispiele:

- Concept pruefen
- Architecture pruefen
- Plan pruefen
- QA-Ergebnis pruefen
- Documentation pruefen

### `collection_review`

Fuer eine Liste von Artefakten mit Sammelentscheidung.

Beispiel:

- Stories eines Projects pruefen

Hier braucht es sowohl:

- Gesamtfeedback
- als auch Feedback auf einzelne Eintraege

### `exception_review`

Fuer Faelle mit `review_required`, bei denen der User eine Entscheidung treffen
soll.

Beispiele:

- QA mit offenen Risiken
- Documentation mit fachlichen Luecken
- App Verification mit unklarer Schwere

### `guided_edit`

Fuer kontrollierte Ueberarbeitung eines bestehenden Artefakts.

Beispiel:

- Story soll geschaerft werden
- Architecture soll vereinfacht werden
- Documentation soll umformuliert werden

## Kernobjekte

### `InteractiveReviewSession`

Container fuer den interaktiven Review-Lauf.

Beispielhafte Felder:

- `id`
- `scopeType`
- `scopeId`
- `artifactType`
- `reviewType`
- `status`
- `startedAt`
- `updatedAt`
- `resolvedAt`
- `lastAssistantMessageId`
- `lastUserMessageId`

`scopeType`:

- `item`
- `project`
- `concept`
- `story_collection`
- `story`
- `architecture`
- `implementation_plan`
- `qa_run`
- `documentation_run`

`artifactType`:

- `concept`
- `stories`
- `architecture`
- `implementation_plan`
- `qa`
- `documentation`

`reviewType`:

- `artifact_review`
- `collection_review`
- `exception_review`
- `guided_edit`

`status`:

- `open`
- `waiting_for_user`
- `synthesizing`
- `ready_for_resolution`
- `resolved`
- `cancelled`

### `InteractiveReviewMessage`

Persistierte Unterhaltung.

Beispielhafte Felder:

- `id`
- `sessionId`
- `role`
- `content`
- `structuredPayloadJson`
- `derivedUpdatesJson`
- `createdAt`

`role`:

- `system`
- `assistant`
- `user`

### `InteractiveReviewEntry`

Strukturierte Review-Einheit innerhalb der Session.

Das ist wichtig fuer Artefakte, die aus mehreren Teilen bestehen, vor allem bei
`UserStories`.

Beispielhafte Felder:

- `id`
- `sessionId`
- `entryType`
- `entryId`
- `title`
- `status`
- `summary`
- `changeRequest`
- `rationale`
- `severity`
- `createdAt`
- `updatedAt`

`entryType`:

- `story`
- `section`
- `finding`
- `option`

`status`:

- `pending`
- `accepted`
- `needs_revision`
- `rejected`
- `resolved`

Fuer `stories` ist das das zentrale Objekt fuer pro-Story-Feedback.

### `InteractiveReviewResolution`

Formale Abschlussaktion mit Workflow-Effekt.

Beispielhafte Felder:

- `id`
- `sessionId`
- `resolutionType`
- `payloadJson`
- `createdAt`
- `appliedAt`

Moegliche `resolutionType`-Werte:

- `approve`
- `approve_and_autorun`
- `request_changes`
- `apply_guided_changes`
- `retry`
- `retry_and_autorun`
- `accept_with_rationale`
- `reject`
- `defer`

Ohne dieses Objekt bleibt die Session nur Unterhaltung.

## Beziehung zu Planning Review

Der aktuelle Implementierungsstand fuehrt neben `interactive review` eine
separate advisory `planning review`-Schicht.

Abgrenzung:

- `interactive review`
  - usergesteuerte, konvergierende Review-Interaktion auf einem Artefakt
- `planning review`
  - strukturierter Readiness- und Entscheidungsreview mit Findings, Synthese,
    Fragen und Annahmen

Wichtig:

- `InteractiveReviewSession` bleibt bestehen und wird nicht durch
  `PlanningReviewRun` ersetzt
- `InteractiveReviewSession` kann aber als `planning review`-Quelle dienen:
  - `sourceType=interactive_review_session`
- das ist aktuell fuer diese Artefaktfaelle unterstuetzt:
  - `stories` auf Project-Ebene
  - `concept`
  - `architecture`
  - `implementation_plan`

## Planning Review Triggering

Planning Review haengt in V1 advisory an bestehende Workflow-Schritte an:

- nach `brainstorm:promote`
- nach erfolgreichem `architecture:start`
- nach erfolgreichem `planning:start`

Der Trigger verbleibt bewusst in den bestehenden workflow-owned Services. Es
gibt in V1 kein separates Event-Bus-System dafuer.

## Quelle der Wahrheit

Im Review ist die Quelle der Wahrheit immer:

- das zugrunde liegende Artefakt
- plus strukturierte Review-Eintraege
- plus die finale Resolution

Der Chat alleine darf nicht ausreichend sein fuer:

- Story-Aenderungen
- Story-Approval
- Architecture-Approval
- Plan-Approval
- QA-Entscheidungen
- Documentation-Fortsetzung

## Besondere Anforderungen fuer UserStory-Feedback

`stories` sind der wichtigste Fall fuer interaktives Feedback.

Hier reicht ein Session-weites Sammelurteil nicht aus. Es braucht zwei Ebenen:

### 1. Project-Ebene

Feedback auf den Story-Satz insgesamt:

- ist der Scope stimmig
- fehlen Stories
- gibt es Duplikate
- ist die Zerlegung sinnvoll
- passen Priorisierung und Schnitte

### 2. Story-Ebene

Feedback auf einzelne Stories:

- unklar formuliert
- zu gross
- fachlich unvollstaendig
- Akzeptanzkriterien fehlen
- falscher Scope
- Story sollte aufgeteilt werden

Deshalb soll eine `stories`-Review-Session immer:

- Session-weites Gesamtfeedback
- plus strukturierte `InteractiveReviewEntry` pro Story

unterstuetzen.

## Typische Story-Resolutionen

Fuer Story-Feedback sind insbesondere diese Resolutionen wichtig:

- `approve_all`
- `approve_all_and_autorun`
- `approve_selected`
- `request_story_revisions`
- `apply_story_edits`
- `regenerate_story_set`

Technisch kann das auf `InteractiveReviewResolution.payloadJson` abgebildet
werden, z. B. mit:

- betroffenen `storyIds`
- Edit-Anweisungen
- Sammelrationale
- `autorun = true|false`

## Interner Ablauf

### 1. Session starten

Ausgangspunkt ist ein bestehendes Artefakt oder eine bestehende Sammlung.

Beispiele:

- Concept wurde erzeugt
- Stories fuer ein Project wurden erzeugt
- Architecture ist fertig
- Planning ist fertig
- QA oder Documentation enden auf `review_required`

Die Engine erstellt eine `InteractiveReviewSession`.

### 2. Kontext bauen

Vor jeder Assistant-Antwort erzeugt die Engine einen fokussierten Review-
Kontext.

Der Kontext enthaelt je nach Artefakt:

- das aktuelle Artefakt
- Metadaten zum Scope
- letzte Aenderungen
- relevante offenen Punkte
- bestehende Review-Eintraege
- letzte Chatnachrichten in begrenztem Fenster

Bei `stories` zusaetzlich:

- Story-Liste
- Story-Reihenfolge
- Story-Status
- evtl. bereits bekannte Einwaende oder offene Punkte

### 3. LLM-Unterstuetzung

Das LLM soll nicht nur frei reagieren, sondern gezielt helfen:

- Artefakt zusammenfassen
- Risiken und Unklarheiten benennen
- Storys oder Abschnitte vergleichen
- Aenderungsvorschlaege formulieren
- Abschlussoptionen erklaeren

### 4. Strukturierte Review-Daten aktualisieren

Aus Assistant- und User-Nachrichten koennen strukturierte Daten entstehen:

- neue `InteractiveReviewEntry`
- Aktualisierung bestehender Eintraege
- zusammenfassende Session-Notizen
- vorgeschlagene Resolutionen

Diese Updates duerfen nicht unkontrolliert direkt in Workflow-Status
umschlagen.

### 5. Resolution anwenden

Die Session endet mit einer klaren Resolution.

Je nach Typ fuehrt die Engine anschliessend gezielt Actions aus:

- `concept:approve`
- `stories:approve`
- `architecture:approve`
- `planning:approve`
- `qa:retry`
- `documentation:retry`
- `autorun` fortsetzen

## UI-Abbildung

Die UI fuer interaktives Review sollte nicht nur aus einem Chatfenster bestehen.

Empfohlene Zonen:

### 1. Artifact Pane

Zeigt das Artefakt selbst:

- Concept-Text
- Story-Liste
- Architecture-Dokument
- Plan
- QA- oder Documentation-Ergebnis

### 2. Conversation Pane

Enthaelt:

- Chat mit dem LLM
- Rueckfragen
- Zusammenfassungen
- Vorschlaege

### 3. Feedback Pane

Strukturierte Review-Eintraege.

Bei `stories`:

- Liste aller Stories
- Status pro Story
- Feedback pro Story
- moegliche vorgeschlagene Aenderungen

### 4. Resolution Pane

Verfuegbare Abschlussaktionen:

- `Approve`
- `Approve and autorun`
- `Request changes`
- `Apply guided changes`
- `Retry`
- `Retry and autorun`

## UI-Verhalten fuer Stories

Story-Feedback braucht eine eigene Darstellung.

Empfohlene Ansicht:

- linke Spalte: Story-Liste
- mittlere Spalte: ausgewaehlte Story im Detail
- rechte Spalte: Feedback, Aenderungsvorschlaege und Abschlussaktionen

Wichtige UI-Funktionen:

- Story markieren als `ok`
- Story markieren als `needs revision`
- Aenderungsvorschlag uebernehmen
- Sammelkommentar fuer das ganze Project setzen
- alle Stories freigeben
- freigeben und Autorun fortsetzen

Das UI schiebt dabei keine Stories selbst fachlich durch den Workflow. Es
arbeitet immer ueber Engine-Aktionen und Resolutionen.

## Guided Edit

Ein Review kann in einen kontrollierten Bearbeitungsmodus uebergehen.

Beispiele:

- Story-Text klarer formulieren
- Akzeptanzkriterien erweitern
- Architecture-Abschnitt vereinfachen
- Dokumentation sprachlich schaerfen

Wichtig:

- Guided Edit ist kein unkontrolliertes Direkt-Edit
- das LLM erzeugt Aenderungsvorschlaege
- der User oder die Engine bestaetigt die Uebernahme
- die Aenderung wird als strukturiertes Update gespeichert

## Autorun-Integration

Interaktive Review-Sessions koennen sauber mit `autorun` zusammenspielen.

Zulaessige Abschluesse:

- `approve_and_autorun`
- `retry_and_autorun`

Semantik:

1. Session wird formal resolved
2. die zugrunde liegende Workflow-Aktion wird ausgefuehrt
3. anschliessend startet der bestehende Autorun-Orchestrator

Wichtig:

- `autorun` wird nie aus blossem Chat gestartet
- immer nur aus einer formalen Resolution

## CLI- und API-Shape

Moegliche erste Kommandos:

- `review:start --type concept --concept-id <id>`
- `review:start --type stories --project-id <id>`
- `review:start --type architecture --project-id <id>`
- `review:start --type planning --project-id <id>`
- `review:start --type qa --qa-run-id <id>`
- `review:start --type documentation --documentation-run-id <id>`
- `review:show --session-id <id>`
- `review:chat --session-id <id> --message "..."`
- `review:resolve --session-id <id> --action approve`
- `review:resolve --session-id <id> --action approve_and_autorun`

Fuer `stories` zusaetzlich spaeter:

- `review:entry:update --session-id <id> --story-id <id> --status needs_revision`
- `review:entry:accept --session-id <id> --story-id <id>`

Dieselben Konzepte sollen spaeter als API fuer die UI bereitstehen.

## Persistenzstrategie

Empfohlen:

- Session persistent speichern
- Nachrichten persistent speichern
- Review-Eintraege persistent speichern
- finale Resolution persistent speichern

So bleibt nachvollziehbar:

- welches Feedback zu welchem Artefakt gegeben wurde
- welche Story warum zur Ueberarbeitung ging
- welche Resolution den Workflow weitergeschoben hat

## Implementierungsstrategie

### Phase 1

Minimal wertvoller Slice:

- generische `InteractiveReviewSession`
- `InteractiveReviewMessage`
- `InteractiveReviewResolution`
- Review fuer `stories`
- `approve`
- `approve_and_autorun`
- `request_changes`

Warum `stories` zuerst:

- dort ist der Mehrwert am groessten
- dort ist der Bedarf fuer pro-Entry-Feedback am klarsten
- dort profitiert die spaetere UI am staerksten

### Phase 2

Ausbau:

- `InteractiveReviewEntry`
- Concept-, Architecture- und Planning-Review
- Guided Edit fuer Story-Aenderungen
- bessere Sammel- und Einzelresolutionen

### Phase 3

Weiterer Ausbau:

- QA- und Documentation-Exception-Review
- App Verification Review
- gemeinsame interaktive Infrastruktur mit Brainstorm

## Gemeinsame Roadmap mit Brainstorm

`brainstorm` und `interactive review` sollen nicht als zwei getrennte
Einzelloesungen gebaut werden, sondern auf einer gemeinsamen interaktiven
Infrastruktur aufsetzen.

Empfohlene Reihenfolge:

### 1. Gemeinsames Interaktions-Fundament

Zuerst eine kleine gemeinsame Basisschicht bauen:

- Session-Container
- Nachrichtenpersistenz
- LLM-Reply-Pipeline
- strukturierte Resolution
- Context-Builder pro Interaktionstyp

Ziel:

- keine doppelte Chat-Infrastruktur fuer Brainstorm und Review
- einheitliche Persistenz
- einheitliche Engine-Owned-Logik

### 2. Brainstorm als erster interaktiver Step

Danach zuerst `brainstorm` umsetzen, weil dort der groesste Human-in-the-Loop-
Mehrwert liegt.

Erster Scope:

- `BrainstormSession`
- `BrainstormMessage`
- `BrainstormDraft`
- Chat
- Draft-Verdichtung
- `promote_to_concept`

Ziel:

- interaktive Engine-Grundlogik mit echtem Produktnutzen validieren
- UI-Modell mit `Conversation`, `Working Draft` und `Decision Pane` testen

### 3. Stories als erster Review-Kernfall

Nach Brainstorm `stories` als ersten interaktiven Review-Step umsetzen.

Erster Scope:

- `InteractiveReviewSession`
- `InteractiveReviewMessage`
- `InteractiveReviewResolution`
- Story-Liste im Scope eines Projects
- Session-weites Gesamtfeedback
- pro Story strukturierte Review-Eintraege
- `approve`
- `approve_and_autorun`
- `request_changes`

Ziel:

- den wichtigsten spaeteren UI-Fall abdecken
- Story-Feedback maschinenlesbar machen
- Autorun sauber an interaktive Freigaben anschliessen

### 4. Gemeinsame UI fuer interaktive Steps

Danach eine gemeinsame UI-Schale fuer:

- Session-Header
- Conversation Pane
- Kontext-/Artefaktbereich
- strukturierte Seitenspalte fuer Draft oder Feedback
- Action-/Resolution-Bereich

Dabei bleiben die inhaltlichen Unterschiede klar:

- Brainstorm zeigt einen `Working Draft`
- Review zeigt Artefakt plus strukturierte Feedback-Eintraege

### 5. Weitere Review-Typen

Auf dem gemeinsamen Fundament folgen:

- `Concept`
- `Architecture`
- `ImplementationPlan`
- `QaRun`
- `DocumentationRun`

Danach optional:

- `AppVerificationRun`
- `StoryReviewRun`
- User-in-the-loop bei Remediation-Ausnahmen

### 6. Gemeinsame Resolver und Policies

Im naechsten Ausbau gemeinsame Resolver einfuehren fuer:

- `approve`
- `approve_and_autorun`
- `request_changes`
- `retry`
- `retry_and_autorun`
- `guided_edit`

Damit wird vermieden, dass jede Session-Art ihre eigene Workflow-
Fortsetzungslogik dupliziert.

## Empfohlener erster technischer Slice

Wenn nur ein sinnvoller Start gebaut werden soll, ist die beste Reihenfolge:

1. gemeinsame Session-/Message-/Resolution-Infrastruktur
2. `brainstorm`
3. `stories`-Review
4. UI fuer beide

Das liefert frueh den groessten Produktwert:

- Brainstorm wird wirklich kollaborativ
- Story-Feedback wird sauber interaktiv
- `approve_and_autorun` wird in einem UI-faehigen Modell verankert

## Offene Entscheidungen

Vor der Implementierung muessen diese Punkte festgelegt werden:

- duerfen Story-Texte direkt aus Guided Edit aktualisiert werden oder nur nach
  expliziter Bestaetigung
- wie fein Story-Feedback modelliert werden soll:
  nur pro Story oder auch pro Acceptance Criterion
- ob eine Stories-Review mehrere parallele Sessions pro Project erlauben darf
- ob `request_changes` bestehende Stories mutiert oder ein neues Story-Set
  erzeugt
- wie stark Session-weite Sammelentscheide einzelne Story-Entscheide
  ueberschreiben duerfen

## Empfehlung

Nach `brainstorm` sollte `stories` der naechste interaktive Kernfall werden.

Der richtige Zuschnitt dafuer ist:

- Review-Session als Container
- Chat als Erklaerungs- und Verhandlungsraum
- strukturierte Eintraege pro Story
- formale Resolution fuer Workflow-Fortschritt

So bekommt ihr spaeter eine UI, in der Story-Feedback klar, maschinenlesbar und
workflow-faehig ist, statt in losem Chat zu verschwinden.
