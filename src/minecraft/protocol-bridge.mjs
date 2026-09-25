/**
 * Mineflayer 4.39.0 does not emit the 26.1 client tick-end packet.
 * Paper 26.3 rejects successive movement packets without intervening tick ends.
 * Close each movement update, including teleport acknowledgements, as a tick.
 * Keep this adapter paired with the pinned dependencies and compatibility probe.
 */
export function installProtocolBridge(bot) {
  const client = bot._client;
  const write = client.write.bind(client);
  const movementPackets = new Set(['position', 'position_look', 'look', 'flying']);
  client.write = (name, packet) => {
    const result = write(name, packet);
    if (movementPackets.has(name)) write('tick_end', {});
    return result;
  };
}
