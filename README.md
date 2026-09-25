# Minecraft AI House-Building Arena

A local Paper 26.3 survival arena with three OpenRouter agents and a React control
panel. The complete requirements are in [SPECIFICATION.md](SPECIFICATION.md).

## Startup

Requires Docker Desktop and an OpenRouter key with credit. Minecraft and the
control panel bind to loopback only. No RCON port is published.

1. Copy `.env.example` to `.env` if you do not already have one. Add
   `OPENROUTER_API_KEY`. After accepting the [Minecraft EULA](https://aka.ms/MinecraftEULA),
   set `EULA=TRUE`. `.env` is ignored by Git and excluded from Docker builds.
2. Download the pinned server and bridge jars:

   ```sh
   sh scripts/fetch-compatibility.sh
   docker compose up -d minecraft
   docker compose logs -f minecraft
   ```

3. After the server reports `Done`, build the arena plugin using the pinned Java
   compiler and that server's exact dependency jars:

   ```sh
   sh scripts/build-plugin.sh
   docker compose restart minecraft
   docker compose up -d --build app
   ```

4. Open [the dashboard](http://localhost:3000). Startup is paused. Join
   `localhost:25565` with Minecraft Java **26.3** as **aryank1511**. You enter
   spectator mode at an elevated overview; free spectator flight remains available.
   The dashboard's **Return to overview** control restores that position.
5. Click **Start** to validate model availability/pricing and begin the paid run.
   **Pause** stops queued actions and active work at a safe block boundary.
   **Resume** reconnects and reconciles the world before requesting more decisions.
   **Reset** requires confirmation, archives the current run, and restores the
   arena, inventories, supplies, and fresh budget ledger.

Stop containers with `docker compose down`. The world volume and `shared/runs`
persist. Restart with `docker compose up -d`; model execution always restarts paused.
Do not remove the world volume or `shared/runs` unless you intend to discard them.

## Configuration and cost

Each `agents/agentN/config.json` contains its model ID; `prompt.md` contains its
individual prompt. Shared behavior, Minecraft rules and house requirements live
under `shared/`. The three starting models are Qwen3 30B A3B Instruct 2507,
Mistral Small 3.2 24B Instruct, and Llama 3.3 70B Instruct.

The default shared budget is **$1 per run**. Change `RUN_BUDGET_USD` in `.env`,
recreate the app container, and Reset to apply a new limit to a new run. Existing
runs keep their original limit. Model changes likewise apply to a new run.

A central ledger reserves funds before every request, using conservative input
bounds and output caps. Provider ceilings are $1 per million input tokens and
$2 per million output tokens. Actual provider-reported cost is recorded in
integer nanodollars. Unknown billing retains the reservation and pauses the run;
the completion request is never blindly repeated. No automatic model upgrades
occur. Completing a house within $1 is a target, not a guarantee.

Run snapshots, readable messages, and SQLite events are saved in `shared/runs`.
`arena.sqlite` records blueprint revisions, claims, action outcomes and usage.
Each run also has a readable `summary.json` and `messages.md` directory.

## Arena and implementation

Runtime consists of exactly two services: Paper and the TypeScript/React app.
The small Paper plugin creates the void world, 32×32 protected platform and
boundary, supply chests, spectator viewpoint and reset behavior. Construction
is restricted to x,z=-6..6 and y=64..71. Bots are survival players with iron tools.
The supplied materials use blocks understood by protocol 26.1 and client 26.3.

Agents propose and review a blueprint. Two distinct votes approve it. Claims
reserve construction tasks and enforce dependencies; disconnect releases claims.
Walking, reach, chest transfers and individual placement use Mineflayer routines.
House completion checks inspect server blocks and interior accessibility instead
of trusting agent declarations. Offline authentication is deliberately local-only;
the whitelist contains agent1, agent2, agent3 and aryank1511.

## Pinned compatibility and validation

- Paper **26.3 build 41**, upstream ALPHA channel; SHA-256 verified download.
- ViaVersion and ViaBackwards **5.12.0**, SHA-256 verified downloads.
- Java 25 server image and compiler image pinned by digest.
- Mineflayer **4.39.0**, protocol **26.1**; npm dependency lockfile.
- Node **26.8.1** image pinned by digest.

`src/minecraft/protocol-bridge.mjs` supplies the client tick-end packets missing
from the pinned Mineflayer version. Without this adapter, Paper disconnects bots
with “Invalid move player packet received”. The fixture also waits for the server
to receive facing changes before placing oriented blocks.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
```

The `compatibility` directory contains live probes and recorded results. They
reset or change their dedicated arena fixtures and should only run when the app
is stopped. `probe.mjs` targets the original unprotected proof world; use it
before installing HouseArena. `arena-probe.mjs` verifies the plugin's protection,
reset, supplies, elevated placement and pause enforcement. `routines-probe.mjs`
exercises the production routines inside the app network. Test bots disconnect
when a probe finishes; spectator joins do not cause that cleanup.

Implementation and live end-to-end validation are still in progress. Check recorded
probe output and run summaries rather than assuming an unrun check has passed.

## Troubleshooting

- **Docker socket denied:** allow Docker access and ensure Docker Desktop is running.
- **Server rejects EULA:** set `EULA=TRUE` only after accepting the linked terms.
- **Invalid movement packet:** keep the pinned bridge adapter enabled; do not downgrade
  the server to make a test pass.
- **Connection throttled:** stagger bot connections; the app waits between logins.
- **Wrong or unavailable model:** correct the model ID in its configuration, then Reset.
- **No supplies / placement error:** inspect the agent's action and inventory. Partial
  progress is preserved. Repeated failures pause visibly rather than spending indefinitely.
- **Unresolved billing:** inspect SQLite reservation/usage events and the OpenRouter
  activity page before attempting recovery. Keep the run paused while cost is unknown.
- **Port conflict:** stop the other local service occupying 25565 or 3000.
- **App restart:** expect paused state and world reconciliation before Resume.
