#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildExe } = require('./build');

const PORT = 4200;
const PUBLIC_DIR = path.join(__dirname, 'public');

const mime = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/build') {
    return handleBuild(req, res);
  }

  if (req.method === 'GET') {
    let urlPath = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(PUBLIC_DIR, urlPath);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('not found');
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

async function handleBuild(req, res) {
  // expect multipart/form-data
  const boundary = req.headers['content-type']?.match(/boundary=(.+)$/)?.[1];
  if (!boundary) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'missing boundary' }));
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  // parse multipart
  const parts = parseMultipart(body, boundary);
  const isoFile = parts.find(p => p.name === 'iso');
  const configJson = parts.find(p => p.name === 'config');
  const qemuFile = parts.find(p => p.name === 'qemu');

  if (!isoFile || !configJson || !qemuFile) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'missing required fields' }));
  }

  const config = JSON.parse(configJson.data.toString('utf8'));
  // auto-detect qemu share dir on this machine
  const qemuShareDir = getQemuShareDir();
  const launcherPath = getLauncherPath(config.target_os || 'mac');
  const outputPath = path.join(require('os').tmpdir(), `standq-${Date.now()}`);

  try {
    // write iso and qemu to temp files
    const isoPath = path.join(require('os').tmpdir(), `standq-iso-${Date.now()}`);
    fs.writeFileSync(isoPath, isoFile.data);
    const qemuPath = path.join(require('os').tmpdir(), `standq-qemu-${Date.now()}`);
    fs.writeFileSync(qemuPath, qemuFile.data);

    if (!qemuShareDir) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'cannot find qemu share directory (bios/rom files)' }));
    }

    // determine bios/rom files based on arch
    const files = [
      { path: qemuPath, name: config.qemu_binary_name, executable: true },
      { path: isoPath, name: config.iso_name, executable: false },
    ];

    // add required rom files per arch
    const requiredRoms = getRequiredRoms(config.arch);
    for (const rom of requiredRoms) {
      const romPath = path.join(qemuShareDir, rom);
      if (fs.existsSync(romPath)) {
        files.push({ path: romPath, name: rom, executable: false });
      }
    }

    const result = buildExe(launcherPath, config, files, outputPath);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="standq-vm"`,
    });
    fs.createReadStream(outputPath).pipe(res);
    res.on('close', () => {
      fs.unlinkSync(isoPath);
      fs.unlinkSync(qemuPath);
      fs.unlinkSync(outputPath);
    });
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function getLauncherPath(targetOs) {
  const base = path.join(__dirname, '..', 'target');
  switch (targetOs) {
    case 'win':
      return path.join(base, 'x86_64-pc-windows-gnu', 'release', 'launcher.exe');
    case 'linux':
      return path.join(base, 'x86_64-unknown-linux-musl', 'release', 'launcher');
    case 'mac':
    default:
      return path.join(base, 'release', 'launcher');
  }
}

function getRequiredRoms(arch) {
  switch (arch) {
    case 'x86_64':
      return [
        'bios-256k.bin',
        'vgabios-stdvga.bin',
        'kvmvapic.bin',
        'efi-e1000.rom',
        'efi-e1000e.rom',
        'multiboot.bin',
        'linuxboot.bin',
        'linuxboot_dma.bin',
      ];
    case 'aarch64':
      return [
        'edk2-aarch64-code.fd',
        'edk2-aarch64-vars.fd',
        'efi-virtio.rom',
      ];
    case 'i386':
      return [
        'bios.bin',
        'vgabios-stdvga.bin',
        'kvmvapic.bin',
        'efi-e1000.rom',
      ];
    default:
      return [];
  }
}

function getQemuShareDir() {
  const candidates = [
    '/opt/homebrew/share/qemu',
    '/usr/local/share/qemu',
    '/usr/share/qemu',
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'bios-256k.bin'))) return dir;
  }
  return null;
}

function parseMultipart(body, boundary) {
  const parts = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  let start = 0;
  while (start < body.length) {
    const boundaryIdx = body.indexOf(boundaryBuf, start);
    if (boundaryIdx === -1) break;
    const headerEnd = body.indexOf('\r\n\r\n', boundaryIdx + boundaryBuf.length);
    if (headerEnd === -1) break;
    const headers = body.slice(boundaryIdx + boundaryBuf.length, headerEnd).toString('utf8');
    const nextBoundary = body.indexOf(boundaryBuf, headerEnd + 4);
    if (nextBoundary === -1) nextBoundary = body.length;
    const data = body.slice(headerEnd + 4, nextBoundary - 2);

    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/);

    parts.push({
      name: nameMatch?.[1],
      filename: filenameMatch?.[1],
      contentType: contentTypeMatch?.[1],
      data,
    });
    start = nextBoundary;
  }
  return parts;
}

server.listen(PORT, () => {
  console.log(`standq builder running at http://localhost:${PORT}`);
});
