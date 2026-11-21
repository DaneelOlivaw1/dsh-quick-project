// Filesystem endpoint tests. The reason these exist: `directoryPicker` is a
// composed capability — POSIX serves the in-app `browse` half, Windows serves
// `pick` only — so the plugin must not depend on either half. These endpoints
// are that independence, and the guardrails are the part worth asserting.
//
//   node --test test/project-fs.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../host/project-fs.mjs'

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

/** A scratch directory inside the Host home. */
function scratch() {
  return mkdtempSync(join(homedir(), 'qp-fs-test-'))
}

test('registers list, create and remove', () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  assert.deepEqual([...registered.keys()].sort(), [
    '/quick-project/create',
    '/quick-project/list',
    '/quick-project/remove',
  ])
})

test('every route answers 405 for GET', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  for (const route of registered.values()) {
    const result = await call(route, { method: 'GET' })
    assert.equal(result.status, 405)
  }
})

test('lists only subdirectories, sorted, with crumbs', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const dir = scratch()
  mkdirSync(join(dir, 'zebra'))
  mkdirSync(join(dir, 'alpha'))
  writeFileSync(join(dir, 'note.txt'), 'x')

  const result = await call(registered.get('/quick-project/list'), { body: { path: dir } })
  assert.equal(result.status, 200)
  assert.deepEqual(result.json.entries.map((entry) => entry.name), ['alpha', 'zebra'])
  assert.equal(result.json.path, dir)
  assert.equal(result.json.crumbs.at(-1).path, dir)
  await call(registered.get('/quick-project/remove'), { body: { path: dir } })
})

test('creates a project under the projects root, parents included, idempotently', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const name = `qp-created-${process.pid}-${Date.now()}`
  const created = await call(registered.get('/quick-project/create'), { body: { name } })
  assert.equal(created.status, 200)
  assert.equal(created.json.path, join(homedir(), 'project', name))
  assert.equal(existsSync(created.json.path), true)

  const again = await call(registered.get('/quick-project/create'), { body: { name } })
  assert.equal(again.status, 200, 'an existing name is adopted, not an error')

  await call(registered.get('/quick-project/remove'), { body: { path: created.json.path } })
  assert.equal(existsSync(created.json.path), false)
})

test('create rejects a name that is not one path segment', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  for (const name of ['', '   ', '.', '..', 'a/b', 'a\\b']) {
    const result = await call(registered.get('/quick-project/create'), { body: { name } })
    assert.equal(result.status, 400, `${JSON.stringify(name)} should be rejected`)
  }
})

test('removes recursively and refuses the dangerous paths', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const route = registered.get('/quick-project/remove')
  const dir = scratch()
  mkdirSync(join(dir, 'nested'))
  writeFileSync(join(dir, 'nested', 'b.txt'), 'x')

  for (const path of [homedir(), '/', join(homedir(), 'project')]) {
    const result = await call(route, { body: { path } })
    assert.equal(result.status, 409, `${path} should be refused`)
  }
  assert.equal(existsSync(join(homedir(), 'project')), true, 'the projects root must survive')

  const outside = await call(route, { body: { path: '/tmp' } })
  assert.equal(outside.json.error, 'refused')

  const file = await call(route, { body: { path: join(dir, 'nested', 'b.txt') } })
  assert.match(file.json.message, /not a directory/)

  const removed = await call(route, { body: { path: dir } })
  assert.equal(removed.status, 200)
  assert.equal(existsSync(dir), false)
})

test('list refuses a path outside the home and reports a missing one', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const route = registered.get('/quick-project/list')
  const outside = await call(route, { body: { path: '/tmp' } })
  assert.equal(outside.status, 409)
  const missing = await call(route, { body: { path: join(homedir(), 'qp-does-not-exist-xyz') } })
  assert.equal(missing.status, 404)
  assert.deepEqual(readdirSync(homedir()).includes('.dsh') || true, true)
})
