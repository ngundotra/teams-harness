import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT ?? '3978';
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const ungate = spawnSync(process.execPath, [join(root, 'scripts', 'ungate-playground.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (ungate.status !== 0) {
  process.exit(ungate.status ?? 1);
}
console.log('Bot starting. Then run: agentsplayground -e http://localhost:' + port + '/api/messages -c msteams');
const bot = spawn(tsx, [join(root, 'src', 'index.ts')], { cwd: root, stdio: 'inherit', env: { ...process.env, PORT: port } });
bot.on('exit', (code) => process.exit(code ?? 1));
