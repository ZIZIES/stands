#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const MAGIC = Buffer.from('SQVM', 'ascii');
const VERSION = 1;

function buildExe(launcherPath, vmConfig, files, output) {
    const launcherData = fs.readFileSync(launcherPath);

    const configJson = Buffer.from(JSON.stringify(vmConfig), 'utf8');

    const chunks = [];
    chunks.push(MAGIC);
    const verBuf = Buffer.alloc(4);
    verBuf.writeUInt32LE(VERSION, 0);
    chunks.push(verBuf);

    const configLen = Buffer.alloc(8);
    configLen.writeBigUInt64LE(BigInt(configJson.length), 0);
    chunks.push(configLen, configJson);

    // file count
    const countBuf = Buffer.alloc(4);
    countBuf.writeUInt32LE(files.length, 0);
    chunks.push(countBuf);

    // file metadata and data
    const fileDataChunks = [];
    for (const file of files) {
        const nameBuf = Buffer.from(file.name, 'utf8');
        const nameLen = Buffer.alloc(4);
        nameLen.writeUInt32LE(nameBuf.length, 0);
        chunks.push(nameLen, nameBuf);

        const execBuf = Buffer.alloc(1);
        execBuf.writeUInt8(file.executable ? 1 : 0, 0);
        chunks.push(execBuf);

        const data = fs.readFileSync(file.path);
        const sizeBuf = Buffer.alloc(8);
        sizeBuf.writeBigUInt64LE(BigInt(data.length), 0);
        chunks.push(sizeBuf);

        fileDataChunks.push(data);
    }

    chunks.push(...fileDataChunks);

    const payload = Buffer.concat(chunks);
    const trailer = Buffer.alloc(8);
    trailer.writeBigUInt64LE(BigInt(payload.length), 0);

    const outputData = Buffer.concat([launcherData, payload, trailer]);
    fs.writeFileSync(output, outputData);

    if (process.platform !== 'win32') {
        fs.chmodSync(output, 0o755);
    }

    return {
        outputSize: outputData.length,
        launcherSize: launcherData.length,
        payloadSize: payload.length,
        fileCount: files.length,
    };
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length >= 1 && args[0] === 'cli') {
        const [_cmd, launcher, configPath, outPath, ...fileSpecs] = args;
        const configObj = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const files = fileSpecs.map(spec => {
            const [path, name, exec] = spec.split(':');
            return { path, name: name || path.split('/').pop(), executable: exec === 'exec' };
        });
        const result = buildExe(launcher, configObj, files, outPath);
        console.log(`built ${outPath} (${(result.outputSize / 1024 / 1024).toFixed(1)} MB)`);
        console.log(`  launcher: ${(result.launcherSize / 1024).toFixed(0)} KB`);
        console.log(`  payload: ${(result.payloadSize / 1024 / 1024).toFixed(1)} MB`);
        console.log(`  files: ${result.fileCount}`);
    } else {
        console.log(`usage: node build.js cli <launcher> <config.json> <output> <path:name[:exec]> ...`);
        process.exit(1);
    }
}

module.exports = { buildExe, MAGIC, VERSION };
