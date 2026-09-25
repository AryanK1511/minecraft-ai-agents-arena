import { key } from './blueprint.js';
import type { Blueprint, Snapshot, Task } from './types.js';
export function inspect(snapshot: Snapshot, blueprint: Blueprint | undefined, tasks: Task[]) {
  const checks: Record<string, boolean> = { approvedBlueprint: !!blueprint?.approved, floor: false, enclosingWalls: false, accessibleDoor: false, windows: false, completeRoof: false, lighting: false, threeBeds: false, craftingTable: false, chest: false, reachableInterior: false, scaffoldCleanup: false };
  if (!blueprint?.approved) return checks;
  const blocks = new Map(snapshot.blocks.map(([x, y, z, state]) => [`${x},${y},${z}`, state]));
  const name = (x: number, y: number, z: number) => (blocks.get(`${x},${y},${z}`) ?? 'minecraft:air').split('[')[0].replace('minecraft:', '');
  const matches = (task: Task) => task.blocks.every(p => {
    const actual = blocks.get(key(p));
    return actual?.split('[')[0] === `minecraft:${p.name}` && (!p.facing || actual.includes(`facing=${p.facing}`));
  });
  const group = (prefix: string) => { const selected = tasks.filter(t => t.id.startsWith(prefix)); return selected.length > 0 && selected.every(matches); };
  checks.floor = group('floor-'); checks.enclosingWalls = group('wall-'); checks.windows = checks.enclosingWalls && [...blocks.values()].filter(s => s.startsWith('minecraft:glass')).length >= 4;
  checks.completeRoof = group('roof-'); checks.lighting = group('lighting'); checks.craftingTable = group('furniture') && [...blocks.values()].some(s => s.startsWith('minecraft:crafting_table')); checks.chest = group('furniture') && [...blocks.values()].some(s => s.startsWith('minecraft:chest['));
  const beds = tasks.find(t=>t.id==='beds')?.blocks ?? [];
  checks.threeBeds = beds.length === 3 && group('beds') && beds.every(p => {
    const direction = { north: [0,-1], south: [0,1], east: [1,0], west: [-1,0] }[p.facing ?? 'south'];
    const head = blocks.get(`${p.x+direction[0]},${p.y},${p.z+direction[1]}`) ?? '';
    return head.startsWith(`minecraft:${p.name}[`) && head.includes('part=head') && head.includes(`facing=${p.facing}`);
  });
  const door = tasks.find(t => t.id === 'door')?.blocks[0];
  if (door) {
    const lower = blocks.get(key(door)) ?? '', upper = blocks.get(`${door.x},${door.y + 1},${door.z}`) ?? '';
    const outside = { north: [0,1], south: [0,-1], east: [-1,0], west: [1,0] }[door.facing ?? 'north'];
    checks.accessibleDoor = lower.startsWith('minecraft:oak_door[') && lower.includes('half=lower') && upper.startsWith('minecraft:oak_door[') && upper.includes('half=upper') && name(door.x, 64, door.z) !== 'air' && name(door.x + outside[0], 65, door.z + outside[1]) === 'air';
    const passable = (x: number, z: number) => ['air', 'oak_door', 'torch'].includes(name(x, 65, z)) && ['air', 'oak_door', 'wall_torch'].includes(name(x, 66, z)) && name(x, 64, z) !== 'air';
    const queue = [[door.x, door.z]], visited = new Set<string>();
    while (queue.length) {
      const [x, z] = queue.shift()!; const k = `${x},${z}`;
      if (visited.has(k) || Math.abs(x) > 6 || Math.abs(z) > 6 || !passable(x, z)) continue;
      visited.add(k); queue.push([x+1,z],[x-1,z],[x,z+1],[x,z-1]);
    }
    const amenities = tasks.filter(t => ['beds','furniture'].includes(t.id)).flatMap(t => t.blocks);
    checks.reachableInterior = visited.size >= 6 && amenities.every(p => [[p.x+1,p.z],[p.x-1,p.z],[p.x,p.z+1],[p.x,p.z-1]].some(([x,z]) => visited.has(`${x},${z}`)));
  }
  checks.scaffoldCleanup = ![...blocks.values()].some(s => s.startsWith('minecraft:dirt') || s.startsWith('minecraft:scaffolding'));
  return checks;
}
