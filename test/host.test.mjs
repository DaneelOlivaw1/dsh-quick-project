// Host-half tests: the naming route end to end with a fake ctx, a fake request
// and a fake model, so the route's contract does not need a live Host to hold.
//
//   node --test test/host.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../host/name-route.mjs'

/** A ctx that records the route the plugin registers. */
function fakeContext({ route = { provider: 'fake', model: 'fake-1' }, answer = 'invoice-reconciler', fail } = {}) {
  const registered = []
  // A child context inherits the parent's services, so the fake `web` carries
  // them too: `mount(web)` resolves `llm` and `agentDefaultModel` from it.
  const web = {
    webServer: { register: (routeSpec) => registered.push(routeSpec) },
    effect: (callback) => callback(),
  }
  web.llm = {
    prepareCall: async (config) => ({
      config,
      stream: async function* () {
        if (fail !== undefined) throw fail
        for (const text of Array.isArray(answer) ? answer : [answer]) {
          yield { type: 'text-delta', index: 0, text }
        }
      },
    }),
  }
  web.agentDefaultModel = { currentSelection: () => route }
  const ctx = {
    llm: web.llm,
    agentDefaultModel: web.agentDefaultModel,
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
  const captured = { status: 0, headers: undefined, body: '' }
  const res = {
    writeHead: (status, headers) => {
      captured.status = status
      captured.headers = headers
    },
    end: (value) => {
      captured.body = value ?? ''
    },
  }
  await handler(req, res)
  return { ...captured, json: captured.body === '' ? undefined : JSON.parse(captured.body) }
}

test('registers one POST route for naming', () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].path, '/quick-project/name')
  assert.equal(registered[0].kind, 'exact')
  assert.equal(typeof registered[0].handler, 'function')
})

test('names a project from the description', async () => {
  const { ctx, registered } = fakeContext({ answer: 'invoice-reconciler' })
  apply(ctx)
  const result = await call(registered[0].handler, { body: { description: '把账单按月汇总成一张表' } })
  assert.equal(result.status, 200)
  assert.deepEqual(result.json, { ok: true, name: 'invoice-reconciler' })
})

test('keeps only the name-shaped token of a chatty answer', async () => {
  const { ctx, registered } = fakeContext({ answer: ['Here you go: `', 'Invoice-Reconciler', '` — a tool that batches bills.'] })
  apply(ctx)
  const result = await call(registered[0].handler, { body: { description: 'bills' } })
  assert.equal(result.json.name, 'invoice-reconciler')
})

test('reports a failed model instead of inventing a name', async () => {
  const { ctx, registered } = fakeContext({ fail: new Error('provider down') })
  apply(ctx)
  const result = await call(registered[0].handler, { body: { description: 'bills' } })
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, false)
  assert.equal(result.json.error, 'llm-failed')
})

test('answers 405 for GET and 400 for an empty description', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const get = await call(registered[0].handler, { method: 'GET' })
  assert.equal(get.status, 405)
  assert.equal(get.headers.allow, 'POST')
  const empty = await call(registered[0].handler, { body: { description: '   ' } })
  assert.equal(empty.status, 400)
})
