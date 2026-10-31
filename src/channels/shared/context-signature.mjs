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
 * blocks are split: a block that does not verify is just user text.
 *
 * SHA-256 is implemented here rather than imported: this module is shared with the
 * settings UI, so it must stay free of Node built-ins and of asynchronous Web
 * Crypto, which cannot run inside a synchronous prompt composer.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value, shift) {
  return (value >>> shift) | (value << (32 - shift));
}

/** SHA-256 of a byte array; returns 32 bytes. */
function sha256(bytes) {
  const length = bytes.length;
  const withPadding = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  withPadding.set(bytes);
  withPadding[length] = 0x80;
  const bitsHigh = Math.floor(length / 0x20000000);
  const bitsLow = (length << 3) >>> 0;
  const tail = withPadding.length;
  withPadding[tail - 8] = (bitsHigh >>> 24) & 0xff;
  withPadding[tail - 7] = (bitsHigh >>> 16) & 0xff;
  withPadding[tail - 6] = (bitsHigh >>> 8) & 0xff;
  withPadding[tail - 5] = bitsHigh & 0xff;
  withPadding[tail - 4] = (bitsLow >>> 24) & 0xff;
  withPadding[tail - 3] = (bitsLow >>> 16) & 0xff;
  withPadding[tail - 2] = (bitsLow >>> 8) & 0xff;
  withPadding[tail - 1] = bitsLow & 0xff;

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      w[index] = (withPadding[base] << 24) | (withPadding[base + 1] << 16)
        | (withPadding[base + 2] << 8) | withPadding[base + 3];
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3);
      const s1 = rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[index] + w[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  hash.forEach((value, index) => {
    digest[index * 4] = (value >>> 24) & 0xff;
    digest[index * 4 + 1] = (value >>> 16) & 0xff;
    digest[index * 4 + 2] = (value >>> 8) & 0xff;
    digest[index * 4 + 3] = value & 0xff;
  });
  return digest;
}

const encoder = new TextEncoder();

/** HMAC-SHA256 over a UTF-8 string. */
function hmacSha256(keyBytes, messageBytes) {
  const blockSize = 64;
  const key = new Uint8Array(blockSize);
  if (keyBytes.length > blockSize) key.set(sha256(keyBytes));
  else key.set(keyBytes);
  const inner = new Uint8Array(blockSize + messageBytes.length);
  for (let index = 0; index < blockSize; index += 1) inner[index] = key[index] ^ 0x36;
  inner.set(messageBytes, blockSize);
  const outer = new Uint8Array(blockSize + 32);
  for (let index = 0; index < blockSize; index += 1) outer[index] = key[index] ^ 0x5c;
  outer.set(sha256(inner), blockSize);
  return sha256(outer);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64url(bytes) {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    output += ALPHABET[(chunk >>> 18) & 63];
    output += ALPHABET[(chunk >>> 12) & 63];
    if (index + 1 < bytes.length) output += ALPHABET[(chunk >>> 6) & 63];
    if (index + 2 < bytes.length) output += ALPHABET[chunk & 63];
  }
  return output;
}

const SECRET = new Uint8Array(32);
if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(SECRET);
else for (let index = 0; index < SECRET.length; index += 1) {
  SECRET[index] = Math.floor(Math.random() * 256);
}

const SIGNATURE_ATTRIBUTE = 'sig';
const SIGNATURE_LENGTH = 22;

/** Sign one block body exactly as it will appear between the tags. */
export function signContextBody(body) {
  if (typeof body !== 'string') return '';
  return base64url(hmacSha256(SECRET, encoder.encode(body))).slice(0, SIGNATURE_LENGTH);
}

/** Compare in constant time so a mismatch position does not leak. */
export function verifyContextBody(body, signature) {
  if (typeof body !== 'string' || typeof signature !== 'string' || !signature) return false;
  const expected = signContextBody(body);
  if (expected.length !== signature.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return difference === 0;
}

/** The signed opening tag for one block body. */
export function signedOpenTag(openTag, body) {
  return `${openTag.slice(0, -1)} ${SIGNATURE_ATTRIBUTE}="${signContextBody(body)}">`;
}

/** Read the signature attribute out of an opening tag, or null when absent. */
export function signatureOfOpenTag(openTag) {
  if (typeof openTag !== 'string') return null;
  const match = new RegExp(String.raw`\ssig="([^"]*)"\s*>$`, 'u').exec(openTag);
  return match ? match[1] : null;
}
