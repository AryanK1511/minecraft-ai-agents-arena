import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { World } from '../dist/src/minecraft/world.js';
const world = new World('minecraft', 'local-compatibility-only', () => {});
try {
  await world.connect(); await world.command('resume'); world.paused=false;
  const result = await world.cleanup('agent1');
  const snapshot = await world.snapshot();
  assert.ok(!snapshot.blocks.some(([, , ,s])=>s.startsWith('minecraft:dirt')));
  writeFileSync('compatibility/routines-results.json',JSON.stringify({at:new Date().toISOString(),cleanup:result,snapshot},null,2)+'\n');
  console.log('CLEANUP PASS',result);
} finally { world.stop(); await world.command('pause'); for(const bot of world.bots.values())bot.quit(); }
