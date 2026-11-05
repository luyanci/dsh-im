import { HarnessClient } from '../shared/harness-client.mjs';

export class OneBotHarnessClient extends HarnessClient {
  constructor(options) {
    super({
      ...options,
      rpcIdPrefix: 'onebot',
      logPrefix: 'dsh-onebot',
    });
  }
}
