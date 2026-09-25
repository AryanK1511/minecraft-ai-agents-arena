import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/store.js';
import { Coordinator } from '../src/core/coordinator.js';
import { inspect } from '../src/core/completion.js';
test('majority, stale votes, dependencies, conflicting claims, and disconnect release', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-coordination-')), store = new Store(dir), coordinator = new Coordinator(store);
  try {
    coordinator.propose('agent1', { width: 7, depth: 7, height: 4, wall: 'oak_planks', floor: 'stone_bricks', roof: 'oak_planks', description: 'test' });
    assert.throws(() => coordinator.vote('agent2', 0), /Stale/);
    assert.throws(() => coordinator.claim('agent1', 'floor-0', 1), /unapproved/);
    coordinator.vote('agent2', 1);
    assert.throws(() => coordinator.claim('agent1', 'roof-0', 1), /dependencies/);
    for (const task of store.state.tasks) if (task.kind==='supply') task.status='done';
    coordinator.claim('agent1', 'floor-0', 1);
    assert.throws(() => coordinator.claim('agent2', 'floor-0', 1), /unavailable/);
    coordinator.release('agent1');
    coordinator.claim('agent2', 'floor-0', 1);
    assert.equal(store.state.tasks.find(t => t.id === 'floor-0')?.owner, 'agent2');
    for (const t of store.state.tasks) t.status = 'done';
    const checks = inspect({ blocks: [], revision: 0, paused: true, players: [] }, store.state.blueprint, store.state.tasks);
    assert.equal(checks.floor, false); assert.equal(checks.completeRoof, false); assert.equal(checks.reachableInterior, false);
  } finally { store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});
