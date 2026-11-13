import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Provide a valid port.');
const assets = {
  '/': ['demo.html', 'text/html'],
  '/audit.css': ['audit.css', 'text/css'],
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const asset = Object.hasOwn(assets, pathname) ? assets[pathname] : null;
  if (!asset) {
    response.writeHead(404).end();
    return;
  }
  try {
    const [file, mimeType] = asset;
    const content = await readFile(new URL(file, import.meta.url));
    response.writeHead(200, { 'content-type': `${mimeType}; charset=utf-8`, 'cache-control': 'no-store' });
    response.end(content);
  } catch (error) {
    response.destroy(error);
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Demo: http://127.0.0.1:${port}`));
