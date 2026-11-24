/**
 * Naming route, kept in its own module so a Host can pick it up without a
 * restart.
 *
 * Node caches an ESM module by URL for the life of the process, so editing the
 * plugin's main module can only be picked up by restarting the Host. A profile
 * patch entry that points at a path the process has never imported is loaded
 * fresh on recompose — which is why this file exists next to `index.mjs`
 * instead of inside it.
 */

import { randomUUID } from 'node:crypto'
import { NAME_PATTERN, slugify } from './naming.mjs'
import { readBody, sendJson } from './http.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'quick-project-name'

/** The model route and the HTTP surface are the only Host services read. */
export const inject = ['webServer', 'llm', 'agentDefaultModel']

/** One-shot instruction for the naming call. */
const SYSTEM = [
  'You name software projects.',
  'The user writes in any language; the name you return is always ASCII.',
  'Rules: 2 to 4 English words, lowercase, letters digits and hyphens only,',
  'kebab-case, at most 40 characters, no trailing hyphen.',
  'Translate the idea, do not transliterate it: 快递单批量打印 → waybill-batch-printer.',
  'Answer with the name alone: no quotes, no punctuation around it, no explanation.',
  'Never answer in Chinese or any other non-Latin script.',
].join('\n')

/** Hard stop on the model call. */
const CALL_TIMEOUT_MS = 20_000

/**
 * Keep only the name-shaped token of a model answer.
 *
 * Taking "the first word that could be a name" is wrong: a model that answers
 * "Here you go: `invoice-reconciler`" would yield `here`. So quoted segments are
 * considered first, and everything is ranked by hyphen count then length, which
 * is what separates a kebab-case name from the prose around it.
 * @param raw - the model's text.
 * @returns the best candidate slug, or an empty string when none is name-shaped.
 */
function pickSlug(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return ''
  const quoted = [...text.matchAll(/[`'"“”]([^`'"“”]{1,80})[`'"“”]/g)].map((match) => match[1])
  const bare = text.match(/[A-Za-z0-9][A-Za-z0-9-]{0,39}/g) ?? []
  const scored = []
  for (const token of [...quoted, ...bare]) {
    const slug = slugify(token)
    if (slug === '' || !NAME_PATTERN.test(slug)) continue
    const hyphens = (slug.match(/-/g) ?? []).length
    scored.push({ slug, score: hyphens * 100 + slug.length })
  }
  if (scored.length === 0) return ''
  scored.sort((a, b) => b.score - a.score)
  return scored[0].slug
}

/**
 * Ask the default model for one project name.
 * @param ctx - context exposing the LLM runtime and the default selection.
 * @param description - the user's requirement text.
 * @returns a slug that matches {@link NAME_PATTERN}.
 * @throws {Error} when the route is missing, the call fails, or the answer holds no name.
 */
async function suggestName(ctx, description) {
  const selection = ctx.agentDefaultModel.currentSelection()
  if (typeof selection?.provider !== 'string' || typeof selection?.model !== 'string') {
    throw new Error('no default model route is configured')
  }
  const signal = AbortSignal.timeout(CALL_TIMEOUT_MS)
  // A reasoning model spends part of the budget before it writes any text, so a
  // 32-token cap can end the call with reasoning and no name at all.
  const call = await ctx.llm.prepareCall({
    provider: selection.provider,
    model: selection.model,
    maxTokens: 300,
  }, signal, (controls) => selection.reasoningEffort === undefined
    ? controls
    : { ...controls, reasoningEffort: selection.reasoningEffort })
  const messages = [{
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: description.slice(0, 2_000) }],
    source: { kind: 'quick-project' },
  }]
  const parts = []
  const reasoning = []
  let finish
  for await (const chunk of call.stream({
    ...call.config,
    messages,
    system: SYSTEM,
    purpose: 'quick-project/name',
    signal,
  })) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') parts.push(chunk.text)
    else if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string') reasoning.push(chunk.text)
    else if (chunk?.type === 'finish') finish = chunk.finish
  }
  if (finish?.kind === 'error' || finish?.kind === 'aborted') {
    throw new Error(`the naming call ended as ${finish.kind}: ${finish.failure?.message ?? 'no message'}`)
  }
  const answer = parts.join('')
  const slug = pickSlug(answer)
  if (slug !== '') return slug
  // A model that answered in Chinese used to get its Han characters back as the
  // folder name, which is the exact outcome the naming rule now forbids. There
  // is nothing to salvage from such an answer — `slugify` of 「账单汇总」 is
  // empty — so this reports the failure and the browser uses its own ASCII
  // fallback.
  throw new Error([
    'the model answer held no usable ascii name',
    `text=${JSON.stringify(answer.slice(0, 120))}`,
    `reasoning=${JSON.stringify(reasoning.join('').slice(0, 200))}`,
  ].join(' '))
}

/**
 * Host plugin body: mount `POST /quick-project/name`.
 * @param ctx - Host root context.
 */
export function apply(ctx) {
  ctx.inject(['webServer', 'llm', 'agentDefaultModel'], (web) => mount(web))
}

/**
 * Register the naming route on an already-resolved web server.
 * @param web - context carrying the `webServer` service.
 */
/** Slot on the web server holding this route's disposer. */
const SLOT = Symbol.for('dsh-quick-project.route.name')

export function mount(web) {
  {
    // Replace, never duplicate: a running Host picks up new route code by
    // mounting a module under a new URL, and two registrations of one path make
    // `webServer` throw.
    const previous = web.webServer[SLOT]
    if (typeof previous === 'function') previous()
    const dispose = web.effect(() => web.webServer.register({
      kind: 'exact',
      path: '/quick-project/name',
      // A `resource` route answers GET/HEAD only; naming needs a body, so this
      // is a handler and owns its own request/response lifecycle.
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST', 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'method' }))
          return
        }
        let description = ''
        try {
          const raw = await readBody(req)
          const body = JSON.parse(raw)
          description = typeof body?.description === 'string' ? body.description.trim() : ''
        } catch {
          sendJson(res, 400, { ok: false, error: 'bad-body' })
          return
        }
        if (description === '') {
          sendJson(res, 400, { ok: false, error: 'empty' })
          return
        }
        try {
          sendJson(res, 200, { ok: true, name: await suggestName(web, description) })
        } catch (error) {
          // Not an HTTP failure: the browser half falls back to its own name and
          // still creates the project, so a dead model must not look like a dead
          // plugin.
          sendJson(res, 200, {
            ok: false,
            error: 'llm-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    }), 'quick-project: naming route')
    web.webServer[SLOT] = dispose
    return dispose
  }
}
