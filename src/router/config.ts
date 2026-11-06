/**
 * Matching rules shared by production, the dev host, and HTTP tests.
 * Trailing slashes are significant, paths are case-sensitive, and duplicate
 * slashes are not collapsed.
 */
export const routerConfig = {
  caseSensitive: true,
  ignoreDuplicateSlashes: false,
  ignoreTrailingSlash: false
} as const
