/**
 * OneBot controller: one runtime per QQ account, plus the config surface the
 * settings page talks to.
 *
 * Unlike the token channels there is nothing to dial and no identity to inspect
 * up front: the protocol end connects to us. So adding a bot only stores its QQ
 * number, listener settings and access-token reference, and the runtime sits in
 * "listening" until that account shows up.
 */
import { deriveOneBotBotIdentity, normalizeOneBotSettings, ONEBOT_IMAGE_FORMATS } from './onebot-config-store.mjs';
import { createOneBotRuntime, createOneBotRuntimeStatus } from './onebot-runtime.mjs';

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeError(code, message) {
  return Object.freeze({ code, message });
}

export class OneBotController {
  #credentials;

  #configStore;

  #createRuntime;

  #logger;

  #runtimes = new Map();

  #errors = new Map();

  #revision = 0;

  #closed = false;

  constructor({
    credentials,
    configStore,
    createRuntime = (options) => createOneBotRuntime(options),
    harness,
    state,
    stateFor,
    contextEnhancement,
    accessPolicy,
    loadImage,
    logger = console,
    replyTimeoutMs,
  }) {
    if (!configStore || typeof configStore.list !== 'function') {
      throw new TypeError('OneBot requires a config store');
    }
    // Either one shared store or a per-account loader; production passes the
    // loader because each QQ account owns its own conversation state.
    if (!harness || (!state && typeof stateFor !== 'function')) {
      throw new TypeError('OneBot requires the harness client and a state store');
    }
    this.#credentials = credentials ?? null;
    this.#configStore = configStore;
    this.#createRuntime = createRuntime;
    this.#logger = logger;
    this.#harness = harness;
    this.#state = state ?? null;
    // Each account keeps its own conversation state (seen ids, queue recovery),
    // so production passes a per-bot loader instead of one shared store.
    this.#stateFor = typeof stateFor === 'function' ? stateFor : () => this.#state;
    this.#contextEnhancement = contextEnhancement;
    this.#accessPolicy = accessPolicy;
    this.#loadImage = loadImage;
    this.#replyTimeoutMs = replyTimeoutMs;
  }

  #harness;

  #state;

  #stateFor;

  #contextEnhancement;

  #accessPolicy;

  #loadImage;

  #replyTimeoutMs;

  /** Start every saved bot. A bot that fails keeps its error until restarted. */
  async initialize() {
    if (this.#closed) return this.status();
    for (const config of this.#configStore.list()) {
      if (this.#runtimes.has(config.botId)) continue;
      try {
        await this.#startRuntime(config);
        this.#errors.delete(config.botId);
      } catch (error) {
        this.#errors.set(config.botId, safeError(
          'listen-failed',
          `无法监听 ${config.host}:${config.port}：${error?.message ?? error}`,
        ));
      }
    }
    this.#revision += 1;
    return this.status();
  }

  /**
   * Save a QQ account and start listening for it. `accessToken` is optional: an
   * empty token means the protocol end is trusted by loopback alone.
   */
  /**
   * Two accounts cannot share one port: the second listener would fail to bind
   * only after it was saved, which looks like a crash rather than a conflict.
   */
  #assertPortFree(port, botId = null) {
    if (!Number.isInteger(port)) return;
    const clash = this.#configStore.list().find((config) => config.botId !== botId && config.port === port);
    if (clash === undefined) return;
    const error = new Error(`端口 ${port} 已被 QQ ${clash.selfId} 使用，每个账号需要独立端口。`);
    error.code = 'onebot-port-in-use';
    throw error;
  }

  async addBot({ selfId, accessToken, name, ...settings } = {}) {
    if (this.#closed) throw new Error('OneBot controller is closed');
    const normalizedSelfId = cleanString(String(selfId ?? ''));
    if (!normalizedSelfId) throw new TypeError('A QQ number (selfId) is required');
    const identity = deriveOneBotBotIdentity(normalizedSelfId);
    const previous = this.#configStore.get(identity.botId);
    this.#assertPortFree(normalizeOneBotSettings(settings).port, identity.botId);
    const token = cleanString(accessToken);
    if (token !== null && this.#credentials !== null) {
      await this.#credentials.set(identity.accessTokenRef, token);
    }
    const saved = await this.#configStore.save({
      ...normalizeOneBotSettings(settings),
      selfId: normalizedSelfId,
      name: cleanString(name) ?? undefined,
      accessTokenRef: previous?.accessTokenRef ?? identity.accessTokenRef,
    });
    await this.#restart(saved.botId);
    return this.status();
  }

  /** Remove the account, its listener and its stored token. */
  async deleteBot(botId) {
    if (this.#closed) throw new Error('OneBot controller is closed');
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown OneBot bot');
    await this.#stopRuntime(botId);
    await this.#configStore.remove(botId);
    if (config.accessTokenRef && this.#credentials !== null
      && typeof this.#credentials.unset === 'function') {
      // A token the credential store does not hold is not an error worth failing
      // the removal over.
      await Promise.resolve()
        .then(() => this.#credentials.unset(config.accessTokenRef))
        .catch(() => {});
    }
    this.#errors.delete(botId);
    this.#revision += 1;
    return this.status();
  }

  /** Persist settings and restart the listener with them. */
  async setSettings(botId, patch = {}) {
    if (this.#closed) throw new Error('OneBot controller is closed');
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown OneBot bot');
    if (patch.port !== undefined) this.#assertPortFree(patch.port, botId);
    const format = cleanString(patch.imageSendFormat);
    const saved = await this.#configStore.update(botId, {
      ...(patch.port === undefined ? {} : { port: patch.port }),
      ...(patch.host === undefined ? {} : { host: patch.host }),
      ...(patch.path === undefined ? {} : { path: patch.path }),
      ...(format === null || !ONEBOT_IMAGE_FORMATS.includes(format) ? {} : { imageSendFormat: format }),
      ...(patch.selfIds === undefined ? {} : { selfIds: patch.selfIds }),
    });
    await this.#restart(saved.botId);
    return this.status();
  }

  /** Stop and start one bot's listener; optionally send a test message after. */
  async restartBot(botId, { sendTest = false } = {}) {
    if (this.#closed) throw new Error('OneBot controller is closed');
    await this.#restart(botId);
    const status = this.status();
    if (!sendTest) return status;
    return { ...status, testMessage: await this.#sendTestMessage(botId) };
  }

  /**
   * The connect check: one short message to wherever the last inbound message
   * came from. With no conversation yet there is nothing to prove, so say that
   * instead of pretending the check passed.
   */
  async #sendTestMessage(botId) {
    const runtime = this.#runtimes.get(botId);
    const target = runtime?.status?.lastTarget;
    if (!runtime || !target) return { sent: false, code: 'test-target-unavailable' };
    try {
      await runtime.sendText(target, '连接检查：收到这条说明收发正常。');
      return { sent: true };
    } catch (error) {
      return { sent: false, code: 'test-send-failed', message: error?.message ?? String(error) };
    }
  }

  status() {
    const bots = this.#configStore.list().map((config) => {
      const runtime = this.#runtimes.get(config.botId);
      const snapshot = runtime?.status ?? createOneBotRuntimeStatus();
      return {
        botId: config.botId,
        selfId: config.selfId,
        name: runtime?.status?.nickname ?? config.name,
        // The workspace-aware wrapper renames `bot.name` from the saved alias, so
        // the bot object has to exist here or an alias would never reach the card.
        bot: { name: runtime?.status?.nickname ?? config.name },
        host: config.host,
        port: config.port,
        path: config.path,
        imageSendFormat: config.imageSendFormat,
        selfIds: config.selfIds,
        accessTokenConfigured: Boolean(config.accessTokenRef),
        ...snapshot,
        ...(this.#errors.has(config.botId) ? { error: this.#errors.get(config.botId) } : {}),
      };
    });
    return { revision: this.#revision, ready: bots.some((bot) => bot.ready === true), bots };
  }

  /**
   * Proactive text for delivery targets: one new message to a QQ user or group,
   * through the bot that owns this account. QQ has no reply threading.
   */
  async sendProactiveText(botId, target, text) {
    const runtime = this.#runtimes.get(botId);
    if (!runtime) {
      const error = new Error('OneBot 机器人未在运行。');
      error.code = 'onebot-bot-inactive';
      throw error;
    }
    const recipient = target?.groupId !== undefined
      ? { groupId: String(target.groupId) }
      : target?.userId !== undefined ? { userId: String(target.userId) } : null;
    if (recipient === null) {
      const error = new Error('投递目标缺少 userId 或 groupId。');
      error.code = 'onebot-target-invalid';
      throw error;
    }
    return runtime.sendText(recipient, String(text ?? ''));
  }

  async close() {
    this.#closed = true;
    for (const botId of [...this.#runtimes.keys()]) {
      await this.#stopRuntime(botId);
    }
    this.#revision += 1;
  }

  async #restart(botId) {
    await this.#stopRuntime(botId);
    const config = this.#configStore.get(botId);
    if (!config) return;
    try {
      await this.#startRuntime(config);
      this.#errors.delete(botId);
    } catch (error) {
      this.#errors.set(botId, safeError(
        'listen-failed',
        `无法监听 ${config.host}:${config.port}：${error?.message ?? error}`,
      ));
    }
    this.#revision += 1;
  }

  async #startRuntime(config) {
    const accessToken = await this.#resolveAccessToken(config);
    const state = await this.#stateFor(config.botId);
    // The factory may be async: production awaits the workspace record before it
    // can hand the runtime its own harness scope.
    const runtime = await this.#createRuntime({
      config: { ...config, accessToken },
      harness: this.#harness,
      state,
      contextEnhancement: this.#contextEnhancement,
      accessPolicy: this.#accessPolicy,
      loadImage: this.#loadImage,
      logger: this.#logger,
      ...this.#replyTimeoutMs === undefined ? {} : { replyTimeoutMs: this.#replyTimeoutMs },
    });
    this.#runtimes.set(config.botId, runtime);
    await runtime.start();
    return runtime;
  }

  async #stopRuntime(botId) {
    const runtime = this.#runtimes.get(botId);
    if (!runtime) return;
    this.#runtimes.delete(botId);
    try {
      await runtime.stop();
    } catch (error) {
      this.#logger?.warn?.(`[dsh-im:onebot] stop failed for ${botId}: ${error?.message ?? error}`);
    }
  }

  async #resolveAccessToken(config) {
    if (!config.accessTokenRef || this.#credentials === null) return '';
    const resolved = await this.#credentials.resolve(config.accessTokenRef);
    return typeof resolved?.value === 'string' ? resolved.value : '';
  }
}
