# Live validation — 25 September 2026

The runtime uses Paper 26.3 build 41, Java 25, ViaVersion/ViaBackwards 5.12.0,
and Mineflayer 4.39.0 connecting as 26.1. The Java client `aryank1511` connected
as 26.3 while the three bots were online. ViaVersion's live player list confirmed
both protocols. The user confirmed spectator mode. Returning to the overview
and confirming all arena edges visually is awaiting user feedback.

## Natural biome and concurrent teamwork

The user replaced the stocked void platform with a 32x32 natural island.
`natural-empty-start.json` records three empty survival inventories, no
workstations or storage, 90 logs, 48 coal ore, 24 iron ore, 114 sand and nine sheep.

| Check | Evidence |
| --- | --- |
| Concurrent survival gathering, tool crafting, mining, smelting and shearing | `natural-results.json`; fixture began with empty inventories and continued through fixes |
| Team-crafted chest, serialized deposits and withdrawal; crafted bed from sheared wool | `storage-results.json` |
| Independent actions for all three players, with per-player serialization | `tests/concurrency.test.ts`; actual model-driven interleaved work in `natural-concurrency-results.json` |
| Delegated supply duties, material dependencies and interrupted-delivery recovery | `tests/supplies.test.ts` |
| Shared budget, failures, completion verification, claims and reset archive | Thirteen passing automated tests under `tests/` |
| Three bot protocols plus the user's spectator connection | Earlier `results.json`, `routines-results.json` |
| Movement correction fix | `navigation-results.json` |

The natural fixture tests made zero OpenRouter requests. The earlier
`arena-results.json`, `pause-results.json` and `restart-results.json` concern the
superseded stocked fixture; they are retained as historical compatibility evidence.

Only loopback ports 25565 and 3000 are published; RCON remains internal. The
whitelist is exactly `agent1`, `agent2`, `agent3`, `aryank1511`. The normal runtime
has two Compose services.

## Paid run

The old stocked run `777851d2-6ef0-4ae5-a4c8-3589a6a2107b` was archived at
$0.042191896 when the user changed the world requirements. Its dimension was
backed up before replacement.

Natural run `ca8adda0-2d33-484b-a4bd-953e616f82ed` starts with the empty-world
snapshot and uses the same three model IDs. Costs and progress remain in its
ledger across debugging pauses and restarts. At handoff the run is paused at 38/39 duties and $0.168275352, with all three
players connected and no unresolved reservations. All three contributed survival
placements. The last roof section and temporary-support cleanup remain, so
full-house completion is not claimed. See `billing-reconciliation.json` for the
stable aggregate-usage reconciliation of one response without billing metadata.

## Compatibility details

The tick-end adapter supplies missing client tick boundaries. Upstream describes
this protocol requirement in [Mineflayer PR 4128](https://github.com/PrismarineJS/mineflayer/pull/4128).
ViaBackwards 5.12.0 consumes the position/rotation followup after a teleport
confirmation as the new server acknowledgement; see its pinned
[entity rewriter](https://github.com/ViaVersion/ViaBackwards/blob/5.12.0/common/src/main/java/com/viaversion/viabackwards/protocol/v26_3to26_2/rewriter/EntityPacketRewriter26_3.java#L158).

At unfinished floor edges, the default physics half-width produced repeated
server corrections. A 0.001-block conservative collision margin allowed the
same survival step-up with zero corrections. Idle teammates now park outside
the build, and placement validates the real eye position instead of assuming
the pathfinder's grid endpoint is exact.

The biome run exposed an overhead-reach error in the pinned pathfinder: its
look goal compared the player's feet with a point above the target block. The
local goal measures eye-to-face distance and checks line of sight; a regression
test covers overhead, distant and occluded blocks. All placements now wait for
the look update before interacting. Crafting clicks synchronize authoritative
window state, and chest transfers verify the resulting stock count. Distinct
duty delegation counts as progress; duplicate assignments are rejected.

Probe scripts may reset or alter fixture blocks. Stop the app before running
one, and do not use reset probes against a house you want to preserve.

Large snapshots use gzip/base64 exports with bounded 3,000-character parts, avoiding RCON reply truncation. The restart recovered a 4,181-byte observation of the existing 92-block partial house without resetting it. `tests/snapshot.test.ts` verifies multipart recovery for a 1,300-block observation.
