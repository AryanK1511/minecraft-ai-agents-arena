package local.arena;

import com.google.gson.Gson;
import org.bukkit.*;
import org.bukkit.block.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.player.*;
import org.bukkit.generator.ChunkGenerator;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;
import java.util.*;

public final class HouseArena extends JavaPlugin implements Listener {
    private static final Set<String> AGENTS = Set.of("agent1", "agent2", "agent3");
    private static final String VIEWER = "aryank1511";
    private static final Gson JSON = new Gson();
    private World arena;
    private boolean paused = true;
    private boolean resetting;
    private long revision;
    private static final Set<Material> MATERIALS = Set.of(
        Material.OAK_PLANKS, Material.OAK_LOG, Material.COBBLESTONE, Material.STONE_BRICKS,
        Material.OAK_STAIRS, Material.OAK_SLAB, Material.GLASS, Material.GLASS_PANE,
        Material.OAK_DOOR, Material.TORCH, Material.WALL_TORCH, Material.LANTERN,
        Material.RED_BED, Material.BLUE_BED, Material.WHITE_BED, Material.CRAFTING_TABLE,
        Material.CHEST, Material.DIRT, Material.SCAFFOLDING, Material.LADDER);

    @Override public void onEnable() {
        arena = new WorldCreator("arena").generator(new VoidGenerator()).generateStructures(false).createWorld();
        if (arena == null) throw new IllegalStateException("Cannot create arena world");
        for (int cx = -1; cx <= 0; cx++) for (int cz = -1; cz <= 0; cz++) arena.getChunkAt(cx, cz).setForceLoaded(true);
        arena.setDifficulty(Difficulty.PEACEFUL);
        arena.setPVP(false);
        arena.setTime(6000);
        arena.setStorm(false);
        arena.setThundering(false);
        arena.setSpawnLocation(0, 64, 11);
        arena.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, false);
        arena.setGameRule(GameRule.DO_WEATHER_CYCLE, false);
        arena.setGameRule(GameRule.DO_MOB_SPAWNING, false);
        arena.setGameRule(GameRule.DO_FIRE_TICK, false);
        arena.setGameRule(GameRule.KEEP_INVENTORY, true);
        arena.setGameRule(GameRule.SPAWN_RADIUS, 0);
        arena.getWorldBorder().setCenter(0, 0);
        arena.getWorldBorder().setSize(128); // Includes the elevated spectator viewpoint.
        getServer().getPluginManager().registerEvents(this, this);
        if (!getConfig().getBoolean("initialized", false)) reset();
        getServer().getScheduler().runTaskTimer(this, () -> {
            arena.setTime(6000);
            arena.setStorm(false);
            arena.setThundering(false);
            for (Player player : arena.getPlayers()) {
                if (AGENTS.contains(player.getName()) && (player.getY() < 60 || Math.abs(player.getX()) > 16 || Math.abs(player.getZ()) > 16)) spawn(player);
            }
        }, 20, 20);
        for (Player player : getServer().getOnlinePlayers()) placePlayer(player);
    }

    private boolean buildable(Block block) {
        return block.getWorld().equals(arena) && Math.abs(block.getX()) <= 6 && Math.abs(block.getZ()) <= 6 && block.getY() >= 64 && block.getY() <= 71;
    }
    private boolean builder(Player player) { return AGENTS.contains(player.getName()); }
    private boolean allowed(Player player, Block block) { return !paused && builder(player) && buildable(block); }
    private void spawn(Player player) {
        int index = Integer.parseInt(player.getName().substring(5));
        player.teleport(new Location(arena, -4.5 + index * 3, 64, 11.5, 180, 0));
    }
    private void overview(Player player) { player.teleport(new Location(arena, 30, 94, 38, 141.7f, 33.5f)); }
    private void placePlayer(Player player) {
        if (VIEWER.equals(player.getName())) {
            player.setGameMode(GameMode.SPECTATOR);
            overview(player);
        } else if (builder(player)) {
            player.setGameMode(GameMode.SURVIVAL);
            if (getConfig().getLong("players." + player.getName(), -1) != getConfig().getLong("resetEpoch")) {
                starter(player);
                getConfig().set("players." + player.getName(), getConfig().getLong("resetEpoch"));
                saveConfig();
            } else if (!player.getWorld().equals(arena)) spawn(player);
        } else player.kickPlayer("This local arena is reserved for its four whitelisted players.");
    }
    private void starter(Player player) {
        player.getInventory().clear();
        player.getInventory().addItem(new ItemStack(Material.IRON_PICKAXE), new ItemStack(Material.IRON_AXE), new ItemStack(Material.IRON_SHOVEL));
        player.setHealth(20);
        player.setFoodLevel(20);
        spawn(player);
    }
    private void reset() {
        paused = true;
        resetting = true;
        for (int cx = -1; cx <= 0; cx++) for (int cz = -1; cz <= 0; cz++) for (Entity entity : arena.getChunkAt(cx, cz).getEntities()) if (!(entity instanceof Player)) entity.remove();
        getConfig().set("resetEpoch", getConfig().getLong("resetEpoch") + 1);
        for (Entity entity : arena.getEntities()) if (!(entity instanceof Player)) entity.remove();
        for (int x = -16; x <= 15; x++) for (int z = -16; z <= 15; z++) {
            for (int y = 64; y <= 74; y++) {
                Block old = arena.getBlockAt(x, y, z);
                if (old.getState() instanceof org.bukkit.inventory.InventoryHolder holder) holder.getInventory().clear();
                old.setType(Material.AIR, false);
            }
            arena.getBlockAt(x, 63, z).setType(Material.SMOOTH_STONE, false);
            if (x == -16 || x == 15 || z == -16 || z == 15) for (int y = 64; y <= 73; y++) arena.getBlockAt(x, y, z).setType(Material.BARRIER, false);
        }
        stock(-11, -5, Map.of(Material.OAK_PLANKS, 24, Material.OAK_LOG, 8, Material.COBBLESTONE, 8, Material.STONE_BRICKS, 8));
        stock(-11, -1, Map.of(Material.OAK_STAIRS, 8, Material.OAK_SLAB, 8, Material.GLASS, 4, Material.GLASS_PANE, 4));
        stock(-11, 3, Map.of(Material.DIRT, 8, Material.SCAFFOLDING, 4, Material.LADDER, 2, Material.TORCH, 2, Material.LANTERN, 1));
        Block furniture = arena.getBlockAt(-11, 64, 7);
        furniture.setType(Material.CHEST);
        Chest chest = (Chest) furniture.getState();
        for (Material material : List.of(Material.RED_BED, Material.BLUE_BED, Material.WHITE_BED, Material.CRAFTING_TABLE, Material.CHEST, Material.OAK_DOOR)) chest.getBlockInventory().addItem(new ItemStack(material, material == Material.OAK_DOOR ? 3 : 1));
        for (Player player : arena.getPlayers()) placePlayer(player);
        getConfig().set("initialized", true);
        saveConfig();
        revision++;
        resetting = false;
        arena.save();
    }
    private void stock(int x, int z, Map<Material, Integer> stacks) {
        // Two adjacent chests provide 54 slots, accessed separately by the bot routines.
        for (int dx = 0; dx < 2; dx++) arena.getBlockAt(x + dx, 64, z).setType(Material.CHEST);
        for (int dx = 0; dx < 2; dx++) {
            Chest chest = (Chest) arena.getBlockAt(x + dx, 64, z).getState();
            for (Map.Entry<Material, Integer> entry : stacks.entrySet()) {
                int count = (entry.getValue() + (dx == 0 ? 1 : 0)) / 2;
                for (int i = 0; i < count; i++) chest.getBlockInventory().addItem(new ItemStack(entry.getKey(), 64));
            }
        }
    }
    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (sender instanceof Player) { sender.sendMessage("Console-only arena control."); return true; }
        try {
            String action = args.length == 0 ? "status" : args[0];
            switch (action) {
                case "pause" -> paused = true;
                case "resume" -> paused = false;
                case "reset" -> reset();
                case "overview" -> { Player p = getServer().getPlayerExact(VIEWER); if (p != null) overview(p); }
                case "snapshot" -> { sender.sendMessage(JSON.toJson(snapshot())); return true; }
                case "status" -> { }
                default -> throw new IllegalArgumentException("Unknown arena action");
            }
            sender.sendMessage(JSON.toJson(Map.of("ok", true, "paused", paused, "revision", revision)));
        } catch (Exception error) { sender.sendMessage(JSON.toJson(Map.of("ok", false, "error", error.toString()))); }
        return true;
    }
    private Map<String, Object> snapshot() {
        List<Object> blocks = new ArrayList<>();
        for (int x = -6; x <= 6; x++) for (int z = -6; z <= 6; z++) for (int y = 64; y <= 71; y++) {
            Block b = arena.getBlockAt(x, y, z);
            if (!b.getType().isAir()) blocks.add(List.of(x, y, z, b.getBlockData().getAsString()));
        }
        List<Object> players = new ArrayList<>();
        for (Player p : arena.getPlayers()) {
            Map<String, Integer> inventory = new TreeMap<>();
            for (ItemStack item : p.getInventory().getContents()) if (item != null) inventory.merge(item.getType().getKey().getKey(), item.getAmount(), Integer::sum);
            players.add(Map.of("name", p.getName(), "x", p.getX(), "y", p.getY(), "z", p.getZ(), "mode", p.getGameMode().name(), "inventory", inventory));
        }
        return Map.of("revision", revision, "paused", paused, "blocks", blocks, "players", players);
    }
    @EventHandler public void join(PlayerJoinEvent event) { placePlayer(event.getPlayer()); }
    @EventHandler public void respawn(PlayerRespawnEvent event) { event.setRespawnLocation(new Location(arena, 0.5, 64, 11.5)); }
    @EventHandler(ignoreCancelled = true) public void place(BlockPlaceEvent event) {
        if (!event.getBlock().getWorld().equals(arena)) return;
        if (!allowed(event.getPlayer(), event.getBlock()) || !MATERIALS.contains(event.getBlock().getType())) event.setCancelled(true);
        else revision++;
    }
    @EventHandler(ignoreCancelled = true) public void multi(BlockMultiPlaceEvent event) {
        if (!event.getBlock().getWorld().equals(arena)) return;
        for (BlockState state : event.getReplacedBlockStates()) if (!allowed(event.getPlayer(), state.getBlock())) event.setCancelled(true);
    }
    @EventHandler(ignoreCancelled = true) public void breakBlock(BlockBreakEvent event) {
        if (!event.getBlock().getWorld().equals(arena)) return;
        if (!allowed(event.getPlayer(), event.getBlock())) event.setCancelled(true); else revision++;
    }
    @EventHandler public void dropDuringReset(ItemSpawnEvent event) { if (resetting && event.getLocation().getWorld().equals(arena)) event.setCancelled(true); }
    @EventHandler public void damage(EntityDamageEvent event) { if (event.getEntity().getWorld().equals(arena)) event.setCancelled(true); }
    @EventHandler public void mob(CreatureSpawnEvent event) { if (event.getLocation().getWorld().equals(arena)) event.setCancelled(true); }
    @EventHandler public void ignite(BlockIgniteEvent event) { if (event.getBlock().getWorld().equals(arena)) event.setCancelled(true); }
    @EventHandler public void explode(EntityExplodeEvent event) { if (event.getLocation().getWorld().equals(arena)) event.setCancelled(true); }
    @EventHandler public void bucket(PlayerBucketEmptyEvent event) { if (event.getPlayer().getWorld().equals(arena)) event.setCancelled(true); }
    @EventHandler public void interact(PlayerInteractEvent event) {
        if (!event.getPlayer().getWorld().equals(arena) || !builder(event.getPlayer())) return;
        if (paused) event.setCancelled(true);
    }
    public static final class VoidGenerator extends ChunkGenerator {
        @Override public boolean shouldGenerateNoise() { return false; }
        @Override public boolean shouldGenerateSurface() { return false; }
        @Override public boolean shouldGenerateBedrock() { return false; }
        @Override public boolean shouldGenerateCaves() { return false; }
        @Override public boolean shouldGenerateDecorations() { return false; }
        @Override public boolean shouldGenerateMobs() { return false; }
        @Override public boolean shouldGenerateStructures() { return false; }
    }
}
