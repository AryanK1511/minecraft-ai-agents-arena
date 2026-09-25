import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { Store } from '../core/store.js';
import { Coordinator, CoordinationConflict } from '../core/coordinator.js';
import { OpenRouter, type ToolSpec } from '../core/openrouter.js';
import { designSchema, key, validateResources } from '../core/blueprint.js';
import { inspect } from '../core/completion.js';
import { IDS, type AgentId, type Snapshot } from '../core/types.js';
import { World } from '../minecraft/world.js';
const xyz = { x: z.number().int(), y: z.number().int(), z: z.number().int() };
const schemas = {
  fulfill_supply: z.object({id:z.string().max(80)}).strict(),
  gather: z.object({name:z.enum(['oak_log','cobblestone','coal','raw_iron','sand','dirt','white_wool']),count:z.number().int().min(1).max(64)}).strict(),
  craft: z.object({name:z.string().max(40),count:z.number().int().min(1).max(64)}).strict(),
  delegate_task: z.object({id:z.string().max(80),agent:z.enum(IDS),reason:z.string().max(300)}).strict(),
  cleanup_scaffolding: z.object({}).strict(),
  observe: z.object({}).strict(), inventory: z.object({}).strict(),
  move: z.object(xyz).strict(),
  transfer: z.object({ name: z.string().max(40), count: z.number().int().min(1).max(128), deposit: z.boolean().default(false) }).strict(),
  propose_blueprint: designSchema,
  revise_blueprint: z.object({ revision: z.number().int(), design: designSchema }).strict(),
  vote_blueprint: z.object({ revision: z.number().int() }).strict(),
  claim_task: z.object({ id: z.string().max(80), revision: z.number().int() }).strict(),
  build_section: z.object({ id: z.string().max(80) }).strict(),
  place_block: z.object({ id: z.string().max(80), ...xyz }).strict(),
  remove_block: z.object({ id: z.string().max(80), ...xyz }).strict(),
  message: z.object({ text: z.string().min(1).max(600) }).strict(),
  remember: z.object({ text: z.string().max(1500) }).strict(),
};
const descriptions: Record<keyof typeof schemas, string> = {
  fulfill_supply:'Gather, mine, craft and smelt the materials for your supply duty, then deposit them into the team-crafted chest. Starts with an empty inventory.',
  gather:'Gather a raw resource in survival, making required tools first.', craft:'Craft or smelt an item from natural resources using a private workbench or furnace.', delegate_task:'Assign an unclaimed duty to a teammate and explain the division of work.',
  cleanup_scaffolding: 'Remove temporary dirt supports using survival tools. Use after all house tasks are done.',
  observe: 'Read compact current world changes, blueprint, and available tasks.', inventory: 'Inspect your survival inventory.', move: 'Walk to an arena position.', transfer: 'Withdraw or deposit stock from serialized shared supply chests.',
  propose_blueprint: 'Propose the house dimensions, materials and appearance. The resulting plan includes required furnishings, windows, and an entrance on the selected side. Only before a proposal exists.',
  revise_blueprint: 'Revise an unapproved proposal; requires the current revision, resets votes, and preserves its history.',
  vote_blueprint: 'Approve the current blueprint revision. Two distinct votes approve it.', claim_task: 'Claim an available task with completed dependencies and reserve its construction region.',
  build_section: 'Build your claimed task with real survival placement, automatic stock withdrawal, reach checks, and partial progress reporting.', place_block: 'Place a single specified block from your claimed task.', remove_block: 'Remove an incorrect block from your claimed task.', message: 'Send a concise shared coordination message.', remember: 'Replace your durable compact memory.',
};
const tools: ToolSpec[] = Object.entries(schemas).map(([name, schema]) => ({ type: 'function', function: { name, description: descriptions[name as keyof typeof schemas], parameters: z.toJSONSchema(schema) as Record<string, unknown> } }));
export class Engine {
  store = new Store(process.env.RUNS_DIR ?? 'shared/runs', Number(process.env.RUN_BUDGET_USD ?? 5));
  coordinator = new Coordinator(this.store);
  router = new OpenRouter(this.store, process.env.OPENROUTER_API_KEY ?? '');
  world = new World(process.env.MC_HOST ?? 'minecraft', process.env.RCON_PASSWORD ?? 'local-compatibility-only', (id, connected) => {
    this.store.state.agents[id].connected = connected;
    if (!connected) {
      this.coordinator.release(id);
      this.store.state.agents[id].action = this.store.state.status === 'running' ? 'reconnecting' : this.store.state.status;
      if (this.store.state.status === 'running') this.say(id, 'I disconnected. My duty is released while I reconnect; keep working.');
    }
    this.publish();
  });
  constructor() {
    this.world.onActivity=(id,action,detail)=>{
      const agent=this.store.state.agents[id];agent.action=action;agent.inventory=this.world.inventory(id);
      const event=detail as {kind?:string;count?:number}|undefined;
      if(event?.kind==='gathered')agent.gathered=(agent.gathered??0)+(event.count??0);
      if(event?.kind==='crafted')agent.crafted=(agent.crafted??0)+(event.count??0);
      this.store.save('survival-action',{agent:id,action,...detail});this.publish();
    };
  }
  say(id: AgentId,text: string) {
    this.store.state.messages.push({agent:id,text,at:new Date().toISOString()});
    this.store.save('message');
    if(this.store.state.agents[id].connected)this.world.bot(id).chat(text.slice(0,240));
    this.publish();
  }
  listeners = new Set<() => void>();
  loops: Promise<void>[] = [];
  lastSnapshot: Snapshot = { blocks: [], players: [], revision: 0, paused: true };
  controlBusy = false;
  cleanupLeader = 0;
  publish() { for (const listener of this.listeners) listener(); }
  async initialize() {
    this.controlBusy = true;
    try { await this.world.command('pause'); await this.world.connect(); await this.reconcile(); }
    finally { this.controlBusy = false; this.publish(); }
  }
  async reconcile() {
    this.lastSnapshot = await this.world.snapshot();
    if(this.lastSnapshot.environment && this.store.state.environment!==this.lastSnapshot.environment)throw new Error('This run belongs to a different world configuration; archive it before starting the natural biome');
    const blocks = new Map(this.lastSnapshot.blocks.map(([x,y,z,state]) => [`${x},${y},${z}`, state]));
    for (const task of this.store.state.tasks) {
      if (task.kind==='supply') {
        const pending=task.pendingDelivery;
        if(pending && this.world.paused) {
          const stock=this.lastSnapshot.storage?.[pending.name]??0;
          const inventory=this.lastSnapshot.players.find(p=>p.name===pending.agent)?.inventory?.[pending.name]??0;
          if(stock===pending.beforeStock+pending.count && inventory===pending.beforeInventory-pending.count) {
            task.delivered=(task.delivered??0)+pending.count;delete task.pendingDelivery;
            if(task.delivered>=(task.supplies?.[0].count??Infinity))task.status='done';
            this.store.save('delivery-reconciled',{task:task.id,result:'completed'});
          } else if(stock===pending.beforeStock && inventory===pending.beforeInventory) {
            delete task.pendingDelivery;this.store.save('delivery-reconciled',{task:task.id,result:'not-applied'});
          } else throw new Error(`Unresolved shared-storage delivery for ${task.id}; keep paused`);
        }
        continue;
      }
      const complete = task.blocks.every(p => blocks.get(key(p))?.split('[')[0] === `minecraft:${p.name}` && (!p.facing || blocks.get(key(p))!.includes(`facing=${p.facing}`)));
      if (complete) { task.status = 'done'; delete task.error; task.failures = 0; }
      else if (task.status === 'done') { task.status = 'todo'; delete task.owner; }
    }
    this.store.state.checklist = inspect(this.lastSnapshot, this.store.state.blueprint, this.store.state.tasks);
    for (const id of IDS) if (this.store.state.agents[id].connected) this.store.state.agents[id].inventory = this.world.inventory(id);
    this.store.save('world-reconciled', { snapshot: this.lastSnapshot }); this.publish();
  }
  async start() {
    if (this.controlBusy) throw new Error('A lifecycle operation is in progress');
    if (this.store.state.status === 'running') return;
    if (this.store.state.status === 'complete') throw new Error('House complete; Reset starts another run');
    if (Object.keys(this.store.state.reservations).length) throw new Error('Unresolved billing reservations prevent resume; inspect the ledger');
    this.controlBusy = true;
    try {
      await Promise.allSettled(this.loops);
      await this.router.validate(); await this.world.connect(); await this.reconcile();
      if (Object.values(this.store.state.checklist).every(Boolean)) { this.store.state.status = 'complete'; this.store.state.reason = 'Verified house complete'; this.store.save('complete'); return; }
      await this.world.command('resume'); this.world.paused = false;
      this.store.state.status = 'running'; this.store.state.reason = '';
      for (const id of IDS) this.store.state.agents[id].failures = 0;
      for (const task of this.store.state.tasks) task.failures = 0;
      this.store.save('start'); this.loops = IDS.map(id => this.loop(id));
    } catch (error) { this.store.pause(error instanceof Error ? error.message : String(error)); throw error; }
    finally { this.controlBusy = false; this.publish(); }
  }
  async pause(reason = 'Paused by user') {
    this.store.pause(reason); this.world.stop(); this.publish();
    await Promise.allSettled(this.loops);
    await this.world.drain(); await this.world.command('pause');
    for (const id of IDS) this.coordinator.release(id,true);
    await this.reconcile();
  }
  async reset(runId: string) {
    if (runId !== this.store.state.id) throw new Error('Stale reset confirmation');
    if (this.controlBusy) throw new Error('A lifecycle operation is in progress');
    this.controlBusy = true;
    try { await this.pause('Resetting'); await this.world.command('reset'); this.store.reset(); await this.reconcile(); }
    finally { this.controlBusy = false; this.publish(); }
  }
  observation(id: AgentId) {
    const s = this.store.state;
    const available = this.coordinator.available(id).slice(0, 12);
    const yourTask = s.tasks.find(t=>t.owner === id && t.status === 'claimed');
    const observedBlocks = this.lastSnapshot.blocks.filter(([x,y,z]) => yourTask?.blocks.some(p=>Math.abs(p.x-x)<=1 && Math.abs(p.z-z)<=1 && Math.abs(p.y-y)<=1)).slice(0,35);
    return { environment:this.lastSnapshot.environment, remainingResources:this.lastSnapshot.resources, sharedStorage:this.lastSnapshot.storage, team:IDS.map(player=>({id:player,action:s.agents[player].action,task:s.tasks.find(t=>t.owner===player&&t.status==='claimed')?.id,inventory:s.agents[player].inventory})), observedBlocks, run: s.id, budgetRemaining: (s.limit * 1e9 - s.spent - Object.values(s.reservations).reduce((a,b)=>a+b,0)) / 1e9, blueprint: s.blueprint, availableTasks: available.map(t=>({id:t.id,label:t.label,kind:t.kind,blocks:t.blocks.length,supplies:t.supplies,assignee:t.assignee})), yourTask: s.tasks.find(t=>t.owner === id && t.status === 'claimed'), done: s.tasks.filter(t=>t.status==='done').length, total: s.tasks.length, inventory: s.agents[id].inventory, recentMessages: s.messages.slice(-6), memory: s.agents[id].memory, checklist: s.checklist };
  }
  toolsFor(id: AgentId): ToolSpec[] {
    const state = this.store.state, bp = state.blueprint;
    let names: string[];
    const own = state.tasks.find(t=>t.owner===id && t.status==='claimed');
    const available = this.observation(id).availableTasks.map(t=>t.id);
    if (!bp) names = ['propose_blueprint'];
    else if (!bp.approved) names = ['vote_blueprint','revise_blueprint'];
    else if (own) names = own.kind==='supply'?['fulfill_supply','gather','craft','observe','inventory','move','remember','message']:['build_section','place_block','remove_block','observe','inventory','move','transfer','remember','message'];
    else if (available.length) names = ['claim_task','delegate_task','message'];
    else names = ['cleanup_scaffolding'];
    return tools.filter(tool=>names.includes(tool.function.name)).map(tool=> {
      const copy = structuredClone(tool);
      const parameters = copy.function.parameters as { properties?: Record<string, unknown> };
      if (parameters.properties?.id) parameters.properties.id = { type:'string', enum: own ? [own.id] : available };
      if (parameters.properties?.revision && bp) parameters.properties.revision = { type:'integer', enum:[bp.revision] };
      return copy;
    });
  }
  needsDecision(id: AgentId) {
    const state = this.store.state, bp = state.blueprint;
    if (bp && !bp.approved && bp.votes.includes(id)) return false;
    if (bp?.approved && state.tasks.some(t=>t.status!=='done') && !state.tasks.some(t=>t.owner===id && t.status==='claimed') && !this.observation(id).availableTasks.length) return false;
    if (bp?.approved && state.tasks.length > 0 && state.tasks.every(t=>t.status==='done')) return id === IDS[this.cleanupLeader];
    return true;
  }
  async execute(id: AgentId, name: keyof typeof schemas, input: unknown) {
    const data = schemas[name].parse(input) as any;
    this.world.check();
    if (name === 'observe') { await this.reconcile(); return this.observation(id); }
    if (name === 'inventory') return this.world.inventory(id);
    if ((name === 'propose_blueprint' || name === 'revise_blueprint') && this.lastSnapshot.resources) validateResources(name === 'propose_blueprint' ? data : data.design,this.lastSnapshot.resources);
    if (name === 'propose_blueprint') return this.coordinator.propose(id, data);
    if (name === 'revise_blueprint') return this.coordinator.revise(id, data.revision, data.design);
    if (name === 'vote_blueprint') return this.coordinator.vote(id, data.revision);
    if (name === 'claim_task') { const task=this.coordinator.claim(id,data.id,data.revision); this.say(id,`I'll take ${task.label}.`); return task; }
    if (name === 'delegate_task') { const task=this.coordinator.delegate(id,data.id,data.agent);this.say(id,`${data.agent}, please take ${task.label}. ${data.reason}`);return task; }
    if (name === 'message') { this.say(id,data.text);return {sent:true}; }
    if (name === 'remember') { this.store.state.agents[id].memory = data.text; this.store.save('memory'); return { saved: true }; }
    return this.world.act(id, async () => {
      this.world.check();
      if(name==='gather'||name==='craft') { await this.world.resources.acquire(id,data.name,data.count);return {inventory:this.world.inventory(id)}; }
      if (name === 'cleanup_scaffolding') { if (!this.store.state.tasks.length || this.store.state.tasks.some(t=>t.status!=='done')) throw new Error('Finish house sections before final cleanup'); const result = await this.world.cleanup(id); await this.reconcile(); return result; }
      if (name === 'move') return this.world.move(id, data);
      if (name === 'transfer') return this.world.transfer(id, data.name, data.count, data.deposit);
      const task = this.store.state.tasks.find(t => t.id === data.id && t.owner === id && t.status === 'claimed');
      if (!task) throw new Error('An owned task claim is required');
      if (name==='fulfill_supply') {
        if(task.pendingDelivery)throw new Error('Delivery reconciliation is required before retrying');
        if(task.kind!=='supply'||!task.supplies?.length)throw new Error('A supply duty is required');
        const supply=task.supplies[0],remaining=supply.count-(task.delivered??0);
        if(remaining>0) {
          await this.world.resources.acquire(id,supply.name,remaining);
          await this.world.resources.ensureStorage(id);
          await this.world.resources.acquire(id,supply.name,remaining);
          try { await this.world.resources.transfer(id,supply.name,remaining,true,{
            before:(beforeStock,beforeInventory)=>{task.pendingDelivery={name:supply.name,count:remaining,beforeStock,beforeInventory,agent:id};this.store.save('delivery-intent',{task:task.id,pending:task.pendingDelivery});},
            after:()=>{task.delivered=(task.delivered??0)+remaining;delete task.pendingDelivery;this.store.save('delivery-confirmed',{task:task.id,count:remaining});}
          }); } catch(error) { if(task.pendingDelivery)this.store.pause('Storage delivery interrupted; Resume reconciles before retrying');throw error; }
        }
        task.status='done';this.store.save('supply-complete',{agent:id,task:task.id});
        this.say(id,`${supply.count} ${supply.name.replaceAll('_',' ')} ready in our shared chest.`);
        await this.reconcile();return {complete:true,task:task.id};
      }
      const selected = name === 'build_section' ? task.blocks : task.blocks.filter(p=>p.x===data.x && p.y===data.y && p.z===data.z);
      if (!selected.length) throw new Error('Block is outside the claimed task');
      let placed = 0;
      try {
        if (name === 'remove_block') { await this.world.remove(id, data); return { removed: data }; }
        await this.world.ensure(id, selected);
        for (const block of selected) { this.world.check(); const result = await this.world.place(id, block); if (!result.alreadyPresent) { placed++; this.store.state.agents[id].contributions++; this.store.save('block-placed', { agent: id, task: task.id, block }); } }
        await this.reconcile();
        if (task.status === 'done') this.say(id, `Completed ${task.label}; the next dependent duties are open.`);
        return { placed, task: task.id, complete: task.status === 'done' };
      } catch (error) {
        if (this.store.state.status === 'running') task.failures++;
        task.error = error instanceof Error ? error.message : String(error);
        if (task.failures >= 3 && this.store.state.status === 'running') {
          task.status = 'todo'; delete task.owner; delete task.assignee;
          task.retryAt = Date.now() + 10_000;
          this.say(id, `I released ${task.label} after repeated trouble (${task.error}). Another teammate can retry it shortly.`);
        }
        this.store.save('partial-action', { agent: id, task: task.id, placed, error: task.error, retryAt: task.retryAt });
        throw new Error(`Partial progress ${placed}: ${task.error}`);
      }
    });
  }
  async loop(id: AgentId) {
    const agent = this.store.state.agents[id];
    let idleDecisions = 0;
    let idleParkingAttempted = false;
    const shared = ['shared/prompts/team.md','shared/minecraft-rules/world.md','shared/house-requirements/house.md'].map(f=>readFileSync(f,'utf8')).join('\n');
    while (this.store.state.status === 'running') {
      if (!agent.connected) {
        agent.action = 'reconnecting'; this.publish();
        try {
          await this.world.connect();
          if (agent.connected) this.say(id, 'Reconnected. I am rejoining the task board.');
        } catch (error) {
          agent.action = `reconnect delayed: ${error instanceof Error ? error.message : String(error)}`; this.publish();
          await new Promise(resolve=>setTimeout(resolve,3000));
        }
        continue;
      }
      if (!this.needsDecision(id)) {
        if (!idleParkingAttempted) {
          idleParkingAttempted = true;
          agent.action = 'making room for teammates'; this.publish();
          try { await this.world.act(id, () => this.world.move(id, { x: (IDS.indexOf(id)-1)*6, y: 64, z: 12 })); }
          catch (error) { if(this.store.state.status === 'running')this.store.save('parking-delayed',{id,error:String(error)}); }
        }
        agent.action = 'waiting for teammates'; this.publish(); await new Promise(resolve=>setTimeout(resolve,500)); continue;
      }
      idleParkingAttempted = false;
      try {
        agent.action = 'thinking'; this.publish();
        const observation = this.observation(id);
        const actionable = observation.yourTask ? `Your current duty is ${observation.yourTask.id}; use ${observation.yourTask.kind === 'supply' ? 'fulfill_supply' : 'build_section'} for it.` : `Current claimable task IDs: ${observation.availableTasks.map(t=>t.id).join(', ') || 'none'}. Historical task IDs may be complete and must not be reclaimed.`;
        const automaticCleanup = observation.total > 0 && observation.done === observation.total;
        const call = automaticCleanup
          ? { id:'automatic-cleanup', function:{name:'cleanup_scaffolding',arguments:'{}'} }
          : await this.router.decide(id, [{ role:'system', content: readFileSync(`agents/${id}/prompt.md`,'utf8')+'\n'+shared }, ...agent.messages.slice(-4), { role:'user', content: JSON.stringify(observation)+'\n'+actionable }], this.toolsFor(id));
        if (this.store.state.status !== 'running') break;
        const name = call.function.name;
        this.store.save(automaticCleanup ? 'automatic-tool-call' : 'model-tool-call', { agent: id, call });
        agent.messages.push({ role: 'assistant', content: `I chose ${name} with arguments ${call.function.arguments.slice(0,2000)}` });
        if (!Object.hasOwn(schemas, name)) throw new Error('Unknown tool');
        agent.action = name; this.publish();
        const result = await this.execute(id, name as keyof typeof schemas, JSON.parse(call.function.arguments));
        agent.messages.push({ role: 'user', content: `Previous tool ${name} result: ${JSON.stringify(result).slice(0,2500)}` });
        agent.messages = agent.messages.slice(-4);
        agent.failures = 0;
        idleDecisions = ['observe','inventory','message','remember','move'].includes(name) ? idleDecisions+1 : 0;
        if (idleDecisions >= 5) {
          agent.messages.push({role:'user',content:'You have spent several decisions without advancing a duty. Claim or execute concrete work now, or clearly coordinate a handoff.'});
          this.store.save('agent-idle-backoff',{id,decisions:idleDecisions});
          idleDecisions = 0;
          await new Promise(resolve=>setTimeout(resolve,2000));
        }
        this.store.save('action-result', { agent: id, name, result }); this.publish();
        if (Object.values(this.store.state.checklist).every(Boolean)) {
          this.store.state.status = 'complete'; this.store.state.reason = 'House verified against actual world blocks and reachable interior';
          this.world.stop(); await this.world.command('pause'); this.store.save('complete'); this.publish(); break;
        }
      } catch (error) {
        const message = error instanceof z.ZodError ? error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ') : error instanceof Error ? error.message : String(error);
        if(error instanceof CoordinationConflict && ++idleDecisions<5) {
          agent.messages.push({role:'user',content:`A teammate changed the shared plan while you were deciding: ${message}. Read the latest availableTasks and choose an available duty.`});
          this.store.save('coordination-conflict',{id,error:message});continue;
        }
        agent.failures++; agent.action = message;
        agent.messages.push({ role: 'user', content: `Tool failed: ${message}. Choose a bounded recovery action; do not repeat an impossible action.` });
        this.store.save('agent-error', { id, error: message }); this.publish();
        if (this.store.state.status !== 'running') break;
        if (message === 'Budget exhausted') {
          this.store.pause('Shared run budget exhausted'); this.world.stop(); await this.world.command('pause').catch(()=>{}); break;
        }
        if (agent.failures >= 3) {
          this.coordinator.release(id);
          const cleanupPhase = this.store.state.tasks.length > 0 && this.store.state.tasks.every(task=>task.status==='done');
          if (cleanupPhase) {
            this.cleanupLeader = (this.cleanupLeader + 1) % IDS.length;
            this.say(id, `I could not reach the remaining supports (${message}). ${IDS[this.cleanupLeader]} is taking the next cleanup attempt.`);
          } else this.say(id, `I am backing off after repeated errors (${message}). My teammates can continue and take the released duty.`);
          agent.failures = 0;
          agent.action = 'recovering while teammates continue'; this.publish();
          await new Promise(resolve=>setTimeout(resolve,5000));
        }
      }
    }
    agent.action = this.store.state.status; this.publish();
  }
}
