#!/usr/bin/env node
/**
 * OneBot v11 reverse-WebSocket probe (M0 of docs/onebot-channel.md).
 *
 * SnowLuma connects to us; this process only records what arrives so the
 * channel's open questions can be answered from evidence instead of guesses:
 *   - handshake: which auth form, X-Self-ID / X-Client-Role present?
 *   - self echo: does a message the bot sends come back as message_sent?
 *   - image segments: file:// / base64:// / http url?
 *   - heartbeat: WS ping frames or a meta_event?
 *
 * Usage:
 *   node scripts/onebot-probe.mjs [--port 6700] [--path /onebot/v11/ws] [--token T]
 *                                 [--send-user QQ | --send-group GID] [--send-text "hi"]
 *                                 [--get-msg MESSAGE_ID]
 *
 * Nothing here is shipped; it is a scratch tool for the design phase.
 */
import { WebSocketServer } from 'ws'
import { appendFileSync } from 'node:fs'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}

const port = Number(arg('port', 6700))
const path = arg('path', '/onebot/v11/ws')
const token = arg('token', '')
const sendGroup = arg('send-group', '')
const sendUser = arg('send-user', '')
const sendText = arg('send-text', '')
const getMsg = arg('get-msg', '')
const getFile = arg('get-file', '')
const getFileName = arg('get-file-name', '')
const resolveFiles = args.includes('--resolve-files')
// Any action, sent once per connection: answers "does this protocol end actually
// implement X" without writing a throwaway script each time.
const probeAction = arg('action', '')
const probeParams = arg('params', '{}')

const logFile = arg('log', '.onebot-probe.jsonl')
const started = new Date().toISOString()
const nextEcho = new Map() // echo -> resolve
let seq = 0

function record(kind, payload) {
  const line = JSON.stringify({ at: new Date().toISOString(), kind, ...payload })
  appendFileSync(logFile, `${line}\n`)
}

function describeImage(segment) {
  const file = String(segment?.data?.file ?? '')
  const url = String(segment?.data?.url ?? '')
  const shape = file.startsWith('base64://')
    ? 'base64'
    : file.startsWith('file://')
      ? 'file'
      : file.startsWith('http')
        ? 'http'
        : file
          ? 'other'
          : 'none'
  return { shape, filePrefix: file.slice(0, 42), hasUrl: url.length > 0, urlPrefix: url.slice(0, 42) }
}

function action(ws, action, params) {
  const echo = `probe-${++seq}`
  const frame = { action, params, echo }
  ws.send(JSON.stringify(frame))
  record('action-out', { action, params, echo })
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 20_000)
    nextEcho.set(echo, (data) => { clearTimeout(timer); resolve(data) })
  })
}

const wss = new WebSocketServer({
  host: '127.0.0.1',
  port,
  path,
  verifyClient: (info, done) => {
    const header = info.req.headers.authorization ?? ''
    const url = new URL(info.req.url ?? '/', 'http://127.0.0.1')
    const query = url.searchParams.get('access_token') ?? ''
    const bearer = header.replace(/^Bearer\s+/i, '')
    const provided = bearer || query
    const headers = {
      selfId: info.req.headers['x-self-id'] ?? '',
      role: info.req.headers['x-client-role'] ?? '',
      userAgent: info.req.headers['user-agent'] ?? '',
      authForm: header ? 'bearer' : query ? 'query' : 'none',
    }
    record('handshake', { path: url.pathname, headers, tokenRequired: token.length > 0, accepted: token.length === 0 || provided === token })
    console.log('[handshake]', JSON.stringify(headers))
    if (token.length === 0 || provided === token) return done(true)
    return done(false, 401, 'unauthorized')
  },
})

wss.on('connection', (ws, req) => {
  const selfId = req.headers['x-self-id'] ?? 'unknown'
  console.log(`[connected] self=${selfId} role=${req.headers['x-client-role'] ?? '?'}`)

  ws.on('ping', (data) => {
    record('ws-ping', { bytes: data?.length ?? 0 })
  })
  ws.on('pong', () => record('ws-pong', {}))

  ws.on('message', (raw) => {
    let frame
    try {
      frame = JSON.parse(raw.toString('utf8'))
    } catch {
      record('bad-frame', { bytes: raw.length })
      return
    }

    // Action response
    if (typeof frame.echo === 'string' && nextEcho.has(frame.echo)) {
      const resolve = nextEcho.get(frame.echo)
      nextEcho.delete(frame.echo)
      record('action-in', { echo: frame.echo, status: frame.status, retcode: frame.retcode })
      resolve(frame)
      return
    }

    // Action request from the protocol end (rare, but keep the channel alive)
    if (typeof frame.action === 'string') {
      record('action-request', { action: frame.action })
      ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: {}, echo: frame.echo }))
      return
    }

    const type = frame.post_type ?? 'unknown'
    const segments = Array.isArray(frame.message) ? frame.message : []
    const images = segments.filter((s) => s?.type === 'image').map(describeImage)
    record('event', {
      postType: type,
      subType: frame.message_type ?? frame.notice_type ?? frame.meta_event_type ?? '',
      selfId: frame.self_id,
      userId: frame.sender?.user_id ?? frame.user_id ?? '',
      groupId: frame.group_id ?? '',
      messageId: frame.message_id ?? '',
      segments: segments.map((s) => s?.type),
      images,
      raw: frame,
    })
    console.log(`[event] ${type} ${frame.message_type ?? ''} group=${frame.group_id ?? '-'} segs=${segments.map((s) => s?.type).join(',') || '-'}`)
    if (images.length > 0) console.log('        image segments:', JSON.stringify(images))

    // Resolve an inbound file the way the channel must: no url here, so ask
    // get_file and see what shape comes back on this protocol end.
    if (resolveFiles && type === 'message') {
      for (const segment of segments) {
        if (segment?.type !== 'file' && segment?.type !== 'video' && segment?.type !== 'record') continue;
        const data = segment?.data ?? {};
        console.log('        file segment:', JSON.stringify(data).slice(0, 400));
        void action(ws, 'get_file', { file_id: data.file_id, file: data.file })
          .then((got) => {
            console.log('[get_file]', JSON.stringify(got?.data ?? got).slice(0, 900));
            record('get-file-probe', { fileId: data.file_id ?? '', segment: data, response: got?.data ?? got });
          })
        // NapCat extensions: a real http url instead of the staged local path.
        const urlParams = frame.group_id
          ? { action: 'get_group_file_url', params: { group_id: Number(frame.group_id), file_id: data.file_id, busid: 102 } }
          : { action: 'get_private_file_url', params: { user_id: Number(frame.user_id), file_id: data.file_id } };
        void action(ws, urlParams.action, urlParams.params)
          .then((got) => {
            console.log(`[${urlParams.action}]`, JSON.stringify(got?.data ?? got).slice(0, 500));
            record('file-url-probe', { action: urlParams.action, response: got?.data ?? got, status: got?.status });
          })
      }
    }

    if (type === 'meta_event') {
      record('meta-event', { detail: frame.meta_event_type, raw: frame })
    }
  })

  ws.on('close', (code) => {
    record('closed', { code })
    console.log(`[closed] code=${code}`)
  })

  if (getMsg || sendText || getFile || probeAction) {
    setTimeout(async () => {
      const info = await action(ws, 'get_login_info', {})
      console.log('[get_login_info]', JSON.stringify(info?.data ?? info))
      if (probeAction) {
        let params = {}
        try {
          params = JSON.parse(probeParams)
        } catch (error) {
          console.log('[action] params is not JSON:', error?.message ?? error)
        }
        const got = await action(ws, probeAction, params)
        console.log(`[${probeAction}]`, JSON.stringify(got?.data ?? got).slice(0, 900))
        record('action-probe', { action: probeAction, params, response: got?.data ?? got, status: got?.status })
      }
      if (getFile) {
        // What a `file` segment looks like without a url: NapCat answers here.
        const got = await action(ws, 'get_file', { file_id: getFile, file: getFileName })
        console.log('[get_file]', JSON.stringify(got?.data ?? got).slice(0, 900))
        record('get-file-probe', { fileId: getFile, response: got?.data ?? got })
      }
      if (getMsg) {
        const got = await action(ws, 'get_msg', { message_id: Number(getMsg) })
        console.log('[get_msg]', JSON.stringify(got?.data ?? got).slice(0, 600))
      }
      if (sendText && sendUser) {
        const sent = await action(ws, 'send_private_msg', {
          user_id: Number(sendUser),
          message: [{ type: 'text', data: { text: sendText } }],
        })
        console.log('[send_private_msg]', JSON.stringify(sent?.data ?? sent))
        console.log('Watch whether this same message comes back as message_sent.')
      } else if (sendText && sendGroup) {
        const sent = await action(ws, 'send_group_msg', {
          group_id: Number(sendGroup),
          message: [{ type: 'text', data: { text: sendText } }],
        })
        console.log('[send_group_msg]', JSON.stringify(sent?.data ?? sent))
        console.log('Watch whether this same message comes back as message_sent.')
      }
    }, 2000)
  }
})

console.log(`OneBot probe listening on ws://127.0.0.1:${port}${path}`)
console.log(`  token: ${token.length > 0 ? '(required)' : '(none)'}`)
console.log(`  log:   ${logFile}`)
console.log(`  started ${started} — point SnowLuma's reverse WS client here.`)
