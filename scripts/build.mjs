// Build the browser half.
//
// The Harness loads a client contribution through `__ModuleLoader__.load`, so
// the artifact has to be one factory body; the banner and footer below are that
// wrapper, and everything between them is bundled code. React stays external:
// the loader's `require` table owns it, and a second copy in the bundle would
// break hooks.

import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

const ID = 'dsh-quick-project'

await build({
  entryPoints: ['client/src/client.js'],
  outfile: 'client/client.js',
  bundle: true,
  minify: process.env.DSH_QUICK_PROJECT_DEBUG !== '1',
  platform: 'browser',
  format: 'cjs',
  target: ['chrome120'],
  // The source is plain `.js` but written in JSX; the automatic runtime turns
  // each element into `react/jsx-runtime` calls the loader can resolve.
  loader: { '.js': 'jsx' },
  jsx: 'automatic',
  jsxImportSource: 'react',
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  legalComments: 'none',
  logLevel: 'warning',
  banner: {
    js: `window.__ModuleLoader__.load({id:"${ID}",factory:(require)=>{var module={exports:{}};var exports=module.exports;`,
  },
  footer: {
    js: 'return module.exports;}});',
  },
})

const bundle = await readFile('client/client.js', 'utf8')
if (!bundle.startsWith(`window.__ModuleLoader__.load({id:"${ID}",`)) {
  throw new Error('client/client.js does not open with the ModuleLoader id — the banner was lost.')
}
console.log(`client/client.js rebuilt: ${(bundle.length / 1024).toFixed(0)} KiB`)
