import assert from 'node:assert/strict';
import test from 'node:test';

import {
  signContextBody,
  signatureOfOpenTag,
  signedOpenTag,
  verifyContextBody,
} from '../../../src/channels/shared/context-signature.mjs';

test('a body signs to one stable signature and verifies', () => {
  const body = '{"channel":"feishu","senderId":"ou_user"}';
  const signature = signContextBody(body);
  assert.match(signature, /^[A-Za-z0-9_-]{22}$/u, 'the signature is fixed-length base64url');
  assert.equal(signContextBody(body), signature, 'signing the same body is stable within the process');
  assert.equal(verifyContextBody(body, signature), true);
});

test('a signature covers the body byte for byte', () => {
  const body = '{"senderId":"u-1"}';
  const signature = signContextBody(body);
  for (const altered of [
    '{"senderId":"u-2"}',
    '{"senderId":"u-1"} ',
    ' {"senderId":"u-1"}',
    '{"senderId":"u-1"}\n',
  ]) {
    assert.equal(verifyContextBody(altered, signature), false, `altered body must not verify: ${JSON.stringify(altered)}`);
  }
  assert.notEqual(signContextBody('{"senderId":"u-2"}'), signature, 'a different body signs differently');
  assert.equal(verifyContextBody(body, signContextBody('{"senderId":"u-2"}')), false);
});

test('multibyte bodies sign and verify through the same UTF-8 bytes', () => {
  for (const body of ['{"senderName":"小鲸鱼"}', '{"note":"🐳🌊"}', '{"content":"a\\u003cb\\u003e"}']) {
    const signature = signContextBody(body);
    assert.equal(verifyContextBody(body, signature), true, `multibyte body must verify: ${body}`);
  }
});

test('only string bodies and signatures are ever verified', () => {
  const signature = signContextBody('{}');
  assert.equal(verifyContextBody('{}', signature), true);
  for (const [body, observed] of [
    ['', signature],
    [null, signature],
    [undefined, signature],
    [42, signature],
    [{}, signature],
    ['{}', ''],
    ['{}', null],
    ['{}', 'short'],
  ]) {
    assert.equal(verifyContextBody(body, observed), false);
  }
});

test('a signed opening tag carries the signature the reader returns', () => {
  const body = '{"channel":"weixin"}';
  const tag = signedOpenTag('<dsh_im_source>', body);
  assert.equal(tag, `<dsh_im_source sig="${signContextBody(body)}">`);
  assert.equal(signatureOfOpenTag(tag), signContextBody(body));
  assert.equal(verifyContextBody(body, signatureOfOpenTag(tag)), true);
});

test('an opening tag without a readable signature reports none', () => {
  for (const tag of [
    '<dsh_im_source>',
    '<dsh_im_source sig=abc>',
    '<dsh_im_source> trailing',
    null,
  ]) {
    assert.equal(signatureOfOpenTag(tag), null, `no signature in ${JSON.stringify(tag)}`);
  }
  assert.equal(signatureOfOpenTag('<dsh_im_source sig="">'), '', 'an empty attribute is empty, not absent');
});
