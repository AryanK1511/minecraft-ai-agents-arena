#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p .runtime/plugin-build .runtime/plugins
# Bootstrap from the exact proof server so compile/runtime API versions agree.
if [ ! -d .runtime/paper-libraries/libraries ]; then
  mkdir -p .runtime/paper-libraries
  docker compose -f compatibility/compose.yaml cp minecraft:/data/libraries .runtime/paper-libraries/
fi
if [ ! -f .runtime/paper-libraries/annotations-26.0.2.jar ]; then
  curl --fail --location https://repo.maven.apache.org/maven2/org/jetbrains/annotations/26.0.2/annotations-26.0.2.jar -o .runtime/paper-libraries/annotations-26.0.2.jar
fi
test "$(shasum -a 256 .runtime/paper-libraries/annotations-26.0.2.jar | cut -d ' ' -f 1)" = 2037be378980d3ba9333e97955f3b2cde392aa124d04ca73ce2eee6657199297
docker run --rm -v "$PWD:/work" -w /work eclipse-temurin:25-jdk@sha256:97014c4b396021f9ddb7d592a7dbedb0c4e4215c29e03dc01c393558aefb71c2 sh -ec '
  classpath=$(find .runtime/paper-libraries -name "*.jar" -print | paste -sd: -)
  javac --release 25 -cp "$classpath" -d .runtime/plugin-build arena-plugin/src/main/java/local/arena/HouseArena.java
  cp arena-plugin/src/main/resources/plugin.yml .runtime/plugin-build/
  jar --create --file .runtime/plugins/HouseArena.jar -C .runtime/plugin-build .
'
