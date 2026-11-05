import { OneBotLogoGlyph } from '../../channel-logos.js';
import { createTokenChannelSettings } from '../shared/token-channel.js';
import { ONEBOT_ENDPOINTS, onebotClientApi } from './api.js';
import { OneBotCredentialPanel } from './credential-panel.js';
import { installOneBotStyles } from './styles.js';

/**
 * Built on the same factory every other channel uses, so OneBot gets the shared
 * bot card and the shared "more settings" surface (workspace, model, agent
 * preset, access policy, alias) instead of a bespoke page.
 */
const channel = createTokenChannelSettings({
  channel: 'OneBot',
  endpoints: ONEBOT_ENDPOINTS,
  api: onebotClientApi,
  LogoGlyph: OneBotLogoGlyph,
  installStyles: installOneBotStyles,
  pageClass: 'dob-page',
  avatarClass: 'dob-avatar',
  connectionLabel: ' OneBot 反向 WebSocket',
  emptyTitle: '接入 OneBot 账号',
  emptyDescription: '填入 QQ 号与本机监听端口，再把协议端的反向 WebSocket 指向该地址。',
  platformLabel: 'OneBot',
  CredentialPanel: OneBotCredentialPanel,
  credentialPayload: values => values,
  credentialAriaLabel: '接入 OneBot 账号',
  credentialOpenLabel: '接入账号',
  credentialCloseLabel: '收起接入',
  credentialNoun: 'OneBot 账号',
  emptyActionLabel: '开始接入',
});

export const OneBotSettingsTab = channel.SettingsTab;
export const OneBotAccountCard = channel.AccountCard;
