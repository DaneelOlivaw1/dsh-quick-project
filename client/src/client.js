// Browser half of dsh-quick-project.
//
// The complaint this answers: starting a project meant walking a folder tree
// from the sidebar's 「+」 to `~/project`, creating a folder, coming back,
// finding it again, and then retyping the same requirement you already had in
// your head. Five steps for something whose real input is one paragraph.
//
// So this fills the sidebar's directory-flow hole with a description field.
// Type what the project is for, press Enter: the Host names it (one small model
// call, so the folder is `invoice-reconciler` and not `新建文件夹 2`), the folder
// is created under `~/project`, the Workspace opens, and the description is
// dropped into the new Session's composer and sent.
//
// Three details that are easy to get wrong:
//   - The hole is declared `single` and sorted by ascending priority, so the
//     stock browse dialog sits at priority 0. Registering at -1 is what makes
//     this one render instead of being shadowed; the stock dialog stays
//     reachable through 「选择已有文件夹…」 → the Host's native picker.
//   - A name that already exists is not an error here. `workspaces.create`
//     resolves an existing directory to the Workspace already pointing at it,
//     which is what someone retyping a name wants.
//   - Sending is separate from opening. The Workspace UI opens a blank Session,
//     and the requirement lands in its composer through `startSession(prompt)`,
//     which fills a draft but never submits it. `AutoSendGuard` closes that last
//     step: it is mounted inside the composer, watches for its own Session's
//     draft to become the text we just asked for, and submits once.

import { useCallback, useEffect, useRef, useState } from 'react'
// The naming rule comes from the Host half so the two halves cannot drift: the
// same file decides what the model may answer, what a repository URL becomes,
// and what this dialog's field accepts. The bundler inlines it.
import { isValidName, nameFromRepoUrl, nameProblem, timestampName } from '../../host/naming.mjs'

/** Locale namespace owning this dialog's copy. */
const NS = 'quick-project'

const LABELS = {
  zh: {
    title: '新建项目',
    'subtitle.empty': '说说这个项目要做什么，名字、文件夹、新会话都由它来',
    'subtitle.unknown': '说说这个项目要做什么；会在 ~/project 下新建并打开',
    description: '项目需求，例如：把支付宝账单按月汇总成一张表',
    nameLabel: '项目名',
    namePlaceholder: '留空则按需求自动取',
    create: '创建并开始',
    creating: '正在创建…',
    naming: '正在取名…',
    named: '已按需求取名，可改',
    'named.fallback': '模型没取名，用了备用名，可改',
    'name.will': '点「创建并开始」时按需求取名',
    opening: '正在打开…',
    sending: '正在发送需求…',
    cancel: '取消',
    browse: '选择已有文件夹…',
    'browse.title': '选择已有文件夹',
    'browse.here': '用这个文件夹',
    'browse.back': '返回新建',
    'browse.empty': '这里没有子文件夹',
    'browse.loading': '读取中…',
    'browse.failed': '打不开这个目录：{message}',
    'menu.remove': '删除项目（含文件夹）',
    'remove.confirm': '删除「{name}」，连文件夹一起删掉？\n\n{path}\n\n文件夹会被永久删除，无法撤销。',
    'remove.failed.short': '文件夹没能删掉',
    exists: '同名文件夹已存在，将直接打开',
    'error.name': '还需要一个项目名（或写点需求自动取）',
    'error.invalid': '名称不能为空，也不能包含 “/” 或 “\\”',
    'error.ascii': '名称只能用 a-z、0-9 和连字符，不要用中文',
    'error.home': '还没拿到宿主主目录，稍等一秒再试',
    'error.failed': '创建失败：{message}',
    foot: '回车创建 · Shift+回车换行 · Esc 取消',
    'clone.link': '克隆 Git 仓库…',
    'clone.back': '返回新建项目',
    'clone.title': '克隆 Git 仓库',
    'clone.subtitle': '粘贴仓库地址，克隆到 ~/project 并直接开始；需求写在下面，克隆完自动发出去',
    'clone.urlLabel': '仓库地址',
    'clone.urlPlaceholder': 'https://github.com/owner/repo.git 或 git@github.com:owner/repo.git',
    'clone.namePlaceholder': '留空则用仓库名',
    'clone.start': '克隆并开始',
    'clone.starting': '正在启动克隆…',
    'clone.progress': '克隆中 · {percent}%',
    'clone.phase.starting': '准备克隆…',
    'clone.phase.counting': '统计对象…',
    'clone.phase.compressing': '压缩对象…',
    'clone.phase.enumerating': '枚举对象…',
    'clone.phase.receiving': '接收对象…',
    'clone.phase.resolving': '解析差异…',
    'clone.phase.done': '克隆完成',
    'clone.phase.failed': '克隆失败',
    'clone.error': '克隆失败：{message}',
    'clone.exists': '「{name}」已经有内容了，换个项目名或先删掉它',
    'clone.requirement': '克隆完之后要我做什么？留空就只是打开它',
    'clone.noUrl': '先粘贴一个仓库地址',
    'clone.foot': '回车开始克隆 · Shift+回车换行 · Esc 取消',
  },
  en: {
    title: 'New project',
    'subtitle.empty': 'Describe what it is for; the name, folder and Session come from it',
    'subtitle.unknown': 'Describe what it is for; it is created under ~/project',
    description: 'What is this project for?',
    nameLabel: 'Name',
    namePlaceholder: 'Left blank, named from the description',
    create: 'Create and start',
    creating: 'Creating…',
    naming: 'Naming…',
    named: 'Named from the description — editable',
    'named.fallback': 'The model did not name it; using a fallback — editable',
    'name.will': 'Named from the description when you start it',
    opening: 'Opening…',
    sending: 'Sending the requirement…',
    cancel: 'Cancel',
    browse: 'Choose an existing folder…',
    'browse.title': 'Choose an existing folder',
    'browse.here': 'Use this folder',
    'browse.back': 'Back',
    'browse.empty': 'No subfolders here',
    'browse.loading': 'Loading…',
    'browse.failed': 'Could not open this folder: {message}',
    'menu.remove': 'Delete project and folder',
    'remove.confirm': 'Delete “{name}” and its folder?\n\n{path}\n\nThe folder is removed for good; this cannot be undone.',
    'remove.failed.short': 'The folder could not be removed',
    exists: 'That folder already exists; it will be opened',
    'error.name': 'A name is needed — or describe the project and it is named for you',
    'error.invalid': 'A name is required and may not contain “/” or “\\”',
    'error.ascii': 'Use lowercase a-z, 0-9 and hyphens — no Chinese characters',
    'error.home': 'The Host home directory is not available yet — try again in a second',
    'error.failed': 'Could not create it: {message}',
    foot: 'Enter to create · Shift+Enter for a new line · Esc to cancel',
    'clone.link': 'Clone a Git repository…',
    'clone.back': 'Back to new project',
    'clone.title': 'Clone a Git repository',
    'clone.subtitle': 'Paste the repository URL; it is cloned into ~/project and opened. Put what you want done below and it is sent once the clone finishes.',
    'clone.urlLabel': 'Repository',
    'clone.urlPlaceholder': 'https://github.com/owner/repo.git or git@github.com:owner/repo.git',
    'clone.namePlaceholder': 'Left blank, named after the repository',
    'clone.start': 'Clone and start',
    'clone.starting': 'Starting the clone…',
    'clone.progress': 'Cloning · {percent}%',
    'clone.phase.starting': 'Preparing…',
    'clone.phase.counting': 'Counting objects…',
    'clone.phase.compressing': 'Compressing objects…',
    'clone.phase.enumerating': 'Enumerating objects…',
    'clone.phase.receiving': 'Receiving objects…',
    'clone.phase.resolving': 'Resolving deltas…',
    'clone.phase.done': 'Cloned',
    'clone.phase.failed': 'Clone failed',
    'clone.error': 'The clone failed: {message}',
    'clone.exists': '“{name}” already has content — pick another name or delete it first',
    'clone.requirement': 'What should be done once it is cloned? Left blank, it is only opened',
    'clone.noUrl': 'Paste a repository URL first',
    'clone.foot': 'Enter to clone · Shift+Enter for a new line · Esc to cancel',
  },
}

/** Services this client plugin reads; Cordis throws on un-injected access. */
export const inject = ['slots', 'locale', 'uiWorkspace', 'workspaces', 'remote', 'contextMenus']

const OVERLAY = {
  position: 'fixed',
  inset: '0',
  zIndex: 9000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.28)',
}

const CARD = {
  boxSizing: 'border-box',
  width: 'min(460px, calc(100vw - 32px))',
  padding: '18px 20px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  color: 'var(--dsw-alias-label-primary, inherit)',
  background: 'var(--dsw-alias-bg-layer-2, #fff)',
  border: '0.5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12))',
  borderRadius: '12px',
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.22)',
}

const TITLE = { fontSize: '15px', fontWeight: 510, lineHeight: '22px' }

const SUBTITLE = {
  fontSize: '12px',
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary, rgba(0,0,0,.55))',
  wordBreak: 'break-all',
}

const FIELD = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '8px 12px',
  fontSize: '14px',
  lineHeight: '22px',
  color: 'inherit',
  background: 'transparent',
  border: '0.5px solid var(--dsw-alias-border-l4, rgba(0,0,0,.2))',
  borderRadius: '8px',
  outline: 'none',
  resize: 'vertical',
}

const NAME_ROW = { display: 'flex', alignItems: 'center', gap: '8px' }

const NAME_LABEL = {
  flex: '0 0 auto',
  fontSize: '12px',
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary, rgba(0,0,0,.55))',
}

const NAME_INPUT = {
  ...FIELD,
  flex: '1 1 0',
  height: '30px',
  padding: '4px 10px',
  fontSize: '13px',
  lineHeight: '20px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  resize: 'none',
}

const PREVIEW = {
  fontSize: '12px',
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,.7))',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  wordBreak: 'break-all',
}

const ACTIONS = { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }

const BUTTON = {
  height: '30px',
  padding: '0 12px',
  fontSize: '13px',
  lineHeight: '1',
  borderRadius: '8px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const PRIMARY = {
  ...BUTTON,
  color: 'var(--dsw-alias-label-on-button, #fff)',
  background: 'var(--dsw-alias-state-business-primary, #1f6feb)',
  border: '1px solid transparent',
}

const SECONDARY = {
  ...BUTTON,
  color: 'inherit',
  background: 'transparent',
  border: '0.5px solid var(--dsw-alias-border-l4, rgba(0,0,0,.2))',
}

const LINK = {
  ...BUTTON,
  padding: '0 2px',
  color: 'var(--dsw-alias-label-tertiary, rgba(0,0,0,.55))',
  background: 'transparent',
  border: 'none',
  textDecoration: 'underline',
}

const FOOT = {
  fontSize: '11px',
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-caption, rgba(0,0,0,.4))',
}

const PROGRESS_TRACK = {
  width: '100%',
  height: '6px',
  overflow: 'hidden',
  background: 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))',
  borderRadius: '999px',
}

const PROGRESS_BAR = {
  height: '100%',
  background: 'var(--dsw-alias-state-business-primary, #1f6feb)',
  borderRadius: '999px',
  transition: 'width 200ms linear',
}

const CRUMBS = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '2px',
  fontSize: '12px',
  lineHeight: '18px',
}

const CRUMB = {
  maxWidth: '160px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  padding: '1px 4px',
  fontSize: '12px',
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary, rgba(0,0,0,.55))',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
}

const ENTRY_LIST = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1px',
  maxHeight: '230px',
  overflowY: 'auto',
  padding: '2px',
  border: '0.5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12))',
  borderRadius: '8px',
}

const ENTRY = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  width: '100%',
  height: '28px',
  padding: '0 8px',
  fontSize: '13px',
  lineHeight: '20px',
  color: 'inherit',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
}

/**
 * The requirement waiting to be sent once its draft lands. Module scope because
 * the two halves live in different components: the dialog sets it, the guard —
 * mounted somewhere in the composer — consumes it.
 */
const AUTO_SEND = { text: '', sessionId: '', deadline: 0 }

/** How long the guard keeps waiting for its draft before giving up. */
const AUTO_SEND_WINDOW_MS = 20_000

/**
 * Join one path segment onto a parent, using the parent's own separator.
 *
 * Display only: the real path is the Host's answer, but a preview that reads
 * `C:\\Users\\me\\project/name` looks broken on Windows.
 * @param parent - absolute directory.
 * @param name - one path segment.
 * @returns the joined path.
 */
function joinPath(parent, name) {
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  const base = parent.endsWith(separator) ? parent.slice(0, -1) : parent
  return `${base}${separator}${name}`
}

/**
 * True when this Enter belongs to an IME rather than to the user.
 *
 * Committing a CJK candidate with Enter also fires `keydown`, and treating that
 * as "submit" creates a project nobody confirmed — which is exactly the mistake
 * this dialog is supposed to make impossible.
 * @param event - the keydown event.
 * @returns whether the event is part of a composition session.
 */
function isImeEnter(event) {
  return event.isComposing === true || event.keyCode === 229
}

/**
 * POST JSON to one of this plugin's Host endpoints and always resolve to a body.
 * @param url - endpoint path on the same origin.
 * @param payload - JSON body.
 * @returns the parsed body, or a synthetic failure carrying the status.
 */
async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => undefined)
  return body ?? { ok: false, error: `the Host answered ${response.status}` }
}

/**
 * True when a name can be used as a folder name.
 *
 * Chinese is refused rather than stripped: 「账单汇总」 silently becoming an
 * empty string is a worse answer than saying the name has to be ASCII.
 * @param name - the candidate.
 * @returns whether the name is legal.
 */
function invalidName(name) {
  return !isValidName(name)
}

/**
 * A name that needs no model: the description's ASCII words, else a timestamped
 * one. Used when the Host could not name it — a Host whose module predates the
 * naming route, a dead model, an offline route, or a model that answered in
 * Chinese (its Han characters are not a legal name any more, and there is
 * nothing to salvage from them).
 * @param description - whatever the user typed.
 * @returns a valid single path segment.
 */
function fallbackName(description) {
  // ASCII only: in a Chinese description an ASCII word is usually a technical
  // term ("CSV", "API"), which names the file format — but it is still a legal
  // name, and a timestamp is the honest last resort.
  const words = (String(description).match(/[A-Za-z0-9]+/g) ?? []).slice(0, 3)
  const slug = words.join('-').toLowerCase().slice(0, 40).replace(/-+$/g, '')
  if (slug !== '' && !invalidName(slug)) return slug
  return timestampName()
}

/**
 * The sentence for a name the rule refused.
 *
 * Chinese gets its own line: it is the case the person actually hits, and
 * "cannot contain / or \" would be a misleading explanation of it.
 * @param name - the rejected name.
 * @param t - this plugin's translator.
 * @returns the message to show.
 */
function nameErrorText(name, t) {
  const problem = nameProblem(name)
  if (problem === 'empty') return t('error.name')
  if (problem === 'non-ascii') return t('error.ascii')
  return t('error.invalid')
}

/**
 * The sidebar's directory flow, replaced by a description field.
 * @param props - the slot's owner share plus this plugin's injected Host calls.
 * @returns the dialog element, or null while the flow is closed.
 */
function QuickProjectFlow(props) {
  const {
    open, busy, onPicked, onCancel,
    createProject, listProjects, hostHome,
    nameFromRequirement, waitForWorkspace, startSession, t,
  } = props
  const [description, setDescription] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [naming, setNaming] = useState(false)
  const [nameNote, setNameNote] = useState(undefined)
  const [error, setError] = useState(undefined)
  const [working, setWorking] = useState(false)
  const [existed, setExisted] = useState(false)
  /** `browse` is the fallback that picks an existing folder without the native dialog. */
  const [mode, setMode] = useState('create')
  const [listing, setListing] = useState(undefined)
  const [listingError, setListingError] = useState(undefined)
  const [listingBusy, setListingBusy] = useState(false)
  /** The repository address in clone mode. */
  const [repoUrl, setRepoUrl] = useState('')
  /** The requirement typed in clone mode; kept apart from `description` so switching modes cannot cross the two. */
  const [cloneDescription, setCloneDescription] = useState('')
  /** The running clone's progress, as the Host reported it. */
  const [clone, setClone] = useState(undefined)
  const descriptionRef = useRef(null)
  /** The repository field's own ref: clone mode focuses it, not the requirement. */
  const repoUrlRef = useRef(null)

  const home = hostHome()
  /** The real projects root, as the Host joins it (`~/project` on POSIX, `~\\project` on Windows). */
  const [projectRoot, setProjectRoot] = useState(undefined)
  /** Display-only guess used until the Host reports the real root. */
  const rootFallback = home === undefined || home === '' ? undefined : joinPath(home, 'project')
  const root = projectRoot ?? rootFallback
  const trimmedName = name.trim()
  const trimmedDescription = description.trim()
  const trimmedRepoUrl = repoUrl.trim()
  /**
   * The folder a clone lands in: the pinned name, else the one the Host will
   * derive from the URL. Showing it while typing is the point — the destination
   * should be visible before git runs, not after.
   */
  const cloneFolder = trimmedName !== '' ? trimmedName : nameFromRepoUrl(trimmedRepoUrl)
  const preview = root === undefined
    ? `~/project/${trimmedName}`
    : mode === 'clone'
      ? (cloneFolder === '' ? root : joinPath(root, cloneFolder))
      : (trimmedName === '' ? root : joinPath(root, trimmedName))
  const pending = working || busy === true || naming

  // A fresh dialog each time it opens: no stale text, no stale complaint.
  useEffect(() => {
    if (!open) return
    setDescription('')
    setName('')
    setNameTouched(false)
    setNaming(false)
    setNameNote(undefined)
    setError(undefined)
    setWorking(false)
    setExisted(false)
    setMode('create')
    setListing(undefined)
    setListingError(undefined)
    setListingBusy(false)
    setRepoUrl('')
    setCloneDescription('')
    setClone(undefined)
    // Ask the Host where projects live: the path separator is the Host's, not
    // the browser's, and only the Host knows it.
    listProjects()
      .then((payload) => setProjectRoot(payload.root))
      .catch(() => {})
    const focus = setTimeout(() => descriptionRef.current?.focus(), 30)
    return () => clearTimeout(focus)
  }, [open])

  // Say “this one already exists” while typing rather than after Enter: the
  // answer changes what the button will do, so it belongs next to the field.
  useEffect(() => {
    if (!open || root === undefined || invalidName(trimmedName)) {
      setExisted(false)
      return
    }
    let cancelled = false
    const probe = setTimeout(() => {
      listProjects(root)
        .then((listing) => {
          if (cancelled) return
          const hit = (listing?.entries ?? []).some((entry) => entry.name === trimmedName && entry.isDirectory !== false)
          setExisted(hit)
        })
        .catch(() => {
          if (!cancelled) setExisted(false)
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(probe)
    }
  }, [open, root, trimmedName, listProjects])

  /**
   * Adopt one directory and start the Session with the requirement in it.
   *
   * Both modes end here: a freshly created folder and a freshly cloned one are
   * the same thing from this point on, and running the requirement through one
   * path is why "clone, then do this" needs no separate sending machinery.
   * @param path - absolute directory the flow was pointed at.
   * @param requirement - what to send once the Session exists; blank opens it empty.
   */
  const finishWith = useCallback(async (path, requirement = trimmedDescription) => {
    const prompt = String(requirement ?? '').trim()
    if (prompt !== '') {
      AUTO_SEND.text = prompt
      AUTO_SEND.deadline = Date.now() + AUTO_SEND_WINDOW_MS
    }
    onPicked(path)
    if (prompt === '') return
    const workspaceId = await waitForWorkspace(path)
    if (workspaceId === undefined) return
    AUTO_SEND.sessionId = workspaceId
    // The flow's owner is opening a blank Session here too. Two concurrent
    // `startSession` calls for one Workspace collapse into one attempt, and the
    // loser's `beforeOpen` — which carries the requirement — is dropped with it.
    // Adopting a blank that already exists therefore gets a second try once the
    // first attempt has settled.
    await startSession(workspaceId, { prompt, clearPreviousDraft: true })
    await new Promise((resolve) => setTimeout(resolve, 700))
    if (AUTO_SEND.text !== '') {
      await startSession(workspaceId, { prompt, clearPreviousDraft: true })
    }
  }, [trimmedDescription, onPicked, waitForWorkspace, startSession])

  const submit = useCallback(async () => {
    if (working || busy === true || naming) return
    // Naming happens here and only here: typing the description must not start a
    // model call, because a name that changes under your eyes reads as work you
    // did not ask for yet.
    let resolved = trimmedName
    if (resolved === '' && trimmedDescription !== '') {
      setNaming(true)
      setNameNote(undefined)
      try {
        const suggested = await nameFromRequirement(trimmedDescription)
        const fallback = typeof suggested !== 'string' || suggested === ''
        resolved = fallback ? fallbackName(trimmedDescription) : suggested
        setName(resolved)
        setNameNote(fallback ? t('named.fallback') : t('named'))
      } finally {
        setNaming(false)
      }
    }
    if (invalidName(resolved)) {
      setError(nameErrorText(resolved, t))
      return
    }
    setWorking(true)
    setError(undefined)
    try {
      // `mkdir -p` semantics on the Host: an existing name is adopted rather
      // than treated as an error, and the Host owns the path separator.
      const target = await createProject(resolved)
      await finishWith(target)
    } catch (reason) {
      AUTO_SEND.text = ''
      setError(t('error.failed', { message: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      setWorking(false)
    }
  }, [working, busy, trimmedName, trimmedDescription, createProject, finishWith, nameFromRequirement, t])

  /**
   * Start a clone and follow it to the end.
   *
   * The clone runs on the Host detached from this request, so this only polls:
   * a slow repository cannot hold a response open, and the dialog still shows
   * what git is doing (its own `Receiving objects: 47%` line) instead of
   * freezing behind a spinner.
   */
  const startClone = useCallback(async () => {
    if (working || busy === true) return
    const url = repoUrl.trim()
    if (url === '') {
      setError(t('clone.noUrl'))
      return
    }
    setWorking(true)
    setError(undefined)
    setClone({ phase: 'starting', percent: 0, line: '' })
    let id
    try {
      const answer = await postJson('/quick-project/clone', {
        url,
        name: trimmedName === '' ? undefined : trimmedName,
      })
      if (answer.ok !== true || typeof answer.id !== 'string') {
        // The Host refuses a directory that already holds something; say that in
        // the person's words rather than forwarding git's.
        setError(answer.error === 'exists'
          ? t('clone.exists', { name: answer.name ?? trimmedName })
          : answer.message ?? answer.error ?? 'the Host could not start the clone')
        setClone(undefined)
        return
      }
      id = answer.id
    } catch (reason) {
      setError(t('clone.error', { message: reason instanceof Error ? reason.message : String(reason) }))
      setClone(undefined)
      return
    }

    // Poll until the Host reports a terminal phase. The dialog can be closed
    // meanwhile: the clone keeps running there, and the Workspace is opened from
    // whichever poll sees it finish.
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      let status
      try {
        status = await postJson('/quick-project/clone-status', { id })
      } catch {
        continue
      }
      if (status.ok !== true) {
        setError(t('clone.error', { message: status.message ?? status.error ?? 'the clone stopped being tracked' }))
        setClone(undefined)
        setWorking(false)
        return
      }
      setClone(status)
      if (status.phase === 'done') {
        try {
          await finishWith(status.path, cloneDescription)
        } catch (reason) {
          setError(t('clone.error', { message: reason instanceof Error ? reason.message : String(reason) }))
        } finally {
          setWorking(false)
        }
        return
      }
      if (status.phase === 'failed') {
        setError(t('clone.error', { message: status.error ?? 'git exited without a reason' }))
        setWorking(false)
        return
      }
    }
  }, [working, busy, repoUrl, trimmedName, cloneDescription, finishWith, t])

  /** Read one directory into the browser pane. */
  const load = useCallback(async (path) => {
    if (typeof path !== 'string' || path === '') {
      setListingError(t('error.home'))
      return
    }
    setListingBusy(true)
    setListingError(undefined)
    try {
      setListing(await listProjects(path))
    } catch (reason) {
      setListingError(t('browse.failed', { message: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      setListingBusy(false)
    }
  }, [listProjects, t])

  const choose = useCallback(async () => {
    if (working || busy === true) return
    setMode('browse')
    setError(undefined)
    await load(root ?? home ?? '')
  }, [working, busy, root, home, load])

  if (!open) return null

  /** The clone's own progress line: git's phase in words, its percentage, and its raw line underneath. */
  const clonePhaseText = clone === undefined
    ? ''
    : t(`clone.phase.${clone.phase}`) !== `clone.phase.${clone.phase}`
      ? t(`clone.phase.${clone.phase}`)
      : t('clone.phase.starting')

  const status = error !== undefined
    ? { text: error, color: 'var(--dsw-alias-state-error-primary, #d1242f)' }
    : clone !== undefined && clone.phase !== 'done' && clone.phase !== 'failed'
      ? { text: `${clonePhaseText} ${t('clone.progress', { percent: clone.percent ?? 0 })}${clone.line === '' || clone.line === undefined ? '' : ` · ${clone.line}`}`, color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,.7))' }
      : busy === true
        ? { text: t('opening'), color: undefined }
        : working
          ? { text: mode === 'clone' ? t('clone.starting') : t('creating'), color: undefined }
          : naming
            ? { text: t('naming'), color: undefined }
            : existed && mode !== 'clone'
              ? { text: t('exists'), color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,.7))' }
              : nameNote !== undefined
                ? { text: nameNote, color: 'var(--dsw-alias-label-tertiary, rgba(0,0,0,.55))' }
                : trimmedName === '' && trimmedDescription !== '' && mode !== 'clone'
                  ? { text: t('name.will'), color: 'var(--dsw-alias-label-tertiary, rgba(0,0,0,.55))' }
                  : { text: mode === 'clone' && cloneFolder === '' ? t('clone.noUrl') : preview, color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,.7))' }

  const dialogTitle = mode === 'browse' ? t('browse.title') : mode === 'clone' ? t('clone.title') : t('title')

  return (
    <div
      style={OVERLAY}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel()
      }}
    >
      <div style={CARD} role="dialog" aria-modal="true" aria-label={dialogTitle}>
        <div style={TITLE}>{dialogTitle}</div>
        {mode === 'browse' ? (
          <>
            <div style={CRUMBS}>
              {(listing?.crumbs ?? []).map((crumb, index, all) => (
                <button
                  key={crumb.path}
                  type="button"
                  style={CRUMB}
                  title={crumb.path}
                  disabled={pending}
                  onClick={() => load(crumb.path)}
                >
                  {crumb.name}
                  {index < all.length - 1 && <span style={{ opacity: 0.5 }}> /</span>}
                </button>
              ))}
            </div>
            <div style={ENTRY_LIST}>
              {listingBusy ? (
                <div style={{ ...PREVIEW, fontFamily: 'inherit', padding: '6px 8px' }} role="status">{t('browse.loading')}</div>
              ) : listingError !== undefined ? (
                <div style={{ ...PREVIEW, fontFamily: 'inherit', padding: '6px 8px', color: 'var(--dsw-alias-state-error-primary, #d1242f)' }} role="alert">
                  {listingError}
                </div>
              ) : (listing?.entries ?? []).length === 0 ? (
                <div style={{ ...PREVIEW, fontFamily: 'inherit', padding: '6px 8px' }}>{t('browse.empty')}</div>
              ) : (
                (listing?.entries ?? []).map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    style={ENTRY}
                    title={entry.path}
                    disabled={pending}
                    onClick={() => load(entry.path)}
                    onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05))' }}
                    onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}
                  >
                    <span aria-hidden="true">▸</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                  </button>
                ))
              )}
            </div>
            <div style={PREVIEW} title={listing?.path}>{listing?.path ?? ''}</div>
            <div style={ACTIONS}>
              <button type="button" style={LINK} disabled={pending} onClick={() => setMode('create')}>
                {t('browse.back')}
              </button>
              <span style={{ flex: '1 1 0' }} />
              <button type="button" style={SECONDARY} disabled={working} onClick={onCancel}>
                {t('cancel')}
              </button>
              <button
                type="button"
                style={PRIMARY}
                disabled={pending || listing === undefined}
                onClick={async () => {
                  if (listing === undefined) return
                  setWorking(true)
                  setError(undefined)
                  try {
                    await finishWith(listing.path)
                  } catch (reason) {
                    setError(t('error.failed', { message: reason instanceof Error ? reason.message : String(reason) }))
                    setMode('create')
                  } finally {
                    setWorking(false)
                  }
                }}
              >
                {busy === true ? t('opening') : working ? t('creating') : t('browse.here')}
              </button>
            </div>
          </>
        ) : mode === 'clone' ? (
          <>
            <div style={SUBTITLE}>{t('clone.subtitle')}</div>
            <div style={NAME_ROW}>
              <span style={NAME_LABEL}>{t('clone.urlLabel')}</span>
              <input
                ref={repoUrlRef}
                style={NAME_INPUT}
                value={repoUrl}
                placeholder={t('clone.urlPlaceholder')}
                spellCheck={false}
                autoComplete="off"
                disabled={pending}
                onChange={(event) => {
                  setRepoUrl(event.target.value)
                  setError(undefined)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    if (isImeEnter(event)) return
                    event.preventDefault()
                    startClone()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    onCancel()
                  }
                }}
              />
            </div>
            <textarea
              ref={descriptionRef}
              style={{ ...FIELD, minHeight: '64px' }}
              rows={3}
              value={cloneDescription}
              placeholder={t('clone.requirement')}
              spellCheck={false}
              disabled={pending}
              onChange={(event) => {
                setCloneDescription(event.target.value)
                setError(undefined)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  if (isImeEnter(event)) return
                  event.preventDefault()
                  startClone()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancel()
                }
              }}
            />
            <div style={NAME_ROW}>
              <span style={NAME_LABEL}>{t('nameLabel')}</span>
              <input
                style={NAME_INPUT}
                value={name}
                placeholder={t('clone.namePlaceholder')}
                spellCheck={false}
                autoComplete="off"
                disabled={pending}
                onChange={(event) => {
                  setName(event.target.value)
                  setNameTouched(true)
                  setError(undefined)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    if (isImeEnter(event)) return
                    event.preventDefault()
                    startClone()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    onCancel()
                  }
                }}
              />
            </div>
            {clone !== undefined && (
              <div
                style={PROGRESS_TRACK}
                role="progressbar"
                aria-valuenow={clone.percent ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div style={{ ...PROGRESS_BAR, width: `${Math.max(2, Math.min(100, clone.percent ?? 0))}%` }} />
              </div>
            )}
            {status !== undefined && (
              <div style={{ ...PREVIEW, fontFamily: 'inherit', color: status.color }} role={error === undefined ? 'status' : 'alert'}>
                {status.text}
              </div>
            )}
            <div style={ACTIONS}>
              <button type="button" style={LINK} disabled={pending} onClick={() => { setMode('create'); setError(undefined) }}>
                {t('clone.back')}
              </button>
              <span style={{ flex: '1 1 0' }} />
              <button type="button" style={SECONDARY} disabled={working} onClick={onCancel}>
                {t('cancel')}
              </button>
              <button type="button" style={PRIMARY} disabled={pending || repoUrl.trim() === ''} onClick={startClone}>
                {clone !== undefined && clone.phase !== 'done' && clone.phase !== 'failed'
                  ? t('clone.progress', { percent: clone.percent ?? 0 })
                  : t('clone.start')}
              </button>
            </div>
            <div style={FOOT}>{t('clone.foot')}</div>
          </>
        ) : (
          <>
            <div style={SUBTITLE}>{root === undefined ? t('subtitle.unknown') : t('subtitle.empty')}</div>
            <textarea
              ref={descriptionRef}
              style={{ ...FIELD, minHeight: '64px' }}
              rows={3}
              value={description}
              placeholder={t('description')}
              spellCheck={false}
              disabled={pending}
              onChange={(event) => {
                setDescription(event.target.value)
                setError(undefined)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  if (isImeEnter(event)) return
                  event.preventDefault()
                  submit()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancel()
                }
              }}
            />
            <div style={NAME_ROW}>
              <span style={NAME_LABEL}>{t('nameLabel')}</span>
              <input
                style={NAME_INPUT}
                value={name}
                placeholder={t('namePlaceholder')}
                spellCheck={false}
                autoComplete="off"
                disabled={pending}
                onChange={(event) => {
                  setName(event.target.value)
                  setNameTouched(true)
                  setNameNote(undefined)
                  setError(undefined)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    if (isImeEnter(event)) return
                    event.preventDefault()
                    submit()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    onCancel()
                  }
                }}
              />
            </div>
            {status !== undefined && (
              <div style={{ ...PREVIEW, fontFamily: 'inherit', color: status.color }} role={error === undefined ? 'status' : 'alert'}>
                {status.text}
              </div>
            )}
            <div style={ACTIONS}>
              <button type="button" style={LINK} disabled={pending} onClick={choose}>
                {t('browse')}
              </button>
              <button
                type="button"
                style={LINK}
                disabled={pending}
                onClick={() => {
                  setMode('clone')
                  setError(undefined)
                  // Focus lands on the URL field on the next paint, once it exists.
                  setTimeout(() => repoUrlRef.current?.focus(), 0)
                }}
              >
                {t('clone.link')}
              </button>
              <span style={{ flex: '1 1 0' }} />
              <button type="button" style={SECONDARY} disabled={working} onClick={onCancel}>
                {t('cancel')}
              </button>
              <button type="button" style={PRIMARY} disabled={pending || (trimmedName === '' && trimmedDescription === '')} onClick={submit}>
                {busy === true ? t('opening') : working ? t('creating') : t('create')}
              </button>
            </div>
            <div style={FOOT}>{t('foot')}</div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Invisible occupant of the composer: submits the requirement once it is the
 * Session's draft. Renders nothing; acts at most once per request.
 * @param props - session-scope standard props (draft state and submit actions).
 * @returns null.
 */
function AutoSendGuard(props) {
  const { useInput, inputActions, sessionId } = props
  const draft = typeof useInput === 'function' ? useInput((state) => state?.draft ?? '') : ''
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current || inputActions === undefined) return
    if (AUTO_SEND.text === '') return
    if (Date.now() > AUTO_SEND.deadline) {
      AUTO_SEND.text = ''
      return
    }
    // Match on the text, not the id: the requirement is what was asked for, and
    // the id may still be settling while the draft already landed.
    if (draft.trim() !== AUTO_SEND.text) return
    fired.current = true
    AUTO_SEND.text = ''
    inputActions.submit()
  }, [draft, inputActions, sessionId])

  return null
}

/**
 * Client plugin body: register the dictionary, fill both directory-flow holes
 * one priority below the stock dialog, and mount the auto-send guard.
 * @param ctx - client root context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, LABELS), 'quick-project: dictionaries')
  const t = ctx.locale.bind(NS)

  /**
   * Unregister the Workspace, then delete its directory.
   *
   * Unregistering first is deliberate: the row stops pointing at a directory
   * that is about to disappear, so a failed delete leaves a visible error
   * instead of a Workspace that opens into nothing.
   * @param target - the clicked Workspace (id, path, display name).
   */
  const removeProject = async ({ workspaceId, path, displayTitle }) => {
    if (typeof path !== 'string' || path === '') throw new Error('this Workspace has no directory path')
    if (!window.confirm(t('remove.confirm', { name: displayTitle ?? path, path }))) return
    await ctx.workspaces.delete(workspaceId)
    const response = await fetch('/quick-project/remove', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    const body = await response.json().catch(() => undefined)
    if (body?.ok !== true) {
      throw new Error(body?.message ?? body?.error ?? `the Host answered ${response.status}`)
    }
  }

  // 「删除工作区」 only unregisters the Workspace and leaves the folder on disk.
  // This adds the missing half, in the same menu, next to it.
  ctx.effect(() => ctx.contextMenus.register({
    id: 'quick-project.remove',
    target: 'workspace',
    order: 350,
    resolve: (target) => [{
      id: 'remove',
      label: t('menu.remove'),
      // Reuse the trash glyph the built-in delete row already registered under
      // this key, so the two destructive rows look like siblings.
      icon: { key: 'workspace.delete' },
      danger: true,
      separatorBefore: true,
      failureLabel: t('remove.failed.short'),
      run: () => removeProject(target),
    }],
  }), 'quick-project: delete-with-folder menu action')

  const injected = () => ({
    // The directory picker is *composed*: POSIX deployments serve the in-app
    // `browse` half (`createDirectory`, `list`), Windows serves the native half
    // (`pick` only). Asking `uiWorkspace` for either half breaks on the other
    // platform, so creation and listing go through the Host, which knows the
    // real separator and always has a filesystem.
    createProject: async (name) => {
      const body = await postJson('/quick-project/create', { name })
      if (body.ok !== true || typeof body.path !== 'string') {
        throw new Error(body.message ?? body.error ?? 'the Host could not create the folder')
      }
      return body.path
    },
    listProjects: async (path) => {
      const body = await postJson('/quick-project/list', path === undefined || path === '' ? {} : { path })
      if (body.ok !== true) throw new Error(body.message ?? body.error ?? 'the Host could not list the folder')
      return body
    },
    hostHome: () => ctx.remote.$host.home,
    startSession: (workspaceId, options) => ctx.uiWorkspace.startSession(workspaceId, options),
    /**
     * Resolve the Workspace at `path` once it also has a Session: calling
     * `startSession` while the flow's own open is still in flight would merge
     * the two attempts and lose the requirement.
     */
    waitForWorkspace: async (path, timeoutMs = 12_000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const snapshot = ctx.workspaces.list.getSnapshot()
        const hit = (snapshot?.items ?? []).find((item) => item.path === path)
        if (hit !== undefined && (hit.sessionIds ?? []).length > 0) return hit.workspaceId
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
      return undefined
    },
    /** Ask the Host for a name; `undefined` means “use the fallback”. */
    nameFromRequirement: async (description) => {
      const response = await fetch('/quick-project/name', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description }),
      })
      if (!response.ok) return undefined
      const body = await response.json().catch(() => undefined)
      return body?.ok === true && typeof body.name === 'string' && body.name !== '' ? body.name : undefined
    },
    t: ctx.locale.bind(NS),
  })

  // `inject` on the hole, not a direct register: the ui-workspace entries that
  // declare these holes may activate later or come back after a reload.
  ctx.effect(() => ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
    yield ctx.slots.register({ name: 'conversation.hero.workspace.directoryFlow', priority: -1, inject: injected }, QuickProjectFlow)
    yield ctx.slots.register({ name: 'sidebar.workspaces.directoryFlow', priority: -1, inject: injected }, QuickProjectFlow)
  })), 'quick-project: directory flow')

  ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'quick-project-auto-send',
    order: 900,
  }, AutoSendGuard)), 'quick-project: auto-send guard')
}
