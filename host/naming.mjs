/**
 * The naming rule, in one place because three callers need it: the naming route
 * (what the model may return), the clone route (what a repository URL becomes),
 * and the browser half (what the person may type).
 *
 * The rule is ASCII: a project name is a folder name, and a folder name is a
 * single lowercase path segment. Chinese is refused rather than transliterated,
 * because a Chinese folder name is exactly what this plugin was asked to stop
 * producing — and silently deleting the Han characters would turn 「账单汇总」
 * into an empty string, which is a worse answer than saying no.
 *
 * Pure, dependency-free, and safe to bundle into the browser half.
 */

/**
 * The one shape a name may take: lowercase ASCII words joined by single
 * hyphens. No leading, trailing or doubled hyphen — `slugify` produces exactly
 * this, so the model's answer and a hand-typed name are judged by one rule.
 */
export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The longest name accepted, in characters. */
export const NAME_MAX_LENGTH = 40

/**
 * Why a name is not usable, as a code the caller localizes.
 * @param name - the candidate.
 * @returns undefined when the name is fine, else one of: empty, dot, separator,
 *   non-ascii, shape.
 */
export function nameProblem(name) {
  if (typeof name !== 'string') return 'empty'
  const value = name.trim()
  if (value === '') return 'empty'
  if (value === '.' || value === '..') return 'dot'
  if (/[/\\]/.test(value)) return 'separator'
  // Anything outside printable ASCII: Chinese, full-width punctuation, accents.
  if (/[^\x20-\x7e]/.test(value)) return 'non-ascii'
  if (value.length > NAME_MAX_LENGTH) return 'shape'
  if (!NAME_PATTERN.test(value)) return 'shape'
  return undefined
}

/** Convenience predicate for callers that only need the boolean. */
export function isValidName(name) {
  return nameProblem(name) === undefined
}

/**
 * Reduce arbitrary text to a name-shaped slug.
 *
 * Non-ASCII is dropped, not transliterated: 「账单汇总」 is the caller's cue to
 * use {@link timestampName} instead, and a partially-stripped slug from mixed
 * text is still better than nothing.
 * @param text - any string.
 * @returns a candidate slug, possibly empty.
 */
export function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/g, '')
}

/**
 * The folder a repository URL should land in.
 *
 * Takes the last path segment, dropping `.git`. Handles the three URL shapes a
 * person pastes: `https://host/owner/repo.git`, `git@host:owner/repo.git`, and
 * a plain local path or `file:///…/repo.git`.
 * @param url - the repository address.
 * @returns a slug, empty when nothing nameable is left.
 */
export function nameFromRepoUrl(url) {
  const trimmed = String(url ?? '').trim().replace(/[\\/]+$/, '')
  if (trimmed === '') return ''
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf(':'))
  const tail = trimmed.slice(cut + 1).replace(/\.git$/i, '')
  return slugify(tail)
}

/**
 * A last-resort name that is always valid, used when neither the model nor the
 * repository URL produced one.
 * @param now - the clock, injectable for tests.
 * @returns e.g. `project-1124-1536`.
 */
export function timestampName(now = new Date()) {
  const two = (value) => String(value).padStart(2, '0')
  return `project-${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`
}

/**
 * Explain a name problem in the copy the dashboard shows.
 * Kept next to the rule so a new code cannot be added without a sentence.
 */
export const NAME_PROBLEM_LABELS = {
  empty: '请填一个项目名',
  dot: '名称不能是 . 或 ..',
  separator: '名称不能包含 “/” 或 “\\”',
  'non-ascii': '名称只能用 a-z、0-9 和连字符，不要用中文',
  shape: '名称只能用小写字母、数字和连字符，且不超过 40 个字符',
}
