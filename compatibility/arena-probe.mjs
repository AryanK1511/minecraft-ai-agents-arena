import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { installProtocolBridge } from '../src/minecraft/protocol-bridge.mjs';
const { pathfinder, Movements, goals } = pathfinderPackage;
const rcon = command => execFileSync('docker', ['compose', '-f', 'compatibility/compose.yaml', 'exec', '-T', 'minecraft', 'rcon-cli', command], { encoding: 'utf8' }).replace(/\x1b\[[0-9;]*m/g, '').trim();
const results = [];
const bots = [];
const record = (test, detail = {}) => { results.push({ test, detail, at: new Date().toISOString() }); console.log(test, detail); };
const deadline = setTimeout(() => { console.error('Arena probe timed out'); process.exit(1); }, 120000);
try {
  assert.equal(JSON.parse(rcon('arena status')).paused, true);
  rcon('arena reset');
  for (const username of ['agent1', 'agent2', 'agent3']) {
    const bot = mineflayer.createBot({ host: '127.0.0.1', username, auth: 'offline', version: '26.1' });
    bots.push(bot);
    installProtocolBridge(bot);
    bot.on('kicked', reason => record('kicked', { username, reason }));
    await once(bot, 'spawn');
    await bot.waitForChunksToLoad();
    await bot.waitForTicks(20);
    assert.equal(bot.game.gameMode, 'survival');
    assert.ok(bot.inventory.items().some(item => item.name === 'iron_pickaxe'));
    bot.loadPlugin(pathfinder);
    const movements = new Movements(bot);
    movements.canDig = false;
    movements.allow1by1towers = false;
    bot.pathfinder.setMovements(movements);
    record('arena-joined', { username, position: bot.entity.position });
    await new Promise(resolve => setTimeout(resolve, 4500));
  }
  const bot = bots[0];
  assert.equal(bot.blockAt(new Vec3(0, 63, 0)).name, 'smooth_stone');
  assert.equal(bot.blockAt(new Vec3(16, 63, 0)).name, 'air');
  assert.equal(bot.blockAt(new Vec3(-16, 64, 0)).name, 'barrier');
  record('arena-floor-void-boundary');
  rcon('arena resume');
  await bot.pathfinder.goto(new goals.GoalNear(-10, 64, -5, 2));
  const chest = await bot.openContainer(bot.blockAt(new Vec3(-11, 64, -5)));
  await chest.withdraw(bot.registry.itemsByName.oak_planks.id, null, 12);
  chest.close();
  assert.ok(bot.inventory.items().length <= 5, 'Reset must not spill old chest contents into the arena');
  await bot.pathfinder.goto(new goals.GoalBlock(0, 64, 2));
  const place = async (target) => {
    await bot.equip(bot.inventory.items().find(item => item.name === 'oak_planks'), 'hand');
    await bot.placeBlock(bot.blockAt(target.offset(0, -1, 0)), new Vec3(0, 1, 0));
    await bot.waitForTicks(5);
    assert.equal(bot.blockAt(target).name, 'oak_planks');
  };
  await place(new Vec3(0, 64, 0));
  await place(new Vec3(0, 65, 0));
  await place(new Vec3(0, 66, 0));
  record('elevated-survival-placement');
  rcon('arena pause');
  await assert.rejects(place(new Vec3(0, 67, 0)));
  assert.equal(bot.blockAt(new Vec3(0, 67, 0)).name, 'air');
  record('pause-rejects-placement');
  rcon('arena resume');
  await bot.equip(bot.inventory.items().find(item => item.name === 'iron_pickaxe'), 'hand');
  await bot.dig(bot.blockAt(new Vec3(0, 63, 2)));
  await bot.waitForTicks(5);
  assert.equal(bot.blockAt(new Vec3(0, 63, 2)).name, 'smooth_stone');
  record('protected-floor');
  await bot.equip(bot.inventory.items().find(item => item.name === 'iron_axe'), 'hand');
  for (let y = 66; y >= 64; y--) { await bot.dig(bot.blockAt(new Vec3(0, y, 0))); await bot.waitForTicks(5); }
  assert.equal(JSON.parse(rcon('arena snapshot')).blocks.length, 0);
  record('fixture-cleanup');
  record('arena-probe-pass');
} catch (error) { record('FAIL', { message: error.message, stack: error.stack }); process.exitCode = 1; }
finally {
  try { rcon('arena pause'); } catch { }
  for (const bot of bots) { bot.pathfinder?.setGoal(null); bot.quit(); }
  clearTimeout(deadline);
  writeFileSync('compatibility/arena-results.json', JSON.stringify(results, null, 2) + '\n');
}
