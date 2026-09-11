# Brain switching: den Provider einer laufenden Unterhaltung wechseln

Ziel: In derselben Paseo-Unterhaltung von OpenCode auf Claude oder Codex
wechseln, ohne Workspace, Worktree, Agent-ID und Timeline zu verlieren.

## Warum das heute nicht geht

`AgentConfigOperations` (packages/server/src/server/session/agent-config/agent-config-session.ts:27)
bietet `setMode`, `setModel`, `setFeature`, `setThinking` — kein `setProvider`.
Der Provider steht bei der Erzeugung fest, deshalb zeigt der Model-Picker nur
Modelle des aktuellen Providers.

## Warum es trotzdem klein ist

Die Lebenszyklus-Mechanik existiert bereits (docs/agent-lifecycle.md:13-26):

- `closed` ist ein persistierter, fortsetzbarer Zustand ohne laufende Laufzeit.
- Schliessen gibt die Provider-Laufzeit frei, Datensatz und Timeline bleiben.
- `ensureAgentLoaded()` baut eine Laufzeit aus dem Datensatz auf, unter
  derselben Paseo-Agent-ID.
- Reload = genau diese Abfolge, mit E2E-Test
  (packages/server/src/server/daemon-e2e/agent-reload.native.real.e2e.test.ts).

Ein Providerwechsel ist also ein Reload, bei dem zwischen Schliessen und
Laden der Datensatz umgeschrieben wird.

## Der Datensatz

`STORED_AGENT_SCHEMA` (packages/server/src/server/agent/agent-storage.ts:45):

| Feld | beim Wechsel |
|---|---|
| `provider` | auf den neuen Provider setzen |
| `config.model` | auf das gewaehlte Modell des neuen Providers |
| `config.modeId`, `config.thinkingOptionId` | zuruecksetzen, Werte sind providerspezifisch |
| `runtimeInfo` | **loeschen** — `sessionId` gehoert zur alten Provider-Session |
| alles andere | unveraendert, insbesondere `id`, `cwd`, `workspaceId`, `persistence` |

Das Loeschen von `runtimeInfo` ist der kritische Punkt: Bleibt die alte
`sessionId` stehen, versucht die neue Laufzeit eine fremde Session
fortzusetzen.

## Umsetzung, in dieser Reihenfolge

1. **Server, Kern.** `setProvider(agentId, provider, modelId)` im AgentManager:
   schliessen, Datensatz umschreiben, `ensureAgentLoaded()`. Fehlschlag laesst
   den Agenten `closed` und wiederholbar zurueck, wie beim Reload.
2. **Timeline-Marker.** Ein Eintrag "Provider gewechselt: X -> Y", damit im
   Verlauf sichtbar bleibt, wo der Schnitt liegt.
3. **Protokoll.** `set_agent_provider_request` / `_response` analog zu
   `set_agent_mode_*`.
4. **Session-Huelle.** `setProvider` in `AgentConfigOperations`, Handler in
   `AgentConfigSession` nach dem Muster von `handleSetAgentModeRequest`.
5. **UI.** Model-Picker um die anderen Provider erweitern, mit Rueckfrage vor
   dem Wechsel.
6. **Tests.** E2E analog zum Reload-Test, plus Unit-Test fuer das Loeschen von
   `runtimeInfo`.

## Bewusst nicht Teil davon

Die native Provider-Historie wandert nicht mit. Eine OpenCode-Session ist keine
Claude-Session. Die Paseo-Timeline bleibt, die inhaltliche Uebergabe leistet
das Second Brain — der Weg Codex -> Claude ist damit bereits belegt.
