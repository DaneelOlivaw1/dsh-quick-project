// Clone route tests. The clone itself needs git and a network, so the tests
// stop at the contract: what is refused before git is ever spawned, how the
// status endpoint answers, and how git's stderr becomes a progress reading.
//
//   node --test test/clone-route.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { apply, progressConsumer, readProgress } from '../host/clone-route.mjs'

/** A ctx that records the routes the plugin registers. */
function fakeContext() {
  const registered = new Map()
  const web = {
    webServer: { register: (spec) => registered.set(spec.path, spec) },
    effect: (callback) => callback(),
  }
  const ctx = {
    inject: (_services, callback) => callback(web),
    effect: (callback) => callback(),
  }
  return { ctx, registered }
}

/** Run one registered handler against a fake request. */
async function call(route, { method = 'POST', body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  const captured = { status: 0, body: '' }
  const res = {
    writeHead: (status) => {
      captured.status = status
    },
    end: (value) => {
      captured.body = value ?? ''
    },
  }
  await route.handler(req, res)
  return { ...captured, json: captured.body === '' ? undefined : JSON.parse(captured.body) }
}

test('registers the clone and clone-status routes', () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  assert.deepEqual([...registered.keys()].sort(), [
    '/quick-project/clone',
    '/quick-project/clone-status',
  ])
})

test('both routes answer 405 for GET', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  for (const route of registered.values()) {
    const result = await call(route, { method: 'GET' })
    assert.equal(result.status, 405)
  }
})

test('refuses a repository "url" git would read as an option', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const route = registered.get('/quick-project/clone')
  for (const url of ['--upload-pack=touch /tmp/pwned', '-c protocol.ext.allow=always', 'has space']) {
    const result = await call(route, { body: { url } })
    assert.equal(result.status, 400, `${url} must be refused before git runs`)
    assert.equal(result.json.error, 'bad-url')
  }
  for (const url of ['', '   ']) {
    const result = await call(route, { body: { url } })
    assert.equal(result.status, 400)
  }
  // 'not a url' has spaces, so it is refused as a bad url rather than accepted.
  const shaped = await call(route, { body: { url: 'not a url' } })
  assert.equal(shaped.status, 400)
})

test('refuses a Chinese folder name — the naming rule holds here too', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const route = registered.get('/quick-project/clone')
  const result = await call(route, {
    body: { url: 'https://github.com/owner/repo.git', name: '账单汇总' },
  })
  assert.equal(result.status, 400)
  assert.equal(result.json.error, 'bad-name')
  assert.equal(result.json.reason, 'non-ascii')
})

test('refuses to clone into a directory that already has content', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const route = registered.get('/quick-project/clone')
  // A real, non-empty directory under the projects root, so the check that runs
  // is the one that ships. The name is a legal slug — `mkdtemp` would produce
  // uppercase characters, which the naming rule rejects before this check.
  const parent = join(homedir(), 'project')
  mkdirSync(parent, { recursive: true })
  const name = `qp-clone-test-${process.pid}-${Date.now()}`
  const scratch = join(parent, name)
  mkdirSync(scratch, { recursive: true })
  writeFileSync(join(scratch, 'file.txt'), 'x')

  try {
    const result = await call(route, { body: { url: 'https://github.com/owner/repo.git', name } })
    assert.equal(result.status, 409)
    assert.equal(result.json.error, 'exists')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('clone-status answers 400 without an id and 404 for one it does not know', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const route = registered.get('/quick-project/clone-status')
  assert.equal((await call(route, { body: {} })).status, 400)
  assert.equal((await call(route, { body: { id: 'no-such-clone' } })).status, 404)
})

test('reads a phase and a percentage out of one git line', () => {
  const receiving = readProgress('Receiving objects:  47% (1234/2600)')
  assert.equal(receiving.phase, 'receiving')
  assert.equal(receiving.percent, 47)
  assert.equal(readProgress('Resolving deltas: 100% (812/812), done.').phase, 'resolving')
  assert.equal(readProgress('Enumerating objects: 2600, done.').phase, 'enumerating')
  assert.equal(readProgress('Counting objects: 2600, done.').phase, 'counting')
  assert.equal(readProgress('Compressing objects:  12% (200/1600)').phase, 'compressing')
  assert.equal(readProgress("Cloning into '/Users/me/project/repo'...").phase, 'starting')
  // A line with no percentage still updates the raw line, without inventing one.
  const bare = readProgress('remote: Enumerating objects')
  assert.equal(bare.line, 'remote: Enumerating objects')
  assert.equal(bare.percent, undefined)
  // Blank output changes nothing.
  assert.deepEqual(readProgress('   '), {})
})

test('follows a carriage-return progress stream to 100%', () => {
  // The real shape of a network clone: git overwrites one line with \r, and the
  // whole point of this plugin's progress is that the bar moves during the
  // download instead of sitting at 0 until it ends.
  const job = { phase: 'starting', percent: 0, line: '' }
  const consume = progressConsumer(job)
  consume("Cloning into 'repo'...\n")
  assert.equal(job.phase, 'starting')
  consume('remote: Enumerating objects: 13, done.        \n')
  assert.equal(job.phase, 'enumerating')
  consume('Receiving objects:   7% (1/13)\rReceiving objects:  46% (6/13)\rReceiving objects:  92% (12/13)\r')
  assert.equal(job.phase, 'receiving')
  assert.equal(job.percent, 92)
  // A later phase restarting at 0% must not drag the bar backwards.
  consume('Resolving deltas:   0% (0/5)\r')
  assert.equal(job.phase, 'resolving')
  assert.equal(job.percent, 92, 'the bar never goes backwards')
  consume('Receiving objects: 100% (13/13), done.\n')
  assert.equal(job.percent, 100)
})

test('joins a line split across two chunks instead of reading half of it', () => {
  const job = { phase: 'receiving', percent: 0, line: '' }
  const consume = progressConsumer(job)
  consume('Receiving objects:  ')
  assert.equal(job.percent, 0, 'a fragment alone is not a reading')
  consume('61% (8/13)\r')
  assert.equal(job.percent, 61)
})
