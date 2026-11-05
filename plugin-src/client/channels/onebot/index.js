import * as React from 'react';

import { OneBotLogoGlyph } from '../../channel-logos.js';
import { h, localizeTemplate } from '../../i18n.js';
import {
  ONEBOT_ENDPOINTS,
  normalizeSnapshot,
  presentError,
  unwrapRpcResult,
} from './api.js';
import { installOneBotStyles } from './styles.js';

const POLL_INTERVAL_MS = 5_000;
const IMAGE_FORMATS = [
  { id: 'auto', label: '自动（推荐）' },
  { id: 'base64', label: 'base64' },
  { id: 'url', label: 'url' },
  { id: 'file', label: 'file://' },
];

function maskSelfId(selfId) {
  const value = String(selfId ?? '');
  return value.length > 6 ? `${value.slice(0, 4)}•••${value.slice(-3)}` : value;
}

function stateLabel(bot) {
  if (bot.error) return { state: 'error', text: bot.error };
  if (bot.connected) return { state: 'connected', text: '已连接' };
  if (bot.listening) return { state: 'listening', text: '监听中，等待协议端接入' };
  return { state: 'idle', text: '未启动' };
}

/** A labelled field row, matching the shared settings look. */
function Field({ label, hint, children }) {
  return h('label', { className: 'dim-credentialField' },
    h('span', null, label),
    children,
    hint ? h('span', { className: 'dob-formHint' }, hint) : null);
}

export function OneBotSettingsTab({ rpcCall }) {
  const [snapshot, setSnapshot] = React.useState({ revision: 0, ready: false, bots: [] });
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [open, setOpen] = React.useState(false);
  const [selfId, setSelfId] = React.useState('');
  const [port, setPort] = React.useState('6700');
  const [accessToken, setAccessToken] = React.useState('');
  const [imageFormat, setImageFormat] = React.useState('auto');

  React.useEffect(() => installOneBotStyles(), []);

  const refresh = React.useCallback(async () => {
    try {
      const value = await rpcCall(ONEBOT_ENDPOINTS.status, {});
      setSnapshot(normalizeSnapshot(unwrapRpcResult(value)));
      setError(null);
    } catch (failure) {
      setError(presentError(failure));
    } finally {
      setLoading(false);
    }
  }, [rpcCall]);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (operation) => {
    setBusy(true);
    setError(null);
    try {
      const value = await operation();
      setSnapshot(normalizeSnapshot(unwrapRpcResult(value)));
    } catch (failure) {
      setError(presentError(failure));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    const normalizedSelfId = selfId.trim();
    if (!/^\d{5,12}$/.test(normalizedSelfId)) {
      setError({ code: 'onebot-invalid-self-id', message: '请填写 QQ 号（5–12 位数字）。' });
      return;
    }
    const normalizedPort = Number(port);
    if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
      setError({ code: 'onebot-invalid-port', message: '端口需在 1–65535 之间。' });
      return;
    }
    void run(async () => {
      const result = await rpcCall(ONEBOT_ENDPOINTS.addBot, {
        selfId: normalizedSelfId,
        port: normalizedPort,
        imageSendFormat: imageFormat,
        ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
      });
      setOpen(false);
      setSelfId('');
      setAccessToken('');
      return result;
    });
  };

  const bots = snapshot.bots;
  return h('section', { className: 'ddt-card dim-surfaceCard dob-page' },
    h('header', { className: 'dob-row', style: { justifyContent: 'space-between' } },
      h('h3', { style: { margin: 0, fontSize: 15 } }, 'OneBot 机器人'),
      h('button', {
        type: 'button',
        className: 'ddt-button',
        'data-kind': 'primary',
        onClick: () => setOpen(!open),
        disabled: busy,
      }, open ? '收起' : '接入账号')),
    h('p', { className: 'dob-formHint', style: { margin: '6px 0 0' } },
      'OneBot v11 反向 WebSocket。协议端（SnowLuma / NapCat / Lagrange）连到本机，插件只负责收与发。'),
    error ? h('p', { className: 'dob-state', 'data-state': 'error', role: 'alert' }, error.message) : null,
    open ? h('form', { className: 'dob-form', onSubmit: submit, style: { marginTop: 14 } },
      h(Field, { label: 'QQ 号' },
        h('input', {
          value: selfId,
          onChange: event => setSelfId(event.target.value),
          placeholder: '2951316926',
          inputMode: 'numeric',
          autoComplete: 'off',
          disabled: busy,
          required: true,
        })),
      h(Field, { label: '监听端口' },
        h('input', {
          value: port,
          onChange: event => setPort(event.target.value),
          placeholder: '6700',
          inputMode: 'numeric',
          autoComplete: 'off',
          disabled: busy,
        })),
      h(Field, { label: '访问令牌（可选）', hint: '协议端配置里填同一个令牌；留空表示只靠回环地址信任。' },
        h('input', {
          type: 'password',
          value: accessToken,
          onChange: event => setAccessToken(event.target.value),
          placeholder: '留空则校验关闭',
          maxLength: 512,
          autoComplete: 'new-password',
          disabled: busy,
        })),
      h(Field, { label: '出站图片形态', hint: 'auto 会依次尝试 base64 与 url，成功后记住。' },
        h('select', {
          value: imageFormat,
          onChange: event => setImageFormat(event.target.value),
          disabled: busy,
        }, IMAGE_FORMATS.map(format => h('option', { key: format.id, value: format.id }, format.label)))),
      h('div', { className: 'dim-viewActions', style: { gridColumn: '1 / -1' } },
        h('button', {
          type: 'submit',
          className: 'ddt-button',
          'data-kind': 'primary',
          disabled: busy || !selfId.trim(),
        }, busy ? '正在保存…' : '保存并开始监听'))) : null,
    loading ? h('p', { className: 'dob-formHint' }, '正在读取状态…')
      : bots.length === 0
        ? h('p', { className: 'dob-formHint', style: { marginTop: 14 } },
          '还没有账号。添加后，协议端把反向 WebSocket 指向下面的地址即可。')
        : h('ul', { style: { listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'grid', gap: 10 } },
          bots.map(bot => {
            const status = stateLabel(bot);
            return h('li', {
              key: bot.botId,
              style: {
                display: 'grid',
                gap: 6,
                padding: '12px 14px',
                border: '1px solid var(--dsw-alias-border-l2, #e5e6eb)',
                borderRadius: 10,
              },
            },
            h('div', { className: 'dob-row', style: { justifyContent: 'space-between' } },
              h('div', { className: 'dob-row' },
                h('span', { className: 'dob-avatar dim-logo', style: { width: 22, height: 22 } }, h(OneBotLogoGlyph, { size: 22 })),
                h('strong', null, bot.nickname ?? bot.name),
                h('span', { className: 'dob-formHint', style: { margin: 0 } }, maskSelfId(bot.selfId))),
              h('span', { className: 'dob-state', 'data-state': status.state },
                status.text,
                status.state === 'connected' && bot.nickname ? ` · ${bot.nickname}` : '')),
            h('div', { className: 'dob-formHint', style: { margin: 0 } },
              `ws://127.0.0.1:${bot.port}${bot.path}`),
            h('div', { className: 'dob-row' },
              h('button', {
                type: 'button',
                className: 'ddt-button',
                disabled: busy,
                onClick: () => void run(() => rpcCall(ONEBOT_ENDPOINTS.restartBot, { botId: bot.botId })),
              }, '重启监听'),
              h('button', {
                type: 'button',
                className: 'ddt-button',
                disabled: busy,
                onClick: () => {
                  if (!window.confirm(localizeTemplate('删除 {name} 并停止监听？', { name: maskSelfId(bot.selfId) }))) return;
                  void run(() => rpcCall(ONEBOT_ENDPOINTS.deleteBot, { botId: bot.botId, confirm: true }));
                },
              }, '删除')));
          })));
}
