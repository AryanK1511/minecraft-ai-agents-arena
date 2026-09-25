#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo 'Copy .env.example to .env, set your OpenRouter key and accept the Minecraft EULA, then run just arena again.' >&2
  exit 1
fi

docker compose config --quiet
sh scripts/fetch-compatibility.sh
docker compose up -d --wait --wait-timeout 180 minecraft

plugin=.runtime/plugins/HouseArena.jar
if [ ! -f "$plugin" ] ||
   [ arena-plugin/src/main/java/local/arena/HouseArena.java -nt "$plugin" ] ||
   [ arena-plugin/src/main/resources/plugin.yml -nt "$plugin" ] ||
   [ scripts/build-plugin.sh -nt "$plugin" ]; then
  sh scripts/build-plugin.sh
  docker compose stop app
  docker compose restart minecraft
  docker compose up -d --wait --wait-timeout 180 minecraft
fi

docker compose up -d --build --wait --wait-timeout 180 app
echo 'Dashboard: http://localhost:3000 · Minecraft: localhost:25565'
echo 'Use Start or Resume in the dashboard when you want the agents to work.'
