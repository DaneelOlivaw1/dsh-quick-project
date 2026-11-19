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
    exists: '同名文件夹已存在，将直接打开',
    'error.name': '还需要一个项目名（或写点需求自动取）',
    'error.invalid': '名称不能为空，也不能包含 “/” 或 “\\”',
    'error.home': '还没拿到宿主主目录，稍等一秒再试',
    'error.failed': '创建失败：{message}',
    foot: '回车创建 · Shift+回车换行 · Esc 取消',
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
    exists: 'That folder already exists; it will be opened',
    'error.name': 'A name is needed — or describe the project and it is named for you',
    'error.invalid': 'A name is required and may not contain “/” or “\\”',
    'error.home': 'The Host home directory is not available yet — try again in a second',
    'error.failed': 'Could not create it: {message}',
    foot: 'Enter to create · Shift+Enter for a new line · Esc to cancel',
  },
}

/** Services this client plugin reads; Cordis throws on un-injected access. */
export const inject = ['slots', 'locale', 'uiWorkspace', 'workspaces', 'remote']

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

/** Join one path segment onto a POSIX-ish parent without doubling the separator. */
function joinPath(parent, name) {
  const base = parent.endsWith('/') ? parent.slice(0, -1) : parent
  return `${base}/${name}`
}

/** A name is one path segment: no separators, not blank, not a dot entry. */
function invalidName(name) {
  return name === '' || name === '.' || name === '..' || /[/\\]/.test(name)
}

/** RPC faults spell "already there" differently across layers; the suffix is the stable part. */
function mentionsExisting(error) {
  const code = error?.rpcError?.code
  return typeof code === 'string' && code.includes('exist')
}

/**
 * A name that needs no model: the description's first CJK characters, else its
 * first ASCII words, else a timestamped one. Used when the Host could not name
 * it — a Host whose module predates the naming route, a dead model, or an
 * offline route.
 * @param description - whatever the user typed.
 * @returns a valid single path segment.
 */
function fallbackName(description) {
  // Chinese first: in a Chinese description an ASCII word is usually a
  // technical term ("CSV", "API"), which names the file format, not the project.
  const han = (description.match(/[\u4e00-\u9fa5]+/g) ?? [])
    .join('')
    .replace(/^(?:帮我|帮忙|请|我|要|想|把|将|做|写|开发|实现|搞|弄|搭|建|一个|一套|一份|个|套|份|的)+/, '')
    .slice(0, 8)
    .replace(/[的了]$/, '')
  if (han !== '' && !invalidName(han)) return han
  const words = (description.match(/[A-Za-z0-9]+/g) ?? []).slice(0, 3)
  const slug = words.join('-').toLowerCase().slice(0, 40).replace(/-+$/g, '')
  if (slug !== '' && !invalidName(slug)) return slug
  const now = new Date()
  const two = (value) => String(value).padStart(2, '0')
  return `project-${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`
}

/**
 * The sidebar's directory flow, replaced by a description field.
 * @param props - the slot's owner share plus this plugin's injected Host calls.
 * @returns the dialog element, or null while the flow is closed.
 */
function QuickProjectFlow(props) {
  const {
    open, busy, onPicked, onCancel,
    createDirectory, listDirectory, readDirectory, hostHome,
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
  const descriptionRef = useRef(null)
  /** The in-flight naming request, so Enter can wait for it instead of failing. */
  const namingRef = useRef(undefined)

  const home = hostHome()
  const root = home === undefined || home === '' ? undefined : joinPath(home, 'project')
  const trimmedName = name.trim()
  const trimmedDescription = description.trim()
  const preview = root === undefined ? `~/project/${trimmedName}` : trimmedName === '' ? root : joinPath(root, trimmedName)
  const pending = working || busy === true

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
    const focus = setTimeout(() => descriptionRef.current?.focus(), 30)
    return () => clearTimeout(focus)
  }, [open])

  // Ask the Host to name the project once the description settles. `nameTouched`
  // guards the overwrite: a name the user typed is theirs, not a suggestion.
  useEffect(() => {
    if (!open || nameTouched || trimmedDescription === '') {
      setNaming(false)
      return
    }
    let cancelled = false
    setNaming(true)
    const ask = setTimeout(() => {
      const request = nameFromRequirement(trimmedDescription)
      namingRef.current = request.catch(() => undefined)
      request
        .then((suggested) => {
          if (cancelled) return
          const fallback = suggested === undefined
          const value = fallback ? fallbackName(trimmedDescription) : suggested
          setName(value)
          setNameNote(fallback ? t('named.fallback') : t('named'))
        })
        .catch(() => {
          if (cancelled) return
          setName(fallbackName(trimmedDescription))
          setNameNote(t('named.fallback'))
        })
        .finally(() => {
          if (!cancelled) {
            setNaming(false)
            namingRef.current = undefined
          }
        })
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(ask)
    }
  }, [open, trimmedDescription, nameTouched, nameFromRequirement, t])

  // Say “this one already exists” while typing rather than after Enter: the
  // answer changes what the button will do, so it belongs next to the field.
  useEffect(() => {
    if (!open || root === undefined || invalidName(trimmedName)) {
      setExisted(false)
      return
    }
    let cancelled = false
    const probe = setTimeout(() => {
      listDirectory(root)
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
  }, [open, root, trimmedName, listDirectory])

  /**
   * Adopt one directory and start the Session with the requirement in it.
   * @param path - absolute directory the flow was pointed at.
   */
  const finishWith = useCallback(async (path) => {
    if (trimmedDescription !== '') {
      AUTO_SEND.text = trimmedDescription
      AUTO_SEND.deadline = Date.now() + AUTO_SEND_WINDOW_MS
    }
    onPicked(path)
    if (trimmedDescription === '') return
    const workspaceId = await waitForWorkspace(path)
    if (workspaceId === undefined) return
    AUTO_SEND.sessionId = workspaceId
    // The flow's owner is opening a blank Session here too. Two concurrent
    // `startSession` calls for one Workspace collapse into one attempt, and the
    // loser's `beforeOpen` — which carries the requirement — is dropped with it.
    // Adopting a blank that already exists therefore gets a second try once the
    // first attempt has settled.
    await startSession(workspaceId, { prompt: trimmedDescription, clearPreviousDraft: true })
    await new Promise((resolve) => setTimeout(resolve, 700))
    if (AUTO_SEND.text !== '') {
      await startSession(workspaceId, { prompt: trimmedDescription, clearPreviousDraft: true })
    }
  }, [trimmedDescription, onPicked, waitForWorkspace, startSession])

  const submit = useCallback(async () => {
    if (working || busy === true) return
    // Pressing Enter while the model is still naming is not an error: wait for
    // the name it is about to hand back.
    let resolved = trimmedName
    if (resolved === '' && namingRef.current !== undefined) {
      const suggested = await namingRef.current
      resolved = typeof suggested === 'string' && suggested !== '' ? suggested : fallbackName(trimmedDescription)
      setName(resolved)
      setNameNote(t('named'))
    }
    if (invalidName(resolved)) {
      setError(resolved === '' ? t('error.name') : t('error.invalid'))
      return
    }
    if (root === undefined) {
      setError(t('error.home'))
      return
    }
    const target = joinPath(root, resolved)
    setWorking(true)
    setError(undefined)
    try {
      if (!existed) {
        try {
          await createDirectory(root, resolved)
        } catch (reason) {
          // A directory that appeared between the probe and the call is still
          // the outcome asked for; let the Host resolve the Workspace there.
          if (!mentionsExisting(reason)) throw reason
        }
      }
      // The flow's owner adopts the directory and opens a blank Session; the
      // requirement is added to that Session afterwards, once it exists.
      if (trimmedDescription !== '') {
        AUTO_SEND.text = trimmedDescription
        AUTO_SEND.deadline = Date.now() + AUTO_SEND_WINDOW_MS
      }
      await finishWith(target)
    } catch (reason) {
      AUTO_SEND.text = ''
      setError(t('error.failed', { message: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      setWorking(false)
    }
  }, [working, busy, trimmedName, trimmedDescription, root, existed, createDirectory, finishWith, t])

  /** Read one directory into the browser pane. */
  const load = useCallback(async (path) => {
    if (typeof path !== 'string' || path === '') {
      setListingError(t('error.home'))
      return
    }
    setListingBusy(true)
    setListingError(undefined)
    try {
      setListing(await readDirectory(path))
    } catch (reason) {
      setListingError(t('browse.failed', { message: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      setListingBusy(false)
    }
  }, [readDirectory, t])

  const choose = useCallback(async () => {
    if (working || busy === true) return
    setMode('browse')
    setError(undefined)
    await load(root ?? home ?? '')
  }, [working, busy, root, home, load])

  if (!open) return null

  const status = error !== undefined
    ? { text: error, color: 'var(--dsw-alias-state-error-primary, #d1242f)' }
    : busy === true
      ? { text: t('opening'), color: undefined }
      : working
        ? { text: t('creating'), color: undefined }
        : naming
          ? { text: t('naming'), color: undefined }
          : existed
            ? { text: t('exists'), color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,.7))' }
            : nameNote !== undefined
              ? { text: nameNote, color: 'var(--dsw-alias-label-tertiary, rgba(0,0,0,.55))' }
              : { text: preview, color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,.7))' }

  return (
    <div
      style={OVERLAY}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel()
      }}
    >
      <div style={CARD} role="dialog" aria-modal="true" aria-label={mode === 'browse' ? t('browse.title') : t('title')}>
        <div style={TITLE}>{mode === 'browse' ? t('browse.title') : t('title')}</div>
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
              <span style={{ flex: '1 1 0' }} />
              <button type="button" style={SECONDARY} disabled={working} onClick={onCancel}>
                {t('cancel')}
              </button>
              <button type="button" style={PRIMARY} disabled={pending || trimmedName === ''} onClick={submit}>
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

  const injected = () => ({
    createDirectory: (path, name) => ctx.uiWorkspace.createDirectory(path, name),
    listDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
    // `directoryPicker.pick` needs the Host's *native* capability. Deployments
    // composed with the in-app browser serve `browse` instead, so the fallback
    // walks `listDirectory` itself rather than assuming a native dialog exists.
    readDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
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
