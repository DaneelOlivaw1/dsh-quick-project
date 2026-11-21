/**
 * Main Host half of dsh-quick-project.
 *
 * Its one job is to mount the routes in `host/routes.mjs`. That indirection is
 * not decoration: Node caches an ESM module by URL for the life of the process,
 * so a route written *here* could only appear after a Host restart — while a
 * module the process has never imported can be mounted by a profile patch entry
 * and take effect immediately. Both callers end up in `host/routes.mjs`, which
 * makes the mount idempotent.
 */

import { apply as mountRoutes } from './host/routes.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'quick-project'

/** The routes need the web server, the model runtime, and the default route. */
export const inject = ['webServer', 'llm', 'agentDefaultModel']

/**
 * @param ctx - Host root context.
 */
export function apply(ctx) {
  mountRoutes(ctx)
}
