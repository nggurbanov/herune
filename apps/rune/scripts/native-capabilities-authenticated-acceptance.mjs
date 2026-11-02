#!/usr/bin/env node
/** Real complete native Hermes Viewers; mutations go only to strict private loopback fixtures. */
import assert from 'node:assert/strict'
import {createHash, randomUUID} from 'node:crypto'
import {spawn, execFileSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {startPrivateCredentials} from './lib/private-credentials.mjs'

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const binary = path.resolve(option('--binary') ?? path.join(app, 'target/debug/herune'))
const out = path.resolve(option('--out') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-fleet-native-evidence-')))
const only = option('--case')
fs.mkdirSync(out, {recursive: true})
assert.equal(fs.readdirSync(out).length, 0, 'Use a fresh evidence directory')
const suiteHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-fleet-native-home-'))
const owned = [], requests = [], screenshots = [], gestures = [], bindings = [], results = [], checks = []
const IDS = {A: '11111111-1111-4111-8111-111111111111', B: '22222222-2222-4222-8222-222222222222'}
const REVISIONS = {A: '33333333-3333-4333-8333-333333333333', B: '44444444-4444-4444-8444-444444444444'}
const TOKEN = 'private-native-fixture-token'
const ROOT = 'shared-root', TIP = 'shared-tip', PROFILE = 'default', RENAME = 'B renamed from native fleet'
const catalog = {provider: 'fixture', model: 'fixture-model', providers: [{slug: 'fixture', name: 'Private fixture', authenticated: true, models: ['fixture-model']}]}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const hash = value => createHash('sha256').update(value).digest('hex')
const harnessSha = hash(fs.readFileSync(fileURLToPath(import.meta.url)))
const binarySha = hash(fs.readFileSync(binary))
assert.ok(option('--expect-sha'), 'An immutable candidate hash is required')
assert.equal(binarySha, option('--expect-sha'), 'Immutable binary SHA mismatch')
fs.copyFileSync(fileURLToPath(import.meta.url), path.join(out, 'harness.mjs'))
const credentialsFixture = path.join(app, 'scripts/lib/private-credentials.mjs')
const credentialsFixtureSha = hash(fs.readFileSync(credentialsFixture))
fs.mkdirSync(path.join(out, 'lib'))
fs.copyFileSync(credentialsFixture, path.join(out, 'lib/private-credentials.mjs'))
let env, active = null, phase = 'setup', failure = null, displayProcess, wm, bus
const scoped = () => ({case: active?.name ?? 'suite', phase})
const atomic = (file, value) => {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700})
  const temporary = file + '.' + randomUUID()
  fs.writeFileSync(temporary, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2), {mode: 0o600})
  fs.renameSync(temporary, file)
}
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
const version = source => ({id: {kind: 'saved', id: IDS[source]}, revision: REVISIONS[source]})
const routeKey = (source, profile) => hash(JSON.stringify(stable([version(source), profile])))
const profileKey = (source, profile = PROFILE, picker = false) => `${picker ? 'fleet-pick-profile-' : 'fleet-profile-'}${routeKey(source, profile)}`
function checked(name, value) { checks.push({...scoped(), name, value}); assert.ok(value, name) }

function input(...values) { return execFileSync('xdotool', values.map(String), {env: active?.env ?? env, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe']}) }
function snapshots() {
  if (!active || !fs.existsSync(active.inspection)) return []
  return fs.readdirSync(active.inspection).filter(file => file.endsWith('.json')).flatMap(file => {
    try { return [JSON.parse(fs.readFileSync(path.join(active.inspection, file), 'utf8'))] } catch { return [] }
  })
}
const current = id => snapshots().find(snapshot => snapshot.id === id)
async function wait(label, check, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (failure) throw failure
    if (active?.child && active.child.exitCode != null) throw new Error(`${label}: app exited ${active.child.exitCode}\n${active.log.slice(-3500)}`)
    const result = check(); if (result) return result
    await delay(40)
  }
  throw new Error(`${label}: timed out in ${active?.name}/${phase}; snapshots=${JSON.stringify(snapshots())}\n${active?.log.slice(-3000)}`)
}
function visible() {
  try { return input('search', '--onlyvisible', '--pid', active.child.pid).trim().split('\n').filter(Boolean) } catch { return [] }
}
function geometry(xid) {
  const value = execFileSync('xwininfo', ['-id', String(xid)], {env: active.env, encoding: 'utf8', timeout: 5000})
  const read = name => { const result = value.match(new RegExp(name + ':\\s+(-?\\d+)')); assert.ok(result, `No ${name} in native geometry`); return Number(result[1]) }
  return {x: read('Absolute upper-left X'), y: read('Absolute upper-left Y'), width: read('Width'), height: read('Height')}
}
function nativeWindow(id) {
  const snapshot = current(id), windows = visible()
  assert.ok(snapshot?.native?.position, `Native frame not ready for ${id}`)
  const known = active.windows.get(id)
  if (known) { assert.ok(windows.includes(known), `Native window disappeared: ${id}`); return known }
  const xid = snapshot.native_raw_handle?.match(/window:\s*(\d+)/)?.[1]
  assert.ok(xid && windows.includes(xid), `Cannot bind ${id} to a visible native XID`)
  assert.ok(![...active.windows.values()].includes(xid), 'Two Viewers share one native window')
  active.windows.set(id, xid)
  bindings.push({...scoped(), id, xid, pid: active.child.pid, geometry: geometry(xid)})
  return xid
}
function focusXid(xid) {
  const tree = execFileSync('xwininfo', ['-id', xid, '-tree'], {env: active.env, encoding: 'utf8', timeout: 5000})
  const parent = tree.match(/Parent window id:\s+(0x[0-9a-f]+)/i)?.[1]
  assert.ok(parent)
  input('windowraise', parent)
  if (input('getwindowfocus').trim() !== xid) {
    input('windowactivate', xid); input('sleep', '0.2')
    if (input('getwindowfocus').trim() !== xid) input('windowfocus', '--sync', xid)
    input('sleep', '0.1')
  }
  assert.equal(input('getwindowfocus').trim(), xid)
}
function focus(id) { const xid = nativeWindow(id); focusXid(xid); return xid }
function key(id, chord) { focus(id); input('key', '--clearmodifiers', chord) }
function drawnFrame(id) {
  try { return JSON.parse(fs.readFileSync(path.join(active.inspection, 'frames', id + '.json'), 'utf8')) } catch { return null }
}
async function click(id, name, button = 1, inset = null) {
  await wait(`native control ${name}`, () => current(id)?.geometry?.[name] || drawnFrame(id)?.elements.some(element => element.key === name && !element.exiting))
  const xid = focus(id)
  await delay(250)
  const element = await wait(`actually drawn control ${name}`, () => drawnFrame(id)?.elements.find(element => element.key === name && !element.exiting && element.opacity > 0 && element.visible[2] > 0 && element.visible[3] > 0))
  const rect = element.visible, frame = geometry(xid)
  const x = frame.x + rect[0] + (inset ?? rect[2] / 2), y = frame.y + rect[1] + rect[3] / 2
  assert.ok(rect[2] > 0 && rect[3] > 0 && x >= frame.x && x < frame.x + frame.width && y >= frame.y && y < frame.y + frame.height, `${name} is outside its native viewport`)
  input('mousemove', x, y, 'sleep', '0.08')
  const runtime = await wait(`native Runtime pointer agrees with X11 for ${name}`, () => {
    const value = drawnFrame(id)
    return value?.pointer && Math.abs(value.pointer[0] - (x - frame.x)) <= 2 && Math.abs(value.pointer[1] - (y - frame.y)) <= 2 && value
  }, 5000)
  assert.ok(runtime.elements.some(item => item.key === name && !item.exiting), `Actual native pointer does not hit ${name}`)
  gestures.push({...scoped(), id, xid, name, button, rect, drawn_rect: element.rect, pointer: input('getmouselocation', '--shell'), runtime_pointer: runtime.pointer, hold_ms: 40})
  input('mousedown', button, 'sleep', '0.04', 'mouseup', button)
  await delay(120)
}
async function type(id, value, target = 'composer-input') {
  await click(id, target, 1, 12)
  const xid = nativeWindow(id)
  assert.equal(input('getwindowfocus').trim(), xid)
  input('key', '--clearmodifiers', 'ctrl+a'); await delay(50)
  input('type', '--clearmodifiers', '--delay', '2', '--', value)
  if (target === 'composer-input') await wait('actual entered draft', () => current(id)?.draft === value)
  assert.equal(input('getwindowfocus').trim(), xid)
}
async function captureXid(name, xid, id = null) {
  focusXid(xid); await delay(450)
  const frame = geometry(xid), file = path.join(active.directory, name + '.png')
  execFileSync('/usr/bin/python3', ['-c', `import gi,os,sys;gi.require_version('Gdk','3.0');from gi.repository import Gdk;d=Gdk.Display.open(os.environ['DISPLAY']);r=d.get_default_screen().get_root_window();x,y,w,h=map(int,sys.argv[2:]);p=Gdk.pixbuf_get_from_window(r,x,y,w,h);p.savev(sys.argv[1],'png',[],[])`, file, frame.x, frame.y, frame.width, frame.height].map(String), {env: active.env, stdio: 'pipe'})
  const proof = file.replace(/\.png$/, '.json')
  atomic(proof, {at: Date.now(), ...scoped(), id, xid, pid: active.child.pid, geometry: frame, snapshot: id ? current(id) : null, frame: id ? drawnFrame(id) : null})
  screenshots.push({...scoped(), window: id, file: path.relative(out, file), sha256: hash(fs.readFileSync(file)), proof: path.relative(out, proof)})
}
async function capture(name, id) { return captureXid(name, nativeWindow(id), id) }
function storeFile(name) { return path.join(active.state, name) }
async function stopOwned(process) {
  if (!process || process.exitCode != null || process.signalCode != null) return
  process.kill('SIGTERM')
  const deadline = Date.now() + 2000
  while (process.exitCode == null && process.signalCode == null && Date.now() < deadline) await delay(20)
  if (process.exitCode == null && process.signalCode == null) process.kill('SIGKILL')
}
async function quit() {
  if (!active?.child || active.child.exitCode != null) return
  const xid = visible()[0]; assert.ok(xid, 'No actual native window to quit')
  focusXid(xid); input('key', '--clearmodifiers', 'ctrl+q')
  const deadline = Date.now() + 30000
  while (active.child.exitCode == null && Date.now() < deadline) await delay(40)
  assert.equal(active.child.exitCode, 0, 'Native global Quit did not finish cleanly')
}
async function privateDisplay() {
  displayProcess = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1920x1200x24', '-nolisten', 'tcp'], {stdio: ['ignore', 'ignore', 'pipe', 'pipe']})
  owned.push(displayProcess)
  let display = '', diagnostic = ''
  displayProcess.stderr.on('data', bytes => diagnostic += bytes)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Private Xvfb did not start: ' + diagnostic)), 10000)
    displayProcess.stdio[3].on('data', bytes => { display += bytes; if (display.includes('\n')) { clearTimeout(timer); resolve() } })
    displayProcess.once('error', reject)
  })
  const runtime = path.join(suiteHome, 'runtime'); fs.mkdirSync(runtime, {mode: 0o700})
  const alsa = path.join(suiteHome, 'alsa.conf'); fs.writeFileSync(alsa, 'pcm.!default { type null }\n')
  env = {PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'UTC', DISPLAY: ':' + display.trim(), HOME: suiteHome, USERPROFILE: suiteHome, XDG_RUNTIME_DIR: runtime, XDG_STATE_HOME: path.join(suiteHome, 'state'), XDG_CONFIG_HOME: path.join(suiteHome, 'config'), XDG_DATA_HOME: path.join(suiteHome, 'data'), XDG_CACHE_HOME: path.join(suiteHome, 'cache'), HERMES_HOME: path.join(suiteHome, 'unused-agent'), HERMES_GATEWAY_TOKEN: 'private-test-token', PULSE_SERVER: `unix:${suiteHome}/no-pulse`, PIPEWIRE_REMOTE: `${suiteHome}/no-pipewire`, ALSA_CONFIG_PATH: alsa}
  bus = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], {env, stdio: ['ignore', 'pipe', 'pipe']}); owned.push(bus)
  env.DBUS_SESSION_BUS_ADDRESS = await new Promise((resolve, reject) => {
    let address = ''; const timer = setTimeout(() => reject(new Error('Private D-Bus did not start')), 5000)
    bus.stdout.on('data', bytes => { address += bytes; if (address.includes('\n')) { clearTimeout(timer); resolve(address.trim().split('\n')[0]) } }); bus.once('error', reject)
  })
  wm = spawn('xfwm4', ['--replace', '--compositor=off'], {env, stdio: ['ignore', 'ignore', 'pipe']}); owned.push(wm)
  let wmLog = ''; wm.stderr.on('data', bytes => wmLog += bytes)
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    assert.equal(wm.exitCode, null, 'Private window manager exited: ' + wmLog)
    if (/window id # 0x[0-9a-f]+/i.test(execFileSync('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK'], {env, encoding: 'utf8'}))) return
    await delay(100)
  }
  throw new Error('Private xfwm did not become ready: ' + wmLog)
}

const gateways = {A: {endpoint: 'http://127.0.0.1:18991', reset(){}, close(){}}, B: {reset(){}, close(){}}}
function principal(source, raw = false) {
  const inner = hash(`url:${new URL(gateways[source].endpoint).toString()}\0`)
  return raw ? inner : hash(`saved:${IDS[source]}:${REVISIONS[source]}:${inner}`)
}
function sameSource(snapshot, source) { return snapshot?.principal === principal(source, active.config.raw && source === 'A') }
async function ready(id, source, profile = PROFILE) {
  return wait(`connected ${source}/${profile}`, () => {
    const snapshot = current(id)
    return snapshot && sameSource(snapshot, source) && snapshot.profile === profile && !snapshot.loading && !snapshot.route_pending && !snapshot.error && snapshot.route === 'Chat' && frame(id).elements.some(e => e.key === 'composer-input' && !e.exiting) && snapshot
  })
}
const frame = id => drawnFrame(id) ?? {elements: []}
const available = element => !element.exiting && !element.inert && element.opacity > 0.95 && element.visible[2] > 1 && element.visible[3] > 1
function matchedRow(element, source) {
  if (!element.key?.startsWith('session-[')) return false
  try {
    const [stamp, profile, root] = JSON.parse(element.key.slice('session-'.length))
    return profile === PROFILE && root === ROOT && stamp.principal === principal(source, active.config.raw && source === 'A')
  } catch { return false }
}
function row(id, source) { return frame(id).elements.find(element => matchedRow(element, source) && !element.exiting) }
async function actualReveal(id, predicate, description) {
  const xid = focus(id)
  await delay(300)
  let element
  for (let attempt = 0; attempt < 24; attempt++) {
    element = frame(id).elements.find(predicate)
    if (element && available(element)) return {xid, element}
    const g = geometry(xid)
    const picker = frame(id).elements.find(e => e.key === 'profile-picker' && available(e))
    const viewport = picker?.visible ?? [0, 100, 220, Math.max(100, g.height - 300)]
    const direction = element && element.rect[1] < viewport[1] ? 4 : 5
    const x = g.x + viewport[0] + Math.min(100, viewport[2] / 2)
    const y = g.y + viewport[1] + viewport[3] / 2
    input('mousemove', x, y, 'sleep', '0.05', 'click', '--repeat', '2', '--delay', '60', direction)
    gestures.push({...scoped(), id, description, scroll: direction, viewport, os_pointer: input('getmouselocation', '--shell')})
    await delay(150)
  }
  assert.ok(element && available(element), `Actual native control unavailable: ${description}`)
}
async function actualClick(id, predicate, description, button = 1, inset = null) {
  const {xid, element} = await actualReveal(id, predicate, description)
  const rect = element.visible, g = geometry(xid)
  const x = g.x + rect[0] + (inset ?? rect[2] / 2), y = g.y + rect[1] + rect[3] / 2
  assert.ok(x >= g.x && x < g.x + g.width && y >= g.y && y < g.y + g.height, `Outside native window: ${description}`)
  input('mousemove', x, y, 'sleep', '0.08')
  const presented = await wait(`actual pointer agrees: ${description}`, () => {
    const currentFrame = frame(id)
    return currentFrame.pointer && Math.abs(currentFrame.pointer[0] - (x - g.x)) <= 2 && Math.abs(currentFrame.pointer[1] - (y - g.y)) <= 2 && currentFrame
  }, 5000)
  gestures.push({...scoped(), id, xid, description, key: element.key, path: element.path, label: element.label, button, rect, pointer: input('getmouselocation', '--shell'), runtime_pointer: presented.pointer, hold_ms: 40})
  input('mousedown', button, 'sleep', '0.04', 'mouseup', button)
  await delay(180)
}
async function clickRow(id, source, button = 1) {
  await wait(`fetched source-qualified row ${source}`, () => row(id, source))
  return actualClick(id, element => matchedRow(element, source), `source ${source} same-id row`, button)
}
function menuPrefix(id, source) {
  const elements = frame(id).elements
  if (sameSource(current(id), source)) return 'sidebar-session-actions'
  return elements.find(e => e.key?.startsWith('owned-session-actions-') && e.key.endsWith('-item0') && !e.exiting)?.key.slice(0, -'-item0'.length)
}
async function rowAction(id, source, index) {
  await clickRow(id, source, 3)
  const prefix = await wait(`actual ${source} row context menu`, () => menuPrefix(id, source))
  await actualClick(id, element => element.key === `${prefix}-item${index}`, `${source} row action ${index}`)
}
function pendingReceipts(source) {
  const directory = storeFile('sidebar-edits')
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory).filter(file => file.endsWith('.json')).flatMap(file => {
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
    return receipt?.mutation?.source?.version?.id?.id === IDS[source] ? [receipt] : []
  })
}
async function copiedInput(id, expected) {
  await click(id, 'composer-input', 1, 12)
  await wait('focused composer displays exact typed draft', () => frame(id).elements.some(e => e.focused && e.key === 'composer-input' && e.text === expected))
  input('key', '--clearmodifiers', 'ctrl+a'); await delay(150)
  input('key', '--clearmodifiers', 'ctrl+c')
  let copied
  for (let attempt = 0; attempt < 15; attempt++) {
    copied = execFileSync('/usr/bin/python3', ['-c', `import gi;gi.require_version('Gtk','3.0');from gi.repository import Gtk,Gdk;Gtk.init([]);print(Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text() or '',end='')`], {env: active.env, encoding: 'utf8', timeout: 5000})
    if (copied === expected) break
    await delay(100)
  }
  assert.equal(copied, expected, 'Actual native clipboard must copy the exact selected draft')
  input('key', '--clearmodifiers', 'End')
}
async function persistedInput(source, editor, text) {
  await wait('private persisted input retains its actual source/editor identity', () => {
    const file = storeFile(`drafts/${principal(source, active.config.raw && source === 'A')}.json`)
    if (!fs.existsSync(file)) return false
    const document = JSON.parse(fs.readFileSync(file, 'utf8'))
    return document.entries?.some(entry => entry.editor === editor && entry.profile === PROFILE && entry.draft?.text === text)
  })
  checked('source-owned input is retained in its private persisted editor file', true)
}
function foreground(snapshot) { return {principal: snapshot.principal, source_epoch: snapshot.source_epoch, editor: snapshot.editor, profile: snapshot.profile, session: snapshot.session, draft: snapshot.draft} }
function assertForeground(id, expected, label) {
  assert.deepEqual(foreground(current(id)), expected, `${label}: source/profile/editor/session/input changed`)
  assert.ok(JSON.stringify(current(id).messages).includes('Distinct private history A/research'), `${label}: A history was replaced`)
  checked(label, true)
}
function sourceFacts(id) { return current(id)?.fleet?.sources ?? [] }
async function fleetCount(id, count) {
  return wait(`verified whole-fleet ${count} profiles`, () => {
    const sources = sourceFacts(id)
    const saved = sources.filter(s => (s.version ?? s.descriptor?.version)?.id?.kind === 'saved')
    return saved.length === 2 && saved.reduce((sum, source) => sum + source.profiles.length, 0) === count && saved
  }, 30000)
}
function squares(id) { return frame(id).elements.filter(e => !e.exiting && (gateways.A.names().some(name => e.key === `profile-${name}`) || gateways.B.names().some(name => e.key === profileKey('B', name)))) }
async function selectRowSource(id, source) {
  await clickRow(id, source)
  await ready(id, source)
  await wait(`source ${source} same-id history`, () => current(id)?.session === TIP && JSON.stringify(current(id).messages).includes(`Distinct private history ${source}/research`))
  return current(id)
}
async function flipTheme(id, dark, filename) {
  if (current(id).dark !== dark) await click(id, 'theme-toggle')
  await wait(`actual ${dark ? 'dark' : 'light'} appearance`, () => current(id)?.dark === dark)
  await capture(filename, id)
}
async function primary() { return wait('complete native primary Viewer', () => snapshots().find(s => s.kind === 'primary_launch' && s.native?.position && !s.loading && !s.route_pending && !s.error && frame(s.id).elements.some(e => e.key === 'composer-input' && !e.exiting))) }
function seededRegistry() { return {version: 1, rows: [], selected: null, primary: null, lastUsed: null, launchMode: 'primary', lastProfiles: {[IDS.A]: PROFILE, [IDS.B]: PROFILE}, cleanup: []} }
async function runCase(name, config, check) {
  if (only && only !== name) return
  for (const gateway of Object.values(gateways)) gateway.reset()
  const directory = path.join(out, name), home = path.join(suiteHome, name), state = path.join(home, 'state', 'hermes-desktop-rune'), inspection = path.join(directory, 'inspection')
  fs.mkdirSync(state, {recursive: true, mode: 0o700}); fs.mkdirSync(inspection, {recursive: true})
  active = {name, config, directory, home, state, inspection, child: null, log: '', windows: new Map(), env: {...env, HOME: home, USERPROFILE: home, XDG_STATE_HOME: path.join(home, 'state'), XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'), XDG_CACHE_HOME: path.join(home, 'cache'), HERMES_HOME: path.join(home, 'unused-agent')}}
  let credentials = null
  if (config.alias || config.root) {
    credentials = await startPrivateCredentials({env: active.env})
    active.env = {...credentials.env, USERPROFILE: credentials.env.HOME, HERMES_HOME: path.join(credentials.env.HOME, 'unused-agent')}
    const reference = `legacy-auth-${randomUUID()}`
    await credentials.putLegacyBundle(reference, TOKEN, {})
    config.reference = reference
  }
  phase = 'boot'
  const registry = {version: 1, rows: [], selected: null, primary: null, lastUsed: null, launchMode: 'primary', lastProfiles: {}, cleanup: []}
  if (config.alias || config.root) registry.version = 2
  if (config.alias || config.root) registry.legacy = {version: 1, global: null, profiles: {default: {id: randomUUID(), edit_revision: randomUUID(), route_revision: randomUUID(), value: {mode: 'remote', kind: 'url', url: gateways.B.endpoint, auth_mode: 'token', remote_profile: config.root ? null : 'dixie', token_present: true, credential: {id: config.reference, version: 1}}}}, tombstones: {}}
  atomic(storeFile('connections.json'), registry)
  atomic(storeFile('startup.json'), {version: 1, revision: 1, defaultRoute: null})
  atomic(storeFile('preferences.json'), {theme: !!config.dark, speak_replies: false, sidebar_open: true, inspector_open: false, show_statusbar: true, show_profile_rail: !config.hidden, simple_mode: false})
  atomic(storeFile('display.json'), {version:1,default_project_dir:'/private/client-default'})
  atomic(storeFile('sounds.json'), {version: 1, preset: 0, muted: true})
  atomic(storeFile('notifications.json'), {version: 1, enabled: false})
  atomic(storeFile('sidebar.json'), {rail: true, all_profiles: false})

  const started = requests.length
  try {
    active.child = spawn(binary, ['--peer-window-proof-dir', inspection, ...(config.raw ? ['--gateway', gateways.A.endpoint, '--profile', PROFILE] : [])], {cwd: app, env: active.env, stdio: ['ignore', 'pipe', 'pipe']}); owned.push(active.child)
    active.child.stderr.on('data', bytes => active.log += bytes); active.child.stdout.on('data', bytes => active.log += bytes)
    await check({started})
    if (failure) throw failure
    const result = {name, passed: true, requests: requests.length - started, native_windows: active.windows.size, mutations: gateways.B.mutations, admissions: gateways.B.admissions, windows: snapshots()}
    await quit(); if (failure) throw failure; results.push(result); atomic(path.join(directory, 'result.json'), result)
  } catch (error) {
    for (const snapshot of snapshots()) { try { await capture(`failure-${snapshot.id}`, snapshot.id) } catch (captureError) { checks.push({...scoped(), capture_error: String(captureError)}) } }
    if (!snapshots().length) for (const [index, xid] of visible().entries()) { try { await captureXid(`failure-native-${index}`, xid) } catch {} }
    atomic(path.join(directory, 'failure.json'), {phase, error: String(error.stack ?? error), windows: snapshots(), frames: snapshots().map(s => frame(s.id))})
    throw error
  } finally {
    atomic(path.join(directory, 'app.log'), active.log)
    for (const file of ['startup.json', 'connections.json', 'windows.json', 'sidebar.json', 'preferences.json']) if (fs.existsSync(storeFile(file))) fs.copyFileSync(storeFile(file), path.join(directory, file))
    for (const directoryName of ['drafts', 'sidebar-edits']) if (fs.existsSync(storeFile(directoryName))) fs.cpSync(storeFile(directoryName), path.join(directory, directoryName), {recursive: true})
    try { await quit() } catch (error) { checks.push({...scoped(), quit_error:String(error)}) }
    await stopOwned(active.child); if (credentials) await credentials.stop(); active = null
  }
}
async function vertical() {
  const rpc = p => JSON.parse(execFileSync('node', ['/tmp/herune-admit-private/rpc.mjs', JSON.stringify(p)], {encoding:'utf8',timeout:180000}))
  const row = () => rpc({action:'list'}).result.plugins.find(x => x.key === 'lifecycle_fixture')
  const healthy = id => { const s=current(id); return s && !s.error && !s.client_error && !s.compose_error && !s.fleet?.error && s.fleet?.sources?.length > 0 && s.fleet.sources.every(source => !String(source.status).includes('Unavailable')) && (s.fleet?.sidebar_groups ?? []).length > 0 && !(s.fleet?.sidebar_groups ?? []).some(g => g.busy || Object.entries(g.errors ?? {}).some(([key, error]) => !(key.startsWith('sidebar.live.') && String(error).includes('(4000)')))) }
  let id=(await primary()).id
  await wait('authenticated sidebar',()=>healthy(id),30000)
  checks.push({...scoped(), name:'sidebar_errors', value:current(id).fleet.sidebar_groups.map(g=>g.errors)})
  await click(id,'nav-capabilities'); await click(id,'capabilities-tab-plugins')
  await wait('real enabled plugin',()=>row()?.status==='enabled' && frame(id).elements.some(e=>e.key==='capability-plugin-lifecycle_fixture'&&!e.exiting))
  await click(id,'capability-plugin-lifecycle_fixture')
  await type(id,'hello-native','capability-field-0')
  await actualClick(id,e=>e.role==='button'&&e.label==='Save plugin settings','save setting')
  await wait('setting readback',()=>row()?.settings_schema?.[0]?.value==='hello-native',30000)
  await click(id,'nav-new-session'); await type(id,'Use the lifecycle fixture tool, then report its result.'); key(id,'Return')
  await wait('real tool result and healthy history',()=>JSON.stringify(current(id)?.messages).includes('hello-native') && healthy(id),120000)
  await delay(3000); checked('completed real chat has no HTTP authentication errors',healthy(id))
  const session = current(id).session
  checked('stored conversation identity exists',!!session)
  checks.push({...scoped(), name:'sidebar_errors', value:current(id).fleet.sidebar_groups.map(g=>g.errors)})
  atomic(path.join(active.directory,'before-quit.json'),current(id))
  const first = {pid:active.child.pid, startticks:fs.readFileSync(`/proc/${active.child.pid}/stat`,'utf8').split(' ')[21]}
  await quit()
  active.inspection=path.join(active.directory,'relaunch-inspection'); fs.mkdirSync(active.inspection)
  active.child=spawn(binary,['--peer-window-proof-dir',active.inspection,'--gateway',gateways.A.endpoint,'--profile',PROFILE],{cwd:app,env:active.env,stdio:['ignore','pipe','pipe']}); owned.push(active.child)
  active.child.stderr.on('data',bytes=>active.log+=bytes); active.child.stdout.on('data',bytes=>active.log+=bytes)
  const second={pid:active.child.pid,startticks:fs.readFileSync(`/proc/${active.child.pid}/stat`,'utf8').split(' ')[21]}
  checked('distinct native app processes',first.pid!==second.pid && first.startticks!==second.startticks)
  atomic(path.join(active.directory,'processes.json'),{first,second})
  id=(await primary()).id
  await wait('authenticated stored session row',()=>healthy(id) && frame(id).elements.some(e=>e.key?.startsWith('session-[')&&!e.exiting),30000)
  await actualClick(id,e=>e.key?.startsWith('session-[')&&!e.exiting,'reopen stored history')
  await wait('stored real tool result read back',()=>JSON.stringify(current(id)?.messages).includes('hello-native') && healthy(id),30000)
  checks.push({...scoped(), name:'sidebar_errors', value:current(id).fleet.sidebar_groups.map(g=>g.errors)})
  atomic(path.join(active.directory,'after-relaunch.json'),current(id)); await capture('authenticated-history',id)
  checked('reopened native history has no HTTP authentication errors',healthy(id))
  await click(id,'nav-capabilities'); await click(id,'capabilities-tab-plugins'); await wait('enabled plugin after restart',()=>row()?.status==='enabled'&&row()?.settings_schema?.[0]?.value==='hello-native',30000)
  await click(id,'capability-plugin-lifecycle_fixture'); await actualClick(id,e=>e.role==='button'&&e.label==='Remove','remove plugin'); await click(id,'capabilities-confirm')
  await wait('authoritative removal',()=>!row(),30000); checked('plugin removed after history readback',!row())
}

let passed = false
try {
  assert.ok(fs.statSync(binary).isFile(), 'Build the ordinary native application before acceptance')
  await privateDisplay()
  for (const [name, config] of [['restart',{raw:true}]]) {
    try { await runCase(name, config, vertical) } catch (error) { results.push({name,passed:false,error:String(error.stack??error)}); failure = null }
  }
  assert.ok(results.length, 'No selected native case ran')
  if (failure) throw failure
  assert.equal(hash(fs.readFileSync(binary)), binarySha, 'Candidate changed during acceptance')
  passed = results.every(r => r.passed) && !checks.some(c => c.name === 'sidebar_errors' && c.value.some(errors => Object.keys(errors).length))
  if (!passed) process.exitCode = 1
} catch (error) {
  failure ??= error
  console.error(error.stack ?? error)
  process.exitCode = 1
} finally {
  for (const process of owned.slice().reverse()) await stopOwned(process)
  await Promise.all(Object.values(gateways).map(gateway => gateway.close()))
  atomic(path.join(out, 'requests.json'), requests)
  atomic(path.join(out, 'gestures.json'), gestures)
  atomic(path.join(out, 'result.json'), {passed, binary, binary_sha256: binarySha, harness_sha256: harnessSha, credentials_fixture_sha256: credentialsFixtureSha, source_head: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: app, encoding: 'utf8'}).trim(), suite_home: suiteHome, failure: failure ? String(failure.stack ?? failure) : null, cases: results, checks, bindings, screenshots, remaining: ['macOS native acceptance'], owned: owned.map(c => ({pid:c.pid, exitCode:c.exitCode, signalCode:c.signalCode}))})
  console.log(JSON.stringify({passed, out, cases: results.map(({name, passed}) => ({name, passed})), failure: failure ? String(failure) : null}))
}
