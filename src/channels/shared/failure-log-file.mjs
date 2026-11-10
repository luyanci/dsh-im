import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * A durable line per failed turn.
 *
 * The `MF-…` reference a user sees in chat used to exist only in the console.
 * DSH Desktop does not capture stdout, so when a desktop user quoted the
 * reference back there was nothing on disk to grep. One JSON line per failure
 * under `<DSH_HOME>/.dsh-im/failures.jsonl` fixes that: the id the user quotes
 * can be searched directly, next to the classified reason and channel.
 *
 * Everything here is best effort. A disk problem must never mask the failure
 * being reported to the user, so every filesystem error is swallowed.
 */

/** Rotate once the file would exceed this size, keeping a single `.1`. */
export const FAILURE_LOG_MAX_BYTES = 2 * 1024 * 1024;

/** A bot token looks like `1234:AA…` and must never reach a log line. */
const TOKEN_SHAPE = /bot\d+:[A-Za-z0-9_-]{20,}/gu;

function scrubbed(value) {
  if (typeof value === 'string') return value.replace(TOKEN_SHAPE, 'bot<redacted>');
  if (Array.isArray(value)) return value.map((entry) => scrubbed(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrubbed(entry)]));
  }
  return value;
}

/** `<DSH_HOME>/.dsh-im/failures.jsonl`, falling back to the usual profile root. */
export function failureLogPath(env = process.env, home = homedir()) {
  const root = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim()
    ? env.DSH_HOME.trim()
    : path.join(home, '.dsh');
  return path.join(root, '.dsh-im', 'failures.jsonl');
}

/** The record shape: who failed, why, and when. */
export function failureLogRecord({ channel, failure, diagnostic = null, at } = {}) {
  return {
    at: typeof at === 'string' && at ? at : new Date().toISOString(),
    channel: String(channel ?? 'unknown'),
    referenceId: failure?.referenceId ?? null,
    code: failure?.code ?? null,
    reason: failure?.reason ?? null,
    details: scrubbed(diagnostic),
  };
}

/**
 * Append one record as a single line, rotating the previous file once.
 * Returns whether the line was written; never throws.
 */
export function appendFailureRecord(record, options = {}) {
  if (!record || typeof record !== 'object') return false;
  const file = typeof options.file === 'string' && options.file ? options.file : failureLogPath();
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes : FAILURE_LOG_MAX_BYTES;
  let line;
  try {
    line = JSON.stringify(record);
  } catch {
    return false;
  }
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      // No file yet, or it cannot be read: appending still succeeds or fails below.
      size = 0;
    }
    if (size > 0 && size + Buffer.byteLength(line) + 1 > maxBytes) {
      try {
        renameSync(file, `${file}.1`);
      } catch {
        // A failed rotation is not a reason to lose this line.
      }
    }
    appendFileSync(file, `${line}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}
