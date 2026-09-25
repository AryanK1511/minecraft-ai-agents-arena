# Set up and start Minecraft and the dashboard together.
arena:
    @sh scripts/start-arena.sh

# Stop the agents first, then Minecraft, preserving saved progress.
stop:
    @docker compose stop app
    @docker compose stop minecraft
