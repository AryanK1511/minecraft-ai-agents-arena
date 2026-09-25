import { Store } from './store.js';
import { designSchema, key, plan } from './blueprint.js';
import type { AgentId } from './types.js';
export class CoordinationConflict extends Error {}
export class Coordinator {
  constructor(public store: Store) {}
  propose(agent: AgentId, input: unknown) {
    if (this.store.state.blueprint?.approved) throw new CoordinationConflict('Approved blueprint is immutable for this run');
    const design = designSchema.parse(input);
    if (this.store.state.blueprint) throw new CoordinationConflict('Review the current proposal before replacing it');
    this.store.state.blueprint = { revision: 1, design, votes: [agent], approved: false };
    this.store.save('blueprint-proposed', { agent, design });
    return this.store.state.blueprint;
  }
  revise(agent: AgentId, revision: number, input: unknown) {
    const previous = this.store.state.blueprint;
    if (!previous || previous.approved || previous.revision !== revision) throw new CoordinationConflict('Cannot revise an approved or stale blueprint');
    const design = designSchema.parse(input);
    this.store.state.blueprint = { revision: revision + 1, design, votes: [agent], approved: false };
    this.store.save('blueprint-revised', { agent, previous, replacement: this.store.state.blueprint });
    return this.store.state.blueprint;
  }
  vote(agent: AgentId, revision: number) {
    const bp = this.store.state.blueprint;
    if (!bp || bp.revision !== revision) throw new CoordinationConflict('Stale blueprint revision');
    if (!bp.votes.includes(agent)) bp.votes.push(agent);
    if (bp.votes.length >= 2 && !bp.approved) { bp.approved = true; this.store.state.tasks = plan(bp.design); }
    this.store.save('blueprint-vote', { agent, revision }); return bp;
  }
  available(agent: AgentId) {
    const tasks = this.store.state.tasks;
    return tasks.filter(task => task.status === 'todo' && (!task.assignee || task.assignee === agent || tasks.some(other => other.owner === task.assignee && other.status === 'claimed')) && task.dependencies.every(id => tasks.find(other => other.id === id)?.status === 'done'));
  }
  claim(agent: AgentId, id: string, revision: number) {
    const state = this.store.state;
    if (!state.blueprint?.approved || state.blueprint.revision !== revision) throw new CoordinationConflict('Blueprint missing, unapproved, or stale');
    const task = state.tasks.find(t => t.id === id);
    if (task?.assignee && task.assignee !== agent && !state.tasks.some(other => other.owner === task.assignee && other.status === 'claimed')) throw new CoordinationConflict(`Task delegated to ${task.assignee}`);
    if (!task || task.status !== 'todo') {
      const available = this.available(agent).map(t => t.id);
      throw new CoordinationConflict(`Task unavailable: ${id} is ${task?.status ?? 'unknown'}. Current available duties for ${agent}: ${available.join(', ') || 'none; wait for teammates'}`);
    }
    if (state.tasks.some(t => t.owner === agent && t.status === 'claimed')) throw new Error('Finish the existing claim first');
    if (!task.dependencies.every(id => state.tasks.find(t => t.id === id)?.status === 'done')) throw new Error('Task dependencies are unfinished');
    const occupied = new Set(state.tasks.filter(t => t.status === 'claimed').flatMap(t => t.blocks.map(key)));
    if (task.blocks.some(p => occupied.has(key(p)))) throw new CoordinationConflict('Construction region is reserved');
    if(task.assignee && task.assignee !== agent)task.assignee=agent;
    task.owner = agent; task.status = 'claimed'; this.store.save('task-claimed', { agent, id }); return task;
  }
  delegate(agent: AgentId, id: string, target: AgentId) {
    const task=this.store.state.tasks.find(t=>t.id===id);
    if(!task||task.status!=='todo')throw new Error('Only unclaimed duties can be delegated');
    if(task.assignee===target)throw new Error(`Task already delegated to ${target}; claim it or choose another duty`);
    task.assignee=target;this.store.save('task-delegated',{agent,id,target});return task;
  }
  release(agent: AgentId, retainDuty = false) { for (const task of this.store.state.tasks) if (task.owner === agent && task.status === 'claimed') { task.status = 'todo'; delete task.owner; if(retainDuty)task.assignee=agent;else delete task.assignee; } this.store.save('claims-released', { agent }); }
}
