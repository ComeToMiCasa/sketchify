// Development server for the landing page: serves site/dist on localhost and rebuilds on changes
// (site/src: the page; src/: the plugin first, then the page). A server, not file://, because the
// shell reads the height of its frames, which browsers forbid across file URLs.
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SITE);
const OUT = join(SITE, 'dist');
const PORT = Number(process.env.PORT ?? 4173);
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

const run = (command, args) =>
  new Promise((done) => {
    spawn(command, args, { cwd: ROOT, stdio: 'inherit' }).on('exit', (code) => done(code === 0));
  });

const rebuild = async (plugin) => {
  if (plugin && !(await run('npm', ['run', 'build', '--silent']))) return;
  await run('node', [join(SITE, 'build.mjs')]);
};

const pending = { timer: undefined, plugin: false };
const schedule = (plugin) => {
  pending.plugin = pending.plugin || plugin;
  clearTimeout(pending.timer);
  pending.timer = setTimeout(() => {
    const withPlugin = pending.plugin;
    pending.plugin = false;
    void rebuild(withPlugin);
  }, 150);
};

createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(OUT, path.endsWith('/') ? join(path, 'index.html') : path);
  try {
    if (!file.startsWith(OUT) || !(await stat(file)).isFile()) throw new Error('not found');
    response.writeHead(200, { 'content-type': `${TYPES[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-store' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('Not found');
  }
}).listen(PORT, async () => {
  await rebuild(false);
  watch(join(SITE, 'src'), { recursive: true }, () => schedule(false));
  watch(join(ROOT, 'src'), { recursive: true }, () => schedule(true));
  console.log(`site: http://localhost:${PORT}/ (watching site/src and src)`);
});
