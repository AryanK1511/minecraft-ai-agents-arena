# Set up and start Minecraft and the dashboard together.
arena:
    @sh scripts/start-arena.sh

# Stop the agents first, then Minecraft, preserving saved progress.
stop:
    @docker compose stop app
    @docker compose stop minecraft

# Stop everything and permanently clear the world, run history, and recorded cost.
reset:
    @docker compose down --volumes --remove-orphans
    @find shared/runs -mindepth 1 ! -name .gitkeep -delete
    @echo 'Arena reset. Run `just arena` to start a fresh world and run.'
