/**
 * OneBot bot configuration.
 *
 * One document per DSH home, one entry per connected QQ account. The access
 * token follows the repository convention: it is a credential reference, never
 * the secret itself, so the settings file stays safe to copy around.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { t } from '../shared/i18n.mjs';

const EMPTY_DOCUMENT = Object.freeze({ version: 1, bots: [] });

export const ONEBOT_DEFAULT_HOST = '127.0.0.1';
export const ONEBOT_DEFAULT_PORT = 6700;
export const ONEBOT_DEFAULT_PATH = '/onebot/v11/ws';
export const ONEBOT_IMAGE_FORMATS = Object.freeze(['auto', 'base64', 'url', 'file']);

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Stable identity derived from the QQ number, so reconnect keeps the same bot. */
export function deriveOneBotBotIdentity(selfId) {
  const raw = cleanString(String(selfId ?? ''));
  if (!raw) throw new TypeError('selfId is required');
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 24);
  return {
    botId: `onebot_${digest}`,
    accessTokenRef: `DSH_ONEBOT_ACCESS_TOKEN_${digest.toUpperCase()}`,
  };
}

/** Never show a full QQ number in the settings list. */
export function maskOneBotSelfId(selfId) {
  const value = cleanString(String(selfId ?? '')) ?? '';
  if (value.length <= 6) return value || t('OneBot 账号');
  return `${value.slice(0, 4)}•••${value.slice(-3)}`;
}

/** A path has to be absolute so the protocol end and we agree on it. */
function normalizePath(value) {
  const raw = cleanString(value) ?? ONEBOT_DEFAULT_PATH;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return ONEBOT_DEFAULT_PORT;
  return port;
}

/**
 * Normalize the per-bot settings. Unknown values fall back to the defaults so a
 * hand-edited document can never break startup.
 */
export function normalizeOneBotSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const format = cleanString(source.imageSendFormat);
  return {
    host: cleanString(source.host) ?? ONEBOT_DEFAULT_HOST,
    port: normalizePort(source.port),
    path: normalizePath(source.path),
    imageSendFormat: ONEBOT_IMAGE_FORMATS.includes(format) ? format : 'auto',
    selfIds: Array.isArray(source.selfIds)
      ? source.selfIds.map((id) => cleanString(String(id))).filter(Boolean)
      : [],
  };
}

function normalizeBot(value) {
  if (!value || typeof value !== 'object') return null;
  const selfId = cleanString(String(value.selfId ?? ''));
  if (!selfId) return null;
  const identity = deriveOneBotBotIdentity(selfId);
  return {
    botId: identity.botId,
    selfId,
    name: cleanString(value.name) ?? `QQ ${maskOneBotSelfId(selfId)}`,
    accessTokenRef: cleanString(value.accessTokenRef) ?? identity.accessTokenRef,
    ...normalizeOneBotSettings(value),
  };
}

function normalizeDocument(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.bots)) return null;
  const bots = value.bots.map(normalizeBot).filter(Boolean);
  return { version: 1, bots };
}

export class OneBotConfigStore {
  #path;

  #value = EMPTY_DOCUMENT;

  #writeQueue = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  async load() {
    try {
      const normalized = normalizeDocument(JSON.parse(await readFile(this.#path, 'utf8')));
      if (!normalized) throw new Error('dsh-im OneBot config contains invalid bot data');
      this.#value = normalized;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#value = EMPTY_DOCUMENT;
    }
    return this;
  }

  list() {
    return structuredClone(this.#value.bots);
  }

  get(botId) {
    const bot = this.#value.bots.find((candidate) => candidate.botId === botId);
    return bot ? structuredClone(bot) : null;
  }

  getByPlatformId(selfId) {
    const bot = this.#value.bots.find((candidate) => candidate.selfId === String(selfId));
    return bot ? structuredClone(bot) : null;
  }

  async save(value) {
    const bot = normalizeBot(value);
    if (!bot) throw new TypeError('OneBot bot config needs a selfId');
    const bots = this.#value.bots.filter((candidate) => candidate.botId !== bot.botId);
    bots.push(bot);
    await this.#write({ version: 1, bots });
    return structuredClone(bot);
  }

  /** Persist only the fields a settings change touches, keeping the rest. */
  async update(botId, patch) {
    const existing = this.get(botId);
    if (!existing) throw new Error('Unknown OneBot bot');
    const merged = normalizeBot({ ...existing, ...(patch ?? {}) });
    if (!merged) throw new TypeError('OneBot bot config needs a selfId');
    const bots = this.#value.bots.map((candidate) => (candidate.botId === botId ? merged : candidate));
    await this.#write({ version: 1, bots });
    return structuredClone(merged);
  }

  async remove(botId) {
    const next = this.#value.bots.filter((candidate) => candidate.botId !== botId);
    if (next.length === this.#value.bots.length) return false;
    await this.#write({ version: 1, bots: next });
    return true;
  }

  async #write(document) {
    const write = this.#writeQueue.then(async () => {
      this.#value = document;
      await mkdir(dirname(this.#path), { recursive: true });
      const temporary = `${this.#path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.#path);
    });
    // One write at a time; a failed write must not poison later ones.
    this.#writeQueue = write.catch(() => {});
    await write;
  }

  /** Remove the document entirely (used when the last bot goes away). */
  async dispose() {
    await this.#writeQueue;
    await unlink(this.#path).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}
