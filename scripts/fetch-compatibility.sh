#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p .runtime/artifacts .runtime/plugins
fetch() {
  url="$1" destination="$2" expected="$3"
  if [ -f "$destination" ] && [ "$(shasum -a 256 "$destination" | cut -d ' ' -f 1)" = "$expected" ]; then
    return
  fi
  curl --fail --location --retry 2 "$url" -o "$destination"
  actual=$(shasum -a 256 "$destination" | cut -d ' ' -f 1)
  test "$actual" = "$expected" || { rm "$destination"; echo 'Artifact checksum mismatch' >&2; exit 1; }
}
fetch 'https://fill-data.papermc.io/v1/objects/2b77166ee61886a9bc9ab33dc9e4847fa3538b36d9ba6e5f2fa7ed90973aa748/paper-26.3-41.jar' .runtime/artifacts/paper-26.3-41.jar 2b77166ee61886a9bc9ab33dc9e4847fa3538b36d9ba6e5f2fa7ed90973aa748
fetch 'https://github.com/ViaVersion/ViaVersion/releases/download/5.12.0/ViaVersion-5.12.0.jar' .runtime/plugins/ViaVersion-5.12.0.jar 72c40a6a702d67f226fc9a0d8ad82aba1483fdabe2e6159bcdddb2dc070750b0
fetch 'https://github.com/ViaVersion/ViaBackwards/releases/download/5.12.0/ViaBackwards-5.12.0.jar' .runtime/plugins/ViaBackwards-5.12.0.jar 194e9250224632274d7b3c17e411e031a9223c1863c6f5138d53c721f07ab78d
