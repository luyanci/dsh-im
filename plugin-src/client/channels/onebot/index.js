import * as React from 'react';

import { ConnectionError } from '../../connection-error.js';
import { OneBotLogoGlyph } from '../../channel-logos.js';
import { h, localizeTemplate, localizeText } from '../../i18n.js';
import { installDingtalkStyles } from '../dingtalk/styles.js';
import {
  ONEBOT_ENDPOINTS,
  normalizeSnapshot,
  presentError,
  unwrapRpcResult,
} from './api.js';
import { installOneBotStyles } from './styles.js';

const POLL_INTERVAL_MS = 5_000;
const IMAGE_FORMATS = ['auto', 'base64', 'url', 'file'];

/** Same button shell the shared channel cards use. */
function Button({ children, kind = 'secondary', className = '', ...props }) {
  return h('button', {
    ...props,
    type: 'button',
    className: `ddt-button ${className}`.trim(),
    'data-kind': kind,
  }, children);
}

function maskSelfId(selfId) {
  const value = String(selfId ?? '');
  return value.length > 6 ? `${value.slice(0, 4)}•••${value.slice(-3)}` : value;
}

function addressOf(account) {
  return `ws://${account.host}:${account.port}${account.path}`;
}

function accountState(account) {
  if (account.error) return { tone: 'error', text: '连接未就绪' };
  if (account.connected) return { tone: 'success', text: '运行正常' };
  if (account.listening) return { tone: 'warning', text: '监听中，等待协议端接入' };
  return { tone: 'warning', text: '未启动' };
}

function Field({ label, hint, children }) {
  return h('label', { className: 'dim-credentialField' },
    h('span', null, label),
    children,
    hint ? h('span', { className: 'dob-hint' }, hint) : null);
}

function AccountCard({ account, busy, removing, onRestart, onRequestRemove, onCancelRemove, onConfirmRemove }) {
  const state = accountState(account);
  return h('article', { className: 'ddt-card dim-botCard', 'data-bot-id': account.botId },
    h('div', { className: 'ddt-cardBody dim-botCardBody' },
      h('div', { className: 'dob-accountHeader' },
        h('span', { className: 'dob-avatar', 'aria-hidden': 'true' }, h(OneBotLogoGlyph, { size: 22 })),
        h('div', { className: 'dob-accountIdentity' },
          h('strong', null, account.nickname ?? account.name),
          h('small', null, maskSelfId(account.selfId))),
        h('span', { className: 'ddt-stateLabel dob-state dim-stateLabel', 'data-tone': state.tone },
          h('span', { className: 'ddt-dot dim-stateDot' }),
          h('span', null, localizeText(state.text)))),
      account.error
        ? h('p', { className: 'dob-error' }, account.error)
        : h('p', { className: 'dob-hint' },
          localizeTemplate('监听地址 {address}', { address: addressOf(account) })),
      h('div', { className: 'ddt-actions dim-viewActions' },
        h(Button, { onClick: onRestart, disabled: Boolean(busy) || removing },
          busy === 'reconnect' ? '正在重启…' : '重启监听'),
        h(Button, { kind: 'danger', onClick: onRequestRemove, disabled: Boolean(busy) || removing },
          '移除接入')),
      removing
        ? h('div', { className: 'ddt-confirm dim-confirm', role: 'alertdialog' },
          h('strong', null, localizeTemplate('从 DeepSeek Harness 移除“{name}”？', {
            name: account.nickname ?? account.name,
          })),
          h('p', null, localizeTemplate('这会停止 {address} 的监听并删除本机保存的 OneBot 账号配置。', {
            address: addressOf(account),
          })),
          h('div', { className: 'ddt-actions dim-viewActions' },
            h(Button, { onClick: onCancelRemove, disabled: Boolean(busy) }, '保留机器人'),
            h(Button, { kind: 'danger', onClick: onConfirmRemove, disabled: Boolean(busy) },
              busy === 'delete' ? '正在移除…' : '确认移除接入')))
        : null));
}

export function OneBotSettingsTab({ rpcCall }) {
  const [snapshot, setSnapshot] = React.useState({ revision: 0, ready: false, bots: [] });
  const [phase, setPhase] = React.useState('loading');
  const [operationError, setOperationError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [busyBot, setBusyBot] = React.useState(null);
  const [removeTarget, setRemoveTarget] = React.useState(null);
  const [open, setOpen] = React.useState(false);
  const [selfId, setSelfId] = React.useState('');
  const [port, setPort] = React.useState('6700');
  const [accessToken, setAccessToken] = React.useState('');
  const [imageFormat, setImageFormat] = React.useState('auto');
  const mounted = React.useRef(true);

  React.useEffect(() => {
    const disposeBase = installDingtalkStyles();
    const disposeChannel = installOneBotStyles();
    mounted.current = true;
    return () => {
      mounted.current = false;
      disposeChannel();
      disposeBase();
    };
  }, []);

  const invoke = React.useCallback(async (endpoint, payload = {}) => {
    if (typeof rpcCall !== 'function') throw new TypeError('OneBot 设置页缺少 RPC 连接');
    const value = unwrapRpcResult(await rpcCall(endpoint, payload));
    if (mounted.current) setOperationError(null);
    return value;
  }, [rpcCall]);

  const loadStatus = React.useCallback(async ({ silent = false } = {}) => {
    if (typeof rpcCall !== 'function') return;
    if (!silent && mounted.current) setPhase('loading');
    try {
      const value = unwrapRpcResult(await rpcCall(ONEBOT_ENDPOINTS.status, {}));
      if (!mounted.current) return;
      setSnapshot(normalizeSnapshot(value));
      setPhase('ready');
    } catch (error) {
      if (!mounted.current) return;
      setOperationError(presentError(error));
      setPhase('error');
    }
  }, [rpcCall]);

  React.useEffect(() => {
    void loadStatus();
    const timer = window.setInterval(() => { void loadStatus({ silent: true }); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  const run = async (label, operation) => {
    setBusy(label);
    try {
      const value = await operation();
      if (!mounted.current) return;
      setSnapshot(normalizeSnapshot(value));
      setPhase('ready');
    } catch (error) {
      if (mounted.current) setOperationError(presentError(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    const normalizedSelfId = selfId.trim();
    if (!/^\d{5,12}$/.test(normalizedSelfId)) {
      setOperationError({ code: 'onebot-invalid-self-id', message: '请填写 QQ 号（5–12 位数字）。' });
      return;
    }
    const normalizedPort = Number(port);
    if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
      setOperationError({ code: 'onebot-invalid-port', message: '端口需在 1–65535 之间。' });
      return;
    }
    void run('bind', async () => {
      const result = await invoke(ONEBOT_ENDPOINTS.addBot, {
        selfId: normalizedSelfId,
        port: normalizedPort,
        imageSendFormat: imageFormat,
        ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
      });
      if (mounted.current) {
        setOpen(false);
        setSelfId('');
        setAccessToken('');
      }
      return result;
    });
  };

  const bots = snapshot.bots;
  const connected = bots.filter((bot) => bot.connected).length;
  return h('section', {
    className: 'ddt-page dob-page dim-channelPage',
    'aria-label': localizeTemplate('{channel} 设置', { channel: 'OneBot' }),
  },
  operationError ? h(ConnectionError, { error: operationError }) : null,
  h('div', { className: 'ddt-heading' },
    h('div', { className: 'ddt-tools' },
      h('div', { className: 'dim-bindActions' },
        h(Button, {
          kind: 'credential',
          className: 'dim-credentialButton',
          onClick: () => { setOpen(!open); setOperationError(null); },
          disabled: Boolean(busy),
          'aria-pressed': open,
          'aria-label': '接入 OneBot 账号',
        }, open ? '收起接入' : '接入账号')),
      bots.length > 0
        ? h('div', { className: 'ddt-badge dim-onlineBadge' },
          h('span', null, localizeTemplate('{connected} / {configured} 在线', {
            connected,
            configured: bots.length,
          })))
        : null)),
  phase === 'loading'
    ? h('div', {
      className: 'ddt-card ddt-loading dim-surfaceCard dim-loadingView',
      'aria-busy': 'true',
    },
    h('div', { className: 'ddt-spinner dim-spinner' }),
    localizeTemplate('正在读取 {channel} 机器人状态…', { channel: 'OneBot' }))
    : phase === 'error'
      ? h('div', { className: 'ddt-card dim-surfaceCard' },
        h('div', { className: 'ddt-inlineError dim-inlineError' },
          h('h3', null, localizeTemplate('无法读取 {channel} 机器人状态', { channel: 'OneBot' })),
          h(Button, { onClick: () => void loadStatus() }, '重新读取')))
      : h(React.Fragment, null,
        open
          ? h('section', { className: 'ddt-card dim-surfaceCard dob-setup' },
            h('div', { className: 'ddt-cardBody dim-surfaceBody' },
              h('h3', null, '接入 OneBot 账号'),
              h('p', { className: 'dob-hint' },
                '协议端（SnowLuma / NapCat / Lagrange）连接本机的反向 WebSocket；插件只负责收与发。'),
              h('form', { className: 'dim-credentialForm dob-form', onSubmit: submit },
                h(Field, { label: 'QQ 号' },
                  h('input', {
                    value: selfId,
                    onChange: event => setSelfId(event.target.value),
                    placeholder: '2951316926',
                    inputMode: 'numeric',
                    autoComplete: 'off',
                    disabled: Boolean(busy),
                    required: true,
                  })),
                h(Field, { label: '监听端口' },
                  h('input', {
                    value: port,
                    onChange: event => setPort(event.target.value),
                    placeholder: '6700',
                    inputMode: 'numeric',
                    autoComplete: 'off',
                    disabled: Boolean(busy),
                  })),
                h(Field, {
                  label: '访问令牌（可选）',
                  hint: '协议端配置里填同一个令牌；留空表示只靠回环地址信任。',
                }, h('input', {
                  type: 'password',
                  value: accessToken,
                  onChange: event => setAccessToken(event.target.value),
                  placeholder: '留空则校验关闭',
                  maxLength: 512,
                  autoComplete: 'new-password',
                  disabled: Boolean(busy),
                })),
                h(Field, {
                  label: '出站图片形态',
                  hint: 'auto 会依次尝试 base64 与 url，成功后记住。',
                }, h('select', {
                  value: imageFormat,
                  onChange: event => setImageFormat(event.target.value),
                  disabled: Boolean(busy),
                }, IMAGE_FORMATS.map(format => h('option', { key: format, value: format },
                  format === 'auto' ? localizeText('自动（推荐）') : format)))),
                h('div', { className: 'ddt-actions dim-viewActions dob-formActions' },
                  h(Button, { onClick: () => setOpen(false), disabled: Boolean(busy) }, '取消'),
                  h(Button, {
                    kind: 'primary',
                    type: 'submit',
                    disabled: Boolean(busy) || !selfId.trim(),
                  }, busy === 'bind' ? '正在保存…' : '保存并开始监听')))))
          : null,
        bots.length === 0 && !open
          ? h('div', { className: 'ddt-card dim-surfaceCard' },
            h('div', { className: 'ddt-cardBody ddt-empty dim-surfaceBody dim-emptyView' },
              h('div', { className: 'dim-emptyCopy' },
                h('div', { className: 'ddt-stateLabel dim-stateLabel' },
                  h('span', { className: 'ddt-dot dim-stateDot' }),
                  h('span', null, localizeTemplate('尚未接入 {channel} 机器人', { channel: 'OneBot' }))),
                h('h3', null, '接入 OneBot 账号'),
                h('p', null, '填入 QQ 号与本机监听端口，然后把协议端的反向 WebSocket 指向下面的地址。'),
                h('div', { className: 'ddt-actions dim-viewActions' },
                  h(Button, { kind: 'primary', onClick: () => setOpen(true) }, '开始接入'))),
              h('div', { className: 'ddt-brandMark dim-emptyBrand dob-avatar', 'aria-hidden': 'true' },
                h(OneBotLogoGlyph, { size: 64 }))))
          : null,
        bots.map(account => h(AccountCard, {
          key: account.botId,
          account,
          busy: busyBot === account.botId ? busy : null,
          removing: removeTarget === account.botId,
          onRestart: () => {
            setBusyBot(account.botId);
            void run('reconnect', () => invoke(ONEBOT_ENDPOINTS.restartBot, { botId: account.botId }))
              .finally(() => { if (mounted.current) setBusyBot(null); });
          },
          onRequestRemove: () => setRemoveTarget(account.botId),
          onCancelRemove: () => setRemoveTarget(null),
          onConfirmRemove: () => {
            setBusyBot(account.botId);
            void run('delete', () => invoke(ONEBOT_ENDPOINTS.deleteBot, { botId: account.botId, confirm: true }))
              .finally(() => {
                if (!mounted.current) return;
                setBusyBot(null);
                setRemoveTarget(null);
              });
          },
        }))));
}
