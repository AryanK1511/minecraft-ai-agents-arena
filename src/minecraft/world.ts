import { readSnapshot, parseReply } from './snapshot.js';
import { ReachBlockGoal } from './navigation.js';
import mineflayer, { type Bot } from 'mineflayer';
import pathfinding from 'mineflayer-pathfinder';
import { Rcon } from 'rcon-client';
import { Vec3 } from 'vec3';
import { Survival } from './resources.js';
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
  private actorQueues = new Map<AgentId, Mutex>();
  private activeActions = new Set<Promise<unknown>>();
  private cleanupQueue = new Mutex();
  private connecting?: Promise<void>;
  resources = new Survival(this);
  onActivity: (id: AgentId, action: string, detail?: object) => void = () => {};
  async act<T>(id: AgentId, operation: () => Promise<T>): Promise<T> {
    let queue = this.actorQueues.get(id);
    if (!queue) { queue = new Mutex(); this.actorQueues.set(id, queue); }
    const action = queue.run(async () => { this.check(); return operation(); });
    this.activeActions.add(action);
    try { return await action; } finally { this.activeActions.delete(action); }
  }
  async drain() { await Promise.allSettled([...this.activeActions]); }
  chests = new Mutex();
  admin = new Mutex();
  paused = true;
  constructor(public host: string, private rconPassword: string, public onChange: (id: AgentId, connected: boolean) => void) {}
  async command(action: 'pause' | 'resume' | 'reset' | 'overview' | 'snapshot' | 'status'): Promise<any> {
    return this.admin.run(async () => {
      const rcon = await Rcon.connect({ host: this.host, port: 25575, password: this.rconPassword });
      try {
        const response = parseReply(await rcon.send(`arena ${action}`));
        return action === 'snapshot' ? await readSnapshot(response, command => rcon.send(command)) : response;
      }
      finally { await rcon.end(); }
    });
  }
  async snapshot(): Promise<Snapshot> { return this.command('snapshot'); }
  async connect() {
    if (this.connecting) return this.connecting;
    const attempt = this.connectAll();
    this.connecting = attempt;
    try { await attempt; }
    finally { if (this.connecting === attempt) this.connecting = undefined; }
  }
  private async connectAll() {
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
      // Leave a 0.001-block collision margin: Paper rejects exact edge contact
      // from the physics library's rounded 0.3 half-width during step-up moves.
      (bot.physics as typeof bot.physics & { playerHalfWidth: number }).playerHalfWidth = 0.301;
      bot.loadPlugin(pathfinder);
      const movements = new ArenaMovements(bot);
      movements.allowParkour = false;
      movements.allowSprinting = false;
      movements.maxDropDown = 8;
      movements.canDig = true;
      movements.exclusionAreasBreak.push(block=> {
        const p=block.position;
        const natural=['oak_log','oak_leaves','stone','coal_ore','iron_ore','sand','dirt','grass_block','short_grass','dandelion','poppy','cornflower'].includes(block.name);
        return natural && Math.abs(p.x)<=14 && Math.abs(p.z)<=14 && p.y>=60 && p.y<=74 && !(Math.abs(p.x)<=6&&Math.abs(p.z)<=6) && !this.resources.claimedByOther(id,p) ? 0 : 100;
      });
      movements.allow1by1towers = true;
      movements.allowFreeMotion = false;
      movements.scafoldingBlocks = [bot.registry.itemsByName.dirt.id];
      movements.exclusionAreasPlace.push(block => bounded(block.position.offset(0, 1, 0)) ? 0 : 100);
      bot.pathfinder.setMovements(movements);
      this.onChange(id, true);
      await new Promise(resolve => setTimeout(resolve, 4500));
    }
  }
  inventory(id: AgentId) {
    const bot=this.bot(id), counts:Record<string,number>={};
    for(const item of (bot.currentWindow??bot.inventory).items()) counts[item.name]=(counts[item.name]??0)+item.count;
    return counts;
  }
  bot(id: AgentId) { const bot = this.bots.get(id); if (!bot || bot._client.ended) throw new Error(`${id} is disconnected`); return bot; }
  check() { if (this.paused) throw new Error('Paused at safe block boundary'); }
  async deadline<T>(promise: Promise<T>, ms = 30000): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('Action timed out')), ms); })]); }
    finally { clearTimeout(timer!); }
  }
  async navigate(id: AgentId, goal: Parameters<Bot['pathfinder']['goto']>[0], timeout = 20000) {
    this.check();const bot=this.bot(id);
    try {
      await this.deadline(bot.pathfinder.goto(goal),timeout);
      await bot.waitForTicks(3);
      // The pinned pathfinder resolves an empty no-path result as success.
      // Never let that start a remote dig, craft or container interaction.
      if(!goal.isEnd(bot.entity.position.floored() as unknown as Parameters<typeof goal.isEnd>[0]))throw new Error(`Navigation ended before reaching ${goal.constructor.name} from ${bot.entity.position}`);
      this.check();
    } finally {bot.pathfinder.setGoal(null);}
  }
  async move(id: AgentId, p: Position) {
    this.check();
    if (![p.x, p.y, p.z].every(Number.isFinite) || p.x < -14 || p.x > 13 || p.z < -14 || p.z > 13 || p.y < 60 || p.y > 74) throw new Error('Movement outside arena');
    const bot = this.bot(id);
    try { await this.navigate(id,new goals.GoalNear(p.x,p.y,p.z,1)); }
    finally { bot.pathfinder.setGoal(null); }
    this.check();
    const { x, y, z } = bot.entity.position;
    return { position: { x, y, z } };
  }
  async moveToAny(id: AgentId, positions: Position[]) {
    this.check();
    if (!positions.length || positions.some(p => ![p.x,p.y,p.z].every(Number.isInteger))) throw new Error('At least one integer approach position is required');
    const bot = this.bot(id);
    const goalsForPositions = positions.map(p => new goals.GoalBlock(p.x,p.y,p.z));
    try { await this.navigate(id,new goals.GoalCompositeAny(goalsForPositions)); }
    finally { bot.pathfinder.setGoal(null); }
    const {x,y,z}=bot.entity.position;
    return {position:{x,y,z}};
  }
  async transfer(id: AgentId, name: string, count: number, deposit = false) {
    return this.resources.transfer(id, name, count, deposit);
  }
  async ensure(id: AgentId, placements: Placement[]) {
    const counts: Record<string, number> = {};
    if (!(this.inventory(id).dirt >= 16)) await this.resources.acquire(id, 'dirt', 16);
    for (const p of placements) if(this.bot(id).blockAt(new Vec3(p.x,p.y,p.z))?.name!==p.name) counts[p.name] = (counts[p.name] ?? 0) + 1;
    for (const [name, count] of Object.entries(counts)) {
      const missing = count - (this.inventory(id)[name] ?? 0);
      if (missing > 0) await this.transfer(id, name, missing);
    }
  }
  async place(id: AgentId, placement: Placement, workshop = false) {
    this.check();
    if (!bounded(placement) && !(workshop && Math.abs(placement.x)<=7 && placement.z>=8 && placement.z<=12 && placement.y===64)) throw new Error('Placement outside construction bounds');
    const bot = this.bot(id), target = new Vec3(placement.x, placement.y, placement.z);
    if (bot.blockAt(target)?.name === placement.name) {
      if (placement.facing && bot.blockAt(target)?.getProperties().facing !== placement.facing) throw new Error('Existing block has incorrect orientation; remove it before retrying');
      return { alreadyPresent: true };
    }
    if (['dirt', 'grass_block', 'scaffolding'].includes(bot.blockAt(target)?.name ?? '')) await this.remove(id, placement);
    if (bot.blockAt(target)?.name !== 'air') throw new Error(`Placement occupied at ${target}`);
    const item = bot.inventory.items().find(i => i.name === placement.name);
    if (!item) throw new Error(`Missing inventory: ${placement.name}`);
    if (placement.name.endsWith('_bed')) {
      const approaches = [[2,0],[-2,0],[0,2],[0,-2]].map(([dx,dz]) => target.offset(dx,0,dz)).filter(p =>
        bot.blockAt(p)?.name === 'air' && bot.blockAt(p.offset(0,1,0))?.name === 'air' && bot.blockAt(p.offset(0,-1,0))?.boundingBox === 'block');
      if (!approaches.length) throw new Error('No clear approach beside the bed');
      try { await this.navigate(id,new goals.GoalCompositeAny(approaches.map(p=>new goals.GoalBlock(p.x,p.y,p.z)))); }
      catch (error) { throw new Error(`Bed approach failed from ${bot.entity.position}: ${error}`); }
      finally { bot.pathfinder.setGoal(null); }
    }
    const goal = new goals.GoalPlaceBlock(target, bot.world, {
      range: 3.5, LOS: true,
      faces: placement.name.endsWith('_bed') || placement.name.endsWith('_door') || placement.name === 'torch'
        ? [new Vec3(0, -1, 0)]
        : [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]
    } as ConstructorParameters<typeof goals.GoalPlaceBlock>[2]) as InstanceType<typeof goals.GoalPlaceBlock> & { getFaceAndRef(p: Vec3): { ref: Vec3; face: Vec3 } | null };
    // Grid path endpoints are approximate. Check real eye position and body
    // clearance, trying another reachable tile when an edge obscures the face.
    const rejected = new Set<string>();
    const isEnd = goal.isEnd.bind(goal);
    goal.isEnd = p => !rejected.has(`${p.x},${p.y},${p.z}`) && isEnd(p);
    const actualFace = () => {
      const p = bot.entity.position;
      if (Math.abs(p.x-target.x-0.5)<0.81 && Math.abs(p.z-target.z-0.5)<0.81 && p.y<target.y+1 && p.y+1.8>target.y) return null;
      return goal.getFaceAndRef(p.offset(0,1.62,0));
    };
    const rejectCurrent = () => { const p = bot.entity.position.floored(); rejected.add(`${p.x},${p.y},${p.z}`); };
    if (!actualFace()) rejectCurrent();
    let node: { ref: Vec3; face: Vec3 } | null = null;
    for (let attempt = 0; attempt < 4 && !node; attempt++) {
      try { await this.navigate(id,goal); }
      catch (error) { throw new Error(`Placement approach failed from ${bot.entity.position} to ${target}: ${error}`); }
      finally { bot.pathfinder.setGoal(null); }
      this.check();
      node = actualFace();
      if (!node) rejectCurrent();
    }
    if (!node) throw new Error(`No reachable placement face at ${target}; bot position ${bot.entity.position}`);
    for (let attempt = 0; attempt < 3; attempt++) {
      await bot.equip(item, 'hand');
      await bot.waitForTicks(3);
      const reference = bot.blockAt(node.ref)!;
      const sneak = ['crafting_table','chest','furnace'].includes(reference.name);
      try {
        if (sneak) { bot.setControlState('sneak',true); await bot.waitForTicks(2); }
        if (placement.facing) {
          const yaw = { north: 0, south: Math.PI, east: -Math.PI / 2, west: Math.PI / 2 }[placement.facing];
          await bot.look(yaw, 0, true);
        } else await bot.lookAt(node.ref.offset(0.5, 0.5, 0.5).minus(node.face.scaled(0.5)), true);
        // The bridge must deliver the new look before the interaction tick.
        await bot.waitForTicks(3);
        await this.deadline((bot as Bot & { _placeBlockWithOptions(block: NonNullable<ReturnType<Bot['blockAt']>>, face: Vec3, options: object): Promise<void> })._placeBlockWithOptions(reference, node.face.scaled(-1), { forceLook: 'ignore', swingArm: 'right' }));
      } catch (error) {
        await bot.waitForTicks(5);
        if (bot.blockAt(target)?.name === placement.name) break;
        if (attempt === 2) throw new Error(`Placement ${placement.name} at ${target} from ${bot.entity.position}, reference ${node.ref}, face ${node.face}, held ${bot.heldItem?.name}: ${error}`);
        this.check();
        rejectCurrent();
        await this.navigate(id, goal);
        node = actualFace();
        if (!node) throw new Error(`No alternate placement face at ${target}`);
        continue;
      } finally {
        if (sneak) bot.setControlState('sneak',false);
      }
      break;
    }
    await bot.waitForTicks(3);
    const result = bot.blockAt(target);
    if (result?.name !== placement.name || (placement.facing && result.getProperties().facing !== placement.facing)) throw new Error(`Placement verification failed at ${target}`);
    return { placed: placement };
  }
  async remove(id: AgentId, p: Position) {
    this.check(); if (!bounded(p)) throw new Error('Removal outside construction bounds');
    const bot = this.bot(id), target = new Vec3(p.x, p.y, p.z);
    if (bot.blockAt(target)?.name === 'air') return;
    try { await this.navigate(id,new ReachBlockGoal(target,bot.world,{reach:3.5})); }
    finally { bot.pathfinder.setGoal(null); }
    this.check();
    const block = bot.blockAt(target);
    if (!block || block.name === 'air') return;
    const suffix = ['dirt','grass_block'].includes(block.name) ? '_shovel' : block.name.includes('stone') ? '_pickaxe' : '_axe';
    const tool = bot.inventory.items().find(i => i.name.endsWith(suffix));
    if (tool) await bot.equip(tool, 'hand');
    await this.deadline(bot.dig(block)); await bot.waitForTicks(3);
    if (bot.blockAt(target)?.name !== 'air') throw new Error('Break verification failed');
  }
  async cleanup(id: AgentId) {
    return this.cleanupQueue.run(() => this.cleanupSupports(id));
  }
  async clearAccess(id: AgentId) {
    return this.cleanupQueue.run(async()=>{
      const bot=this.bot(id);
      const supports:Vec3[]=[];
      for(let z=6;z>=4;z--)for(let y=67;y>=64;y--)for(let x=-1;x<=1;x++) {
        const position=new Vec3(x,y,z),name=bot.blockAt(position)?.name;
        if(name==='dirt'||name==='grass_block'||name==='scaffolding')supports.push(position);
      }
      let removed=0;
      for(const position of supports) {
        this.check();
        if(!['dirt','grass_block','scaffolding'].includes(bot.blockAt(position)?.name??''))continue;
        await this.remove(id,position);removed++;
      }
      return {removed};
    });
  }
  private async cleanupSupports(id: AgentId) {
    this.check();
    const blocks = (await this.snapshot()).blocks.filter(([, y, , state]) => y >= 64 && (state.startsWith('minecraft:dirt') || state.startsWith('minecraft:grass_block') || state.startsWith('minecraft:scaffolding'))).sort((a,b)=>b[1]-a[1]);
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
