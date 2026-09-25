import { z } from 'zod';
import type { Design, Placement, Task } from './types.js';
const solid = z.enum(['oak_planks', 'oak_log', 'cobblestone', 'stone_bricks']);
export const designSchema = z.object({ width: z.number().int().min(7).max(11), depth: z.number().int().min(7).max(11), height: z.number().int().min(4).max(5), wall: solid, floor: solid, roof: solid, description: z.string().min(1).max(500), doorSide: z.enum(['north','south','east','west']).default('south'), bedSpacing: z.number().int().min(1).max(2).default(2) }).strict();
export function plan(design: Design): Task[] {
  const tasks: Task[] = [];
  const x0 = -Math.floor(design.width / 2), z0 = -Math.floor(design.depth / 2);
  const x1 = x0 + design.width - 1, z1 = z0 + design.depth - 1, top = 64 + design.height;
  const add = (id: string, blocks: Placement[], dependencies: string[]) => tasks.push({ id, label: id, blocks, dependencies, status: 'todo', failures: 0 });
  const floorIds: string[] = [];
  for (let z = z0; z <= z1; z++) { const id = `floor-${z}`; floorIds.push(id); add(id, Array.from({ length: design.width }, (_, i) => ({ x: x0 + i, y: 64, z, name: design.floor })), []); }
  const wallIds: string[] = [];
  for (let y = 65; y < top; y++) for (const side of ['north', 'south', 'west', 'east']) {
    const id = `wall-${side}-${y}`, blocks: Placement[] = [];
    const horizontal = side === 'north' || side === 'south';
    for (let n = horizontal ? x0 : z0 + 1; n <= (horizontal ? x1 : z1 - 1); n++) {
      const x = horizontal ? n : side === 'west' ? x0 : x1;
      const z = horizontal ? (side === 'north' ? z0 : z1) : n;
      if (side === 'south' && x === 0 && y <= 66) continue;
      const window = y === 66 && (horizontal ? Math.abs(x) === 2 : Math.abs(z) === 2);
      blocks.push({ x, y, z, name: window ? 'glass' : design.wall });
    }
    wallIds.push(id); add(id, blocks, y === 65 ? floorIds : [`wall-${side}-${y - 1}`]);
  }
  for (let z = z0; z <= z1; z++) add(`roof-${z}`, Array.from({ length: design.width }, (_, i) => ({ x: x0 + i, y: top, z, name: design.roof })), wallIds);
  add('door', [{ x: 0, y: 65, z: z1, name: 'oak_door', facing: 'north' }], floorIds);
  add('beds', [-(design.bedSpacing ?? 2), 0, design.bedSpacing ?? 2].map((x, i) => ({ x, y: 65, z: z0 + 2, name: ['red_bed', 'blue_bed', 'white_bed'][i], facing: 'south' })), floorIds);
  add('furniture', [{ x: x0 + 1, y: 65, z: z1 - 1, name: 'crafting_table' }, { x: x1 - 1, y: 65, z: z1 - 1, name: 'chest' }], floorIds);
  add('lighting', [{ x: x0 + 1, y: 65, z: z0 + 1, name: 'torch' }, { x: x1 - 1, y: 65, z: z0 + 1, name: 'torch' }], floorIds);
  const turns = { south: 0, west: 1, north: 2, east: 3 }[design.doorSide ?? 'south'];
  const directions = ['north','east','south','west'] as const;
  for (const task of tasks) for (const block of task.blocks) {
    for (let turn = 0; turn < turns; turn++) { const x = block.x; block.x = -block.z; block.z = x; }
    if (block.facing) block.facing = directions[(directions.indexOf(block.facing) + turns) % 4];
  }
  return tasks;
}
export const key = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;
