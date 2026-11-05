import * as React from 'react';

import { ConnectionError } from '../../connection-error.js';
import { h, localizeTemplate, localizeText } from '../../i18n.js';

const IMAGE_FORMATS = ['auto', 'base64', 'url', 'file'];

/**
 * The OneBot counterpart of the token panels: instead of pasting a platform
 * token, the owner supplies the QQ number and the local listener.
 */
export function OneBotCredentialPanel({ busy, error, onSubmit, onCancel }) {
  const [selfId, setSelfId] = React.useState('');
  const [port, setPort] = React.useState('6700');
  const [accessToken, setAccessToken] = React.useState('');
  const [imageFormat, setImageFormat] = React.useState('auto');
  const [invalid, setInvalid] = React.useState(null);
  const headingId = React.useId();

  const submit = (event) => {
    event.preventDefault();
    if (busy) return;
    setInvalid(null);
    const normalizedSelfId = selfId.trim();
    if (!/^\d{5,12}$/.test(normalizedSelfId)) {
      setInvalid({ code: 'onebot-invalid-self-id', message: '请填写 QQ 号（5–12 位数字）。' });
      return;
    }
    const normalizedPort = Number(port);
    if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
      setInvalid({ code: 'onebot-invalid-port', message: '端口需在 1–65535 之间。' });
      return;
    }
    void onSubmit?.({
      selfId: normalizedSelfId,
      port: normalizedPort,
      imageSendFormat: imageFormat,
      ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
    });
  };

  return h('section', {
    // Same shells as the shared credential panel, so the heading picks up the
    // shared title styles instead of rendering as bare body text.
    className: 'ddt-card dim-surfaceCard dim-credentialPanel',
    'aria-labelledby': headingId,
  },
  h('h3', { id: headingId, className: 'dim-credentialTitle' }, '接入 OneBot 账号'),
  h('p', { className: 'dob-hint' },
    '协议端（SnowLuma / NapCat / Lagrange）连接本机的反向 WebSocket；插件只负责收与发。'),
  // This channel is the odd one out: nothing is dialled out, so the owner has to
  // configure the other side first. Show the exact address to paste.
  h('ol', { className: 'dob-steps' },
    h('li', null, '安装并启动协议端（SnowLuma / NapCat / Lagrange），登录要对接的 QQ。'),
    h('li', null, localizeTemplate('在协议端开启「反向 WebSocket」，地址填 {address}。', {
      address: `ws://127.0.0.1:${port.trim() || '6700'}/onebot/v11/ws`,
    })),
    h('li', null, '协议端的访问令牌与本页填同一个，两边都留空表示不校验。'),
    h('li', null, '保存后协议端会自动连上；QQ 里 @ 它、或引用它的话即可对话。')),
  h('form', { className: 'dim-credentialForm dob-form', onSubmit: submit },
    h('label', { className: 'dim-credentialField' },
      h('span', null, 'QQ 号'),
      h('input', {
        value: selfId,
        onChange: event => setSelfId(event.target.value),
        placeholder: 'QQ 号',
        inputMode: 'numeric',
        autoComplete: 'off',
        disabled: Boolean(busy),
        required: true,
      })),
    h('label', { className: 'dim-credentialField' },
      h('span', null, '监听端口'),
      h('input', {
        value: port,
        onChange: event => setPort(event.target.value),
        placeholder: '6700',
        inputMode: 'numeric',
        autoComplete: 'off',
        disabled: Boolean(busy),
      })),
    h('label', { className: 'dim-credentialField' },
      h('span', null, '访问令牌（可选）'),
      h('input', {
        type: 'password',
        value: accessToken,
        onChange: event => setAccessToken(event.target.value),
        placeholder: '留空则校验关闭',
        maxLength: 512,
        autoComplete: 'new-password',
        disabled: Boolean(busy),
      }),
      h('span', { className: 'dob-hint' },
        '协议端配置里填同一个令牌；留空表示只靠回环地址信任。')),
    h('label', { className: 'dim-credentialField' },
      h('span', null, '出站图片形态'),
      h('select', {
        value: imageFormat,
        onChange: event => setImageFormat(event.target.value),
        disabled: Boolean(busy),
      }, IMAGE_FORMATS.map(format => h('option', { key: format, value: format },
        format === 'auto' ? localizeText('自动（推荐）') : format))),
      h('span', { className: 'dob-hint' }, 'auto 会依次尝试 base64 与 url，成功后记住。')),
    error ? h(ConnectionError, { error }) : null,
    invalid ? h(ConnectionError, { error: invalid }) : null,
    h('div', { className: 'ddt-actions dim-viewActions dob-formActions' },
      h('button', {
        type: 'submit',
        className: 'ddt-button',
        'data-kind': 'primary',
        disabled: Boolean(busy),
      }, busy ? '正在保存…' : '保存并开始监听'),
      h('button', {
        type: 'button',
        className: 'ddt-button',
        onClick: onCancel,
        disabled: Boolean(busy),
      }, '取消'))));
}
