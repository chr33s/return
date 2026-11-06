import type { IncomingMessage } from "node:http"

export interface OriginForm {
  readonly pathname: string
  readonly search: string
}

/**
 * Origin-form only: a single leading slash, then a path and an optional query.
 * Scheme-relative (`//…`) and absolute-form (`http://…`) targets are rejected.
 */
export const parseOriginForm = (target: string | undefined): OriginForm | undefined => {
  if (target === undefined || target.length === 0) return undefined
  if (target.charCodeAt(0) !== 47 || target.charCodeAt(1) === 47) return undefined
  for (let i = 0; i < target.length; i++) {
    const code = target.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f || target[i] === "\\" || target[i] === "#") return undefined
  }
  const query = target.indexOf("?")
  if (query === -1) return { pathname: target, search: "" }
  return { pathname: target.slice(0, query), search: target.slice(query) }
}

export const requestScheme = (req: IncomingMessage): "http" | "https" => {
  const socket = req.socket as { encrypted?: boolean } | null | undefined
  return socket !== null && socket !== undefined && socket.encrypted === true ? "https" : "http"
}

export const requestHost = (req: IncomingMessage): string | undefined => {
  const host = req.headers.host
  if (Array.isArray(host)) return undefined
  if (host === undefined || host === "") return "127.0.0.1"
  return host
}

/** `undefined` when the host cannot be placed in a URL, such as `::1` without brackets. */
export const requestUrl = (
  scheme: "http" | "https",
  host: string,
  pathname: string,
  search: string
): URL | undefined => {
  try {
    return new URL(`${scheme}://${host}${pathname}${search}`)
  } catch {
    return undefined
  }
}
