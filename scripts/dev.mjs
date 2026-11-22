import { spawn } from 'node:child_process';
import path from 'node:path';

const isWin = process.platform === 'win32';
const npmBin = isWin ? 'npm.cmd' : 'npm';

const env = {
  ...process.env,
  PATH: isWin ? `C:\\Program Files\\nodejs;${process.env.PATH || ''}` : process.env.PATH,
};

function startProc(name, args) {
  const child = spawn(npmBin, args, {
    cwd: path.resolve(import.meta.dirname, '..'),
    stdio: 'inherit',
    env,
    shell: isWin,
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });
  return child;
}

const server = startProc('server', ['--prefix', 'server', 'run', 'dev']);
const client = startProc('client', ['--prefix', 'client', 'run', 'dev']);

function shutdown() {
  server.kill('SIGINT');
  client.kill('SIGINT');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
