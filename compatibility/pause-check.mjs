import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
const db = new DatabaseSync('shared/runs/arena.sqlite', {readOnly:true});
let state;
for (let attempt=0;attempt<40;attempt++) {
 state=await (await fetch('http://localhost:3000/api/state')).json();
 if(state.status==='paused'&&Object.keys(state.reservations).length===0)break;
 await new Promise(resolve=>setTimeout(resolve,500));
}
assert.equal(state.status,'paused');assert.equal(Object.keys(state.reservations).length,0);
const before = db.prepare("SELECT max(seq) AS seq FROM events WHERE kind='reserve'").get().seq;
const spent = state.spent;
await new Promise(resolve=>setTimeout(resolve,3000));
const after = db.prepare("SELECT max(seq) AS seq FROM events WHERE kind='reserve'").get().seq;
const second=await (await fetch('http://localhost:3000/api/state')).json();
assert.equal(before,after);assert.equal(second.spent,spent);assert.equal(second.status,'paused');
const result={at:new Date().toISOString(),run:state.id,spent,modelReservationSequence:after,completedTasks:second.tasks.filter(t=>t.status==='done').map(t=>t.id),contributions:Object.fromEntries(Object.entries(second.agents).map(([id,a])=>[id,a.contributions])),result:'No new model reservations or spending while paused'};
writeFileSync('compatibility/pause-results.json',JSON.stringify(result,null,2)+'\n');console.log(result);db.close();
