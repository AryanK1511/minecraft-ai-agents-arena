import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { installProtocolBridge } from '../src/minecraft/protocol-bridge.mjs';
const { pathfinder, Movements, goals } = pathfinderPackage;
const results = [];
const bots = [];
const command = (...commands) => execFileSync('docker', ['compose', '-f', 'compatibility/compose.yaml', 'exec', '-T', 'minecraft', 'rcon-cli', ...commands], { encoding: 'utf8' });
async function timeout(promise, ms = 30000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out')), ms); })]);
  } finally { clearTimeout(timer); }
}
function record(test, detail) { results.push({ test, detail, at: new Date().toISOString() }); console.log(test, JSON.stringify(detail)); }
async function connect(username) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565, username, auth: 'offline', version: '26.1' });
  bots.push(bot);
  bot.on('kicked', reason => record('kicked', {username, reason}));
  installProtocolBridge(bot);
  const write = bot._client.write.bind(bot._client);
  bot._client.write = (name, packet) => {
    if (['position', 'position_look', 'look'].includes(name)) {
      for (const key of ['x', 'y', 'z', 'yaw', 'pitch']) {
        if (key in packet && !Number.isFinite(packet[key])) record('invalid-outgoing-packet', {name, key, packet});
      }
    }
    return write(name, packet);
  };
  bot.on('error', error => console.error(username, error.message));
  await timeout(once(bot, 'spawn'), 60000);
  bot.loadPlugin(pathfinder);
  const movements = new Movements(bot);
  movements.canDig = false;
  movements.allow1by1towers = false;
  bot.pathfinder.setMovements(movements);
  assert.equal(bot.game.gameMode, 'survival');
  record('connected', { username, version: bot.version, gameMode: bot.game.gameMode });
  return bot;
}
try {
  command('gamerule minecraft:advance_time false');
  command('time set day');
  command('weather clear');
  command('forceload add -16 -16 15 15');
  await new Promise(resolve => setTimeout(resolve, 1000));
  command('fill -16 63 -16 15 63 15 minecraft:stone');
  command('fill -16 64 -16 15 73 15 minecraft:air');
  command('setblock -3 64 0 minecraft:chest');
  command('item replace block -3 64 0 container.0 with minecraft:oak_planks 64');
  command('item replace block -3 64 0 container.1 with minecraft:oak_stairs 16');
  command('item replace block -3 64 0 container.2 with minecraft:oak_door 3');
  command('item replace block -3 64 0 container.3 with minecraft:red_bed 1');
  command('setworldspawn 0 64 0');
  for (const name of ['agent1', 'agent2', 'agent3']) command(`clear ${name}`);
  const trio = [];
  for (const name of ['agent1', 'agent2', 'agent3']) {
    trio.push(await connect(name));
    await new Promise(resolve => setTimeout(resolve, 4500));
  }
  for (let i = 0; i < trio.length; i++) {
    const bot = trio[i];
    command(`tp ${bot.username} -8 64 ${i * 3}`);
    await bot.waitForTicks(20);
    const start = bot.entity.position.clone();
    await timeout(bot.pathfinder.goto(new goals.GoalNear(-2, 64, 0, 1)));
    assert.ok(bot.entity.position.distanceTo(start) > 3, 'Walking must change actual position');
    record('walked', { username: bot.username, position: bot.entity.position });
    const chest = await timeout(bot.openContainer(bot.blockAt(new Vec3(-3, 64, 0))));
    await timeout(chest.withdraw(bot.registry.itemsByName.oak_planks.id, null, 8));
    chest.close();
    record('inventory', { username: bot.username, items: bot.inventory.items().map(x => ({ name: x.name, count: x.count })) });
    const target = new Vec3(2, 64, i * 3);
    await timeout(bot.pathfinder.goto(new goals.GoalNear(target.x, 64, target.z, 2)));
    await bot.equip(bot.inventory.items().find(x => x.name === 'oak_planks'), 'hand');
    await timeout(bot.placeBlock(bot.blockAt(target.offset(0, -1, 0)), new Vec3(0, 1, 0)));
    await bot.waitForTicks(10);
    if (bot.blockAt(target)?.name !== 'oak_planks') throw new Error('Placement was not reflected in world');
    record('placed', { username: bot.username, target });
    await timeout(bot.dig(bot.blockAt(target)));
    await bot.waitForTicks(10);
    if (bot.blockAt(target)?.name !== 'air') throw new Error('Breaking was not reflected in world');
    record('broke', { username: bot.username, target });
  }
  await orientedFixture(trio[0]);
  trio[0].quit();
  await new Promise(resolve => setTimeout(resolve, 4500));
  const reconnected = await connect('agent1');
  assert.ok(reconnected.inventory.items().some(item => item.name === 'oak_planks'), 'Inventory must survive reconnect');
  record('basic-bridge-pass', { spectator26_3: 'requires real client validation', orientedBlocks: 'passed stairs, door, bed fixture' });
} catch (error) {
  record('BLOCKED', { message: error.message, stack: error.stack });
  process.exitCode = 1;
} finally {
  for (const bot of bots) {
    bot.pathfinder?.setGoal(null);
    bot.clearControlStates();
    bot.quit();
  }
  writeFileSync('compatibility/results.json', JSON.stringify(results, null, 2) + '\n');
}

async function orientedFixture(bot) {
  await timeout(bot.pathfinder.goto(new goals.GoalNear(-2, 64, 0, 1)));
  const chest = await timeout(bot.openContainer(bot.blockAt(new Vec3(-3, 64, 0))));
  try {
    for (const name of ['oak_stairs', 'oak_door', 'red_bed']) {
      await timeout(chest.withdraw(bot.registry.itemsByName[name].id, null, 1));
    }
  } finally { chest.close(); }
  for (const [name, x] of [['oak_stairs', 4], ['oak_door', 7], ['red_bed', 10]]) {
    const target = new Vec3(x, 64, -4);
    await timeout(bot.pathfinder.goto(new goals.GoalBlock(x, 64, -2)));
    await bot.equip(bot.inventory.items().find(item => item.name === name), 'hand');
    // Mineflayer yaw zero faces north. Keep it fixed while targeting the floor.
    await bot.look(0, Math.PI / 4, true);
    await bot.waitForTicks(3); // Let the server receive the new yaw before using the item.
    await timeout(bot._placeBlockWithOptions(bot.blockAt(target.offset(0, -1, 0)), new Vec3(0, 1, 0), { forceLook: 'ignore', swingArm: 'right' }));
    await bot.waitForTicks(10);
    const block = bot.blockAt(target);
    assert.equal(block.name, name);
    const properties = block.getProperties();
    assert.equal(properties.facing, 'north');
    if (name === 'oak_stairs') assert.equal(properties.half, 'bottom');
    if (name === 'oak_door') {
      assert.equal(properties.half, 'lower');
      const upper = bot.blockAt(target.offset(0, 1, 0));
      assert.equal(upper.name, name);
      assert.equal(upper.getProperties().half, 'upper');
      await bot.activateBlock(block);
      await bot.waitForTicks(10);
      assert.equal(bot.blockAt(target).getProperties().open, true);
    }
    if (name === 'red_bed') {
      assert.equal(properties.part, 'foot');
      const head = bot.blockAt(target.offset(0, 0, -1));
      assert.equal(head.name, name);
      assert.equal(head.getProperties().part, 'head');
    }
    record('oriented-placement', { username: bot.username, target, name, properties });
  }
}
