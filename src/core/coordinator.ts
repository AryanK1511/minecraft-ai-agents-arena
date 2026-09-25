import { Store } from './store.js';
import { designSchema, key, plan } from './blueprint.js';
import type { AgentId } from './types.js';
export class Coordinator {
  constructor(public store: Store) {}
  propose(agent: AgentId, input: unknown) {
    if (this.store.state.blueprint?.approved) throw new Error('Approved blueprint is immutable for this run');
    const design = designSchema.parse(input);
    if (this.store.state.blueprint) throw new Error('Review the current proposal before replacing it');
    this.store.state.blueprint = { revision: 1, design, votes: [agent], approved: false };
    this.store.save('blueprint-proposed', { agent, design });
    return this.store.state.blueprint;
  }
  revise(agent: AgentId, revision: number, input: unknown) {
    const previous = this.store.state.blueprint;
    if (!previous || previous.approved || previous.revision !== revision) throw new Error('Cannot revise an approved or stale blueprint');
    const design = designSchema.parse(input);
    this.store.state.blueprint = { revision: revision + 1, design, votes: [agent], approved: false };
    this.store.save('blueprint-revised', { agent, previous, replacement: this.store.state.blueprint });
    return this.store.state.blueprint;
  }
  vote(agent: AgentId, revision: number) {
    const bp = this.store.state.blueprint;
    if (!bp || bp.revision !== revision) throw new Error('Stale blueprint revision');
    if (!bp.votes.includes(agent)) bp.votes.push(agent);
    if (bp.votes.length >= 2 && !bp.approved) { bp.approved = true; this.store.state.tasks = plan(bp.design); }
    this.store.save('blueprint-vote', { agent, revision }); return bp;
  }
  claim(agent: AgentId, id: string, revision: number) {
    const state = this.store.state;
    if (!state.blueprint?.approved || state.blueprint.revision !== revision) throw new Error('Blueprint missing, unapproved, or stale');
    const task = state.tasks.find(t => t.id === id);
    if (!task || task.status !== 'todo') throw new Error('Task unavailable');
    if (state.tasks.some(t => t.owner === agent && t.status === 'claimed')) throw new Error('Finish the existing claim first');
    if (!task.dependencies.every(id => state.tasks.find(t => t.id === id)?.status === 'done')) throw new Error('Task dependencies are unfinished');
    const occupied = new Set(state.tasks.filter(t => t.status === 'claimed').flatMap(t => t.blocks.map(key)));
    if (task.blocks.some(p => occupied.has(key(p)))) throw new Error('Construction region is reserved');
    task.owner = agent; task.status = 'claimed'; this.store.save('task-claimed', { agent, id }); return task;
  }
  release(agent: AgentId) { for (const task of this.store.state.tasks) if (task.owner === agent && task.status === 'claimed') { task.status = 'todo'; delete task.owner; } this.store.save('claims-released', { agent }); }
}
