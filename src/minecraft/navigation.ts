import pathfinding from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

/** Measure reach from the player's eyes, including blocks above their head. */
export class ReachBlockGoal extends pathfinding.goals.GoalLookAtBlock {
  override isEnd(node: { x: number; y: number; z: number }) {
    const eye = new Vec3(node.x + 0.5, node.y + this.entityHeight, node.z + 0.5);
    for (const [x, y, z] of [[0, 0.5, 0.5], [1, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [0.5, 0.5, 0], [0.5, 0.5, 1]]) {
      const delta = this.pos.offset(x, y, z).minus(eye);
      const distance = delta.norm();
      if (distance === 0 || distance > this.reach) continue;
      const hit = this.world.raycast(eye, delta.scaled(1 / distance), distance + 0.01);
      if (hit?.position.equals(this.pos)) return true;
    }
    return false;
  }
}
