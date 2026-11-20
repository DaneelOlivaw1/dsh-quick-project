// Removal endpoint tests: the guardrails are the point, so they are asserted
// before the happy path and again after it.
//
//   node --test test/remove.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../host/remove-route.mjs'

/** A ctx that records the route the plugin registers. */
function fakeContext() {
  const registered = []
  const web = {
    webServer: { register: (spec) => registered.push(spec) },
    effect: (callback) => callback(),
  }
  const ctx = {
    inject: (_services, callback) => callback(web),
    effect: (callback) => callback(),
  }
  return { ctx, registered }
}

/** Run the registered handler against a fake request. */
async function call(handler, { method = 'POST', body } = {}) {
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
  await handler(req, res)
  return { ...captured, json: captured.body === '' ? undefined : JSON.parse(captured.body) }
}

/** A scratch directory inside the Host home, with one file in it. */
function scratch() {
  const dir = mkdtempSync(join(homedir(), 'qp-remove-test-'))
  writeFileSync(join(dir, 'a.txt'), 'x')
  mkdirSync(join(dir, 'nested'))
  writeFileSync(join(dir, 'nested', 'b.txt'), 'x')
  return dir
}

test('registers one POST route', () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].path, '/quick-project/remove')
  assert.equal(typeof registered[0].handler, 'function')
})

test('answers 405 for GET', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const result = await call(registered[0].handler, { method: 'GET' })
  assert.equal(result.status, 405)
})

test('removes a directory recursively', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const dir = scratch()
  const result = await call(registered[0].handler, { body: { path: dir } })
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(existsSync(dir), false)
})

test('refuses the home directory, the projects root, and the filesystem root', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  for (const path of [homedir(), '/', join(homedir(), 'project')]) {
    const result = await call(registered[0].handler, { body: { path } })
    assert.equal(result.status, 409, `${path} should be refused`)
    assert.equal(result.json.error, 'refused')
  }
  assert.equal(existsSync(join(homedir(), 'project')), true, 'the projects root must survive')
})

test('refuses a path outside the home, a file, and a path that is gone', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const outside = await call(registered[0].handler, { body: { path: '/tmp' } })
  assert.equal(outside.json.error, 'refused')

  const dir = scratch()
  const file = join(dir, 'a.txt')
  const notADirectory = await call(registered[0].handler, { body: { path: file } })
  assert.equal(notADirectory.status, 409)
  assert.match(notADirectory.json.message, /not a directory/)

  const missing = await call(registered[0].handler, { body: { path: join(dir, 'nope') } })
  assert.equal(missing.status, 409)

  // The refusals above must not have removed anything.
  assert.equal(existsSync(join(dir, 'nested', 'b.txt')), true)
  await call(registered[0].handler, { body: { path: dir } })
})
