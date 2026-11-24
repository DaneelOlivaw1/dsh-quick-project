/**
 * One mount point for every Host route this plugin owns.
 *
 * Two callers can reach here — the plugin's main module (always, after a
 * restart) and a profile `cordis.patch.yml` entry (which is what makes a route
 * appear in a *running* process, where Node's ESM cache still holds the old
 * main module). Both must not register the same path twice: `webServer` throws
 * on a duplicate route. The marker therefore lives on the server object itself,
 * not on the module, because the two callers import this file under different
 * URLs and so get different module instances.
 *
 * The sub-modules are imported *dynamically*, carrying this module's own `?v=`
 * along. That is not a style choice. Node caches an ES module by resolved URL,
 * and a query string on `routes.mjs?v=10` does **not** propagate into a static
 * `import './clone-route.mjs'` — that specifier still resolves to the bare
 * path and hits whatever the *first* load cached. A version bump would then
 * swap the entry point while every route kept executing old code, which is a
 * silent "my change did nothing" failure indistinguishable from a broken hot
 * reload. Threading the tag through makes one bump mean one real reload.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'quick-project-routes'

/** The union of what the two route modules read. */
export const inject = ['webServer', 'llm', 'agentDefaultModel']

/** Key on the web server recording which routes are mounted. */
const MOUNTED = Symbol.for('dsh-quick-project.routes-mounted')

/**
 * Import one sibling module under this module's own version tag.
 * @param file - file name next to this module, e.g. `./clone-route.mjs`.
 * @returns the imported module namespace.
 */
export function importSibling(file) {
  const here = new URL(import.meta.url)
  const tagged = new URL(file, here)
  tagged.search = here.search
  return import(tagged.href)
}

/**
 * Mount every route, replacing whatever was mounted before.
 *
 * Replace instead of "skip if present": the main module mounts on every Host
 * start, and a profile patch entry mounts when someone wants a *running* Host to
 * pick up new route code. `webServer.register` throws on a duplicate path, so
 * skipping would make a `?v=N` bump a no-op and replacing keeps both callers
 * usable. Disposing first is what makes the bump a hot reload.
 * @param ctx - Host root context.
 */
export function apply(ctx) {
  ctx.inject(['webServer', 'llm', 'agentDefaultModel'], (web) => {
    // The imports are async, but registration must not be: an awaited callback
    // returns before any route exists, and a request that arrives during that
    // window finds nothing. The promise is kept so a failed load is reported by
    // the loader rather than swallowed.
    loadSiblings().then((modules) => {
      try {
        // Each module replaces its own routes on mount, so calling all three is
        // safe no matter how many times this runs.
        for (const module of modules) module.mount(web)
        web.webServer[MOUNTED] = true
      } catch (error) {
        console.error('[quick-project] could not mount its routes:', error)
      }
    }).catch((error) => {
      console.error('[quick-project] could not load its route modules:', error)
    })
  })
}

/** Load the three route modules, each under this module's version tag. */
function loadSiblings() {
  return Promise.all([
    importSibling('./name-route.mjs'),
    importSibling('./project-fs.mjs'),
    importSibling('./clone-route.mjs'),
  ])
}
