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
 */

import { mount as mountNameRoute } from './name-route.mjs'
import { mount as mountProjectFs } from './project-fs.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'quick-project-routes'

/** The union of what the two route modules read. */
export const inject = ['webServer', 'llm', 'agentDefaultModel']

/** Key on the web server recording which routes are mounted. */
const MOUNTED = Symbol.for('dsh-quick-project.routes-mounted')

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
    // Each module replaces its own routes on mount, so calling both is safe no
    // matter how many times this runs.
    mountNameRoute(web)
    mountProjectFs(web)
    web.webServer[MOUNTED] = true
  })
}
