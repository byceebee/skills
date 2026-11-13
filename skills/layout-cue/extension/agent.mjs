const pairingUrl = /^ws:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/[a-f0-9]{64}$/;
const commands = new Set(['status', 'start', 'capture', 'capture-clean', 'navigate', 'click', 'stop', 'pick', 'select', 'clear', 'import', 'defaults']);
let session;

export function agentConnected(tabId) {
  return session?.tabId === tabId && session.ready;
}

export function disconnectAgent(tabId, origin) {
  if (session?.tabId !== tabId || origin === session.origin) return;
  clearInterval(session.heartbeat);
  session.close();
  session = undefined;
}

async function dispatch(connection, request, run) {
  if (session !== connection || !connection.ready || typeof request?.id !== 'string') return;
  const { id, action } = request;
  let response;
  try {
    if (action === 'disconnect') response = { id, value: { disconnected: true } };
    else if (commands.has(action)) response = { id, value: await run(request) };
    else throw new Error('Unknown agent command.');
  } catch (error) {
    response = { id, error: error.message };
  }
  if (session === connection) {
    connection.send(response);
    if (action === 'disconnect') disconnectAgent(connection.tabId);
  }
}

export async function connectNativeAgent(tabId, origin, run) {
  if (session) throw new Error('Disconnect the agent from its current tab first.');
  const port = chrome.runtime.connectNative('com.byceebee.layout_witness');
  const connection = { tabId, origin, ready: false, send: (value) => port.postMessage(value), close: () => port.disconnect() };
  session = connection;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The local audit host did not start. Check its installation.')), 5000);
      port.onDisconnect.addListener(() => {
        const message = chrome.runtime.lastError?.message;
        clearTimeout(timeout);
        if (session === connection) session = undefined;
        reject(new Error(message ?? 'The local audit host disconnected.'));
      });
      port.onMessage.addListener((request) => {
        if (request?.ready === true && session === connection) {
          clearTimeout(timeout);
          connection.ready = true;
          resolve();
        } else {
          void dispatch(connection, request, run);
        }
      });
    });
  } catch (error) {
    if (session === connection) disconnectAgent(tabId);
    throw error;
  }
}

export async function connectAgent(url, tabId, origin, run) {
  const match = typeof url === 'string' && pairingUrl.exec(url.trim());
  if (!match || Number(match[1]) > 65535) throw new Error('Paste the local pairing URL printed by Layout Cue.');
  if (session) throw new Error('Disconnect the agent from its current tab first.');

  const socket = new WebSocket(url.trim());
  const connection = { tabId, origin, ready: false, send: (value) => socket.send(JSON.stringify(value)), close: () => socket.close() };
  session = connection;
  socket.addEventListener('close', () => {
    clearInterval(connection.heartbeat);
    if (session === connection) session = undefined;
  });
  socket.addEventListener('message', ({ data }) => {
    let request;
    try { request = JSON.parse(data); } catch { return; }
    void dispatch(connection, request, run);
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
  connection.ready = true;
  const ping = () => {
    if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"ping"}');
  };
  ping();
  connection.heartbeat = setInterval(ping, 20_000);
}
