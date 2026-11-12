const pairingUrl = /^ws:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/[a-f0-9]{64}$/;
const commands = new Set(['status', 'start', 'stop', 'pick', 'select', 'clear', 'import', 'defaults']);
let session;

export function agentConnected(tabId) {
  return session?.tabId === tabId && session.socket.readyState === WebSocket.OPEN;
}

export function disconnectAgent(tabId, origin) {
  if (session?.tabId !== tabId || origin === session.origin) return;
  clearInterval(session.heartbeat);
  session.socket.close();
  session = undefined;
}

export async function connectAgent(url, tabId, origin, run) {
  const match = typeof url === 'string' && pairingUrl.exec(url.trim());
  if (!match || Number(match[1]) > 65535) throw new Error('Paste the local pairing URL printed by Layout Witness.');
  if (session) throw new Error('Disconnect the agent from its current tab first.');

  const socket = new WebSocket(url.trim());
  const connection = { socket, tabId, origin };
  session = connection;
  socket.addEventListener('close', () => {
    clearInterval(connection.heartbeat);
    if (session === connection) session = undefined;
  });
  socket.addEventListener('message', async ({ data }) => {
    let request;
    try { request = JSON.parse(data); } catch { return; }
    if (session !== connection || typeof request?.id !== 'string') return;

    const { id, action } = request;
    let response;
    try {
      if (action === 'disconnect') response = { id, value: { disconnected: true } };
      else if (commands.has(action)) response = { id, value: await run(request) };
      else throw new Error('Unknown agent command.');
    } catch (error) {
      response = { id, error: error.message };
    }
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(response));
    if (action === 'disconnect') disconnectAgent(tabId);
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(false), 5000);
      const opened = () => finish(true);
      const failed = () => finish(false);
      function finish(success) {
        clearTimeout(timeout);
        socket.removeEventListener('open', opened);
        socket.removeEventListener('error', failed);
        socket.removeEventListener('close', failed);
        if (success) resolve();
        else reject(new Error('Could not connect. Check that the local agent server is running.'));
      }
      socket.addEventListener('open', opened);
      socket.addEventListener('error', failed);
      socket.addEventListener('close', failed);
    });
  } catch (error) {
    if (session === connection) disconnectAgent(tabId);
    throw error;
  }
  const ping = () => {
    if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"ping"}');
  };
  ping();
  connection.heartbeat = setInterval(ping, 20_000);
}
