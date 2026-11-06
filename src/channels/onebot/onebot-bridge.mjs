import { TextHarnessBridge, createTextBridgeStatus } from '../shared/text-harness-bridge.mjs';

/**
 * OneBot has no reactions, no message editing and no typing indicator, so the
 * descriptor declares none. A finished turn leaves no trace behind, which is
 * also why the channel never has to clean a placeholder up.
 */
export const ONEBOT_DESCRIPTOR = Object.freeze({
  key: 'onebot',
  label: 'OneBot',
  connectionLabel: ' OneBot v11 反向 WebSocket',
  reactions: Object.freeze({ processing: null, success: null, error: null }),
});

export class OneBotHarnessBridge extends TextHarnessBridge {
  constructor(options) {
    super({ descriptor: ONEBOT_DESCRIPTOR, ...options });
  }
}

export { createTextBridgeStatus as createOneBotBridgeStatus };
