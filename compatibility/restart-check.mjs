import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const parse=text=>JSON.parse(text.replace(/\x1b\[[0-9;]*m/g,'').trim());
const before=parse(readFileSync('/tmp/arena-before-restart.txt','utf8'));
const baseline=JSON.parse(readFileSync('compatibility/pause-results.json','utf8'));
let state;
for(let i=0;i<50;i++) {state=await(await fetch('http://localhost:3000/api/state')).json();if(Object.values(state.agents).every(a=>a.connected))break;await new Promise(r=>setTimeout(r,500));}
assert.equal(state.status,'paused');assert.equal(state.spent,baseline.spent);assert.equal(state.id,baseline.run);assert.equal(Object.keys(state.reservations).length,0);
assert.ok(Object.values(state.agents).every(a=>a.connected));
const after=parse(execFileSync('docker',['compose','exec','-T','minecraft','rcon-cli','arena snapshot'],{encoding:'utf8'}));
assert.deepEqual(after.blocks,before.blocks);assert.equal(after.paused,true);
assert.deepEqual(Object.fromEntries(Object.entries(state.agents).map(([id,a])=>[id,a.contributions])),baseline.contributions);
const result={at:new Date().toISOString(),run:state.id,spent:state.spent,preservedBlocks:after.blocks.length,players:after.players.map(p=>({name:p.name,mode:p.mode})),result:'Restarted paused with identical world blocks, run id, cost and contributions'};
writeFileSync('compatibility/restart-results.json',JSON.stringify(result,null,2)+'\n');console.log(result);
