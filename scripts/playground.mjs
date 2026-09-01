import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT ?? '3978';
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const agentsBin = join(root, 'node_modules', '.bin', 'agentsplayground');
const ungate = spawnSync(process.execPath, [join(root, 'scripts', 'ungate-playground.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (ungate.status !== 0) {
  process.exit(ungate.status ?? 1);
}
const children = [];
function stopAll(code) {
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  process.exit(code);
}
console.log('Harness on http://localhost:' + port + '/api/messages');
const bot = spawn(tsx, [join(root, 'src', 'index.ts')], { cwd: root, stdio: 'inherit', env: { ...process.env, PORT: port } });
children.push(bot);
bot.on('exit', (code) => stopAll(code ?? 1));
if (existsSync(agentsBin)) {
  console.log('Playground: http://localhost:56150/  (one tab, not 127.0.0.1)');
  const playground = spawn(agentsBin, [
    '-e', 'http://localhost:' + port + '/api/messages',
    '-c', 'msteams',
    '-p', '56150',
  ], { cwd: root, stdio: 'inherit' });
  children.push(playground);
  playground.on('exit', (code) => stopAll(code ?? 1));
} else {
  console.log('agentsplayground not installed. Run: npx agentsplayground -e http://localhost:' + port + '/api/messages -c msteams -p 56150');
}
