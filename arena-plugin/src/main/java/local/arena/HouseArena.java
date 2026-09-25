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
import org.bukkit.generator.WorldInfo;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;
import java.util.*;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPOutputStream;

public final class HouseArena extends JavaPlugin implements Listener {
    private static final Set<String> AGENTS = Set.of("agent1", "agent2", "agent3");
    private static final String VIEWER = "aryank1511";
    private static final Gson JSON = new Gson();
    private World arena;
    private boolean paused = true;
    private boolean resetting;
    private long revision;
    private final Map<String, String> snapshotExports = new LinkedHashMap<>();
    private static final Set<Material> MATERIALS = Set.of(
        Material.OAK_PLANKS, Material.OAK_LOG, Material.COBBLESTONE, Material.STONE_BRICKS,
        Material.OAK_STAIRS, Material.OAK_SLAB, Material.GLASS, Material.GLASS_PANE,
        Material.OAK_DOOR, Material.TORCH, Material.WALL_TORCH, Material.LANTERN,
        Material.RED_BED, Material.BLUE_BED, Material.WHITE_BED, Material.CRAFTING_TABLE,
        Material.CHEST, Material.DIRT, Material.SCAFFOLDING, Material.LADDER, Material.FURNACE, Material.OAK_SAPLING);

    @Override public void onEnable() {
        arena = new WorldCreator("biome").generator(new OceanGenerator()).generateStructures(false).createWorld();
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
        if (getConfig().getInt("biomeVersion", 0) != 1) reset();
        getServer().getScheduler().runTaskTimer(this, () -> {
            arena.setTime(6000);
            arena.setStorm(false);
            arena.setThundering(false);
            for (Player player : arena.getPlayers()) {
                if (AGENTS.contains(player.getName()) && (player.getY() < 59 || Math.abs(player.getX()) > 16 || Math.abs(player.getZ()) > 16)) spawn(player);
            }
        }, 20, 20);
        for (Player player : getServer().getOnlinePlayers()) placePlayer(player);
    }

    private boolean buildable(Block block) {
        return block.getWorld().equals(arena) && Math.abs(block.getX()) <= 6 && Math.abs(block.getZ()) <= 6 && block.getY() >= 64 && block.getY() <= 71;
    }
    private boolean builder(Player player) { return AGENTS.contains(player.getName()); }
    private boolean workshop(Block block) {
        return block.getWorld().equals(arena) && Math.abs(block.getX()) <= 7 && block.getZ() >= 8 && block.getZ() <= 12 && block.getY() >= 64 && block.getY() <= 66;
    }
    private boolean harvestable(Block block) {
        if (!block.getWorld().equals(arena) || Math.abs(block.getX()) > 14 || Math.abs(block.getZ()) > 14 || block.getY() < 60 || block.getY() > 74) return false;
        if (Math.abs(block.getX()) <= 6 && Math.abs(block.getZ()) <= 6 && block.getY() < 64) return false;
        return Set.of(Material.OAK_LOG, Material.OAK_LEAVES, Material.STONE, Material.COAL_ORE, Material.IRON_ORE, Material.SAND, Material.DIRT, Material.GRASS_BLOCK, Material.SHORT_GRASS, Material.DANDELION, Material.POPPY, Material.CORNFLOWER).contains(block.getType());
    }
    private boolean allowed(Player player, Block block) { return !paused && builder(player) && (buildable(block) || workshop(block)); }
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
            for (int y = 59; y <= 80; y++) {
                Block old = arena.getBlockAt(x, y, z);
                if (old.getState() instanceof org.bukkit.inventory.InventoryHolder holder) holder.getInventory().clear();
                old.setType(Material.AIR, false);
            }
            arena.setBiome(x, 64, z, Biome.PLAINS);
            arena.getBlockAt(x, 59, z).setType(Material.BEDROCK, false);
            for (int y = 60; y <= 61; y++) arena.getBlockAt(x, y, z).setType(Material.STONE, false);
            arena.getBlockAt(x, 62, z).setType(Material.DIRT, false);
            arena.getBlockAt(x, 63, z).setType(Material.GRASS_BLOCK, false);
            double coast = Math.hypot(x / 19.0, z / 18.0);
            boolean pasture = x >= -14 && x <= -8 && z >= 9 && z <= 14;
            if (coast > 1.0 && !pasture) {
                arena.getBlockAt(x, 61, z).setType(Material.SAND, false);
                arena.getBlockAt(x, 62, z).setType(Material.WATER, false);
                arena.getBlockAt(x, 63, z).setType(Material.AIR, false);
            } else if (coast > 0.92) arena.getBlockAt(x,63,z).setType(Material.SAND,false);
            if (x == -16 || x == 15 || z == -16 || z == 15) {
                for (int y = 60; y <= 80; y++) arena.getBlockAt(x, y, z).setType(Material.BARRIER, false);
            }
        }
        // A sandy pond, a low exposed mineral ridge, a meadow and an oak grove.
        for (int x = -14; x <= -8; x++) for (int z = -13; z <= -7; z++) {
            double distance = Math.hypot(x + 11, z + 10);
            if (distance < 3.7) {
                arena.getBlockAt(x, 62, z).setType(Material.SAND, false);
                arena.getBlockAt(x, 63, z).setType(distance < 2.5 ? Material.WATER : Material.SAND, false);
            }
        }
        for (int x = 8; x <= 13; x++) for (int z = -6; z <= 5; z++) {
            int height = 1 + ((x + z + 20) % 3);
            for (int y = 63; y <= 63 + height; y++) {
                Material material = (x * 13 + z * 7 + y + 1000) % 7 == 0 ? Material.IRON_ORE :
                    (x * 5 + z * 11 + y + 1000) % 4 == 0 ? Material.COAL_ORE : Material.STONE;
                arena.getBlockAt(x, y, z).setType(material, false);
            }
        }
        for(int x=-13;x<=-8;x++)for(int z=-1;z<=5;z++) {
            if(Math.hypot(x+10.5,z-2)<2.8) {
                arena.getBlockAt(x,63,z).setType(Material.DIRT,false);
                arena.getBlockAt(x,64,z).setType(Material.GRASS_BLOCK,false);
            }
        }
        int[][] trees = {{-13,-3},{-9,-3},{-13,2},{-9,3},{-13,7},{-9,7},
            {-5,-12},{0,-12},{5,-12},{10,-12},{-6,-8},{-2,-8},{3,-8},{7,-9},
            {-5,14},{0,14},{5,14},{10,13}};
        for (int[] tree : trees) tree(tree[0], tree[1]);
        Random random = new Random(2603);
        for (int i = 0; i < 100; i++) {
            int x = random.nextInt(29) - 14, z = random.nextInt(29) - 14;
            if (Math.abs(x) <= 7 && z >= -7 && z <= 12) continue;
            if (arena.getBlockAt(x, 63, z).getType() == Material.GRASS_BLOCK && arena.getBlockAt(x, 64, z).getType().isAir()) {
                Material[] flowers = {Material.SHORT_GRASS, Material.DANDELION, Material.POPPY, Material.CORNFLOWER};
                arena.getBlockAt(x, 64, z).setType(flowers[random.nextInt(flowers.length)], false);
            }
        }
        for (int x = -14; x <= -8; x++) for (int z = 9; z <= 14; z++) {
            if (x == -14 || x == -8 || z == 9 || z == 14) arena.getBlockAt(x, 64, z).setType(Material.OAK_FENCE, false);
        }
        arena.getBlockAt(-8, 64, 11).setType(Material.AIR, false);
        for (int i = 0; i < 9; i++) {
            Sheep sheep = arena.spawn(new Location(arena, -12.5 + i % 3, 64, 10.5 + i / 3), Sheep.class);
            sheep.setColor(DyeColor.WHITE); sheep.setAdult(); sheep.setPersistent(true); sheep.setRemoveWhenFarAway(false);
        }
        for (Player player : arena.getPlayers()) placePlayer(player);
        getConfig().set("initialized", true);
        getConfig().set("biomeVersion", 1);
        saveConfig();
        revision++;
        resetting = false;
        arena.save();
    }
    private void tree(int x, int z) {
        int base = arena.getHighestBlockYAt(x,z) + 1;
        for (int y = base + 3; y <= base + 6; y++) for (int dx = -2; dx <= 2; dx++) for (int dz = -2; dz <= 2; dz++) {
            if (x + dx < -14 || x + dx > 14 || z + dz < -14 || z + dz > 14 || Math.abs(dx) + Math.abs(dz) > (y == base + 6 ? 2 : 3)) continue;
            if (Math.abs(x + dx) <= 6 && Math.abs(z + dz) <= 6) continue;
            Block leaf = arena.getBlockAt(x + dx, y, z + dz);
            leaf.setType(Material.OAK_LEAVES, false);
            org.bukkit.block.data.type.Leaves data = (org.bukkit.block.data.type.Leaves) leaf.getBlockData();
            data.setPersistent(false); data.setDistance(2); leaf.setBlockData(data, false);
        }
        for (int y = base; y < base + 5; y++) arena.getBlockAt(x, y, z).setType(Material.OAK_LOG, false);
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
                case "snapshot" -> {
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    try (GZIPOutputStream gzip = new GZIPOutputStream(bytes)) { gzip.write(JSON.toJson(snapshot()).getBytes(StandardCharsets.UTF_8)); }
                    String payload = Base64.getEncoder().encodeToString(bytes.toByteArray());
                    String token = UUID.randomUUID().toString();
                    if (snapshotExports.size() >= 4) snapshotExports.remove(snapshotExports.keySet().iterator().next());
                    snapshotExports.put(token, payload);
                    sender.sendMessage(JSON.toJson(Map.of("encoding", "gzip-base64", "token", token, "parts", (payload.length()+2999)/3000, "data", payload.substring(0, Math.min(3000,payload.length())))));
                    return true;
                }
                case "snapshot-part" -> {
                    if(args.length != 3 || !snapshotExports.containsKey(args[1])) throw new IllegalArgumentException("Snapshot export expired");
                    String payload = snapshotExports.get(args[1]);
                    int offset = Integer.parseInt(args[2])*3000;
                    if(offset < 0 || offset >= payload.length()) throw new IllegalArgumentException("Invalid snapshot part");
                    sender.sendMessage(JSON.toJson(Map.of("data",payload.substring(offset, Math.min(offset+3000,payload.length())))));
                    return true;
                }
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
        Map<String, Integer> resources = new TreeMap<>();
        List<Object> workstations = new ArrayList<>();
        for (int x = -14; x <= 14; x++) for (int z = -14; z <= 14; z++) for (int y = 60; y <= 74; y++) {
            Block b = arena.getBlockAt(x, y, z);
            if (Set.of(Material.OAK_LOG, Material.COAL_ORE, Material.IRON_ORE, Material.SAND).contains(b.getType())) resources.merge(b.getType().getKey().getKey(), 1, Integer::sum);
            if (Set.of(Material.CRAFTING_TABLE, Material.FURNACE, Material.CHEST).contains(b.getType())) workstations.add(List.of(x,y,z,b.getType().getKey().getKey()));
        }
        Map<String, Integer> storage = new TreeMap<>();
        Block teamChest = arena.getBlockAt(0,64,8);
        if (teamChest.getState() instanceof Chest chest) for (ItemStack item : chest.getBlockInventory().getContents()) if (item != null) storage.merge(item.getType().getKey().getKey(),item.getAmount(),Integer::sum);
        long sheep = arena.getEntities().stream().filter(e -> e instanceof Sheep).count();
        return Map.of("revision", revision, "paused", paused, "blocks", blocks, "players", players, "environment", "natural-biome-v1", "resources", resources, "storage", storage, "workstations", workstations, "sheep", sheep);
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
        if (!allowed(event.getPlayer(), event.getBlock()) && !(!paused && builder(event.getPlayer()) && harvestable(event.getBlock()))) event.setCancelled(true); else revision++;
    }
    @EventHandler public void dropDuringReset(ItemSpawnEvent event) { if (resetting && event.getLocation().getWorld().equals(arena)) event.setCancelled(true); }
    @EventHandler public void damage(EntityDamageEvent event) { if (event.getEntity().getWorld().equals(arena)) event.setCancelled(true); }
    @EventHandler public void mob(CreatureSpawnEvent event) { if (event.getLocation().getWorld().equals(arena) && !(resetting && event.getEntity() instanceof Sheep)) event.setCancelled(true); }
    @EventHandler public void ignite(BlockIgniteEvent event) { if (event.getBlock().getWorld().equals(arena)) event.setCancelled(true); }
    @EventHandler public void explode(EntityExplodeEvent event) { if (event.getLocation().getWorld().equals(arena)) event.setCancelled(true); }
    @EventHandler public void bucket(PlayerBucketEmptyEvent event) { if (event.getPlayer().getWorld().equals(arena)) event.setCancelled(true); }
    @EventHandler public void interact(PlayerInteractEvent event) {
        if (!event.getPlayer().getWorld().equals(arena) || !builder(event.getPlayer())) return;
        if (paused) event.setCancelled(true);
    }
    public static final class OceanGenerator extends ChunkGenerator {
        @Override public void generateNoise(WorldInfo info, Random random, int chunkX, int chunkZ, ChunkData data) {
            data.setRegion(0, 58, 0, 16, 59, 16, Material.BEDROCK);
            data.setRegion(0, 59, 0, 16, 60, 16, Material.SAND);
            data.setRegion(0, 60, 0, 16, 63, 16, Material.WATER);
        }
        @Override public boolean shouldGenerateNoise() { return true; }
        @Override public boolean shouldGenerateSurface() { return false; }
        @Override public boolean shouldGenerateBedrock() { return false; }
        @Override public boolean shouldGenerateCaves() { return false; }
        @Override public boolean shouldGenerateDecorations() { return false; }
        @Override public boolean shouldGenerateMobs() { return false; }
        @Override public boolean shouldGenerateStructures() { return false; }
    }
}
