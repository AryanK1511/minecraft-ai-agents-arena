# Current requirements amendment — 25 September 2026

The user explicitly revised the original plan:

- Replace the artificial stocked platform with a compact, beautiful natural biome containing trees, flowers, water, terrain, and all resources needed for the house.
- Start agents empty-handed. No pre-stocked chests or supplied tools. They gather, mine, craft, smelt, and obtain wool through survival actions.
- Keep players within a small area visible from the spectator overview.
- Run physical agent actions concurrently. Coordinate distinct duties, dependencies, resource/block claims, and a visible shared chat log. Serialize only genuinely shared resources.
- Preserve the original run archive when migrating to this world. All remaining original requirements below still apply where compatible.

---

# Minecraft AI House-Building Arena

## Summary

Create a local Docker Compose project running Minecraft Java **26.3**, three AI players, and a small control dashboard. The agents collaboratively design and build a house using supplied survival materials. You join as **aryank1511**, automatically placed in spectator mode at a viewpoint showing the entire arena.

Use inexpensive OpenRouter models with a **shared $1 budget per run**. Everything starts paused.

## Server and arena

- Run two containers: the Minecraft server and a TypeScript application containing three independent agent loops, coordination, persistence, and the dashboard.
- Use Paper 26.3 on Java 25, with ViaVersion and ViaBackwards 5.12.0. Mineflayer bots connect using protocol 26.1; your client connects using 26.3. ViaBackwards documents [26.3 server support](https://github.com/ViaVersion/ViaBackwards/releases/tag/5.12.0).
- First prove bot connection, movement, inventory access, and placement through this bridge. Pin the working server build, plugins, image, and dependencies. If this fails, treat compatibility as a blocker; do not silently downgrade Minecraft.
- Build a **32×32 flat arena** surrounded by void, with a protected floor and boundary. Use a small Paper plugin for arena generation, protection, spectator placement, and reset.
- Set permanent daylight, clear weather, peaceful difficulty, no mob spawning, and no PvP.
- Provide stocked supply chests, tools, and scaffolding materials. Restrict construction to a central **13×13 footprint**, at most **8 blocks high**, using blocks understood by both client versions.
- Agents use survival mechanics for construction. Administrative world changes are limited to setup and reset.
- Whitelist `agent1`, `agent2`, `agent3`, and `aryank1511`. Use offline authentication and bind Minecraft to `127.0.0.1:25565`; keep administrative ports internal.
- Place you at an elevated overview on joining. Provide a dashboard “Return to overview” button; allow free spectator flight. Tune the camera for the full arena at ordinary desktop aspect ratios.

## Agents, shared context, and cost

Create this structure:

```text
agents/
  agent1/
  agent2/
  agent3/
shared/
  prompts/
  minecraft-rules/
  house-requirements/
  runs/
```

Each agent folder contains its model configuration and individual prompt. Shared files explain coordinates, movement, reach, inventories, placement, scaffolding, collaboration, and completion requirements.

Use these configurable starting models:

| Player | OpenRouter model                           |
| ------ | ------------------------------------------ |
| agent1 | `qwen/qwen3-30b-a3b-instruct-2507`         |
| agent2 | `mistralai/mistral-small-3.2-24b-instruct` |
| agent3 | `meta-llama/llama-3.3-70b-instruct`        |

These are inexpensive candidates from three model families, currently listed by [Qwen](https://openrouter.ai/qwen/qwen3-30b-a3b-instruct-2507), [Mistral](https://openrouter.ai/mistralai/mistral-small-3.2-24b-instruct), and [Meta](https://openrouter.ai/meta-llama/llama-3.3-70b-instruct) on OpenRouter. Validate availability, tool support, and pricing before starting; unavailable models produce a visible configuration error.

- Give agents equal capabilities and separate conversation histories. They propose a shared blueprint, review it, agree by majority, and claim construction tasks with dependencies.
- Require a floor, enclosing walls, accessible doorway and door, windows, complete roof, lighting, three beds, a crafting table, and a chest. Agents choose the appearance and layout.
- Expose validated tools for observation, inventory, movement, chest transfers, placing/removing blocks, building bounded sections, messaging, blueprint proposals, and task claims.
- Execute walking and placement through deterministic Mineflayer routines. Section-building tools place real blocks individually, respect reach and inventory, verify results, and report partial progress.
- Coordinate task ownership and construction-region reservations centrally. Serialize shared chest access; release abandoned reservations after disconnects.
- Persist the task board, blueprint revisions, agent memory, action results, and usage in SQLite. Export readable messages and run summaries into the shared run folder.
- Supply compact world observations and recent changes instead of full transcripts. Call models when decisions are needed, with at most one outstanding request per agent.
- Enforce the $1 run budget through central reservations for pending requests, output limits, provider price ceilings, and reconciliation with reported usage. Pause if pricing or billed usage cannot be resolved safely.
- Bound retries for API errors and failed actions. Repeated failures or lack of progress pause the affected work and appear in the dashboard; no automatic model upgrades.

## Dashboard and lifecycle

- Serve a small dashboard at `http://localhost:3000`, using a TypeScript backend, React UI, and server-sent events.
- Show three agent cards with model, connection state, current action, inventory summary, messages, completed tasks, and spending.
- Show the shared blueprint summary, task board, run budget, and completion checklist.
- Provide **Start, Pause, Resume, Reset, and Return to overview** controls. Pause cancels queued work and stops active routines at a safe block boundary.
- Use REST endpoints for controls and state, plus an event stream for updates. Keep OpenRouter credentials server-side in an ignored environment file.
- Persist the world and run state across container restarts. Restart paused, re-observe the world, and reconcile partial tasks before resuming.
- Reset requires confirmation in the dashboard, archives the previous run, and restores the arena, supplies, agent inventories, and budget ledger.
- Verify completion against actual world blocks and reachable interior space, not agent declarations alone. Stop model calls when the house passes.
- Document Docker startup, EULA acceptance, OpenRouter configuration, spectator connection, model changes, budget changes, and troubleshooting.

## Validation and assumptions

- **Compatibility:** All three bots and a Java 26.3 spectator coexist; bots walk, withdraw supplies, place oriented blocks, break blocks, and reconnect correctly.
- **Construction:** Deterministic routines build a small fixture in survival, including elevated placement, doors, beds, and scaffolding cleanup.
- **Coordination:** Conflicting claims, stale blueprints, interrupted actions, chest contention, and reconnects cannot duplicate work or corrupt shared state.
- **Cost and recovery:** Mock API failures, malformed tool calls, concurrent budget reservations, and restarts. Confirm no model calls occur before Start or after budget/completion pause.
- **End-to-end:** Run the three selected models, verify that each contributes to the house, inspect the completion checks, and record actual cost. Budget exhaustion preserves an incomplete run; completion within $1 is a target, not a guarantee.
- **Viewing:** Confirm the full arena fits in the default spectator view. Walls and roofs may conceal the interior, as agreed.
- Assume Docker Desktop and an OpenRouter key with credit are available. Docker and Compose are installed, but daemon access was not verified because the current sandbox denied socket access.
- This first version is local-only, with supplied materials, no resource gathering, and no browser-based 3D Minecraft viewer.
