# Minecraft AI House-Building Biome

Three independent OpenRouter players gather, craft and build together in a
compact natural Minecraft Java **26.3** biome. Their physical actions run
concurrently. You watch as `aryank1511` in spectator mode and follow their duties
and chat in a local React dashboard.

## Start locally

Requires Docker Desktop, `just`, and an OpenRouter key with credit.

1. Copy `.env.example` to `.env` if needed. Set `OPENROUTER_API_KEY`. After accepting
   the [Minecraft EULA](https://aka.ms/MinecraftEULA), set `EULA=TRUE`. The environment
   file is ignored by Git and excluded from Docker builds.
2. Start everything from the repository root:

   ```sh
   just arena
   ```

   This downloads and verifies the pinned artifacts if needed, starts Minecraft,
   builds and loads the biome plugin when missing or changed, and builds and starts
   the dashboard. It waits for Minecraft to be healthy and preserves existing worlds
   and run progress.
3. Open [the dashboard](http://localhost:3000). Join `localhost:25565` with a Java
   26.3 client as **aryank1511**. You enter spectator mode at an elevated overview.
   Free flight works; **Return to overview** restores the camera.
4. Newly started app processes begin paused. **Start** validates the model catalog
   and begins paid decisions. **Pause** stops queued work and active actions at safe
   boundaries. **Resume** reconnects and reconciles. **Reset** requires confirmation,
   archives the run, regenerates the biome and clears all player inventories.

Run `just stop` to stop the agents and dashboard first, then Minecraft, preserving
the world and run progress. Restart with
`just arena`; newly started app processes begin paused. Normal runtime has
exactly two services: Minecraft and the TypeScript application. Only loopback
ports 25565 and 3000 are published. RCON is internal.

## The biome and survival rules

The 32×32 island contains an oak grove, meadow and flowers, sandy pond, exposed
stone/coal/iron ridge and white sheep, surrounded by water. A protected boundary
keeps the players in a small viewing area. The central 13×13 house site has a
protected foundation; construction is limited to eight blocks of height.

**No tools, materials or filled chests are supplied.** Players start empty-handed,
punch trees, make workbenches and wooden tools, mine stone for better tools,
smelt sand for glass, and make shears to obtain wool for beds. The team crafts
its own storage chest. Each player crafts a private workbench and furnace.
Permanent daylight, clear weather, peaceful difficulty and disabled PvP keep
attention on teamwork. Only biome setup/reset uses administrative world edits.

The original stocked-platform specification was superseded by the user's natural
biome and concurrent-teamwork amendments at the top of `SPECIFICATION.md`.

## Teamwork and chat

The three models have equal tools, separate histories, and shared context. They
propose and review a blueprint; two votes approve it. Supply duties cover gathering
and crafting, while construction duties wait for their materials and prerequisites.
Plans are checked against the island’s finite wood and fuel supply.
Agents can delegate unclaimed duties, claim their own responsibilities, and send
messages visible in both Minecraft chat and the dashboard.

Each player has its own action queue. Three gathering, crafting or building jobs
can run at the same time. Resource-block claims prevent duplicate harvesting;
shared chest access is serialized. An idle player can take an unclaimed duty
from an already-busy teammate, while active claims remain protected. The dashboard
shows actions, inventories,
gathered/crafted quantities, placements, completed duties and costs.

Completion checks inspect actual floor, walls, windows, roof, lighting, three
beds, crafting table, chest, both door halves and reachable interior space.
Temporary construction supports must be cleaned up. Trees and the finished
house can naturally obscure individual players from some viewing angles.

## Models, budget and persistence

Change model IDs in `agents/agentN/config.json`; prompts are in the same folders.
The defaults are Qwen3 30B A3B Instruct 2507, Mistral Small 3.2 24B Instruct and
Llama 3.3 70B Instruct. Shared rules and requirements live under `shared/`.
Model changes apply to new runs.

The default shared budget is **$1 per run**. Set `RUN_BUDGET_USD` in `.env`, recreate
the app container and Reset to apply a new limit. Existing runs retain theirs.
A central ledger reserves funds for concurrent requests using conservative input
bounds and output caps. Provider ceilings are $1/M input and $2/M output tokens.
Actual reported usage is recorded in integer nanodollars. Unknown billing retains
its reservation and pauses execution; completion requests are never blindly retried.
No model upgrades occur automatically. Finishing within $1 is a target, not a guarantee.

SQLite stores blueprints, duties, claims, outcomes, messages and usage. Each run
exports `summary.json`, `world.json` and `messages.md` under `shared/runs`.
Restarts retain progress and restart paused. Furnaces may finish already-loaded
inputs while paused, as in normal Minecraft; no new inputs or model calls begin.

## Versions and validation

- Paper **26.3 build 41** (upstream ALPHA), Java 25, SHA-256-verified server jar.
- ViaVersion and ViaBackwards **5.12.0**, SHA-256-verified jars.
- Mineflayer **4.39.0** using protocol **26.1**; dependencies pinned in the lockfile.
- Node **26.8.1**, server image and Java compiler image pinned by digest.

The protocol adapter supplies missing client tick boundaries. A 0.001-block
collision margin prevents repeated Paper corrections at block edges. Placement
checks the actual eye position, retries bounded approach tiles, and waits for
facing updates before placing oriented blocks.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
```

See `compatibility/VALIDATION.md` and recorded probe results. The earlier probes
validate the original stocked fixture; `natural-probe.mjs` tests concurrent
survival gathering and crafting from empty inventories. **Probes can reset their
world: run them only with the app stopped and before a paid run you want to keep.**
The live natural-biome run verified concurrent survival work and contributions
from all three models. At handoff it is paused at 38/39 duties, with $0.168275352
recorded and no unresolved reservations. The last roof section and support cleanup
remain; full-house completion has not been verified. Thirteen automated tests pass.

## Troubleshooting

- Docker denied: start Docker Desktop and allow local Docker access.
- Invalid movement packets: retain the pinned tick adapter; do not downgrade Paper.
- Missing/unavailable model: correct its configuration, then start a new run.
- A repeated action failure: inspect the visible action, inventory and run events.
  Partial blocks, gathered materials and cost remain preserved while paused.
- Unknown billing: inspect the reservation/usage events and OpenRouter activity;
  keep the run paused until the actual charge can be reconciled.
- Bots disconnect during development: fixture probes deliberately quit when done;
  spectator joins do not trigger bot disconnection.
- Port conflict: stop the other service on 25565 or 3000.
