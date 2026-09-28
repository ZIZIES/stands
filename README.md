# standq

bundle a vm into a single executable. you pick an iso, tweak some settings, and it spits out a standalone exe that runs qemu with your vm inside.

## how it works

1. **builder** (web UI at `localhost:4200`): upload an iso + qemu binary, configure ram/cpu/disk/display
2. **launcher** (rust): the shell binary. reads its own file, extracts embedded files to temp, spawns qemu
3. **build**: the builder splices `[launcher][payload][trailer]` into one binary

## layout

```
launcher/src/main.rs   - rust launcher (reads own payload, extracts, runs qemu)
builder/server.js      - web server + build endpoint
builder/build.js       - build logic (can also be used as CLI)
builder/public/        - web UI frontend
```

## building

```sh
cargo build --release
cargo build --release --target x86_64-pc-windows-gnu
cargo zigbuild --release --target x86_64-unknown-linux-musl
```

## running

```sh
node builder/server.js
# open http://localhost:4200
```

## cli build (no web ui)

```sh
node builder/build.js cli target/release/launcher config.json output-vm \
  /path/to/qemu-system-x86_64:qemu-system-x86_64:exec \
  /path/to/iso:boot.img \
  /opt/homebrew/share/qemu/bios-256k.bin:bios-256k.bin \
  /opt/homebrew/share/qemu/vgabios-stdvga.bin:vgabios-stdvga.bin \
  /opt/homebrew/share/qemu/kvmvapic.bin:kvmvapic.bin
```
