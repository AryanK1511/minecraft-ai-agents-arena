import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/server/engine.js';
test('reset rejects stale confirmation, archives the old ledger and restores a fresh paused run', async () => {
  const directory = mkdtempSync(join(tmpdir(),'arena-lifecycle-'));
  const previousDirectory=process.env.RUNS_DIR; process.env.RUNS_DIR=directory;
  const engine = new Engine();
  if(previousDirectory===undefined)delete process.env.RUNS_DIR;else process.env.RUNS_DIR=previousDirectory;
  const calls:string[]=[];
  engine.world.command=async(action)=>{calls.push(action);return {ok:true,paused:true,revision:0,blocks:[],players:[]};};
  try {
    const run=engine.store.state.id;
    engine.store.state.spent=12_345;engine.store.save('test-spending');
    await assert.rejects(engine.reset('stale-run'),/Stale/);assert.equal(calls.length,0);
    await engine.reset(run);
    assert.ok(calls.includes('reset'));assert.notEqual(engine.store.state.id,run);
    assert.equal(engine.store.state.spent,0);assert.equal(engine.store.state.status,'paused');
    assert.ok(existsSync(join(directory,run,'summary.json')));
    assert.equal(engine.store.db.prepare("SELECT count(*) AS n FROM events WHERE kind='archived' AND run=?").get(run)?.n,1);
  } finally {engine.store.db.close();rmSync(directory,{recursive:true,force:true});}
});
