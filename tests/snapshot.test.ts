import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readSnapshot } from '../src/minecraft/snapshot.js';

test('large world observations survive bounded RCON replies without truncation', async () => {
  const snapshot = { revision: 42, paused: true, players: [], blocks: Array.from({length: 1300}, (_,i)=>[i%13,64+Math.floor(i/169),Math.floor(i/13)%13,`minecraft:oak_planks[axis=${i}]`]) };
  const payload = gzipSync(JSON.stringify(snapshot)).toString('base64');
  assert.ok(payload.length > 3000);
  const result = await readSnapshot({encoding:'gzip-base64',token:'abc-123',parts:Math.ceil(payload.length/3000),data:payload.slice(0,3000)}, async command => {
    const part = Number(command.split(' ').at(-1));
    const reply = JSON.stringify({data:payload.slice(part*3000,(part+1)*3000)});
    assert.ok(reply.length<4096);
    return reply;
  });
  assert.deepEqual(result,snapshot);
});
