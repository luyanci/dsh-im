/**
 * OneBot v11 reverse-WebSocket transport.
 *
 * The protocol end (SnowLuma, NapCat, Lagrange, …) dials us, sends events over
 * the socket and expects actions back on that same connection. This module owns
 * only that transport: handshake validation, session bookkeeping, action
 * request/response correlation and liveness. Turning frames into semantic
 * messages is `onebot-runtime.mjs`; calling actions is `onebot-api.mjs`.
 *
 * Wire facts this encodes (measured against SnowLuma, see
 * `docs/onebot-channel.md` §2.1):
 *   - `X-Self-ID` and `X-Client-Role` are mandatory; a missing header is refused.
 *   - The access token arrives as `Authorization: Bearer <token>` or as an
 *     `access_token` query parameter. An empty configured token means no check.
 *   - `message` events, `meta_event`s (`lifecycle`, `heartbeat`) and `notice`s
 *     share the connection; actions travel in the opposite direction and are
 *     correlated by `echo`.
 */
import { WebSocketServer } from 'ws';

/** The role that carries both events and actions on one socket. */
export const ONEBOT_UNIVERSAL_ROLE = 'Universal';

/** Roles that may carry actions. `Event` alone cannot answer us. */
const ACTION_ROLES = new Set(['universal', 'api']);

const DEFAULT_ACTION_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

function readToken(headers, url) {
  const authorization = String(headers.authorization ?? '');
  const bearer = authorization.replace(/^Bearer\s+/i, '').trim();
  if (bearer.length > 0) return bearer;
  return String(url.searchParams.get('access_token') ?? '').trim();
}

function headerValue(headers, name) {
  const value = headers[name];
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

/**
 * Validate one upgrade request. Returns `{ ok: true, selfId, role }` or
 * `{ ok: false, status, reason }`; never throws, so the caller can refuse the
 * handshake with a plain HTTP status.
 */
export function checkOneBotHandshake({ headers, url, accessToken = '', selfIds = [] }) {
  const selfId = headerValue(headers, 'x-self-id').trim();
  const role = headerValue(headers, 'x-client-role').trim();
  if (selfId.length === 0) return { ok: false, status: 400, reason: 'missing X-Self-ID' };
  if (role.length === 0) return { ok: false, status: 400, reason: 'missing X-Client-Role' };
  if (accessToken.length > 0 && readToken(headers, url) !== accessToken) {
    return { ok: false, status: 401, reason: 'bad access token' };
  }
  const allow = Array.isArray(selfIds) ? selfIds.map(String).filter(Boolean) : [];
  if (allow.length > 0 && !allow.includes(selfId)) {
    return { ok: false, status: 403, reason: `account ${selfId} is not allowed` };
  }
  if (!ACTION_ROLES.has(role.toLowerCase())) {
    return { ok: false, status: 400, reason: `role ${role} cannot carry actions` };
  }
  return { ok: true, selfId, role };
}

/**
 * One connected protocol end. Actions are sent through `request()`; incoming
 * frames are handed to the server's listeners rather than handled here.
 */
class OneBotSession {
  #ws;

  #pending = new Map();

  #sequence = 0;

  #closed = false;

  #actionTimeoutMs;

  constructor(ws, { selfId, role, actionTimeoutMs = DEFAULT_ACTION_TIMEOUT_MS }) {
    this.#ws = ws;
    this.#actionTimeoutMs = actionTimeoutMs;
    this.selfId = selfId;
    this.role = role;
    this.connectedAt = new Date();
    ws.on('message', (raw) => this.#onFrame(raw));
    ws.on('close', (code, reason) => {
      this.#closed = true;
      this.#failPending(new Error(`OneBot connection closed (${code}${reason?.length ? ` ${reason}` : ''})`));
    });
    ws.on('error', (error) => {
      this.#failPending(error instanceof Error ? error : new Error(String(error)));
    });
  }

  get open() {
    return !this.#closed && this.#ws.readyState === 1;
  }

  #onFrame(raw) {
    let frame;
    try {
      frame = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }
    if (typeof frame?.echo === 'string' && this.#pending.has(frame.echo)) {
      const settle = this.#pending.get(frame.echo);
      this.#pending.delete(frame.echo);
      settle(frame);
      return;
    }
    if (typeof frame?.action === 'string') {
      // A protocol end asking us for an action is not part of OneBot v11; answer
      // empty so it does not hang.
      this.#send({ status: 'failed', retcode: 1404, data: null, echo: frame.echo });
      return;
    }
    this.onFrame?.(frame);
  }

  #send(frame) {
    if (!this.open) return false;
    this.#ws.send(JSON.stringify(frame));
    return true;
  }

  #failPending(error) {
    for (const settle of this.#pending.values()) settle({ __error: error });
    this.#pending.clear();
  }

  /** Resolve to the action's `data`, or throw with the peer's `wording`. */
  request(action, params = {}) {
    if (!this.open) return Promise.reject(new Error('OneBot connection is not open'));
    const echo = `dsh-${++this.#sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(echo);
        reject(new Error(`OneBot action ${action} timed out after ${this.#actionTimeoutMs}ms`));
      }, this.#actionTimeoutMs);
      timer.unref?.();
      this.#pending.set(echo, (frame) => {
        clearTimeout(timer);
        if (frame.__error) {
          reject(frame.__error);
          return;
        }
        if (frame.status === 'failed' || frame.retcode !== 0) {
          const wording = frame.wording ?? frame.message ?? `retcode ${frame.retcode}`;
          const error = new Error(`OneBot action ${action} failed: ${wording}`);
          error.retcode = frame.retcode;
          reject(error);
          return;
        }
        resolve(frame.data);
      });
      this.#send({ action, params, echo });
    });
  }

  /** Transport-level ping; `ws` answers the peer's pings for us. */
  ping() {
    try {
      this.#ws.ping();
    } catch {
      // A socket that already failed is settled by its close handler.
    }
  }

  close(code = 1000, reason = 'closed by host') {
    this.#closed = true;
    try {
      this.#ws.close(code, reason);
    } catch {
      this.#ws.terminate?.();
    }
  }
}

/**
 * Reverse-WebSocket server. Binds loopback by default: a protocol end on the
 * same machine is the only supported deployment for the first version.
 */
export function createOneBotServer({
  host = '127.0.0.1',
  port = 6700,
  path = '/onebot/v11/ws',
  accessToken = '',
  selfIds = [],
  actionTimeoutMs = DEFAULT_ACTION_TIMEOUT_MS,
  heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
  logger,
} = {}) {
  const sessions = new Map();
  const listeners = { frame: new Set(), state: new Set() };
  let heartbeat;

  const server = new WebSocketServer({
    host,
    port,
    path,
    verifyClient: (info, done) => {
      const url = new URL(info.req?.url ?? '/', 'http://127.0.0.1');
      const verdict = checkOneBotHandshake({
        headers: info.req?.headers ?? {},
        url,
        accessToken,
        selfIds,
      });
      if (!verdict.ok) {
        logger?.warn?.(`OneBot handshake refused: ${verdict.reason}`);
        done(false, verdict.status, verdict.reason);
        return;
      }
      info.req.onebot = verdict;
      done(true);
    },
  });

  function emitState(kind, session) {
    for (const listener of listeners.state) listener({ kind, session });
  }

  server.on('connection', (ws, req) => {
    const verdict = req?.onebot;
    if (!verdict?.ok) {
      ws.close(4001, 'handshake not validated');
      return;
    }
    const existing = sessions.get(verdict.selfId);
    if (existing !== undefined && existing.open) {
      logger?.warn?.(`OneBot account ${verdict.selfId} already connected; refusing the duplicate`);
      ws.close(4009, 'account already connected');
      return;
    }
    const session = new OneBotSession(ws, {
      selfId: verdict.selfId,
      role: verdict.role,
      actionTimeoutMs,
    });
    sessions.set(verdict.selfId, session);
    emitState('connected', session);
    session.onFrame = (frame) => {
      for (const listener of listeners.frame) listener(frame, session);
    };
    ws.on('close', () => {
      if (sessions.get(session.selfId) === session) sessions.delete(session.selfId);
      emitState('disconnected', session);
    });
    ws.on('pong', () => {
      session.alive = true;
    });
    session.alive = true;
  });

  server.on('error', (error) => {
    logger?.error?.(`OneBot server error: ${error?.message ?? error}`);
  });

  return {
    get listening() {
      return server.address() !== null;
    },

    /** The connected sessions, one per account. */
    sessions() {
      return [...sessions.values()];
    },

    sessionFor(selfId) {
      return sessions.get(String(selfId));
    },

    onFrame(listener) {
      listeners.frame.add(listener);
      return () => listeners.frame.delete(listener);
    },

    onState(listener) {
      listeners.state.add(listener);
      return () => listeners.state.delete(listener);
    },

    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          heartbeat = setInterval(() => {
            for (const session of sessions.values()) {
              if (session.alive === false) {
                session.close(4008, 'heartbeat lost');
                continue;
              }
              session.alive = false;
              session.ping?.();
            }
          }, heartbeatIntervalMs);
          heartbeat.unref?.();
          resolve(server.address());
        };
        server.once('error', onError);
        server.once('listening', onListening);
      });
    },

    async close() {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      heartbeat = undefined;
      for (const session of sessions.values()) session.close(1001, 'server shutting down');
      sessions.clear();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
