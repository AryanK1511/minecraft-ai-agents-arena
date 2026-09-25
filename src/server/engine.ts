import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { Store } from '../core/store.js';
import { Coordinator } from '../core/coordinator.js';
import { OpenRouter, type ToolSpec } from '../core/openrouter.js';
import { designSchema, key } from '../core/blueprint.js';
import { inspect } from '../core/completion.js';
import { IDS, type AgentId, type Snapshot } from '../core/types.js';
import { World } from '../minecraft/world.js';
const xyz = { x: z.number().int(), y: z.number().int(), z: z.number().int() };
const schemas = {
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
  cleanup_scaffolding: 'Remove temporary dirt supports using survival tools. Use after all house tasks are done.',
  observe: 'Read compact current world changes, blueprint, and available tasks.', inventory: 'Inspect your survival inventory.', move: 'Walk to an arena position.', transfer: 'Withdraw or deposit stock from serialized shared supply chests.',
  propose_blueprint: 'Propose the house dimensions, materials and appearance. The resulting plan includes required furnishings, windows, and an entrance on the selected side. Only before a proposal exists.',
  revise_blueprint: 'Revise an unapproved proposal; requires the current revision, resets votes, and preserves its history.',
  vote_blueprint: 'Approve the current blueprint revision. Two distinct votes approve it.', claim_task: 'Claim an available task with completed dependencies and reserve its construction region.',
  build_section: 'Build your claimed task with real survival placement, automatic stock withdrawal, reach checks, and partial progress reporting.', place_block: 'Place a single specified block from your claimed task.', remove_block: 'Remove an incorrect block from your claimed task.', message: 'Send a concise shared coordination message.', remember: 'Replace your durable compact memory.',
};
const tools: ToolSpec[] = Object.entries(schemas).map(([name, schema]) => ({ type: 'function', function: { name, description: descriptions[name as keyof typeof schemas], parameters: z.toJSONSchema(schema) as Record<string, unknown> } }));
export class Engine {
  store = new Store(process.env.RUNS_DIR ?? 'shared/runs', Number(process.env.RUN_BUDGET_USD ?? 1));
  coordinator = new Coordinator(this.store);
  router = new OpenRouter(this.store, process.env.OPENROUTER_API_KEY ?? '');
  world = new World(process.env.MC_HOST ?? 'minecraft', process.env.RCON_PASSWORD ?? 'local-compatibility-only', (id, connected) => {
    this.store.state.agents[id].connected = connected;
    if (!connected) { this.coordinator.release(id); this.store.pause(`${id} disconnected; Resume reconnects and reconciles`); this.world.stop(); }
    this.publish();
  });
  listeners = new Set<() => void>();
  loops: Promise<void>[] = [];
  lastSnapshot: Snapshot = { blocks: [], players: [], revision: 0, paused: true };
  controlBusy = false;
  publish() { for (const listener of this.listeners) listener(); }
  async initialize() {
    this.controlBusy = true;
    try { await this.world.command('pause'); await this.world.connect(); await this.reconcile(); }
    finally { this.controlBusy = false; this.publish(); }
  }
  async reconcile() {
    this.lastSnapshot = await this.world.snapshot();
    const blocks = new Map(this.lastSnapshot.blocks.map(([x,y,z,state]) => [`${x},${y},${z}`, state]));
    for (const task of this.store.state.tasks) {
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
    await this.world.actions.run(async () => { await this.world.command('pause'); });
    for (const id of IDS) this.coordinator.release(id);
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
    const available = s.tasks.filter(t => t.status === 'todo' && t.dependencies.every(d => s.tasks.find(t => t.id === d)?.status === 'done')).slice(0, 12);
    const yourTask = s.tasks.find(t=>t.owner === id && t.status === 'claimed');
    const observedBlocks = this.lastSnapshot.blocks.filter(([x,y,z]) => yourTask?.blocks.some(p=>Math.abs(p.x-x)<=1 && Math.abs(p.z-z)<=1 && Math.abs(p.y-y)<=1)).slice(0,35);
    return { observedBlocks, run: s.id, budgetRemaining: (s.limit * 1e9 - s.spent - Object.values(s.reservations).reduce((a,b)=>a+b,0)) / 1e9, blueprint: s.blueprint, availableTasks: available.map(t=>({id:t.id,blocks:t.blocks.length})), yourTask: s.tasks.find(t=>t.owner === id && t.status === 'claimed'), done: s.tasks.filter(t=>t.status==='done').length, total: s.tasks.length, inventory: s.agents[id].inventory, recentMessages: s.messages.slice(-6), memory: s.agents[id].memory, checklist: s.checklist };
  }
  toolsFor(id: AgentId): ToolSpec[] {
    const state = this.store.state, bp = state.blueprint;
    let names: string[];
    const own = state.tasks.find(t=>t.owner===id && t.status==='claimed');
    const available = this.observation(id).availableTasks.map(t=>t.id);
    if (!bp) names = ['propose_blueprint'];
    else if (!bp.approved) names = ['vote_blueprint','revise_blueprint'];
    else if (own) names = ['build_section','place_block','remove_block','observe','inventory','move','transfer','remember','message'];
    else if (available.length) names = ['claim_task'];
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
    return true;
  }
  async execute(id: AgentId, name: keyof typeof schemas, input: unknown) {
    const data = schemas[name].parse(input) as any;
    this.world.check();
    if (name === 'observe') { await this.reconcile(); return this.observation(id); }
    if (name === 'inventory') return this.world.inventory(id);
    if (name === 'propose_blueprint') return this.coordinator.propose(id, data);
    if (name === 'revise_blueprint') return this.coordinator.revise(id, data.revision, data.design);
    if (name === 'vote_blueprint') return this.coordinator.vote(id, data.revision);
    if (name === 'claim_task') return this.coordinator.claim(id, data.id, data.revision);
    if (name === 'message') { this.store.state.messages.push({ agent: id, text: data.text, at: new Date().toISOString() }); this.store.save('message'); return { sent: true }; }
    if (name === 'remember') { this.store.state.agents[id].memory = data.text; this.store.save('memory'); return { saved: true }; }
    return this.world.actions.run(async () => {
      this.world.check();
      if (name === 'cleanup_scaffolding') { if (!this.store.state.tasks.length || this.store.state.tasks.some(t=>t.status!=='done')) throw new Error('Finish house sections before final cleanup'); const result = await this.world.cleanup(id); await this.reconcile(); return result; }
      if (name === 'move') return this.world.move(id, data);
      if (name === 'transfer') return this.world.transfer(id, data.name, data.count, data.deposit);
      const task = this.store.state.tasks.find(t => t.id === data.id && t.owner === id && t.status === 'claimed');
      if (!task) throw new Error('An owned task claim is required');
      const selected = name === 'build_section' ? task.blocks : task.blocks.filter(p=>p.x===data.x && p.y===data.y && p.z===data.z);
      if (!selected.length) throw new Error('Block is outside the claimed task');
      let placed = 0;
      try {
        if (name === 'remove_block') { await this.world.remove(id, data); return { removed: data }; }
        await this.world.ensure(id, selected);
        for (const block of selected) { this.world.check(); const result = await this.world.place(id, block); if (!result.alreadyPresent) { placed++; this.store.state.agents[id].contributions++; this.store.save('block-placed', { agent: id, task: task.id, block }); } }
        await this.reconcile(); return { placed, task: task.id, complete: task.status === 'done' };
      } catch (error) { if (this.store.state.status === 'running') task.failures++; task.error = error instanceof Error ? error.message : String(error); if (task.failures >= 3) this.store.pause(`${task.id} failed three times: ${task.error}`); this.store.save('partial-action', { agent: id, task: task.id, placed, error: task.error }); throw new Error(`Partial progress ${placed}: ${task.error}`); }
    });
  }
  async loop(id: AgentId) {
    const agent = this.store.state.agents[id];
    let idleDecisions = 0;
    const shared = ['shared/prompts/team.md','shared/minecraft-rules/world.md','shared/house-requirements/house.md'].map(f=>readFileSync(f,'utf8')).join('\n');
    while (this.store.state.status === 'running' && agent.connected) {
      if (!this.needsDecision(id)) { agent.action = 'waiting for teammates'; this.publish(); await new Promise(resolve=>setTimeout(resolve,500)); continue; }
      try {
        agent.action = 'thinking'; this.publish();
        const call = await this.router.decide(id, [{ role:'system', content: readFileSync(`agents/${id}/prompt.md`,'utf8')+'\n'+shared }, ...agent.messages.slice(-4), { role:'user', content: JSON.stringify(this.observation(id)) }], this.toolsFor(id));
        if (this.store.state.status !== 'running') break;
        const name = call.function.name;
        this.store.save('model-tool-call', { agent: id, call });
        agent.messages.push({ role: 'assistant', content: `I chose ${name} with arguments ${call.function.arguments.slice(0,2000)}` });
        if (!Object.hasOwn(schemas, name)) throw new Error('Unknown tool');
        agent.action = name; this.publish();
        const result = await this.execute(id, name as keyof typeof schemas, JSON.parse(call.function.arguments));
        agent.messages.push({ role: 'user', content: `Previous tool ${name} result: ${JSON.stringify(result).slice(0,2500)}` });
        agent.messages = agent.messages.slice(-4);
        agent.failures = 0;
        idleDecisions = ['observe','inventory','message','remember'].includes(name) ? idleDecisions+1 : 0;
        if (idleDecisions >= 5) throw new Error('No construction or coordination progress in five decisions');
        this.store.save('action-result', { agent: id, name, result }); this.publish();
        if (Object.values(this.store.state.checklist).every(Boolean)) {
          this.store.state.status = 'complete'; this.store.state.reason = 'House verified against actual world blocks and reachable interior';
          this.world.stop(); await this.world.command('pause'); this.store.save('complete'); this.publish(); break;
        }
      } catch (error) {
        const message = error instanceof z.ZodError ? error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ') : error instanceof Error ? error.message : String(error);
        agent.failures++; agent.action = message;
        agent.messages.push({ role: 'user', content: `Tool failed: ${message}. Choose a bounded recovery action; do not repeat an impossible action.` });
        this.store.save('agent-error', { id, error: message }); this.publish();
        if (agent.failures >= 3 || this.store.state.status !== 'running') { if (this.store.state.status === 'running') this.store.pause(`${id}: ${message}`); this.world.stop(); await this.world.command('pause').catch(()=>{}); break; }
      }
    }
    agent.action = this.store.state.status; this.publish();
  }
}
