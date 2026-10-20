// Starts or stops the local Supabase used by the auth end-to-end tests.
//   node e2e/auth/stack.mjs start | stop | status
// The stack runs in Docker on this machine only. It's built from a generated workdir (gitignored)
// holding e2e/auth/supabase/config.toml and the repo's migrations, minus 0002.
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.resolve(here, "../..")
const repo = path.resolve(frontend, "..")
const workdir = path.join(frontend, "test-results", "supabase-e2e")
export const STACK_ENV = path.join(workdir, "stack-env.json")
const CLI = ["--yes", "supabase@2.121.0"]

function supabase(args, opts = {}) {
  return execFileSync("npx", [...CLI, ...args, "--workdir", workdir], { encoding: "utf8", ...opts })
}

function prepare() {
  const dir = path.join(workdir, "supabase")
  rmSync(path.join(dir, "migrations"), { recursive: true, force: true })
  mkdirSync(path.join(dir, "migrations"), { recursive: true })
  copyFileSync(path.join(here, "supabase", "config.toml"), path.join(dir, "config.toml"))
  for (const file of readdirSync(path.join(repo, "supabase", "migrations")).sort()) {
    if (file.startsWith("0002_")) continue
    copyFileSync(path.join(repo, "supabase", "migrations", file), path.join(dir, "migrations", file))
  }
}

function status() {
  const s = JSON.parse(supabase(["status", "-o", "json"], { stdio: ["ignore", "pipe", "ignore"] }))
  const env = {
    apiUrl: s.API_URL,
    anonKey: s.ANON_KEY,
    serviceRoleKey: s.SERVICE_ROLE_KEY,
    mailUrl: s.MAILPIT_URL ?? s.INBUCKET_URL,
  }
  for (const [k, v] of Object.entries(env)) {
    if (!v) throw new Error(`local Supabase status is missing ${k}`)
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(env.apiUrl)) throw new Error(`refusing a non-local Supabase: ${env.apiUrl}`)
  writeFileSync(STACK_ENV, JSON.stringify(env, null, 2))
  return env
}

const cmd = process.argv[2]
if (cmd === "start") {
  prepare()
  supabase(["start"], { stdio: "inherit" })
  const env = status()
  console.log(`local Supabase ready at ${env.apiUrl} (mail: ${env.mailUrl})`)
} else if (cmd === "stop") {
  supabase(["stop", "--no-backup"], { stdio: "inherit" })
} else if (cmd === "status") {
  console.log(status().apiUrl)
} else {
  console.error("usage: node e2e/auth/stack.mjs start|stop|status")
  process.exit(1)
}
