// Continues natural-probe's gathered inventory; does not reset or spawn items.
import assert from 'node:assert/strict';
import {World} from '/app/dist/src/minecraft/world.js';
const world=new World('minecraft','local-compatibility-only',()=>{});
world.onActivity=(id,action,detail)=>console.log(JSON.stringify({at:new Date().toISOString(),id,action,...detail}));
try {
 await world.connect();await world.command('resume');world.paused=false;
 console.log('INITIAL',JSON.stringify(Object.fromEntries([...world.bots].map(([id])=>[id,world.inventory(id)]))));
 await world.act('agent1',()=>world.resources.ensureStorage('agent1'));
 await world.act('agent1',()=>world.resources.acquire('agent1','oak_planks',4));
 const receipts=[];
 await Promise.all([['agent1','oak_planks',4],['agent2','cobblestone',4],['agent3','glass',2]].map(([id,name,count])=>world.act(id,()=>world.resources.transfer(id,name,count,true,{before:(stock,inventory)=>receipts.push({id,name,count,stock,inventory}),after:()=>{}}))));
 await world.act('agent3',()=>world.resources.transfer('agent3','glass',1));
 assert.equal(world.inventory('agent3').glass,1);
 await world.act('agent3',()=>world.resources.acquire('agent3','white_bed',1));
 assert.equal(world.inventory('agent3').white_bed,1);
 console.log('STORAGE PASS',JSON.stringify({receipts,snapshot:await world.snapshot()}));
}finally{world.stop();await world.drain();await world.command('pause');for(const bot of world.bots.values())bot.quit();setTimeout(()=>process.exit(),1000)}
