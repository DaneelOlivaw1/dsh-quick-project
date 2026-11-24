/**
 * The two request/response helpers every route in this plugin needs.
 *
 * Small on purpose: `webServer` hands a `handler` route the raw request and
 * response, so each route reads its own body and writes its own JSON. Sharing
 * them keeps the routes from drifting apart (one answering 400 where another
 * answers 500).
 */

/** Write one JSON response. A `handler` route owns the whole response lifecycle. */
export function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

/**
 * Read the request body, bounded so a wrong client cannot grow it without limit.
 * @param req - the incoming request.
 * @param limit - maximum accepted bytes.
 * @returns the body as UTF-8 text.
 */
export async function readBody(req, limit = 4_096) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Read a JSON body, answering nothing: the caller owns the error response so it
 * can name the failure in its own vocabulary.
 * @param req - the incoming request.
 * @param limit - maximum accepted bytes.
 * @returns the parsed body, or undefined when it is not JSON.
 */
export async function readJson(req, limit = 4_096) {
  try {
    const parsed = JSON.parse(await readBody(req, limit))
    return parsed ?? {}
  } catch {
    return undefined
  }
}
