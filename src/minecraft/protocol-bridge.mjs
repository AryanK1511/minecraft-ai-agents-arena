/**
 * Mineflayer 4.39.0 does not emit the 26.1 client tick-end packet.
 * Paper 26.3 rejects successive movement packets without intervening tick ends.
 * Close the preceding movement tick before each physics update, including idle
 * ticks. ViaBackwards consumes teleport followups as acknowledgements.
 * Keep this adapter paired with the pinned dependencies and compatibility probe.
 */
export function installProtocolBridge(bot) {
  const client = bot._client;
  const write = client.write.bind(client);
  const movementPackets = new Set(['position', 'position_look', 'look', 'flying']);
  client.write = (name, packet) => {
    if (movementPackets.has(name) && packet.flags) packet.flags.hasHorizontalCollision = !!bot.entity?.isCollidedHorizontally;
    return write(name, packet);
  };
  bot.on('physicsTick', () => write('tick_end', {}));
}
