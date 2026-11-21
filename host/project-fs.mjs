/**
 * Filesystem endpoints for projects, in one module because they share the same
 * guardrails and the same reason for existing: the directory picker is a
 * *composed* capability and different deployments compose different halves.
 *
 * POSIX deployments here compose the in-app browser, which serves
 * `createDirectory` and `list`; Windows composes the native OS dialog, which
 * serves only `pick`. Calling `directoryPicker.createDirectory` on that machine
 * answers "needs the browse capability; the composed picker serves native" — so
 * nothing in this plugin may depend on which half is composed. The Host can
 * always do both, and it is the side that knows the real path separator.
 *
 * Endpoints (all POST, all JSON):
 *   /quick-project/list   { path? }  → { path, root, crumbs, entries }
 *   /quick-project/create { name }   → { path }           409 when it exists
 *   /quick-project/remove { path }   → { path }           recursive
 *
 * Guardrails, shared by all three: stay inside the Host home, never touch a
 * path that is home itself, `/`, the projects root (for removal) or anything
 * inside DSH's home.
 */

import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'quick-project-fs'

/** The HTTP surface is the only Host service read. */
export const inject = ['webServer']

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

/** True when `child` is `parent` or sits below it, on either separator. */
function within(child, parent) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** The projects root: `<home>/project`, joined by the Host's own separator. */
function projectsRoot() {
  return join(homedir(), 'project')
}

/** Refusals shared by every endpoint. @returns a reason, or undefined when fine. */
function outsideHome(target) {
  const home = homedir()
  if (target === '/' || /^[A-Za-z]:[\\/]?$/.test(target)) return 'refusing to work on a drive or filesystem root'
  if (target === home) return 'refusing to work on the home directory'
  if (!within(target, home)) return 'path is outside the Host home directory'
  const dshHome = process.env.DSH_HOME ?? join(home, '.dsh')
  if (within(target, dshHome)) return 'refusing to work inside the DSH home'
  return undefined
}

/** Path crumbs from the filesystem root down to `target`. */
function ancestry(target) {
  const crumbs = []
  let current = resolve(target)
  for (;;) {
    const parent = dirname(current)
    crumbs.unshift({ name: parent === current ? current : basename(current), path: current })
    if (parent === current) return crumbs
    current = parent
  }
}

/** Directories (and links to directories) under `target`, sorted by name. */
async function subdirectories(target) {
  const listed = await readdir(target, { withFileTypes: true })
  const entries = []
  for (const item of listed) {
    let isDirectory = item.isDirectory()
    if (!isDirectory && item.isSymbolicLink()) {
      try {
        isDirectory = (await stat(join(target, item.name))).isDirectory()
      } catch {
        isDirectory = false
      }
    }
    if (isDirectory) entries.push({ name: item.name, path: join(target, item.name) })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return entries
}

/** Reject a name that is not a single path segment. */
function segmentProblem(name) {
  if (typeof name !== 'string') return 'name is required'
  if (name.trim() === '') return 'name is required'
  if (name === '.' || name === '..') return 'name cannot be . or ..'
  if (/[/\\]/.test(name)) return 'name must be a single path segment'
  return undefined
}

/**
 * Host plugin body: mount the three routes.
 * @param ctx - Host root context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (web) => mount(web))
}

/**
 * Register the filesystem routes on an already-resolved web server.
 * @param web - context carrying the `webServer` service.
 */
/** Slot on the web server holding the disposers of these three routes. */
const SLOT = Symbol.for('dsh-quick-project.routes.fs')

export function mount(web) {
  {
    for (const dispose of web.webServer[SLOT] ?? []) {
      try {
        dispose()
      } catch {
        // An effect from an unloaded fiber is already disposed.
      }
    }
    /** Shared envelope: method check, body read, error mapping. */
    const disposers = []
    const route = (path, handle) => disposers.push(web.effect(() => web.webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST', 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'method' }))
          return
        }
        let body
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          sendJson(res, 400, { ok: false, error: 'bad-body' })
          return
        }
        try {
          await handle(body ?? {}, res)
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            error: 'failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    }), `quick-project: ${path}`))

    // List one directory: the folder browser and the "already exists" probe.
    route('/quick-project/list', async (body, res) => {
      const requested = typeof body.path === 'string' && body.path !== '' ? resolve(body.path) : projectsRoot()
      const refusal = outsideHome(requested)
      if (refusal !== undefined) {
        sendJson(res, 409, { ok: false, error: 'refused', message: refusal })
        return
      }
      let info
      try {
        info = await stat(requested)
      } catch {
        sendJson(res, 404, { ok: false, error: 'missing', message: `${requested} does not exist` })
        return
      }
      if (!info.isDirectory()) {
        sendJson(res, 409, { ok: false, error: 'refused', message: 'not a directory' })
        return
      }
      sendJson(res, 200, {
        ok: true,
        path: requested,
        root: projectsRoot(),
        home: homedir(),
        crumbs: ancestry(requested),
        entries: await subdirectories(requested),
      })
    })

    // Create `<projects>/<name>`, parent included: `~/project` may not exist yet.
    route('/quick-project/create', async (body, res) => {
      const problem = segmentProblem(body.name)
      if (problem !== undefined) {
        sendJson(res, 400, { ok: false, error: 'bad-name', message: problem })
        return
      }
      const target = join(projectsRoot(), body.name)
      const refusal = outsideHome(target)
      if (refusal !== undefined) {
        sendJson(res, 409, { ok: false, error: 'refused', message: refusal })
        return
      }
      try {
        await mkdir(target, { recursive: true })
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: 'create-failed',
          message: error instanceof Error ? error.message : String(error),
        })
        return
      }
      sendJson(res, 200, { ok: true, path: target })
    })

    // Remove one directory recursively. The browser half asks first.
    route('/quick-project/remove', async (body, res) => {
      if (typeof body.path !== 'string' || body.path.trim() === '') {
        sendJson(res, 400, { ok: false, error: 'bad-path', message: 'path is required' })
        return
      }
      const target = resolve(body.path)
      const refusal = outsideHome(target)
      if (refusal !== undefined) {
        sendJson(res, 409, { ok: false, error: 'refused', message: refusal })
        return
      }
      if (target === projectsRoot()) {
        sendJson(res, 409, { ok: false, error: 'refused', message: 'refusing to delete the projects root' })
        return
      }
      let info
      try {
        info = await stat(target)
      } catch {
        sendJson(res, 409, { ok: false, error: 'refused', message: 'not there any more' })
        return
      }
      if (!info.isDirectory()) {
        sendJson(res, 409, { ok: false, error: 'refused', message: 'not a directory' })
        return
      }
      // Judge a link by where it lands, not by where it starts.
      const real = await realpath(target)
      if (real !== target && !within(real, homedir())) {
        sendJson(res, 409, { ok: false, error: 'refused', message: 'the link points outside the Host home' })
        return
      }
      await rm(target, { recursive: true, force: true })
      sendJson(res, 200, { ok: true, path: target })
    })

    web.webServer[SLOT] = disposers
    return () => {
      for (const dispose of disposers) dispose()
    }
  }
}
