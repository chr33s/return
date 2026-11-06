export const defaultPrefix = "/api"

/** A prefix of `/` would claim every SPA request. */
export const normalizePrefix = (prefix: string) => {
  const trimmed = prefix.trim()
  if (trimmed === "" || trimmed === "/") {
    throw new Error("return vite prefix must not be empty")
  }
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash
}

export const matchesPrefix = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`)

/** `/api/users/` stays `/users/`. An exact prefix becomes `/`. */
export const stripPrefix = (pathname: string, prefix: string) => {
  const rest = pathname.slice(prefix.length)
  return rest === "" ? "/" : rest
}

/** Vite's `base`. `/` means the SPA is not mounted under a prefix. */
export const normalizeBase = (base: string | undefined) => {
  if (base === undefined || base === "" || base === "/") return "/"
  const withSlash = base.startsWith("/") ? base : `/${base}`
  return withSlash.endsWith("/") ? withSlash : `${withSlash}/`
}

/**
 * A base of `/api/` owns `/api/` and `/api/…`. The exact path `/api` is not
 * that base, so `fetch("/api")` can still hit the router.
 */
export const claimedByBase = (pathname: string, base: string) => {
  if (base === "/") return false
  return pathname === base || pathname.startsWith(base)
}

/** `/app/assets/main.js` with base `/app/` is `/assets/main.js` inside `dist`. */
export const stripBase = (pathname: string, base: string) => {
  if (base === "/") return pathname
  if (pathname === base) return "/"
  if (pathname.startsWith(base)) return `/${pathname.slice(base.length)}`
  return pathname
}
