// src/js/ws.js
// WebSocket manager with automatic reconnect (up to 3 attempts).
// Sends 'ping' every 30 s to reset the server-side idle timer.
// Usage: import { createWsManager } from './ws.js'; const ws = createWsManager();

export function createWsManager() {
  let _ws = null;
  let _code = null;
  let _handlers = {};
  let _pingInterval = null;
  let _retries = 0;
  let _isClosed = false;
  const MAX_RETRIES = 3;

  function connect(code, handlers) {
    _code = code;
    _handlers = handlers;
    _retries = 0;
    _isClosed = false;
    _open();
  }

  function _open() {
    if (_isClosed) return;
    if (_ws) { try { _ws.onclose = null; _ws.close(); } catch {} }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/api/rooms/${_code}/ws`;

    _ws = new WebSocket(url);

    _ws.onopen = () => {
      _retries = 0;
      _startPing();
      if (_handlers.onOpen) _handlers.onOpen();
    };

    _ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      if (_handlers.onMessage) _handlers.onMessage(msg);
    };

    _ws.onclose = (evt) => {
      _stopPing();
      // 1000 = normal close (room ended), do not retry
      if (evt.code === 1000) {
        if (_handlers.onEnded) _handlers.onEnded();
        return;
      }
      if (_isClosed) return;
      if (_retries < MAX_RETRIES) {
        _retries++;
        setTimeout(_open, 2000 * _retries);
      } else {
        if (_handlers.onDisconnect) _handlers.onDisconnect();
      }
    };

    _ws.onerror = () => {
      // onerror is always followed by onclose, so let onclose handle retry
    };
  }

  function _startPing() {
    _stopPing();
    _pingInterval = setInterval(() => {
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30_000);
  }

  function _stopPing() {
    if (_pingInterval) { clearInterval(_pingInterval); _pingInterval = null; }
  }

  function close() {
    _isClosed = true;
    _stopPing();
    if (_ws) { 
      try { _ws.onclose = null; _ws.close(); } catch {} 
      _ws = null; 
    }
  }

  return { connect, close };
}
