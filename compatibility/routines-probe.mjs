import assert from 'node:assert/strict';
import { World } from '../dist/src/minecraft/world.js';
const world = new World('minecraft', 'local-compatibility-only', () => {});
const timer = setTimeout(() => { console.error('Routine fixture deadline'); process.exit(1); }, 180000);
try {
  await world.command('reset'); await world.connect();
  world.paused = false; await world.command('resume');
  const blocks = [
    {x:0,y:64,z:0,name:'oak_planks'},
    {x:0,y:65,z:0,name:'oak_planks'},
    {x:0,y:66,z:0,name:'oak_planks'},
    {x:0,y:67,z:0,name:'oak_planks'},
    {x:2,y:64,z:0,name:'oak_door',facing:'north'},
    {x:-2,y:64,z:0,name:'red_bed',facing:'north'}
  ];
  console.log('initial-inventory',world.inventory('agent1'));
  for (const [name,count] of [['dirt',32],['oak_planks',4],['oak_door',1],['red_bed',1]]) { console.log('withdrawing',name,count,world.inventory('agent1')); await world.transfer('agent1',name,count); console.log('withdrawn',world.inventory('agent1'), 'server',(await world.snapshot()).players.find(p=>p.name==='agent1')); }
  for (const p of blocks) { console.log('placing',p); await world.place('agent1',p); console.log('placed; position',world.bot('agent1').entity.position); }
  const snapshot = await world.snapshot();
  for (const p of blocks) assert.ok(snapshot.blocks.some(([x,y,z,s])=>x===p.x&&y===p.y&&z===p.z&&s.startsWith(`minecraft:${p.name}`)));
  console.log('ROUTINE FIXTURE PASS',JSON.stringify(snapshot));
} finally {
  world.stop(); await world.command('pause'); for (const bot of world.bots.values()) bot.quit(); clearTimeout(timer);
}
