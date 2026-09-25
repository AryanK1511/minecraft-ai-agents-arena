import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { IDS, type AgentId, type RunState } from './types.js';
export class Store {
  db: DatabaseSync;
  state: RunState;
  constructor(public directory = 'shared/runs', public budget = 1) {
    if (!Number.isFinite(budget) || budget <= 0 || !Number.isSafeInteger(Math.round(budget * 1e9))) throw new Error('RUN_BUDGET_USD must be a positive, finite dollar amount');
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'arena.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, run TEXT, at TEXT, kind TEXT, json TEXT);');
    const row = this.db.prepare('SELECT json FROM state WHERE id=1').get() as { json: string } | undefined;
    this.state = row ? JSON.parse(row.json) : this.fresh();
    this.state.status = 'paused';
    this.state.reason = Object.keys(this.state.reservations).length ? 'Unresolved request reservations from previous process; reconcile billing before resume.' : 'Restarted paused; world reconciliation required.';
    for (const id of IDS) { this.state.agents[id].connected = false; this.state.agents[id].action = 'paused'; }
    for (const task of this.state.tasks) if (task.status === 'claimed') { task.status = 'todo'; delete task.owner; }
    this.save('startup');
  }
  fresh(): RunState {
    const agents = Object.fromEntries(IDS.map(id => [id, { ...JSON.parse(readFileSync(`agents/${id}/config.json`, 'utf8')), connected: false, action: 'paused', memory: '', spent: 0, failures: 0, contributions: 0, inventory: {}, messages: [] }])) as RunState['agents'];
    return { id: randomUUID(), status: 'paused', reason: 'Ready; press Start', limit: this.budget, spent: 0, reservations: {}, tasks: [], agents, messages: [], checklist: {}, revision: 0 };
  }
  save(kind: string, detail: unknown = {}) {
    this.state.revision++;
    const json = JSON.stringify(this.state);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO state VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(json);
      this.db.prepare('INSERT INTO events(run,at,kind,json) VALUES (?,?,?,?)').run(this.state.id, new Date().toISOString(), kind, JSON.stringify(detail));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    const runDir = join(this.directory, this.state.id);
    mkdirSync(runDir, { recursive: true });
    if (kind === 'world-reconciled') writeFileSync(join(runDir, 'world.json'), JSON.stringify((detail as { snapshot: unknown }).snapshot, null, 2));
    writeFileSync(join(runDir, 'summary.json'), JSON.stringify(this.state, null, 2));
    writeFileSync(join(runDir, 'messages.md'), this.state.messages.map(m => `${m.at} **${m.agent}**: ${m.text}`).join('\n\n'));
  }
  reserve(amount: number): string {
    if (this.state.status !== 'running') throw new Error('Run is paused');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Invalid reservation');
    const reserved = Object.values(this.state.reservations).reduce((a, b) => a + b, 0);
    if (this.state.spent + reserved + amount > this.state.limit * 1e9) throw new Error('Budget exhausted');
    const id = randomUUID(); this.state.reservations[id] = amount; this.save('reserve', { id, amount }); return id;
  }
  settle(request: string, amount: number, agent: AgentId) {
    const reserved = this.state.reservations[request];
    if (reserved === undefined || !Number.isSafeInteger(amount) || amount < 0) throw new Error('Unresolved billing');
    this.state.spent += amount;
    this.state.agents[agent].spent += amount;
    delete this.state.reservations[request];
    if (amount > reserved) { this.state.status = 'paused'; this.state.reason = 'Provider billed above the reserved ceiling'; }
    this.save('settled', { request, amount, agent });
  }
  pause(reason: string) { this.state.status = 'paused'; this.state.reason = reason; this.save('pause', { reason }); }
  reset() { this.save('archived'); this.state = this.fresh(); this.save('reset'); }
}
