// Browser half of dsh-quick-project.
//
// The complaint this answers: making a new project meant walking a folder tree
// from the sidebar's 「+」 to `~/project`, creating a folder, coming back, and
// finding it again. Four steps for something whose only input is a name.
//
// So this fills the sidebar's directory-flow hole with one text field: type a
// name, press Enter, and the folder exists under `~/project` and that Workspace
// is open. The Host does the creating (the browser cannot touch the filesystem)
// and the Host does the adopting (`onPicked` → `workspaces.create` → a blank
// Session is opened by the owner of the flow).
//
// Two details that are easy to get wrong:
//   - The hole is declared `single` and sorted by ascending priority, so the
//     stock browse dialog sits at priority 0. Registering at -1 is what makes
//     this one render instead of being shadowed; the stock dialog stays
//     registered and reachable through 「选择已有文件夹…」 → the Host's native
//     picker, so no capability is lost.
//   - A name that already exists is not an error here. `workspaces.create`
//     resolves an existing directory to the Workspace already pointing at it,
//     which is exactly what someone retyping a name wants.

import { useCallback, useEffect, useRef, useState } from 'react'

/** Locale namespace owning this dialog's copy. */
const NS = 'quick-project'

const LABELS = {
  zh: {
    title: '新建项目',
    'subtitle.empty': '输入名称，会在 {root} 下新建文件夹并打开',
    'subtitle.unknown': '输入名称，会在 ~/project 下新建文件夹并打开',
    placeholder: '项目名称',
    create: '创建并打开',
    creating: '正在创建…',
    opening: '正在打开…',
    cancel: '取消',
    browse: '选择已有文件夹…',
    exists: '同名文件夹已存在，将直接打开',
    'error.invalid': '名称不能为空，也不能包含 “/” 或 “\\”',
    'error.home': '还没拿到宿主主目录，稍等一秒再试',
    'error.failed': '创建失败：{message}',
    foot: '回车创建 · Esc 取消',
  },
  en: {
    title: 'New project',
    'subtitle.empty': 'Type a name; the folder is created under {root} and opened',
    'subtitle.unknown': 'Type a name; the folder is created under ~/project and opened',
    placeholder: 'Project name',
    create: 'Create and open',
    creating: 'Creating…',
    opening: 'Opening…',
    cancel: 'Cancel',
    browse: 'Choose an existing folder…',
    exists: 'That folder already exists; it will be opened',
    'error.invalid': 'A name is required and may not contain “/” or “\\”',
    'error.home': 'The Host home directory is not available yet — try again in a second',
    'error.failed': 'Could not create it: {message}',
    foot: 'Enter to create · Esc to cancel',
  },
}

/** Services this client plugin reads; Cordis throws on un-injected access. */
export const inject = ['slots', 'locale', 'uiWorkspace', 'remote']

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
  width: 'min(420px, calc(100vw - 32px))',
  padding: '18px 20px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
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

const INPUT = {
  boxSizing: 'border-box',
  width: '100%',
  height: '38px',
  padding: '7px 12px',
  fontSize: '14px',
  lineHeight: '22px',
  color: 'inherit',
  background: 'transparent',
  border: '0.5px solid var(--dsw-alias-border-l4, rgba(0,0,0,.2))',
  borderRadius: '8px',
  outline: 'none',
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
 * The sidebar's directory flow, replaced by a single field.
 * @param props - the slot's owner share plus this plugin's injected Host calls.
 * @returns the dialog element, or null while the flow is closed.
 */
function QuickProjectFlow(props) {
  const { open, busy, onPicked, onCancel, createDirectory, listDirectory, pickDirectory, hostHome, t } = props
  const [name, setName] = useState('')
  const [error, setError] = useState(undefined)
  const [working, setWorking] = useState(false)
  const [existed, setExisted] = useState(false)
  const inputRef = useRef(null)

  const home = hostHome()
  const root = home === undefined || home === '' ? undefined : joinPath(home, 'project')
  const trimmed = name.trim()
  const preview = root === undefined ? `~/project/${trimmed}` : trimmed === '' ? root : joinPath(root, trimmed)
  const pending = working || busy === true

  // A fresh dialog each time it opens: no stale name, no stale complaint.
  useEffect(() => {
    if (!open) return
    setName('')
    setError(undefined)
    setWorking(false)
    setExisted(false)
    const focus = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(focus)
  }, [open])

  // Say “this one already exists” while typing rather than after Enter: the
  // answer changes what the button will do, so it belongs next to the field.
  useEffect(() => {
    if (!open || root === undefined || invalidName(trimmed)) {
      setExisted(false)
      return
    }
    let cancelled = false
    const probe = setTimeout(() => {
      listDirectory(root)
        .then((listing) => {
          if (cancelled) return
          const hit = (listing?.entries ?? []).some((entry) => entry.name === trimmed && entry.isDirectory !== false)
          setExisted(hit)
        })
        .catch(() => {
          if (!cancelled) setExisted(false)
        })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(probe)
    }
  }, [open, root, trimmed, listDirectory])

  const submit = useCallback(async () => {
    if (working || busy === true) return
    if (invalidName(trimmed)) {
      setError(t('error.invalid'))
      return
    }
    if (root === undefined) {
      setError(t('error.home'))
      return
    }
    const target = joinPath(root, trimmed)
    if (existed) {
      onPicked(target)
      return
    }
    setWorking(true)
    setError(undefined)
    try {
      let created
      try {
        created = await createDirectory(root, trimmed)
      } catch (reason) {
        // A directory that appeared between the probe and the call is still the
        // outcome asked for; let the Host resolve the Workspace already there.
        if (mentionsExisting(reason)) {
          onPicked(target)
          return
        }
        throw reason
      }
      onPicked(typeof created === 'string' && created !== '' ? created : target)
    } catch (reason) {
      setError(t('error.failed', { message: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      setWorking(false)
    }
  }, [working, busy, trimmed, root, existed, createDirectory, onPicked, t])

  const choose = useCallback(async () => {
    if (working || busy === true) return
    try {
      const picked = await pickDirectory()
      if (typeof picked === 'string' && picked !== '') onPicked(picked)
    } catch (reason) {
      setError(t('error.failed', { message: reason instanceof Error ? reason.message : String(reason) }))
    }
  }, [working, busy, pickDirectory, onPicked, t])

  if (!open) return null

  const status = error !== undefined
    ? { text: error, color: 'var(--dsw-alias-state-error-primary, #d1242f)' }
    : busy === true
      ? { text: t('opening'), color: undefined }
      : working
        ? { text: t('creating'), color: undefined }
        : existed
          ? { text: t('exists'), color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,.7))' }
          : undefined

  return (
    <div
      style={OVERLAY}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel()
      }}
    >
      <div style={CARD} role="dialog" aria-modal="true" aria-label={t('title')}>
        <div style={TITLE}>{t('title')}</div>
        <div style={SUBTITLE}>{root === undefined ? t('subtitle.unknown') : t('subtitle.empty', { root })}</div>
        <input
          ref={inputRef}
          style={INPUT}
          value={name}
          placeholder={t('placeholder')}
          spellCheck={false}
          autoComplete="off"
          disabled={pending}
          onChange={(event) => {
            setName(event.target.value)
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
        <div style={PREVIEW}>{preview}</div>
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
          <button type="button" style={PRIMARY} disabled={pending || trimmed === ''} onClick={submit}>
            {pending ? (busy === true ? t('opening') : t('creating')) : t('create')}
          </button>
        </div>
        <div style={FOOT}>{t('foot')}</div>
      </div>
    </div>
  )
}

/**
 * Client plugin body: register the dictionary, then fill both directory-flow
 * holes one priority below the stock dialog so this one is the one that renders.
 * @param ctx - client root context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, LABELS), 'quick-project: dictionaries')

  const injected = () => ({
    createDirectory: (path, name) => ctx.uiWorkspace.createDirectory(path, name),
    listDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
    hostHome: () => ctx.remote.$host.home,
    t: ctx.locale.bind(NS),
  })

  // `inject` on the hole, not a direct register: the ui-workspace entries that
  // declare these holes may activate later or come back after a reload.
  ctx.effect(() => ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
    yield ctx.slots.register({ name: 'conversation.hero.workspace.directoryFlow', priority: -1, inject: injected }, QuickProjectFlow)
    yield ctx.slots.register({ name: 'sidebar.workspaces.directoryFlow', priority: -1, inject: injected }, QuickProjectFlow)
  })), 'quick-project: directory flow')
}
