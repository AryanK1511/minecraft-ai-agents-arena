import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/store.js';
import { OpenRouter } from '../src/core/openrouter.js';
test('concurrent reservations cannot exceed the shared run budget and restart retains unresolved billing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-budget-'));
  const store = new Store(dir, 1);
  try {
    assert.throws(() => store.reserve(1), /paused/);
    store.state.status = 'running';
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => Promise.resolve().then(() => store.reserve(400_000_000))));
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 2);
    const id = (results[0] as PromiseFulfilledResult<string>).value;
    store.settle(id, 200_000_000, 'agent1');
    assert.equal(store.state.spent, 200_000_000);
    store.db.close();
    const restarted = new Store(dir, 1);
    assert.equal(restarted.state.status, 'paused');
    assert.match(restarted.state.reason, /Unresolved/);
    assert.equal(Object.keys(restarted.state.reservations).length, 1);
    restarted.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('no completion request before Start and uncertain API failures retain the reservation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-api-'));
  const store = new Store(dir);
  let calls = 0;
  const fetcher = (async () => { calls++; throw new Error('network lost'); }) as typeof fetch;
  const router = new OpenRouter(store, 'test-key', fetcher);
  router.models.set(store.state.agents.agent1.model, { id: store.state.agents.agent1.model, supported_parameters: ['tools'], pricing: { prompt: '0.0000001', completion: '0.0000003' } });
  try {
    await assert.rejects(router.decide('agent1', [], []), /paused/);
    assert.equal(calls, 0);
    store.state.status = 'running';
    await assert.rejects(router.decide('agent1', [], []), /network lost/);
    assert.equal(calls, 1);
    assert.equal(store.state.status, 'paused');
    assert.equal(Object.keys(store.state.reservations).length, 1);
    await assert.rejects(router.decide('agent1', [], []), /paused/);
    assert.equal(calls, 1);
  } finally { store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('a router rejection with no endpoint costs zero, while malformed paid tool output remains charged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-routing-')), store = new Store(dir);
  let rejectRouting = true;
  const fetcher = (async () => new Response(JSON.stringify(rejectRouting ? {error:{message:'No endpoints found that support the requested parameters'}} : {id:'generation-test',usage:{cost:0.001},choices:[{message:{tool_calls:[]}}]}), {status:rejectRouting?404:200})) as typeof fetch;
  const router = new OpenRouter(store,'test-key',fetcher);
  router.models.set(store.state.agents.agent1.model,{id:store.state.agents.agent1.model,supported_parameters:['tools'],pricing:{prompt:'0.0000001',completion:'0.0000003'}});
  try {
    store.state.status='running'; await assert.rejects(router.decide('agent1',[],[]),/No endpoints/);
    assert.equal(Object.keys(store.state.reservations).length,0); assert.equal(store.state.spent,0);
    rejectRouting=false; store.state.status='running'; await assert.rejects(router.decide('agent1',[],[]),/at least one tool/);
    assert.equal(store.state.spent,1_000_000); assert.equal(Object.keys(store.state.reservations).length,0);
    store.state.status='complete'; await assert.rejects(router.decide('agent1',[],[]),/paused/);
  } finally { store.db.close(); rmSync(dir,{recursive:true,force:true}); }
});
