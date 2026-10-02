#!/usr/bin/env node
/**
 * live-reload.mjs — points the native app at a local Angular dev server.
 *
 * `ng serve` is not reachable from a phone on plain localhost, so the WebView
 * has to be told the machine's LAN address. This script discovers that address,
 * starts the dev server, syncs and launches the app.
 *
 * It refuses to run on Node < 22 (Capacitor 8 requires it) with an actionable
 * message instead of the raw `EBADENGINE` failure.
 */
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const platform = process.argv[2];
if (!['android', 'ios'].includes(platform)) {
  console.error('Usage: node scripts/live-reload.mjs <android|ios>');
  process.exit(1);
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(
    `\nNode ${process.versions.node} is too old.\n` +
      `Capacitor 8 requires Node 22 or newer.\n\n` +
      `  macOS/Linux: nvm install 22 && nvm use 22   (or install Node 22 LTS)\n` +
      `  Windows:     winget install OpenJS.NodeJS.LTS\n\n` +
      `The repo's .nvmrc pins the version to use.\n`
  );
  process.exit(1);
}

/**
 * The first non-internal IPv4 address, which is the one a phone on the same
 * Wi-Fi can actually reach.
 */
function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      const isUsable =
        address.family === 'IPv4' && !address.internal;
      if (isUsable) {
        return address.address;
      }
    }
  }
  return null;
}

const host = lanAddress();
if (!host) {
  console.error(
    'No non-internal IPv4 address found. Connect to Wi-Fi, then retry.\n' +
      'Alternatively run "npm run cap:sync && npm run android:run" to test the bundled build.'
  );
  process.exit(1);
}

const run = (command, args, env = {}) =>
  spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });

console.log(`\nLAN address: ${host}`);
console.log(`Starting dev server on http://${host}:4200 ...\n`);
console.log('Your phone must be on the SAME Wi-Fi as this machine.\n');

const server = run('npm', ['run', 'serve:mobile']);

// Give the dev server a moment to bind before the app tries to load it,
// otherwise the WebView hits a connection-refused on first paint.
await new Promise(resolve => setTimeout(resolve, 12000));

console.log('Syncing and launching...\n');
await new Promise(resolve => {
  const app = run('npx', ['cap', 'run', platform, '--target', platform === 'android' ? 'android' : 'ios'], {
    CAP_SERVER_HOST: host,
  });
  app.on('exit', code => {
    server.kill();
    resolve();
    process.exit(code ?? 0);
  });
});
