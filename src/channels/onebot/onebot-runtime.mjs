/**
 * The OneBot runtime: one reverse-WebSocket listener per bot.
 *
 * It owns the transport and the bridge, nothing else. Inbound frames are
 * normalized and handed to `bridge.accept`; outbound messages go through the bot
 * client the bridge already holds. The protocol end owns reconnection, so a
 * disconnect only flips the status back to "listening" and waits.
 */
import { createOneBotApi } from './onebot-api.mjs';
import { createOneBotBotClient } from './onebot-bot.mjs';
import { createOneBotBridgeStatus, OneBotHarnessBridge } from './onebot-bridge.mjs';
import { createOneBotServer } from './onebot-connection.mjs';
import { normalizeOneBotEvent } from './onebot-normalize.mjs';

/** Convenience factory; the class stays exported for callers that subclass. */
export function createOneBotRuntime(options) {
  return new OneBotRuntime(options);
}

export function createOneBotRuntimeStatus() {
  return {
    startedAt: null,
    ready: false,
    connectionState: 'idle',
    listening: false,
    selfId: null,
    nickname: null,
    harnessReachable: false,
    lastConnectedAt: null,
    lastError: null,
    ...createOneBotBridgeStatus(),
  };
}

export class OneBotRuntime {
  #config;

  #harness;

  #state;

  #contextEnhancement;

  #accessPolicy;

  #logger;

  #replyTimeoutMs;

  #createServer;

  #createBridge;

  #createApi;

  #loadImage;

  #status;

  #server = null;

  #bridge = null;

  #session = null;

  #abortController = null;

  #stopped = true;

  #starting = null;

  #address = null;

  constructor({
    config,
    harness,
    state,
    contextEnhancement,
    accessPolicy,
    logger = console,
    replyTimeoutMs,
    createServer = createOneBotServer,
    createBridge = (options) => new OneBotHarnessBridge(options),
    createApi = createOneBotApi,
    loadImage,
    status = createOneBotRuntimeStatus(),
  }) {
    if (!config?.botId) throw new TypeError('OneBot runtime needs a bot config');
    if (!harness || !state) throw new TypeError('OneBot runtime needs the harness client and state store');
    this.#config = config;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#accessPolicy = accessPolicy;
    this.#logger = logger;
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#createServer = createServer;
    this.#createBridge = createBridge;
    this.#createApi = createApi;
    this.#loadImage = loadImage;
    this.#status = status;
  }

  get status() {
    return structuredClone(this.#status);
  }

  get ready() {
    return this.#status.ready === true;
  }

  /** The bound address after `start()` (`{ address, family, port }`). */
  get address() {
    return this.#address;
  }

  /** Start listening. Safe to call twice; the second call returns the same run. */
  start() {
    if (this.#starting !== null) return this.#starting;
    this.#starting = this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start() {
    await this.stop();
    this.#stopped = false;
    this.#status.startedAt = new Date().toISOString();
    this.#status.connectionState = 'connecting';
    this.#status.lastError = null;
    const controller = new AbortController();
    this.#abortController = controller;

    const bot = createOneBotBotClient({
      getApi: () => (this.#session === null ? undefined : this.#createApi(this.#session)),
      logger: this.#logger,
      format: this.#config.imageSendFormat,
    });
    this.#bridge = this.#createBridge({
      bot,
      harness: this.#harness,
      state: this.#state,
      contextEnhancement: this.#contextEnhancement,
      accessPolicy: this.#accessPolicy,
      status: this.#status,
      logger: this.#logger,
      ...this.#replyTimeoutMs === undefined ? {} : { replyTimeoutMs: this.#replyTimeoutMs },
      signal: controller.signal,
    });

    this.#server = this.#createServer({
      host: this.#config.host,
      port: this.#config.port,
      path: this.#config.path,
      accessToken: this.#config.accessToken ?? '',
      selfIds: this.#config.selfIds ?? [],
      logger: this.#logger,
    });
    this.#server.onState(({ kind, session }) => {
      if (kind === 'connected') {
        this.#session = session;
        this.#status.ready = true;
        this.#status.connectionState = 'connected';
        this.#status.selfId = session.selfId;
        this.#status.lastConnectedAt = new Date().toISOString();
        void this.#describeAccount(session);
        return;
      }
      if (this.#session === session) this.#session = null;
      this.#status.ready = false;
      this.#status.connectionState = 'listening';
    });
    this.#server.onFrame((frame) => this.#onFrame(frame));

    try {
      this.#address = await this.#server.listen();
    } catch (error) {
      this.#status.connectionState = 'failed';
      this.#status.lastError = error instanceof Error ? error.message : String(error);
      await this.stop();
      throw error;
    }
    this.#status.listening = true;
    this.#status.connectionState = 'listening';
    // The harness check is advisory: a protocol end may connect before the Host
    // is ready, and the bridge retries on its own.
    if (typeof this.#harness?.ensureRunning === 'function') {
      try {
        await this.#harness.ensureRunning();
        this.#status.harnessReachable = true;
      } catch (error) {
        this.#status.harnessReachable = false;
        this.#status.lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return this.status;
  }

  /** Fill the account name once connected; never fail a turn over it. */
  async #describeAccount(session) {
    try {
      const api = this.#createApi(session);
      const info = await api.getLoginInfo();
      if (this.#session === session && typeof info?.nickname === 'string') {
        this.#status.nickname = info.nickname;
      }
    } catch (error) {
      this.#logger?.warn?.(`[dsh-im:onebot] get_login_info failed: ${error?.message ?? error}`);
    }
  }

  #onFrame(frame) {
    if (this.#stopped || this.#bridge === null) return;
    let message;
    try {
      message = normalizeOneBotEvent(frame, {
        selfId: this.#session?.selfId ?? this.#config.selfId,
        groupTriggers: this.#config.groupTriggers,
        loadImage: this.#loadImage,
      });
    } catch (error) {
      // A CQ-string message is the one shape the first version refuses; say so
      // once per frame instead of dropping it silently.
      this.#logger?.warn?.(`[dsh-im:onebot] dropped a message: ${error?.message ?? error}`);
      return;
    }
    if (!message) return;
    void this.#bridge.accept(message).catch((error) => {
      this.#logger?.warn?.(`[dsh-im:onebot] bridge rejected a message: ${error?.message ?? error}`);
    });
  }

  async stop() {
    this.#stopped = true;
    this.#abortController?.abort();
    this.#abortController = null;
    const server = this.#server;
    const bridge = this.#bridge;
    this.#server = null;
    this.#bridge = null;
    this.#session = null;
    this.#status.ready = false;
    this.#status.listening = false;
    this.#status.connectionState = 'idle';
    this.#address = null;
    try {
      await server?.close();
    } catch (error) {
      this.#logger?.warn?.(`[dsh-im:onebot] listener close failed: ${error?.message ?? error}`);
    }
    await Promise.race([
      bridge?.waitForIdle?.() ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    return this.status;
  }
}
