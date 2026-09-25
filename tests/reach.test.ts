import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { ReachBlockGoal } from '../src/minecraft/navigation.js';

test('a player can reach overhead logs from below, but not distant or occluded blocks', () => {
  const target = new Vec3(0, 67, 0);
  let occluded = false;
  const world = { raycast: () => ({ position: occluded ? new Vec3(0, 66, 0) : target }) } as unknown as ConstructorParameters<typeof ReachBlockGoal>[1];
  const goal = new ReachBlockGoal(target, world, { reach: 3.5 });
  const position = new Vec3(0, 64, 0) as Parameters<typeof goal.isEnd>[0];
  assert.equal(goal.isEnd(position), true);
  assert.equal(goal.isEnd(new Vec3(0, 60, 0) as typeof position), false);
  occluded = true;
  assert.equal(goal.isEnd(position), false);
});
