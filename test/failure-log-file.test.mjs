import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  appendFailureRecord,
  FAILURE_LOG_MAX_BYTES,
  failureLogPath,
  failureLogRecord,
} from '../src/channels/shared/failure-log-file.mjs';

function tempFile(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-im-failures-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'nested', 'failures.jsonl');
}

test('one failure becomes one greppable line', (t) => {
  const file = tempFile(t);
  const written = appendFailureRecord(failureLogRecord({
    channel: 'telegram',
    failure: { referenceId: 'MF-ABCD1234', code: 'MODEL_STREAM', reason: 'STREAM_CLOSED' },
    diagnostic: { provider: 'deepseek', stage: 'stream' },
  }), { file });
  assert.equal(written, true);
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.referenceId, 'MF-ABCD1234');
  assert.equal(record.channel, 'telegram');
  assert.equal(record.code, 'MODEL_STREAM');
  assert.equal(record.reason, 'STREAM_CLOSED');
  assert.deepEqual(record.details, { provider: 'deepseek', stage: 'stream' });
  assert.match(record.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('appending keeps earlier lines so the id stays searchable', (t) => {
  const file = tempFile(t);
  for (const id of ['MF-ONE00001', 'MF-TWO00002']) {
    appendFailureRecord(failureLogRecord({ channel: 'onebot', failure: { referenceId: id } }), { file });
  }
  const text = readFileSync(file, 'utf8');
  assert.equal(text.trim().split('\n').length, 2);
  assert.match(text, /MF-ONE00001/);
  assert.match(text, /MF-TWO00002/);
});

test('the log rotates once instead of growing forever', (t) => {
  const file = tempFile(t);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${'x'.repeat(FAILURE_LOG_MAX_BYTES)}\n`);
  assert.equal(appendFailureRecord(failureLogRecord({ channel: 'telegram', failure: { referenceId: 'MF-ROT00001' } }), { file }), true);
  // The new line lives in the fresh file and the previous generation is kept.
  assert.match(readFileSync(file, 'utf8'), /MF-ROT00001/);
  assert.match(readFileSync(`${file}.1`, 'utf8').slice(0, 16), /x{16}/);
});

test('bot tokens never reach the file', (t) => {
  const file = tempFile(t);
  appendFailureRecord(failureLogRecord({
    channel: 'telegram',
    failure: { referenceId: 'MF-TOK00001' },
    diagnostic: { detail: 'bad token bot123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA end' },
  }), { file });
  const text = readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /bot123456:/);
  assert.match(text, /bot<redacted>/);
});

test('a filesystem problem never throws and never stops the caller', () => {
  // A directory path cannot be appended to on any platform.
  const directory = mkdtempSync(path.join(tmpdir(), 'dsh-im-failures-dir-'));
  try {
    assert.equal(appendFailureRecord({ at: 'x' }, { file: directory }), false);
    assert.equal(appendFailureRecord(null), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the default path sits under DSH_HOME', () => {
  assert.equal(
    failureLogPath({ DSH_HOME: 'C:/home/dsh' }, 'C:/users/x'),
    path.join('C:/home/dsh', '.dsh-im', 'failures.jsonl'),
  );
  assert.equal(failureLogPath({}, 'C:/users/x'), path.join('C:/users/x', '.dsh', '.dsh-im', 'failures.jsonl'));
});
