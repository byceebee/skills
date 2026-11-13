import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Provide a valid port.');
const demo = new URL('./demo.html', import.meta.url);
const server = createServer(async (request, response) => {
  if (request.url !== '/') {
    response.writeHead(404).end();
    return;
  }
  try {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(await readFile(demo));
  } catch (error) {
    response.destroy(error);
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Demo: http://127.0.0.1:${port}`));
