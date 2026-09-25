import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/server/engine.js';
import type { Snapshot } from '../src/core/types.js';
test('supply duties are delegated, require real delivery, and reconcile interrupted deposits', async () => {
  const directory=mkdtempSync(join(tmpdir(),'arena-supplies-'));
  const old=process.env.RUNS_DIR;process.env.RUNS_DIR=directory;
  const engine=new Engine();if(old===undefined)delete process.env.RUNS_DIR;else process.env.RUNS_DIR=old;
  let snapshot:Snapshot={revision:0,paused:true,blocks:[],players:[],storage:{}};
  engine.world.snapshot=async()=>snapshot;
  try {
    engine.coordinator.propose('agent1',{width:7,depth:7,height:4,wall:'oak_planks',floor:'oak_planks',roof:'oak_planks',description:'test'});
    engine.coordinator.vote('agent2',1);
    await engine.reconcile();
    const task=engine.store.state.tasks.find(t=>t.kind==='supply')!;
    assert.equal(task.status,'todo');
    assert.throws(()=>engine.coordinator.claim('agent1','floor-0',1),/dependencies/);
    engine.coordinator.delegate('agent1',task.id,'agent3');
    assert.throws(()=>engine.coordinator.claim('agent2',task.id,1),/delegated/);
    engine.coordinator.claim('agent3',task.id,1);
    task.supplies=[{name:'oak_planks',count:4}];
    task.pendingDelivery={agent:'agent3',name:'oak_planks',count:4,beforeStock:0,beforeInventory:10};
    snapshot={...snapshot,storage:{oak_planks:4},players:[{name:'agent3',x:0,y:64,z:7,mode:'SURVIVAL',inventory:{oak_planks:6}}]};
    await engine.reconcile();
    assert.equal(task.delivered,4);assert.equal(task.status,'done');assert.equal(task.pendingDelivery,undefined);
  } finally {engine.store.db.close();rmSync(directory,{recursive:true,force:true});}
});


test('finite biome resources reject log-heavy plans before harvesting begins', async () => {
  const {validateResources,designSchema}=await import('../src/core/blueprint.js');
  const resources={oak_log:90,coal_ore:48};
  const design=designSchema.parse({width:7,depth:7,height:4,wall:'oak_planks',floor:'oak_planks',roof:'oak_planks',description:'compact cabin'});
  assert.doesNotThrow(()=>validateResources(design,resources));
  assert.throws(()=>validateResources({...design,width:11,depth:11,wall:'oak_log',floor:'oak_log',roof:'oak_log'},resources),/cannot supply/);
});

test('distinct duty delegations count as progress in the live decision loop', async () => {
  const directory=mkdtempSync(join(tmpdir(),'arena-delegation-'));
  const previous=process.env.RUNS_DIR;process.env.RUNS_DIR=directory;
  const engine=new Engine();if(previous===undefined)delete process.env.RUNS_DIR;else process.env.RUNS_DIR=previous;
  try {
    engine.coordinator.propose('agent1',{width:7,depth:7,height:4,wall:'oak_planks',floor:'oak_planks',roof:'oak_planks',description:'test'});
    engine.coordinator.vote('agent2',1);
    engine.store.state.status='running';engine.store.state.checklist={finished:false};
    engine.store.state.agents.agent1.connected=true;engine.world.paused=false;
    engine.world.bot=()=>({chat:()=>{}} as unknown as ReturnType<typeof engine.world.bot>);
    engine.world.command=async()=>({});
    const duties=engine.store.state.tasks.filter(t=>t.kind==='supply').slice(0,6);
    let calls=0;
    engine.router.decide=async()=>{
      if(calls===duties.length){engine.store.pause('test complete');return {id:'end',type:'function',function:{name:'observe',arguments:'{}'}};}
      const task=duties[calls++];
      return {id:task.id,type:'function',function:{name:'delegate_task',arguments:JSON.stringify({id:task.id,agent:'agent2',reason:'Divide the preparation work'})}};
    };
    await engine.loop('agent1');
    assert.equal(calls,6);
    assert.equal(engine.store.state.reason,'test complete');
    assert.ok(duties.every(t=>t.assignee==='agent2'));
    assert.throws(()=>engine.coordinator.delegate('agent1',duties[0].id,'agent2'),/already delegated/);
    engine.coordinator.claim('agent2',duties[0].id,1);
    assert.ok(engine.coordinator.available('agent3').some(t=>t.id===duties[1].id));
    engine.coordinator.claim('agent3',duties[1].id,1);
    assert.equal(duties[1].owner,'agent3');
    assert.throws(()=>engine.coordinator.claim('agent1',duties[0].id,1),/unavailable/);
  } finally {engine.store.db.close();rmSync(directory,{recursive:true,force:true});}
});
