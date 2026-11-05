/**
 * Management RPC for the OneBot channel.
 *
 * The settings page needs five things: read status, add an account, remove one,
 * restart one, and change listener settings. Everything else (workspace, model,
 * access policy) is shared bot plumbing this first version keeps at defaults, so
 * those endpoints are deliberately absent instead of half-working.
 */
import { registerManagementRpc } from '../../../management-rpc.mjs';
import { resolveRpcAuthority } from '../../rpc-authority.mjs';
import { ONEBOT_IMAGE_FORMATS } from '../../../../src/channels/onebot/onebot-config-store.mjs';

export const ONEBOT_RPC_CHANNEL = '/onebot';

export const ONEBOT_ENDPOINTS = Object.freeze({
  status: 'onebot.status',
  addBot: 'onebot.add-bot',
  deleteBot: 'onebot.delete-bot',
  restartBot: 'onebot.restart-bot',
  setSettings: 'onebot.set-settings',
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

function validSelfIds(value) {
  return value === undefined
    || (Array.isArray(value) && value.length <= 32 && value.every((id) => /^\d{5,12}$/.test(String(id))));
}

function failure(code, message) {
  return { ok: false, error: { code, message, details: {} } };
}

const SETTINGS_KEYS = ['botId', 'host', 'port', 'path', 'imageSendFormat', 'selfIds'];

function validate(endpoint, payload) {
  if (!isRecord(payload)) return 'Payload must be an object.';
  switch (endpoint) {
    case ONEBOT_ENDPOINTS.status:
      return exactKeys(payload, []) ? null : 'onebot.status does not accept fields.';
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
        ? null : 'onebot.delete-bot requires a botId and confirm=true.';
    case ONEBOT_ENDPOINTS.restartBot:
      return exactKeys(payload, ['botId']) && validId(payload.botId)
        ? null : 'onebot.restart-bot requires a botId.';
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
    default:
      return null;
  }
}

/** Wrap a controller in the RPC surface, refusing malformed payloads loudly. */
export function createOneBotRpcHandler(controller) {
  return async (endpoint, payload = {}) => {
    if (!ONEBOT_RPC_ENDPOINTS.includes(endpoint)) {
      return failure('onebot-unknown-endpoint', `Unknown OneBot endpoint: ${endpoint}`);
    }
    const invalid = validate(endpoint, payload);
    if (invalid !== null) return failure('onebot-invalid-payload', invalid);
    try {
      switch (endpoint) {
        case ONEBOT_ENDPOINTS.status:
          return { ok: true, value: controller.status() };
        case ONEBOT_ENDPOINTS.addBot:
          return { ok: true, value: await controller.addBot(payload) };
        case ONEBOT_ENDPOINTS.deleteBot:
          return { ok: true, value: await controller.deleteBot(payload.botId) };
        case ONEBOT_ENDPOINTS.restartBot:
          return { ok: true, value: await controller.restartBot(payload.botId) };
        case ONEBOT_ENDPOINTS.setSettings: {
          const { botId, ...patch } = payload;
          return { ok: true, value: await controller.setSettings(botId, patch) };
        }
        default:
          return failure('onebot-unknown-endpoint', `Unknown OneBot endpoint: ${endpoint}`);
      }
    } catch (error) {
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
