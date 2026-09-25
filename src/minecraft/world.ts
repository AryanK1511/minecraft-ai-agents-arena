import mineflayer, { type Bot } from 'mineflayer';
import pathfinding from 'mineflayer-pathfinder';
import { Rcon } from 'rcon-client';
import { Vec3 } from 'vec3';
import { installProtocolBridge } from './protocol-bridge.mjs';
import { IDS, type AgentId, type Placement, type Position, type Snapshot } from '../core/types.js';
const { pathfinder, Movements, goals } = pathfinding;
class ArenaMovements extends Movements {
  // Cardinal paths avoid clipping corners of temporary support columns.
  getMoveDiagonal() {}
}
export function bounded(p: Position) { return Number.isInteger(p.x) && Number.isInteger(p.y) && Number.isInteger(p.z) && Math.abs(p.x) <= 6 && Math.abs(p.z) <= 6 && p.y >= 64 && p.y <= 71; }
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> { const next = this.tail.then(operation); this.tail = next.catch(() => {}); return next; }
}
export class World {
  bots = new Map<AgentId, Bot>();
  actions = new Mutex();
  chests = new Mutex();
  admin = new Mutex();
  paused = true;
  constructor(public host: string, private rconPassword: string, public onChange: (id: AgentId, connected: boolean) => void) {}
  async command(action: 'pause' | 'resume' | 'reset' | 'overview' | 'snapshot' | 'status'): Promise<any> {
    return this.admin.run(async () => {
      const rcon = await Rcon.connect({ host: this.host, port: 25575, password: this.rconPassword });
      try { return JSON.parse((await rcon.send(`arena ${action}`)).replace(/\x1b\[[0-9;]*m/g, '').trim()); }
      finally { await rcon.end(); }
    });
  }
  async snapshot(): Promise<Snapshot> { return this.command('snapshot'); }
  async connect() {
    for (const id of IDS) {
      const existing = this.bots.get(id);
      if (existing && !existing._client.ended) continue;
      const bot = mineflayer.createBot({ host: this.host, username: id, auth: 'offline', version: '26.1' });
      installProtocolBridge(bot);
      this.bots.set(id, bot);
      bot.on('error', () => {});
      bot.once('end', () => { this.onChange(id, false); });
      await this.deadline(new Promise<void>((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reason => reject(new Error(String(reason)))); }), 30000);
      await this.deadline(bot.waitForChunksToLoad(), 30000);
      await bot.waitForTicks(10);
      bot.loadPlugin(pathfinder);
      const movements = new ArenaMovements(bot);
      movements.allowParkour = false;
      movements.allowSprinting = false;
      movements.canDig = false;
      movements.allow1by1towers = true;
      movements.allowFreeMotion = false;
      movements.scafoldingBlocks = [bot.registry.itemsByName.dirt.id];
      movements.exclusionAreasPlace.push(block => bounded(block.position.offset(0, 1, 0)) ? 0 : 100);
      bot.pathfinder.setMovements(movements);
      this.onChange(id, true);
      await new Promise(resolve => setTimeout(resolve, 4500));
    }
  }
  inventory(id: AgentId) { return Object.fromEntries(this.bot(id).inventory.items().map(item => [item.name, this.bot(id).inventory.items().filter(i => i.name === item.name).reduce((sum, i) => sum + i.count, 0)])); }
  bot(id: AgentId) { const bot = this.bots.get(id); if (!bot || bot._client.ended) throw new Error(`${id} is disconnected`); return bot; }
  check() { if (this.paused) throw new Error('Paused at safe block boundary'); }
  async deadline<T>(promise: Promise<T>, ms = 30000): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('Action timed out')), ms); })]); }
    finally { clearTimeout(timer!); }
  }
  async move(id: AgentId, p: Position) {
    this.check();
    if (![p.x, p.y, p.z].every(Number.isFinite) || p.x < -14 || p.x > 13 || p.z < -14 || p.z > 13 || p.y < 64 || p.y > 72) throw new Error('Movement outside arena');
    const bot = this.bot(id);
    try { await this.deadline(bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 1)), 20000); }
    finally { bot.pathfinder.setGoal(null); }
    this.check();
  }
  async transfer(id: AgentId, name: string, count: number, deposit = false) {
    return this.chests.run(async () => {
      this.check();
      const bot = this.bot(id), item = bot.registry.itemsByName[name];
      if (!item || !Number.isInteger(count) || count < 1 || count > 256) throw new Error('Invalid chest transfer');
      let remaining = count;
      const shelves: Record<string, number> = { oak_planks: -5, oak_log: -5, cobblestone: -5, stone_bricks: -5, oak_stairs: -1, oak_slab: -1, glass: -1, glass_pane: -1, dirt: 3, scaffolding: 3, ladder: 3, torch: 3, lantern: 3, oak_door: 7, red_bed: 7, blue_bed: 7, white_bed: 7, crafting_table: 7, chest: 7 };
      const shelf = shelves[name];
      if (shelf === undefined) throw new Error(`No stock location for ${name}`);
      for (const z of [shelf]) for (const x of z === 7 ? [-11] : [-11, -10]) {
        await this.move(id, { x: x + 2, y: 64, z });
        const chest = await this.deadline(bot.openContainer(bot.blockAt(new Vec3(x, 64, z))!));
        try {
          this.check();
          const available = deposit ? (this.inventory(id)[name] ?? 0) : chest.containerItems().filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
          const amount = Math.min(remaining, available);
          if (amount > 0) {
            if (deposit) await this.deadline(chest.deposit(item.id, null, amount));
            else await this.deadline(chest.withdraw(item.id, null, amount));
            remaining -= amount;
          }
        } finally { chest.close(); await bot.waitForTicks(5); }
        if (remaining === 0) return { transferred: count };
      }
      throw new Error(`Supply unavailable: ${name}, ${remaining} still required`);
    });
  }
  async ensure(id: AgentId, placements: Placement[]) {
    const counts: Record<string, number> = { dirt: 32 };
    for (const p of placements) counts[p.name] = (counts[p.name] ?? 0) + 1;
    for (const [name, count] of Object.entries(counts)) {
      const missing = count - (this.inventory(id)[name] ?? 0);
      if (missing > 0) await this.transfer(id, name, missing);
    }
  }
  async place(id: AgentId, placement: Placement) {
    this.check();
    if (!bounded(placement)) throw new Error('Placement outside construction bounds');
    const bot = this.bot(id), target = new Vec3(placement.x, placement.y, placement.z);
    if (bot.blockAt(target)?.name === placement.name) {
      if (placement.facing && bot.blockAt(target)?.getProperties().facing !== placement.facing) throw new Error('Existing block has incorrect orientation; remove it before retrying');
      return { alreadyPresent: true };
    }
    if (['dirt', 'scaffolding'].includes(bot.blockAt(target)?.name ?? '')) await this.remove(id, placement);
    if (bot.blockAt(target)?.name !== 'air') throw new Error(`Placement occupied at ${target}`);
    const item = bot.inventory.items().find(i => i.name === placement.name);
    if (!item) throw new Error(`Missing inventory: ${placement.name}`);
    if (placement.name.endsWith('_bed')) {
      const approaches = [[2,0],[-2,0],[0,2],[0,-2]].map(([dx,dz]) => target.offset(dx,0,dz)).filter(p =>
        bot.blockAt(p)?.name === 'air' && bot.blockAt(p.offset(0,1,0))?.name === 'air' && bot.blockAt(p.offset(0,-1,0))?.boundingBox === 'block');
      if (!approaches.length) throw new Error('No clear approach beside the bed');
      try { await this.deadline(bot.pathfinder.goto(new goals.GoalCompositeAny(approaches.map(p=>new goals.GoalBlock(p.x,p.y,p.z)))), 20000); }
      catch (error) { throw new Error(`Bed approach failed from ${bot.entity.position}: ${error}`); }
      finally { bot.pathfinder.setGoal(null); }
    }
    const goal = new goals.GoalPlaceBlock(target, bot.world, {
      range: 3.5, LOS: true,
      faces: placement.name.endsWith('_bed') || placement.name.endsWith('_door') || placement.name === 'torch'
        ? [new Vec3(0, -1, 0)]
        : [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]
    } as ConstructorParameters<typeof goals.GoalPlaceBlock>[2]) as InstanceType<typeof goals.GoalPlaceBlock> & { getFaceAndRef(p: Vec3): { ref: Vec3; face: Vec3 } | null };
    try { await this.deadline(bot.pathfinder.goto(goal), 20000); }
    catch (error) { throw new Error(`Placement approach failed from ${bot.entity.position} to ${target}: ${error}`); }
    finally { bot.pathfinder.setGoal(null); }
    this.check();
    const node = goal.getFaceAndRef(bot.entity.position.offset(0, 1.62, 0)) as { ref: Vec3; face: Vec3 } | null;
    if (!node) throw new Error(`No reachable placement face at ${target}; bot position ${bot.entity.position}`);
    await bot.equip(item, 'hand');
    if (placement.facing) {
      const yaw = { north: 0, south: Math.PI, east: -Math.PI / 2, west: Math.PI / 2 }[placement.facing];
      await bot.look(yaw, 0, true); await bot.waitForTicks(3);
      await this.deadline((bot as Bot & { _placeBlockWithOptions(block: NonNullable<ReturnType<Bot['blockAt']>>, face: Vec3, options: object): Promise<void> })._placeBlockWithOptions(bot.blockAt(node.ref)!, node.face.scaled(-1), { forceLook: 'ignore', swingArm: 'right' }));
    } else await this.deadline(bot.placeBlock(bot.blockAt(node.ref)!, node.face.scaled(-1)));
    await bot.waitForTicks(3);
    const result = bot.blockAt(target);
    if (result?.name !== placement.name || (placement.facing && result.getProperties().facing !== placement.facing)) throw new Error(`Placement verification failed at ${target}`);
    return { placed: placement };
  }
  async remove(id: AgentId, p: Position) {
    this.check(); if (!bounded(p)) throw new Error('Removal outside construction bounds');
    const bot = this.bot(id), target = new Vec3(p.x, p.y, p.z);
    try { await this.deadline(bot.pathfinder.goto(new goals.GoalLookAtBlock(target, bot.world, { reach: 3.5 })), 20000); }
    finally { bot.pathfinder.setGoal(null); }
    this.check();
    const block = bot.blockAt(target);
    if (!block || block.name === 'air') return;
    const tool = bot.inventory.items().find(i => i.name === (block.name === 'dirt' ? 'iron_shovel' : block.name.includes('stone') ? 'iron_pickaxe' : 'iron_axe'));
    if (tool) await bot.equip(tool, 'hand');
    await this.deadline(bot.dig(block)); await bot.waitForTicks(3);
    if (bot.blockAt(target)?.name !== 'air') throw new Error('Break verification failed');
  }
  async cleanup(id: AgentId) {
    const blocks = (await this.snapshot()).blocks.filter(([, , , state]) => state.startsWith('minecraft:dirt') || state.startsWith('minecraft:scaffolding')).sort((a,b)=>b[1]-a[1]);
    const bot = this.bot(id);
    const movements = bot.pathfinder.movements;
    const previousTower = movements.allow1by1towers;
    movements.allow1by1towers = false;
    const oldScaffolds = movements.scafoldingBlocks;
    movements.scafoldingBlocks = [];
    try { for (const [x,y,z] of blocks) { this.check(); await this.remove(id, {x,y,z}); } }
    finally { movements.allow1by1towers = previousTower; movements.scafoldingBlocks = oldScaffolds; }
    return { removed: blocks.length };
  }
  stop() { this.paused = true; for (const bot of this.bots.values()) { bot.pathfinder?.setGoal(null); bot.clearControlStates(); } }
}
