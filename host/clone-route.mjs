/**
 * Clone a repository into the projects root and report how far it has got.
 *
 * Why this lives on the Host rather than in the dialog: the browser has no
 * filesystem and no child process, and the Host is the side that knows the real
 * path separator. It is also the side that can stream git's own progress out of
 * stderr, which is the whole point — a clone that prints nothing for forty
 * seconds reads as a hang.
 *
 * Two endpoints, both POST like the rest of this plugin:
 *   /quick-project/clone        { url, name? } → { id, path, name }
 *   /quick-project/clone-status { id }         → { phase, percent, line, ... }
 *
 * The clone runs detached from the request: the dialog polls, so a slow
 * repository cannot hold an HTTP response open, and closing the dialog does not
 * kill a clone that is already most of the way through.
 *
 * Argument injection is the thing to get right here. `git clone` takes the URL
 * as a positional argument, so a "URL" of `--upload-pack=…` would be read as an
 * option; anything starting with `-` is refused, and the target is built by the
 * Host with `join` rather than pasted into a command line — `spawn` takes an
 * argv array and there is no shell involved.
 */

import { spawn } from 'node:child_process'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { nameFromRepoUrl, nameProblem } from './naming.mjs'
import { readJson, sendJson } from './http.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'quick-project-clone'

/** The HTTP surface is the only Host service read. */
export const inject = ['webServer']

/** Slot on the web server holding the disposers of these routes. */
const SLOT = Symbol.for('dsh-quick-project.routes.clone')

/** Finished jobs are dropped after this long, so the map cannot grow forever. */
const JOB_TTL_MS = 10 * 60 * 1000

/** The projects root: `<home>/project`, joined by the Host's own separator. */
function projectsRoot() {
  return join(homedir(), 'project')
}

/** True when `child` is `parent` or sits below it, on either separator. */
function within(child, parent) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Reject a repository address git must not read as an option.
 * @param url - whatever was pasted.
 * @returns a reason, or undefined when it looks like an address.
 */
function urlProblem(url) {
  if (typeof url !== 'string') return 'repository url is required'
  const value = url.trim()
  if (value === '') return 'repository url is required'
  // The one real hazard: `git clone --upload-pack=…` style option injection.
  if (value.startsWith('-')) return 'repository url cannot start with "-"'
  if (/\s/.test(value)) return 'repository url cannot contain spaces'
  // https://, http://, ssh://, git://, file:///abs — or scp-like git@host:path
  // — or a local path the person cloned from disk.
  const shaped = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^[^@/\s]+@[^:\s]+:.+$/.test(value) || isAbsolute(value) || value.startsWith('./') || value.startsWith('../')
  if (!shaped) return 'that does not look like a repository url'
  return undefined
}

/** Live jobs by id. Only what the status endpoint reads is kept here. */
const jobs = new Map()

/** Drop jobs nobody has asked about for a while. */
function pruneJobs(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (job.phase !== 'running' && now - job.touchedAt > JOB_TTL_MS) jobs.delete(id)
  }
}

/**
 * Turn one line of git's stderr into a progress reading.
 *
 * git writes `Receiving objects:  47% (1234/2600)` to stderr, carriage-return
 * separated when it is a terminal and newline separated when it is a pipe. The
 * percentage is taken as a maximum so a later phase reporting a lower number
 * (resolving deltas starts near 0%) does not make the bar jump backwards.
 * @param line - one stderr line.
 * @returns what to patch onto the job.
 */
export function readProgress(line) {
  const text = line.trim()
  if (text === '') return {}
  // `remote:` lines are the *other* side of the transfer doing its own work —
  // `remote: Compressing objects: 100%` means the server finished compressing,
  // not that this clone is 100% done. Counting it would pin the bar at 100% for
  // the whole download, which is exactly the "stuck bar" this plugin exists to
  // avoid. They stay as raw reassurance text only.
  if (/^remote:/i.test(text)) return { line: text, touchedAt: Date.now() }
  const patch = { line: text, touchedAt: Date.now() }
  // Name the phase the way git does, so the dialog can say what is happening in
  // the person's words rather than showing raw git output alone. The phase is
  // read from the label, not from the percentage: `done.` lines and final
  // summaries carry no percentage at all but do say which phase just ended.
  if (/Receiving objects/i.test(text)) patch.phase = 'receiving'
  else if (/Resolving deltas/i.test(text)) patch.phase = 'resolving'
  else if (/Enumerating objects/i.test(text)) patch.phase = 'enumerating'
  else if (/Counting objects/i.test(text)) patch.phase = 'counting'
  else if (/Compressing objects/i.test(text)) patch.phase = 'compressing'
  else if (/Cloning into/i.test(text)) patch.phase = 'starting'
  const percent = text.match(/(\d{1,3})%/)
  if (percent !== null) patch.percent = Math.min(100, Number(percent[1]))
  return patch
}

/**
 * Build the stderr consumer that keeps one job's progress up to date.
 *
 * Extracted from {@link startClone} so the `\r` handling can be tested without
 * spawning git: a network clone emits `Receiving objects:  7%`…`100%` separated
 * by carriage returns, and emitting no progress at all is the failure mode that
 * matters — a bar that sits at 0% while a large repository downloads.
 * @param job - the job record to patch.
 * @returns a function taking decoded text chunks.
 */
export function progressConsumer(job) {
  let carry = ''
  return (chunk) => {
    carry += chunk
    // git separates progress updates with \r on a TTY; a pipe may still carry
    // them, and the final line of a phase arrives without a trailing separator.
    const parts = carry.split(/[\r\n]+/)
    // Keep the trailing fragment only when the chunk did not end on a break.
    carry = /[\r\n]$/.test(carry) ? '' : (parts.pop() ?? '')
    for (const part of parts) {
      const patch = readProgress(part)
      // A phase change restarts git's own counter (`Receiving objects` begins at
      // 0% after `Compressing` reached 100), so a naive max() over the whole
      // stream would leave the bar at 100% while the download runs. The clamp is
      // therefore per phase: inside one phase the number only grows, but a new
      // phase starts counting from its own reading.
      if (typeof patch.percent === 'number') {
        patch.percent = patch.phase !== undefined && patch.phase !== job.phase
          ? patch.percent
          : Math.max(job.percent ?? 0, patch.percent)
      }
      Object.assign(job, patch)
    }
  }
}

/**
 * Start one clone.
 * @param url - validated repository address.
 * @param target - absolute destination, already validated.
 * @returns the job record, already running.
 */
function startClone(url, target) {
  const id = randomUUID()
  const job = {
    id,
    url,
    path: target,
    phase: 'starting',
    percent: 0,
    line: '',
    startedAt: Date.now(),
    touchedAt: Date.now(),
    finishedAt: undefined,
    error: undefined,
  }
  jobs.set(id, job)

  // `--progress` is what makes git report on a pipe at all; without a terminal
  // it stays silent until the end. `--` ends options, so the URL can never be
  // read as a flag even if the guard above were loosened one day.
  const child = spawn('git', ['clone', '--progress', '--', url, target], {
    // A clone never wants stdin: credentials come from the environment, and a
    // prompt would hang a detached process forever.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })

  const consume = progressConsumer(job)

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', consume)
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', consume)

  child.on('error', (error) => {
    job.phase = 'failed'
    job.error = error.code === 'ENOENT'
      ? 'git is not installed, or not on the Host PATH'
      : `could not run git: ${error.message}`
    job.finishedAt = Date.now()
    job.touchedAt = job.finishedAt
  })

  child.on('close', (code) => {
    // A failed clone leaves a half-written directory that would be adopted as a
    // Workspace on the next attempt, so it is removed here rather than left for
    // the person to find.
    if (code === 0) {
      job.phase = 'done'
      job.percent = 100
      job.line = ''
    } else if (job.phase !== 'failed') {
      job.phase = 'failed'
      job.error = `git exited with code ${code}`
    }
    job.finishedAt = Date.now()
    job.touchedAt = job.finishedAt
    if (code !== 0) {
      rm(target, { recursive: true, force: true }).catch(() => {})
    }
  })

  return job
}

/** What the dialog is allowed to see of a job. */
function publicJob(job) {
  return {
    ok: true,
    id: job.id,
    phase: job.phase,
    percent: job.percent,
    line: job.line,
    path: job.path,
    error: job.error,
    elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
  }
}

/**
 * Host plugin body: mount the clone routes.
 * @param ctx - Host root context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (web) => mount(web))
}

/**
 * Register the clone routes on an already-resolved web server.
 * @param web - context carrying the `webServer` service.
 */
export function mount(web) {
  for (const dispose of web.webServer[SLOT] ?? []) {
    try {
      dispose()
    } catch {
      // An effect from an unloaded fiber is already disposed.
    }
  }
  const disposers = []
  /** Shared envelope: method check, body read, error mapping. */
  const route = (path, handle) => disposers.push(web.effect(() => web.webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST', 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'method' }))
        return
      }
      const body = await readJson(req, 8_192)
      if (body === undefined) {
        sendJson(res, 400, { ok: false, error: 'bad-body' })
        return
      }
      try {
        await handle(body, res)
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }), `quick-project: ${path}`))

  // Start a clone. Answers as soon as git is running, not when it is finished.
  route('/quick-project/clone', async (body, res) => {
    const problem = urlProblem(body.url)
    if (problem !== undefined) {
      sendJson(res, 400, { ok: false, error: 'bad-url', message: problem })
      return
    }
    const url = body.url.trim()
    // The name comes from the repository when the dialog did not pin one, so a
    // clone needs no naming round trip.
    const wanted = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : nameFromRepoUrl(url)
    const nameIssue = nameProblem(wanted)
    if (nameIssue !== undefined) {
      sendJson(res, 400, {
        ok: false,
        error: 'bad-name',
        reason: nameIssue,
        message: nameIssue === 'empty'
          ? 'could not read a name out of that url; type one'
          : 'the name must be ascii letters, digits and hyphens',
      })
      return
    }
    const target = join(projectsRoot(), wanted)
    if (!within(target, homedir()) || within(target, process.env.DSH_HOME ?? join(homedir(), '.dsh'))) {
      sendJson(res, 409, { ok: false, error: 'refused', message: 'that path is not clonable' })
      return
    }
    // Cloning into a directory that already holds something is not adopted the
    // way an empty `mkdir` is: git refuses, and so does this — with a sentence
    // that says how to proceed instead of git's wording.
    let taken = false
    try {
      taken = (await stat(target)).isDirectory() && (await readdir(target)).length > 0
    } catch {
      taken = false
    }
    if (taken) {
      sendJson(res, 409, {
        ok: false,
        error: 'exists',
        message: `${wanted} already exists and is not empty`,
        path: target,
      })
      return
    }
    await mkdir(projectsRoot(), { recursive: true })
    pruneJobs()
    const job = startClone(url, resolve(target))
    sendJson(res, 200, { ok: true, id: job.id, name: wanted, path: job.path })
  })

  // Report on one clone. Polled by the dialog while it is open.
  route('/quick-project/clone-status', async (body, res) => {
    if (typeof body.id !== 'string' || body.id === '') {
      sendJson(res, 400, { ok: false, error: 'bad-id', message: 'id is required' })
      return
    }
    const job = jobs.get(body.id)
    if (job === undefined) {
      sendJson(res, 404, { ok: false, error: 'gone', message: 'that clone is no longer tracked' })
      return
    }
    job.touchedAt = Date.now()
    sendJson(res, 200, publicJob(job))
  })

  web.webServer[SLOT] = disposers
  return () => {
    for (const dispose of disposers) dispose()
  }
}
