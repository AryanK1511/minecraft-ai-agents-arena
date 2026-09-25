import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/minecraft/world.js';
import { IDS } from '../src/core/types.js';
test('three players work simultaneously while each player has only one physical action', async () => {
  const world=new World('unused','unused',()=>{});world.paused=false;
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const started:string[]=[];
  const actions=IDS.map(id=>world.act(id,async()=>{started.push(id);await gate;}));
  let extra=false;
  const queued=world.act('agent1',async()=>{extra=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(new Set(started),new Set(IDS));
  assert.equal(extra,false);
  release();await Promise.all(actions);await queued;await world.drain();
  assert.equal(extra,true);
});
