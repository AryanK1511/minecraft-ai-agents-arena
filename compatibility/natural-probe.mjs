// Resets the natural biome. Run with the app stopped, before starting a paid run.
import assert from 'node:assert/strict';
import {World} from '/app/dist/src/minecraft/world.js';
const world=new World('minecraft','local-compatibility-only',()=>{});
world.onActivity=(id,action,detail)=>console.log(JSON.stringify({at:new Date().toISOString(),id,action,...detail}));
try {
 const reset=process.env.RESET_FIXTURE!=='false';
 if(reset)await world.command('reset'); await world.connect();
 if(reset)for(const id of ['agent1','agent2','agent3'])assert.deepEqual(world.inventory(id),{});
 assert.equal((await world.snapshot()).environment,'natural-biome-v1');
 await world.command('resume');world.paused=false;
 const start=Date.now();
 const results=await Promise.allSettled([
   world.act('agent1',()=>world.resources.acquire('agent1','oak_planks',16)),
   world.act('agent2',()=>world.resources.acquire('agent2','cobblestone',4)),
   world.act('agent3',()=>world.resources.acquire('agent3','glass',2))
 ]);
 console.log('CONCURRENT RESULTS',results.map(r=>r.status==='fulfilled'?'pass':String(r.reason)));
 console.log('INVENTORIES',JSON.stringify(Object.fromEntries(['agent1','agent2','agent3'].map(id=>[id,world.inventory(id)]))));
 for(const r of results)if(r.status==='rejected')throw r.reason;
 await world.act('agent3',()=>world.resources.acquire('agent3','white_wool',1));
 console.log('NATURAL SURVIVAL PASS',JSON.stringify({elapsedSeconds:(Date.now()-start)/1000,snapshot:await world.snapshot()}));
}finally{world.stop();await world.drain();await world.command('pause');for(const bot of world.bots.values())bot.quit();setTimeout(()=>process.exit(),1000)}
