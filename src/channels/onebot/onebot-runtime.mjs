/**
 * The OneBot runtime: one reverse-WebSocket listener per bot.
 *
 * It owns the transport and the bridge, nothing else. Inbound frames are
 * normalized and handed to `bridge.accept`; outbound messages go through the bot
 * client the bridge already holds. The protocol end owns reconnection, so a
 * disconnect only flips the status back to "listening" and waits.
 */
import { readFile, stat } from 'node:fs/promises';
import { createOneBotApi, downloadOneBotMedia } from './onebot-api.mjs';
import { createOneBotBotClient } from './onebot-bot.mjs';
import { createOneBotBridgeStatus, OneBotHarnessBridge } from './onebot-bridge.mjs';
import { createOneBotServer } from './onebot-connection.mjs';
import {
  normalizeOneBotEvent,
  oneBotAddressedForQuote,
  oneBotApiGroupList,
  oneBotUnhandledFrameKind,
  oneBotQuotedReference,
} from './onebot-normalize.mjs';

/** How often one unhandled frame kind may be named in the log. */
const UNHANDLED_FRAME_LOG_WINDOW_MS = 10 * 60 * 1000;

/**
 * How long a failed image url suppresses further url attempts for the account.
 * The rkey that signs those links is issued by the protocol end; when its rkey
 * service is gone every link is dead, and probing each one costs a round trip
 * before the same `get_image` fallback runs anyway.
 */
const IMAGE_URL_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * A path the protocol end put on this machine, or undefined for anything else:
 * an `image` segment may carry a cached file path where a url is expected.
 */
function absolutePathOf(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return /^(?:[A-Za-z]:[\\/]|\/)/u.test(value) ? value : undefined;
}

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

  #bot = null;

  #lastTarget = null;

  /** kind → last time it was named in the log, so one shape cannot spam. */
  #ignoredFrames = new Map();

  #loadImage;

  /** `file`/`file_id` → the bytes NapCat staged locally (see #loadFile). */
  #loadFile;

  /** `image` segment → bytes, by url or by `get_image` (see #downloadImage). */
  #loadInboundImage;

  /**
   * When an image url last failed for this account. The url is signed with an
   * rkey that dies with the protocol end's rkey service — once that happens
   * every link is dead, so retrying each image only costs a doomed request.
   */
  #imageUrlFailedAt = 0;

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
    // Inbound media comes from signed urls the protocol end attaches; without a
    // downloader both images and files would fail at prompt preparation.
    this.#loadImage = loadImage ?? downloadOneBotMedia;
    // The conversation travels as the third argument: the url extensions need
    // it, and dropping it here is what made every load report ctx=none.
    this.#loadFile = (data, options, context) => this.#downloadFile(data, options, context);
    this.#loadInboundImage = (data, options, context) => this.#downloadImage(data, options, context);
    this.#status = status;
  }

  get status() {
    return structuredClone({
      ...this.#status,
      // Where the last inbound message came from; the connect check sends its
      // test message there.
      ...(this.#lastTarget === null ? {} : { lastTarget: this.#lastTarget }),
    });
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
    this.#bot = bot;
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
      // One listener, one account: the protocol end must claim this QQ number.
      selfId: this.#config.selfId,
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

  /**
   * Resolve a quoted message id through `get_msg`. QQ's `reply` segment carries
   * only the id, so without this the reply block reaches the model as
   * `not-delivered` even though the message exists.
   */
  /**
   * Bytes for an inbound `file`/`video`/`record` segment.
   *
   * NapCat sends those segments with **no url**: the frame carries only `file`
   * and `file_id`, and its `get_file` action answers with a **local path** in
   * `url` (plus the same path in `file`), not an http link. That is why an image
   * (which does carry an http url) arrived while every other file "exploded" at
   * prompt preparation. Resolve the id, then read whichever form comes back.
   */
  /** Read a path the protocol end staged locally, honouring the size cap. */
  async #readStaged(file, options = {}) {
    const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0
      ? options.maxBytes : undefined;
    if (maxBytes !== undefined) {
      const info = await stat(file);
      if (info.size > maxBytes) throw new Error(`OneBot media is ${info.size} bytes; the limit is ${maxBytes}`);
    }
    return readFile(file);
  }

  /**
   * Bytes for an inbound `image` segment.
   *
   * The url an image segment carries is signed with an rkey that expires, and
   * NapCat's rkey service is frequently disabled — a sticker sent minutes ago
   * then answers `{"retcode":-5503007,"retmsg":"download url has expired"}`. The
   * image is still on disk, so `get_image` answers with that cached path and the
   * base64 payload; either form feeds the turn. This is why a chat full of
   * animated stickers used to fail with IMAGE_DOWNLOAD_FAILED.
   */
  async #downloadImage(data, options = {}, context = null) {
    const fileName = typeof data?.file === 'string' && data.file ? data.file : 'image';
    const via = (route, bytes) => {
      const size = bytes?.data?.length ?? bytes?.length ?? '?';
      this.#logger?.info?.(`[dsh-im:onebot] inbound image via ${route} (${fileName}, ${size} bytes)`);
      return bytes;
    };
    let lastError = null;
    const direct = typeof data?.url === 'string' && /^https?:\/\//i.test(data.url)
      ? data.url : undefined;
    // A failure inside the cooldown window means the rkey source is still dead:
    // skip the doomed request and go straight to get_image.
    const cooling = Date.now() - this.#imageUrlFailedAt < IMAGE_URL_COOLDOWN_MS;
    if (direct !== undefined && cooling) {
      this.#logger?.info?.(
        `[dsh-im:onebot] image url skipped for ${fileName}: a recent url download failed`,
      );
    } else if (direct !== undefined) {
      try {
        return via('segment-url', await this.#loadImage(direct, options));
      } catch (error) {
        lastError = error;
        this.#imageUrlFailedAt = Date.now();
        this.#logger?.info?.(
          `[dsh-im:onebot] image url download failed for ${fileName}: ${error?.message ?? error}`,
        );
      }
    }
    // Some protocol ends inline an absolute path in `url` or `file`.
    const inline = absolutePathOf(data?.file) ?? absolutePathOf(data?.url);
    if (inline !== undefined) {
      try {
        return via('staged-path', await this.#readStaged(inline, options));
      } catch (error) {
        lastError = error;
      }
    }
    const session = this.#session;
    const api = session === null || session === undefined ? null : this.#createApi(session);
    if (api !== null && typeof data?.file === 'string' && data.file) {
      try {
        const resolved = await api.getImage({ file: data.file });
        const staged = absolutePathOf(resolved?.file);
        if (staged !== undefined) {
          try {
            return via('get-image-path', await this.#readStaged(staged, options));
          } catch (error) {
            lastError = error;
          }
        }
        if (typeof resolved?.base64 === 'string' && resolved.base64) {
          const payload = resolved.base64.replace(/^base64:\/\//u, '');
          return via('get-image-base64', Buffer.from(payload, 'base64'));
        }
      } catch (error) {
        lastError = error;
        this.#logger?.info?.(
          `[dsh-im:onebot] get_image failed for ${fileName}: ${error?.message ?? error}`,
        );
      }
    }
    throw new Error(
      `OneBot image ${fileName} could not be fetched`
      + (lastError === null ? '' : `: ${lastError?.message ?? lastError}`),
    );
  }

  async #downloadFile(data, options = {}, context = null) {
    const fileName = typeof data?.file === 'string' && data.file ? data.file : 'file';
    const session = this.#session;
    const identifier = typeof data?.file_id === 'string' && data.file_id
      ? data.file_id
      : (typeof data?.file === 'string' && data.file ? data.file : undefined);
    const api = session === null || session === undefined ? null : this.#createApi(session);
    // Why a url action was skipped matters as much as the route itself: a
    // missing id or a missing conversation both fall straight to get_file.
    const note = `id=${identifier === undefined ? 'no' : 'yes'}`
      + ` ctx=${context ? (context.groupId ? 'group' : 'private') : 'none'}`;
    const via = (route, bytes) => {
      // Which route fed this file is the question every protocol end raises, so
      // answer it in the log instead of making the next reader re-derive it. The
      // downloader answers `{ data, mediaType }`, a staged read answers a Buffer.
      const size = bytes?.data?.length ?? bytes?.length ?? '?';
      this.#logger?.info?.(
        `[dsh-im:onebot] inbound file via ${route} (${fileName}, ${size} bytes, ${note})`,
      );
      return bytes;
    };
    const direct = typeof data?.url === 'string' && /^https?:\/\//i.test(data.url)
      ? data.url : undefined;
    if (direct !== undefined) return via('segment-url', await this.#loadImage(direct, options));
    // NapCat extensions hand back a real http url, which works even when the
    // staged file is outside this machine's view. A failed download (expired
    // rkey, CDN error) falls through to get_file instead of failing the turn.
    if (api !== null && identifier !== undefined && context) {
      try {
        const resolvedUrl = context.groupId
          ? await api.getGroupFileUrl(context.groupId, identifier)
          : await api.getPrivateFileUrl(context.userId, identifier);
        const url = typeof resolvedUrl?.url === 'string' ? resolvedUrl.url : '';
        if (/^https?:\/\//i.test(url)) {
          return via(context.groupId ? 'group-file-url' : 'private-file-url', await this.#loadImage(url, options));
        }
        this.#logger?.info?.(`[dsh-im:onebot] file url action returned no http url for ${fileName}`);
      } catch (error) {
        // Refused or unimplemented here: fall through to get_file.
        this.#logger?.info?.(
          `[dsh-im:onebot] file url action unavailable for ${fileName}: ${error?.message ?? error}`,
        );
      }
    }
    let resolved = data;
    if (api !== null && identifier !== undefined) {
      resolved = await api.getFile({
        file_id: identifier,
        ...(typeof data?.file === 'string' && data.file ? { file: data.file } : {}),
      });
    }
    const url = typeof resolved?.url === 'string' ? resolved.url : '';
    if (/^https?:\/\//i.test(url)) return via('get-file-url', await this.#loadImage(url, options));
    // A staged local path is cheaper than a base64 payload, so prefer it even
    // when get_file sends both (NapCat does once "local file to url" is on).
    const staged = typeof resolved?.file === 'string' && resolved.file
      ? resolved.file
      : (/^(?:[A-Za-z]:[\\/]|\/)/.test(url) ? url : '');
    if (staged) {
      const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0
        ? options.maxBytes : undefined;
      if (maxBytes !== undefined) {
        const info = await stat(staged);
        if (info.size > maxBytes) throw new Error(`OneBot file is ${info.size} bytes; the limit is ${maxBytes}`);
      }
      return via('staged-path', await readFile(staged));
    }
    if (typeof resolved?.base64 === 'string' && resolved.base64) {
      return via('base64', Buffer.from(resolved.base64, 'base64'));
    }
    throw new Error('OneBot file segment has no download url and get_file returned none');
  }

  async #loadReply(messageId) {
    const session = this.#session;
    if (session === null || session === undefined) return null;
    const api = this.#createApi(session);
    return oneBotQuotedReference(await api.getMsg(messageId));
  }

  /**
   * A reply to our own message is the QQ equivalent of Telegram's "reply to the
   * bot", so it must wake the model under the mention trigger. The id alone does
   * not say who wrote the quoted message, so resolve it first.
   */
  async #addressedForQuote(message) {
    if (message.addressed || message.kind !== 'group') return message;
    if (message.taggedAtSelf === true || typeof message.replyTo?.load !== 'function') return message;
    let quoted;
    try {
      quoted = await message.replyTo.load({});
    } catch (error) {
      this.#logger?.warn?.(`[dsh-im:onebot] get_msg failed for ${message.replyTo.messageId}: ${error?.message ?? error}`);
      return message;
    }
    const selfId = this.#session?.selfId ?? this.#config.selfId;
    if (quoted === null || quoted === undefined || String(quoted.authorId ?? '') !== String(selfId)) {
      return message;
    }
    if (oneBotAddressedForQuote(this.#config.groupTriggers, {
      chatId: message.chatId,
      senderId: message.senderId,
    })) {
      message.addressed = true;
      message.repliedToBot = true;
    }
    return message;
  }

  /**
   * Frames an adapter sends that are not a chat message: its own echoes
   * (`message_sent`), notices such as a group file upload, and meta events.
   *
   * They are dropped on purpose, but silently dropping them made a protocol end
   * that pushes a new shape look like "the bot received something it does not
   * understand". Each kind is named once per window instead, so the next new
   * event can be identified from the log without enabling debug logging.
   */
  #noteUnhandledFrame(frame) {
    const kind = oneBotUnhandledFrameKind(frame);
    const previous = this.#ignoredFrames.get(kind) ?? 0;
    if (Date.now() - previous < UNHANDLED_FRAME_LOG_WINDOW_MS) return;
    this.#ignoredFrames.set(kind, Date.now());
    this.#logger?.info?.(`[dsh-im:onebot] ignored frame ${kind}`);
  }

  #onFrame(frame) {
    if (this.#stopped || this.#bridge === null) return;
    if (frame?.post_type !== 'message') {
      this.#noteUnhandledFrame(frame);
      return;
    }
    let message;
    try {
      message = normalizeOneBotEvent(frame, {
        selfId: this.#session?.selfId ?? this.#config.selfId,
        groupTriggers: this.#config.groupTriggers,
        loadImage: this.#loadInboundImage,
        loadFile: this.#loadFile,
        loadReply: (messageId, options) => this.#loadReply(messageId, options),
      });
    } catch (error) {
      // A CQ-string message is the one shape the first version refuses; say so
      // once per frame instead of dropping it silently.
      this.#logger?.warn?.(`[dsh-im:onebot] dropped a message: ${error?.message ?? error}`);
      return;
    }
    if (!message) return;
    // A frame NapCat/NapCat-like ends push that carries no text, media or quote
    // (an unknown segment, a system record) cannot become a turn; answering it
    // used to fall through to the bridge's "text, images and files only" reply.
    // Name the segment kinds once and drop it instead.
    if (!String(message.content ?? '').trim()
      && (message.images ?? []).length === 0 && (message.files ?? []).length === 0
      && message.replyTo === undefined) {
      const kinds = [...new Set((Array.isArray(frame?.message) ? frame.message : [])
        .map((segment) => String(segment?.type ?? 'unknown')))].join(',') || 'none';
      const key = `content-less:${kinds}`;
      if (Date.now() - (this.#ignoredFrames.get(key) ?? 0) >= UNHANDLED_FRAME_LOG_WINDOW_MS) {
        this.#ignoredFrames.set(key, Date.now());
        this.#logger?.info?.(
          `[dsh-im:onebot] dropped a content-less message (segments=${kinds}); `
          + 'NapCat turns QQ gray tips such as a file receipt into an empty message',
        );
      }
      return;
    }
    // Remember the origin so the connect check has somewhere to send its test.
    if (message.replyTarget) this.#lastTarget = { ...message.replyTarget };
    void this.#addressedForQuote(message)
      .then((ready) => this.#bridge?.accept(ready))
      .catch((error) => {
        this.#logger?.warn?.(`[dsh-im:onebot] bridge rejected a message: ${error?.message ?? error}`);
      });
  }

  /** Send one proactive text (delivery targets) through this account's bot. */
  async sendText(target, text) {
    if (this.#bot === null || this.#stopped) {
      const error = new Error('OneBot 账号未连接。');
      error.code = 'onebot-bot-inactive';
      throw error;
    }
    return this.#bot.sendText(target, text);
  }

  /**
   * The groups this account has joined, for the group-rules settings page.
   *
   * Nothing is cached: a group joined or left five minutes ago must show up
   * correctly, and the panel is opened rarely enough to pay one round trip.
   */
  async listGroups() {
    const session = this.#session;
    if (session === null || session === undefined) {
      const error = new Error('OneBot 账号未连接。');
      error.code = 'onebot-not-connected';
      throw error;
    }
    const api = this.#createApi(session);
    return oneBotApiGroupList(await api.getGroupList());
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
