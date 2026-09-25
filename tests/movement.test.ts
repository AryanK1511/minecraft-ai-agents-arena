import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { World } from '../src/minecraft/world.js';

test('walking returns a serializable observed position and clears navigation after success or failure', async () => {
  const world = new World('unused', 'unused', () => {});
  let cleared = 0, fail = false;
  const bot = {
    _client: { ended: false },
    async waitForTicks() {},
    entity: { position: new Vec3(0.5, 64, 10.5) },
    pathfinder: {
      async goto() { if (fail) throw new Error('No path'); },
      setGoal(value: unknown) { assert.equal(value, null); cleared++; }
    }
  } as unknown as Bot;
  world.bots.set('agent1', bot);
  world.paused = false;
  const result = await world.move('agent1', { x: 0, y: 64, z: 11 });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { position: { x: 0.5, y: 64, z: 10.5 } });
  assert.equal(cleared, 2);
  fail = true;
  await assert.rejects(world.move('agent1', { x: 0, y: 64, z: 11 }), /No path/);
  assert.equal(cleared, 4);
});
