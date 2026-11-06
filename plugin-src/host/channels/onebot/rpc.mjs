/**
 * Management RPC for the OneBot channel.
 *
 * The shared bot surface (workspace, model, access policy, and the rest) uses the
 * same endpoint names as every other channel, so the settings page behaves like
 * Telegram's; the two OneBot-specific calls carry the listener settings no other
 * channel has.
 */
import { registerManagementRpc } from '../../../management-rpc.mjs';
import { resolveRpcAuthority } from '../../rpc-authority.mjs';
import { ONEBOT_IMAGE_FORMATS } from '../../../../src/channels/onebot/onebot-config-store.mjs';
import { SET_WORKSPACE_ENDPOINT, publicWorkspaceError, validWorkspacePayload } from '../shared/workspace-rpc.mjs';
import { SET_MODEL_ENDPOINT, validModelPayload } from '../shared/model-setting-rpc.mjs';
import { SET_AGENT_PRESET_ENDPOINT, validAgentPresetPayload } from '../shared/agent-preset-rpc.mjs';
import {
  SET_CONTEXT_ENHANCEMENT_ENDPOINT,
  validContextEnhancementPayload,
} from '../shared/context-enhancement-rpc.mjs';
import { SET_MESSAGE_MODE_ENDPOINT, validMessageModePayload } from '../../../../src/channels/shared/message-mode.mjs';
import { SET_ACCESS_POLICY_ENDPOINT, validAccessPolicyPayload } from '../shared/access-policy-rpc.mjs';
import { SET_ALIAS_ENDPOINT, validAliasPayload } from '../shared/bot-alias-rpc.mjs';

export const ONEBOT_RPC_CHANNEL = '/onebot';

export const ONEBOT_ENDPOINTS = Object.freeze({
  status: 'connection.status',
  deleteBot: 'bot.delete',
  restartBot: 'bot.reconnect',
  addBot: 'onebot.add-bot',
  setSettings: 'onebot.set-settings',
  setWorkspace: SET_WORKSPACE_ENDPOINT,
  setModel: SET_MODEL_ENDPOINT,
  setAgentPreset: SET_AGENT_PRESET_ENDPOINT,
  setContextEnhancement: SET_CONTEXT_ENHANCEMENT_ENDPOINT,
  setBusyMessageMode: SET_MESSAGE_MODE_ENDPOINT,
  setAccessPolicy: SET_ACCESS_POLICY_ENDPOINT,
  setAlias: SET_ALIAS_ENDPOINT,
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

/** Invalid payloads carry the shared `bad-request` code the Host expects. */
function invalidPayload(message) {
  return failure('bad-request', message);
}

const SETTINGS_KEYS = ['botId', 'host', 'port', 'path', 'imageSendFormat', 'selfIds'];

/** The shared bot surface: one payload validator and one controller call each. */
const SHARED_ENDPOINTS = [
  [SET_WORKSPACE_ENDPOINT, validWorkspacePayload, 'updateWorkspace', (payload) => [payload.botId, payload.workspace]],
  [SET_MODEL_ENDPOINT, validModelPayload, 'updateModel', (payload) => [payload.botId, payload.model]],
  [SET_AGENT_PRESET_ENDPOINT, validAgentPresetPayload, 'updateAgentPreset', (payload) => [payload.botId, payload.agentPreset]],
  [SET_CONTEXT_ENHANCEMENT_ENDPOINT, validContextEnhancementPayload, 'updateContextEnhancement', (payload) => [payload.botId, payload.config]],
  [SET_MESSAGE_MODE_ENDPOINT, validMessageModePayload, 'updateBusyMessageMode', (payload) => [payload.botId, payload.mode]],
  [SET_ACCESS_POLICY_ENDPOINT, validAccessPolicyPayload, 'updateAccessPolicy', (payload) => [payload.botId, payload]],
  [SET_ALIAS_ENDPOINT, validAliasPayload, 'updateAlias', (payload) => [payload.botId, payload.alias]],
];

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
    default: {
      const shared = SHARED_ENDPOINTS.find(([name]) => name === endpoint);
      if (shared === undefined) return null;
      return shared[1](payload) ? null : `${endpoint} received an invalid payload.`;
    }
  }
}

/** Wrap a controller in the RPC surface, refusing malformed payloads loudly. */
export function createOneBotRpcHandler(controller) {
  return async (endpoint, payload = {}) => {
    if (!ONEBOT_RPC_ENDPOINTS.includes(endpoint)) {
      return failure('onebot-unknown-endpoint', `Unknown OneBot endpoint: ${endpoint}`);
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
        default: {
          const shared = SHARED_ENDPOINTS.find(([name]) => name === endpoint);
          if (shared === undefined) return failure('onebot-unknown-endpoint', `Unknown OneBot endpoint: ${endpoint}`);
          const [, , method, argsOf] = shared;
          if (typeof controller[method] !== 'function') {
            return failure('onebot-unsupported', `${endpoint} is not available for this channel yet`);
          }
          return { ok: true, value: await controller[method](...argsOf(payload)) };
        }
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
