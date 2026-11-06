export const TELEGRAM_RICH_TEXT_LIMIT = 30_000;
export const TELEGRAM_REGULAR_TEXT_LIMIT = 4_000;

function textValue(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('Telegram message text must be a non-empty string');
  }
  return value;
}

function escapedCharacterLength(value) {
  if (value === '&') return 5;
  if (value === '<' || value === '>') return 4;
  return 1;
}

function escapedLength(value) {
  return Array.from(value).reduce((total, character) => (
    total + escapedCharacterLength(character)
  ), 0);
}

function preferredCut(points, offset, hardEnd, limit) {
  const minimum = offset + Math.floor(limit * 0.5);
  for (let index = hardEnd - 1; index >= minimum; index -= 1) {
    if (points[index] === '\n' || points[index] === ' ') return index + 1;
  }
  return hardEnd;
}

function splitText(value, limit, characterLength = () => 1) {
  if (typeof value !== 'string') throw new TypeError('Telegram message text must be a string');
  if (!value) return [];
  const points = Array.from(value);
  const chunks = [];
  let offset = 0;
  while (offset < points.length) {
    let end = offset;
    let length = 0;
    while (end < points.length) {
      const nextLength = characterLength(points[end]);
      if (length + nextLength > limit) break;
      length += nextLength;
      end += 1;
    }
    if (end === offset) throw new Error('Telegram message character exceeds the chunk limit');
    if (end < points.length) end = preferredCut(points, offset, end, limit);
    chunks.push(points.slice(offset, end).join(''));
    offset = end;
  }
  return chunks;
}

function fenceMarkers(markdown) {
  return [...markdown.matchAll(/^```[^\n]*(?:\n|$)/gm)];
}

function assertCompleteFences(markdown) {
  const markers = fenceMarkers(markdown);
  if (markers.length % 2 !== 0) {
    throw new Error('Telegram Rich Markdown contains an unfinished code fence');
  }
  return markers;
}

function escapedMarkdown(value) {
  return Array.from(value, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    return character;
  }).join('');
}

/** Split markdown into prose and fenced-code segments. */
function fenceSegments(source) {
  const markers = fenceMarkers(source);
  const segments = [];
  let cursor = 0;
  for (let index = 0; index < markers.length; index += 2) {
    const opening = markers[index];
    const closing = markers[index + 1];
    if (opening.index > cursor) segments.push({ kind: 'plain', text: source.slice(cursor, opening.index) });
    const end = closing.index + closing[0].length;
    segments.push({ kind: 'fence', text: source.slice(opening.index, end) });
    cursor = end;
  }
  if (cursor < source.length) segments.push({ kind: 'plain', text: source.slice(cursor) });
  return segments;
}

/**
 * Escape HTML entities in prose only. A fenced code block is rendered verbatim,
 * so escaping it leaks literal `&lt;`/`&gt;` into code the reader copies — which
 * is exactly what happened to every HTML snippet the model produced.
 */
function escapedOutsideFences(source) {
  return fenceSegments(source)
    .map((segment) => (segment.kind === 'fence' ? segment.text : escapedMarkdown(segment.text)))
    .join('');
}

function plainRichChunks(source, limit) {
  return splitText(source, limit, escapedCharacterLength).map((chunk) => ({
    source: chunk,
    markdown: escapedMarkdown(chunk),
  }));
}

function fencedRichChunks(source, opening, closing, limit) {
  const body = source.slice(opening.length, source.length - closing.length);
  const wrapperLength = Array.from(opening).length
    + Math.max(Array.from(closing).length, 3)
    + 1;
  const bodyLimit = limit - wrapperLength;
  if (bodyLimit < 1) throw new Error('Telegram Rich Markdown code fence exceeds the limit');
  const bodyChunks = splitText(body, bodyLimit);
  return bodyChunks.map((bodyChunk, index) => {
    const last = index === bodyChunks.length - 1;
    const separator = bodyChunk.endsWith('\n') ? '' : '\n';
    const renderedClosing = last ? closing : '```';
    const sourceChunk = `${index === 0 ? opening : ''}${bodyChunk}${last ? closing : ''}`;
    const markdown = `${opening}${bodyChunk}${separator}${renderedClosing}`;
    if (Array.from(markdown).length > limit) {
      throw new Error('Telegram Rich Markdown code block exceeds the limit');
    }
    return { source: sourceChunk, markdown };
  });
}

export function toTelegramRichMarkdown(value) {
  const markdown = textValue(value);
  assertCompleteFences(markdown);
  // Rich Markdown also accepts HTML tags. Escape entities in prose so encoded or
  // raw model output cannot be interpreted as Telegram-specific markup, but keep
  // fenced code verbatim or the reader copies `&lt;` where the source had `<`.
  return escapedOutsideFences(markdown);
}

export function splitTelegramRichMarkdown(value, limit = TELEGRAM_RICH_TEXT_LIMIT) {
  if (!Number.isInteger(limit) || limit < 128 || limit > 32_768) {
    throw new TypeError('Telegram Rich Markdown limit is invalid');
  }
  const source = textValue(value);
  assertCompleteFences(source);
  const segments = fenceSegments(source);
  const complete = segments
    .map((segment) => (segment.kind === 'fence' ? segment.text : escapedMarkdown(segment.text)))
    .join('');
  if (Array.from(complete).length <= limit) return [{ source, markdown: complete }];

  const chunks = [];
  for (const segment of segments) {
    if (segment.kind === 'plain') {
      chunks.push(...plainRichChunks(segment.text, limit));
      continue;
    }
    if (Array.from(segment.text).length <= limit) {
      chunks.push({ source: segment.text, markdown: segment.text });
      continue;
    }
    const [opening, closing] = fenceMarkers(segment.text);
    chunks.push(...fencedRichChunks(segment.text, opening[0], closing[0], limit));
  }
  return chunks;
}

export function splitTelegramRegularText(value, limit = TELEGRAM_REGULAR_TEXT_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 4_096) {
    throw new TypeError('Telegram regular message limit is invalid');
  }
  // Keep Telegram's established 4000 UTF-16-unit boundary without ever cutting
  // a surrogate pair in half.
  return splitText(textValue(value), limit, (character) => character.length);
}
