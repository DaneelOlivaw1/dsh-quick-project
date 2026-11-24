// The naming rule is the part everything else trusts, so it gets its own tests:
// the browser half, the create route and the clone route all read it, and a
// hole here is a Chinese folder name in someone's home directory.
//
//   node --test test/naming.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NAME_PATTERN,
  isValidName,
  nameFromRepoUrl,
  nameProblem,
  slugify,
  timestampName,
} from '../host/naming.mjs'

test('accepts kebab-case ascii names', () => {
  for (const name of ['a', 'invoice-reconciler', 'waybill-batch-printer', 'project-1124-1536', 'x1']) {
    assert.equal(isValidName(name), true, `${name} should be valid`)
  }
})

test('rejects Chinese, which is the whole point of the rule', () => {
  for (const name of ['账单汇总', '新建文件夹2', '账单-summary', 'ｈｅｌｌｏ']) {
    assert.equal(nameProblem(name), 'non-ascii', `${name} should be refused as non-ascii`)
    assert.equal(isValidName(name), false)
  }
})

test('rejects empty, dot entries and separators', () => {
  assert.equal(nameProblem(''), 'empty')
  assert.equal(nameProblem('   '), 'empty')
  assert.equal(nameProblem('.'), 'dot')
  assert.equal(nameProblem('..'), 'dot')
  assert.equal(nameProblem('a/b'), 'separator')
  assert.equal(nameProblem('a\\b'), 'separator')
})

test('rejects shapes that are not kebab-case', () => {
  assert.equal(nameProblem('UPPER'), 'shape')
  assert.equal(nameProblem('-leading'), 'shape')
  assert.equal(nameProblem('trailing-'), 'shape')
  assert.equal(nameProblem('double--hyphen'), 'shape')
  assert.equal(nameProblem('has space'), 'shape')
  assert.equal(nameProblem('a'.repeat(41)), 'shape')
  assert.equal(nameProblem(`a${'b'.repeat(39)}`), undefined, 'exactly 40 is allowed')
})

test('slugify drops non-ascii instead of inventing a transliteration', () => {
  // The important case: a pure-Chinese input has no ascii left, so the caller
  // must fall back rather than ship an empty name.
  assert.equal(slugify('账单汇总'), '')
  assert.equal(slugify('Invoice  Reconciler'), 'invoice-reconciler')
  assert.equal(slugify('  --a--b--  '), 'a-b')
})

test('reads a folder name out of the three repository URL shapes', () => {
  assert.equal(nameFromRepoUrl('https://github.com/owner/dsh-quick-project.git'), 'dsh-quick-project')
  assert.equal(nameFromRepoUrl('https://github.com/owner/dsh-quick-project'), 'dsh-quick-project')
  assert.equal(nameFromRepoUrl('git@github.com:owner/lark-cli.git'), 'lark-cli')
  assert.equal(nameFromRepoUrl('ssh://git@host:2222/team/Repo_Name.git'), 'repo-name')
  assert.equal(nameFromRepoUrl('/Users/me/project/thing.git'), 'thing')
  assert.equal(nameFromRepoUrl('https://github.com/owner/repo/'), 'repo', 'a trailing slash is ignored')
  assert.equal(nameFromRepoUrl(''), '')
  assert.equal(nameFromRepoUrl('https://github.com/所有者/项目'), '', 'a Chinese repo name yields nothing to use')
})

test('the timestamp fallback always satisfies the rule', () => {
  const now = new Date(2026, 10, 24, 15, 36)
  const name = timestampName(now)
  assert.equal(name, 'project-1124-1536')
  assert.equal(isValidName(name), true)
  assert.equal(NAME_PATTERN.test(name), true)
})
