import assert from 'node:assert/strict';
import {World} from '/app/dist/src/minecraft/world.js';
const world=new World('minecraft','local-compatibility-only',()=>{});
world.onActivity=(id,action,detail)=>console.log(JSON.stringify({at:new Date().toISOString(),id,action,...detail}));
try {
 await world.connect();await world.command('resume');world.paused=false;
 console.log('INITIAL',JSON.stringify(world.inventory('agent3')));
 await world.act('agent3',()=>world.resources.acquire('agent3','white_bed',1));
 assert.equal(world.inventory('agent3').white_bed,1);
 console.log('BED PASS',JSON.stringify(await world.snapshot()));
}finally{world.stop();await world.drain();await world.command('pause');for(const bot of world.bots.values())bot.quit();setTimeout(()=>process.exit(),1000)}
