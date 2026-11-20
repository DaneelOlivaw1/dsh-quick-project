/**
 * Directory removal endpoint, in its own module for the same reason
 * `name-route.mjs` is: Node caches an ESM module by URL for the life of the
 * process, so a route the process has never imported is the only kind that can
 * appear without restarting the Host.
 *
 * Guardrails matter more here than anywhere else in this plugin: this is the
 * one endpoint that deletes files. It refuses to touch
 *
 *   - a path outside the Host home,
 *   - the home directory itself,
 *   - the projects root (`<home>/project`), so one stray click cannot take every
 *     project at once,
 *   - anything inside DSH's own home (`~/.dsh`) — the sessions live there,
 *   - a path that is not an existing directory.
 *
 * Everything else is removed recursively. The confirmation belongs to the
 * browser half; this endpoint only checks the shape of the request.
 */

import { realpath, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'quick-project-remove'

/** No Host services are read: this is a pure filesystem endpoint. */
export const inject = []

/** Write one JSON response. A `handler` route owns the whole response lifecycle. */
function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

/** Read the request body, bounded. */
async function readBody(req, limit = 4_096) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** True when `child` is `parent` or sits below it. */
function within(child, parent) {
  return child === parent || child.startsWith(`${parent}/`)
}

/**
 * Check one requested path against the guardrails.
 * @param requested - the path the browser asked to delete.
 * @returns the path to delete, or a refusal reason.
 */
async function admit(requested) {
  if (typeof requested !== 'string' || requested.trim() === '') return { reason: 'path is required' }
  const home = homedir()
  const target = resolve(requested)
  if (target === '/') return { reason: 'refusing to delete the filesystem root' }
  if (target === home) return { reason: 'refusing to delete the home directory' }
  if (!within(target, home)) return { reason: 'path is outside the Host home directory' }
  const dshHome = process.env.DSH_HOME ?? join(home, '.dsh')
  if (within(target, dshHome)) return { reason: 'refusing to delete inside the DSH home' }
  if (target === join(home, 'project')) return { reason: 'refusing to delete the projects root' }
  let info
  try {
    info = await stat(target)
  } catch {
    return { reason: 'not there any more' }
  }
  if (!info.isDirectory()) return { reason: 'not a directory' }
  // Resolve links last: a symlink that points back into the DSH home must be
  // judged by where it lands, not by where it starts.
  let real
  try {
    real = await realpath(target)
  } catch {
    return { reason: 'cannot resolve the path' }
  }
  if (real !== target && !within(real, home)) return { reason: 'the link points outside the Host home' }
  return { path: target }
}

/**
 * Host plugin body: mount `POST /quick-project/remove`.
 * @param ctx - Host root context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (web) => {
    web.effect(() => web.webServer.register({
      kind: 'exact',
      path: '/quick-project/remove',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST', 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'method' }))
          return
        }
        let requested
        try {
          requested = JSON.parse(await readBody(req))?.path
        } catch {
          sendJson(res, 400, { ok: false, error: 'bad-body' })
          return
        }
        const admitted = await admit(requested)
        if (admitted.path === undefined) {
          sendJson(res, 409, { ok: false, error: 'refused', message: admitted.reason })
          return
        }
        try {
          await rm(admitted.path, { recursive: true, force: true })
          sendJson(res, 200, { ok: true, path: admitted.path })
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            error: 'remove-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    }), 'quick-project: remove route')
  })
}
