import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { createContainer } from '../../runtime/container.ts';
import { createHttpServer } from './http.ts';
const app = await createContainer();
let middleware: Parameters<typeof createHttpServer>[1] extends (() => infer T) | undefined ? T : never;
const server = createHttpServer(app, () => middleware);
let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
if (process.argv.includes('--dev')) {
  const {
    createServer
  } = await import('vite');
  vite = await createServer({
    configFile: join(app.config.root, 'vite.config.ts'),
    server: {
      middlewareMode: true,
      hmr: {
        server
      }
    }
  });
  middleware = vite.middlewares;
} else {
  const root = resolve(app.config.root, 'dist');
  middleware = (request, response, next) => {
    void (async () => {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(root + sep)) return next();
      try {
        const content = await readFile(file);
        const types: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon'
        };
        response.writeHead(200, {
          'Content-Type': types[extname(file)] ?? 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff'
        });
        response.end(content);
      } catch {
        next();
      }
    })().catch(next);
  };
}
server.on('error', async error => {
  console.error((error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${app.config.port} is already in use.` : 'SERVER_FAILED');
  await vite?.close();
  await app.close();
  process.exitCode = 1;
});
server.listen(app.config.port, '127.0.0.1', () => console.log(`Followup UI: http://127.0.0.1:${app.config.port}`));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close();
  await vite?.close();
  await app.close();
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
