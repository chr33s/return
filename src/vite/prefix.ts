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
