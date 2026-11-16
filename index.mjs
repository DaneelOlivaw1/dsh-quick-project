/**
 * Host half of dsh-quick-project: deliberately empty.
 *
 * Everything this plugin does happens in the browser half — the Host already
 * owns the two calls it needs (`directoryPicker.createDirectory` to make the
 * folder, `workspaces.create` to adopt it), and the flow's owner opens the
 * resulting Workspace. A Host module still has to exist because the bundle
 * patch mounts this package, so this file only names the plugin.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'quick-project'

/** No Host services are read. */
export const inject = []

/** Nothing to wire on the Host. */
export function apply() {}
