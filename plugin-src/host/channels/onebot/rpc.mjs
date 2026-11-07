/**
 * Management RPC for the OneBot channel.
 *
 * OneBot adds its own calls (add-bot, listener settings, per-group rules) on top
 * of the shared token-bot surface, exactly like Telegram composes the shared
 * table. Everything shared is inherited rather than re-listed: re-listing is how
 * `bot.empty-answer.set` once answered "Unknown OneBot endpoint" while Telegram
 * had it for free.
 */
import { registerManagementRpc } from '../../../management-rpc.mjs';
import { resolveRpcAuthority } from '../../rpc-authority.mjs';
import { ONEBOT_IMAGE_FORMATS } from '../../../../src/channels/onebot/onebot-config-store.mjs';
import { publicWorkspaceError } from '../shared/workspace-rpc.mjs';
import { TOKEN_BOT_ENDPOINTS, createTokenBotRpcHandler } from '../shared/rpc.mjs';
import { validGroupTriggersConfig } from '../shared/group-triggers-rpc.mjs';

export const ONEBOT_RPC_CHANNEL = '/onebot';

export const ONEBOT_ENDPOINTS = Object.freeze({
  ...TOKEN_BOT_ENDPOINTS,
  deleteBot: 'bot.delete',
  restartBot: 'bot.reconnect',
  addBot: 'onebot.add-bot',
  setSettings: 'onebot.set-settings',
  getGroupRules: 'onebot.group-rules.get',
  setGroupRules: 'onebot.group-rules.set',
  listGroups: 'onebot.group-rules.list',
});

export const ONEBOT_RPC_ENDPOINTS = Object.freeze(Object.values(ONEBOT_ENDPOINTS));

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validSelfId(value) {
  return (typeof value === 'string' || typeof value === 'number')
    && /^\d{5,12}$/.test(String(value));
}

function validPort(value) {
  return value === undefined || (Number.isInteger(value) && value >= 1 && value <= 65535);
}

function validPath(value) {
  return value === undefined || (typeof value === 'string' && value.startsWith('/') && value.length <= 128);
}

function validAccessToken(value) {
  return value === undefined || value === null
    || (typeof value === 'string' && value.length <= 512);
}

/** Group ids the panel asks to remove: trimmed non-empty strings, bounded. */
function validRemovedGroupIds(value) {
  return value === undefined || (Array.isArray(value)
    && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0 && entry.length <= 64));
}

function validSelfIds(value) {
  return value === undefined
    || (Array.isArray(value) && value.length <= 32 && value.every((id) => /^\d{5,12}$/.test(String(id))));
}

function failure(code, message) {
  return { ok: false, error: { code, message, details: {} } };
}

/** Invalid payloads carry the shared `bad-request` code the Host expects. */
function invalidPayload(message) {
  return failure('bad-request', message);
}

const SETTINGS_KEYS = ['botId', 'host', 'port', 'path', 'imageSendFormat', 'selfIds'];

/** Endpoints this module answers itself; the rest is the shared table's job. */
const ONEBOT_OWN_ENDPOINTS = new Set([
  ONEBOT_ENDPOINTS.status,
  ONEBOT_ENDPOINTS.deleteBot,
  ONEBOT_ENDPOINTS.restartBot,
  ONEBOT_ENDPOINTS.addBot,
  ONEBOT_ENDPOINTS.setSettings,
  ONEBOT_ENDPOINTS.getGroupRules,
  ONEBOT_ENDPOINTS.setGroupRules,
  ONEBOT_ENDPOINTS.listGroups,
]);

function validate(endpoint, payload) {
  if (!isRecord(payload)) return 'Payload must be an object.';
  switch (endpoint) {
    case ONEBOT_ENDPOINTS.status:
      return exactKeys(payload, []) ? null : 'connection.status does not accept fields.';
    case ONEBOT_ENDPOINTS.addBot:
      if (!exactKeys(payload, ['selfId', 'accessToken', 'name', 'host', 'port', 'path', 'imageSendFormat', 'selfIds'])) {
        return 'onebot.add-bot received unknown fields.';
      }
      if (!validSelfId(payload.selfId)) return 'onebot.add-bot requires a QQ number.';
      if (!validAccessToken(payload.accessToken)) return 'onebot.add-bot received an invalid access token.';
      if (payload.name !== undefined && (typeof payload.name !== 'string' || payload.name.length > 64)) {
        return 'onebot.add-bot received an invalid name.';
      }
      if (!validPort(payload.port) || !validPath(payload.path) || !validSelfIds(payload.selfIds)) {
        return 'onebot.add-bot received invalid listener settings.';
      }
      if (payload.imageSendFormat !== undefined && !ONEBOT_IMAGE_FORMATS.includes(payload.imageSendFormat)) {
        return 'onebot.add-bot received an unknown image format.';
      }
      return null;
    case ONEBOT_ENDPOINTS.deleteBot:
      return exactKeys(payload, ['botId', 'confirm']) && validId(payload.botId) && payload.confirm === true
        ? null : 'bot.delete requires a botId and confirm=true.';
    case ONEBOT_ENDPOINTS.restartBot:
      // The settings page's connect check asks for a test message in the same call.
      return exactKeys(payload, ['botId', 'sendTest']) && validId(payload.botId)
        && (payload.sendTest === undefined || typeof payload.sendTest === 'boolean')
        ? null : 'bot.reconnect requires a botId and an optional sendTest flag.';
    case ONEBOT_ENDPOINTS.setSettings:
      if (!exactKeys(payload, SETTINGS_KEYS) || !validId(payload.botId)) {
        return 'onebot.set-settings requires a botId and known fields only.';
      }
      if (!validPort(payload.port) || !validPath(payload.path) || !validSelfIds(payload.selfIds)) {
        return 'onebot.set-settings received invalid listener settings.';
      }
      if (payload.imageSendFormat !== undefined && !ONEBOT_IMAGE_FORMATS.includes(payload.imageSendFormat)) {
        return 'onebot.set-settings received an unknown image format.';
      }
      return null;
    case ONEBOT_ENDPOINTS.getGroupRules:
      return exactKeys(payload, ['botId']) && typeof payload.botId === 'string' && payload.botId
        ? null : 'onebot.group-rules.get requires a botId.';
    case ONEBOT_ENDPOINTS.listGroups:
      return exactKeys(payload, ['botId']) && typeof payload.botId === 'string' && payload.botId
        ? null : 'onebot.group-rules.list requires a botId.';
    case ONEBOT_ENDPOINTS.setGroupRules: {
      if (!exactKeys(payload, ['botId', 'config', 'removed'])) {
        return 'onebot.group-rules.set accepts botId, config and removed only.';
      }
      if (typeof payload.botId !== 'string' || !payload.botId) {
        return 'onebot.group-rules.set requires a botId.';
      }
      return validGroupTriggersConfig(payload.config) !== null
        && validRemovedGroupIds(payload.removed)
        ? null : 'onebot.group-rules.set received invalid rules.';
    }
    default:
      // A shared endpoint: the shared handler validates and dispatches it.
      return null;
  }
}

/** Wrap a controller in the RPC surface, refusing malformed payloads loudly. */
export function createOneBotRpcHandler(controller) {
  // The shared handler only ever sees settings endpoints; the lifecycle calls
  // stay on OneBot's own path because its restart takes `sendTest` and it has no
  // credential binding at all. The adapter exists just to satisfy the contract,
  // and it is built lazily so a caller that only touches OneBot's own endpoints
  // does not need the whole lifecycle surface.
  //
  // It must be a Proxy: the real controller is a class instance whose methods live
  // on the prototype, and spreading it into a plain object silently dropped every
  // one of them — the shared handler then refused to construct and the settings
  // page showed the generic "operation failed" card with no reason.
  let sharedHandler = null;
  const shared = (endpoint, payload) => {
    sharedHandler ??= createTokenBotRpcHandler(new Proxy(controller, {
      get(target, key) {
        if (key === 'bindCredentials') {
          return () => {
            throw new Error('OneBot 不需要绑定凭据。');
          };
        }
        if (key === 'reconnectBot') {
          return (botId) => target.restartBot(botId);
        }
        if (key === 'deleteBot') {
          return (botId) => target.deleteBot(botId, { confirm: true });
        }
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }), { channel: 'OneBot' });
    return sharedHandler(endpoint, payload);
  };

  return async (endpoint, payload = {}) => {
    if (!ONEBOT_RPC_ENDPOINTS.includes(endpoint)) {
      return failure('onebot-unknown-endpoint', `Unknown OneBot endpoint: ${endpoint}`);
    }
    if (!ONEBOT_OWN_ENDPOINTS.has(endpoint)) {
      // Inherited from the shared table: one implementation, no drift.
      return shared(endpoint, payload);
    }
    const invalid = validate(endpoint, payload);
    if (invalid !== null) return invalidPayload(invalid);
    try {
      switch (endpoint) {
        case ONEBOT_ENDPOINTS.status:
          return { ok: true, value: await controller.status() };
        case ONEBOT_ENDPOINTS.addBot:
          return { ok: true, value: await controller.addBot(payload) };
        case ONEBOT_ENDPOINTS.deleteBot:
          return { ok: true, value: await controller.deleteBot(payload.botId, { confirm: payload.confirm }) };
        case ONEBOT_ENDPOINTS.restartBot:
          return {
            ok: true,
            value: await controller.restartBot(payload.botId, {
              ...(payload.sendTest === undefined ? {} : { sendTest: payload.sendTest }),
            }),
          };
        case ONEBOT_ENDPOINTS.setSettings: {
          const { botId, ...patch } = payload;
          return { ok: true, value: await controller.setSettings(botId, patch) };
        }
        case ONEBOT_ENDPOINTS.getGroupRules:
          return { ok: true, value: await controller.groupRulesPanel(payload.botId) };
        case ONEBOT_ENDPOINTS.listGroups:
          return { ok: true, value: await controller.listGroups(payload.botId) };
        case ONEBOT_ENDPOINTS.setGroupRules:
          return {
            ok: true,
            value: await controller.updateGroupRules(payload.botId, {
              config: payload.config,
              removed: payload.removed ?? [],
            }),
          };
        default:
          // Unreachable: ONEBOT_OWN_ENDPOINTS lists every endpoint handled here.
          return failure('onebot-unknown-endpoint', `Unknown OneBot endpoint: ${endpoint}`);
      }
    } catch (error) {
      const published = publicWorkspaceError(error);
      if (published !== null) return failure(published.code, published.message);
      return failure('onebot-operation-failed', error instanceof Error ? error.message : String(error));
    }
  };
}

export function installOneBotRpc(ctx, controller, authority) {
  return registerManagementRpc(
    ctx,
    ONEBOT_RPC_CHANNEL,
    createOneBotRpcHandler(controller),
    { authority: resolveRpcAuthority(authority) },
  );
}
