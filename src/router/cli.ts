#!/usr/bin/env node
import { realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { generateProject } from "./generate.ts"

const flag = (name: string) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const invoked = process.argv[1]
const isMain = invoked !== undefined && realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url))

if (isMain) {
  const routesArg = flag("--routes")
  const outArg = flag("--out")
  if (routesArg === undefined || outArg === undefined || routesArg.startsWith("--") || outArg.startsWith("--")) {
    console.error("usage: return-generate --routes <dir> --out <file> [--check]")
    process.exitCode = 1
  } else {
    const projectRoot = process.cwd()
    const result = await generateProject({
      routesDir: path.resolve(projectRoot, routesArg),
      outFile: path.resolve(projectRoot, outArg),
      projectRoot,
      check: process.argv.includes("--check")
    })
    if (result.diagnostics.length > 0) {
      for (const line of result.diagnostics) console.error(line)
      process.exitCode = 1
    } else {
      process.stdout.write(result.wrote ? "wrote\n" : "unchanged\n")
    }
  }
}
