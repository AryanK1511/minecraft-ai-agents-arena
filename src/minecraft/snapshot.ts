import { gunzipSync } from 'node:zlib';
import type { Snapshot } from '../core/types.js';
export function parseReply(reply: string) { return JSON.parse(reply.replace(/\x1b\[[0-9;]*m/g, '').trim()); }
export async function readSnapshot(response: any, send: (command: string) => Promise<string>): Promise<Snapshot> {
  if (response.encoding !== 'gzip-base64') return response;
  if (!Number.isInteger(response.parts) || response.parts < 1 || response.parts > 100 || !/^[a-f0-9-]+$/.test(response.token)) throw new Error('Invalid snapshot export');
  let payload = response.data;
  for (let part = 1; part < response.parts; part++) {
    const reply = parseReply(await send(`arena snapshot-part ${response.token} ${part}`));
    if (typeof reply.data !== 'string') throw new Error('Incomplete snapshot export');
    payload += reply.data;
  }
  return JSON.parse(gunzipSync(Buffer.from(payload, 'base64'), { maxOutputLength: 2_000_000 }).toString('utf8'));
}
