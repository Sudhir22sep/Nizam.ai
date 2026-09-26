#!/usr/bin/env node
/**
 * Runs the API server and the Angular dev server together for local work.
 *
 * `node dist/.../server.mjs & ng serve` (the previous `dev:full`) had two
 * problems that only showed up interactively:
 *
 *   1. The `&` backgrounds the API inside a subshell, so Ctrl+C kills `ng serve`
 *      and leaves the API still listening. The next run then dies with
 *      `EADDRINUSE: address already in use :::4000`, and the stale process is
 *      invisible unless you already know to go looking for it.
 *   2. Both servers write to the same terminal, so their output interleaves and
 *      there is no way to tell which side printed an error.
 *
 * This script owns both children: it tags their output, waits for the API to
 * accept connections before starting Vite (otherwise the first proxied /api
 * request races the API boot and fails), and on shutdown tears the whole stack
 * down so nothing is left holding a port.
 *
 * Usage: node scripts/dev.mjs [--no-build] [--api-port 4000] [--web-port 4200]
 */
import { spawn } from 'child_process';
import net from 'net';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');

const API_ENTRY = join(projectRoot, 'dist', 'Nizam', 'server', 'server.mjs');

const COLORS = { api: '\x1b[36m', web: '\x1b[35m', reset: '\x1b[0m' };

function parseArgs(argv) {
  const options = { build: true, apiPort: 4000, webPort: 4200 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-build') {
      options.build = false;
    } else if (arg === '--api-port') {
      options.apiPort = Number(argv[++i]);
    } else if (arg === '--web-port') {
      options.webPort = Number(argv[++i]);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

/** Pipes a child's output with a coloured `[api]` / `[web]` prefix per line. */
function run(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // `npx ng serve` spawns the real CLI as a grandchild, so signalling the
    // direct child alone leaves the dev server running and still holding its
    // port. A detached child becomes a process-group leader, which lets
    // shutdown signal the whole group with one negative-pid kill.
    detached: true,
  });

  const prefix = `${COLORS[label]}[${label}]${COLORS.reset} `;
  const forward = (stream, target) => {
    let buffer = '';
    stream.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      // The final element is a partial line; hold it until the rest arrives.
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        target.write(`${prefix}${line}\n`);
      }
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  return child;
}

/** Resolves once something accepts TCP connections on `port`. */
function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`API did not start listening on ${port} within ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

const children = new Set();
let shuttingDown = false;

/**
 * Stops every child and exits.
 *
 * A Ctrl+C from the terminal is delivered by the shell to this process, not to
 * the children, so nothing is left to cascade. This is the function that makes
 * shutdown complete.
 */
function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    try {
      // Negative pid signals the whole process group, which is what catches the
      // grandchild `npx` creates. Falls back to the direct child if the group
      // signal is refused (for example on a non-POSIX host).
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // Already gone; its exit handler still runs.
      }
    }
  }
  setTimeout(() => process.exit(code), 500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  if (options.build) {
    console.log('Building the server bundle (this takes about 40s)...');
    await new Promise((resolve, reject) => {
      const build = run('api', 'npm', ['run', 'build'], {});
      build.on('exit', code =>
        code === 0 ? resolve() : reject(new Error(`build exited with code ${code}`))
      );
    });
  }

  const api = run('api', process.execPath, [API_ENTRY], { PORT: String(options.apiPort) });
  children.add(api);
  api.on('exit', code => {
    // If the API dies on its own, tear the whole stack down rather than leave
    // Vite proxying to nothing.
    console.error(`[api] exited with code ${code}`);
    shutdown(code ?? 1);
  });

  await waitForPort(options.apiPort);
  console.log(`[api] is listening on ${options.apiPort}; starting the dev server`);

  const web = run(
    'web',
    'npx',
    ['ng', 'serve', '--port', String(options.webPort), '--proxy-config', 'proxy.conf.json'],
    {}
  );
  children.add(web);
  web.on('exit', code => {
    console.error(`[web] exited with code ${code}`);
    shutdown(code ?? 1);
  });
}

main().catch(error => {
  console.error(`dev:full failed: ${error.message}`);
  shutdown(1);
});