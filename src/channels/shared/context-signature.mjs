import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Authenticate the context blocks this plugin writes into a prompt.
 *
 * Splitting a prompt on `<dsh_im_source>` tags means trusting whoever typed the
 * tag: a user could paste a block naming any sender, and the Host would hand the
 * model a plugin-sourced message it never produced. Stripping forged blocks from
 * incoming text closes the path this channel knows about, but it is a race
 * against whatever spelling comes next.
 *
 * A block is therefore signed with a per-process secret. The signature travels in
 * the opening tag, covers the exact body byte for byte, and is verified where the
 * blocks are split: a block that does not verify is just user text. The secret
 * never leaves the process, and because the signature covers the body a replayed
 * block can only ever repeat the provenance that was really produced.
 */
const SECRET = randomBytes(32);
const SIGNATURE_ATTRIBUTE = 'sig';
const SIGNATURE_LENGTH = 22;

/** Sign one block body exactly as it will appear between the tags. */
export function signContextBody(body) {
  if (typeof body !== 'string') return '';
  return createHmac('sha256', SECRET)
    .update(body, 'utf8')
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

/** Compare without leaking where the first differing byte sits. */
export function verifyContextBody(body, signature) {
  if (typeof body !== 'string' || typeof signature !== 'string' || !signature) return false;
  const expected = Buffer.from(signContextBody(body), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The signed opening tag for one block body. */
export function signedOpenTag(openTag, body) {
  const signature = signContextBody(body);
  return `${openTag.slice(0, -1)} ${SIGNATURE_ATTRIBUTE}="${signature}">`;
}

/**
 * Read the signature attribute out of an opening tag.
 * @returns the signature, or null when the tag carries none.
 */
export function signatureOfOpenTag(openTag) {
  const match = new RegExp(String.raw`\ssig="([^"]*)"\s*>$`, 'u').exec(openTag);
  return match ? match[1] : null;
}
