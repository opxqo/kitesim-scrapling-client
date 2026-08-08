#!/usr/bin/env node

import { randomBytes } from "node:crypto"
import { chmod, readFile, rename, writeFile } from "node:fs/promises"
import { resolve } from "node:path"


const envPath = resolve(process.cwd(), ".env")
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const emails = process.argv.slice(2).map((value) => value.trim().toLowerCase())

if (!emails.length || emails.length > 20 || emails.some((email) => !emailPattern.test(email))) {
  throw new Error("Usage: node scripts/configure-local-accounts.mjs <email1> [email2 ... email20]")
}
if (new Set(emails).size !== emails.length) {
  throw new Error("Kitesim login emails must be unique")
}

let source = ""
try {
  source = await readFile(envPath, "utf8")
} catch (error) {
  if (error?.code !== "ENOENT") throw error
}

function parsedValue(name) {
  const line = source.split(/\r?\n/).find((candidate) => (
    candidate.trimStart().startsWith(`${name}=`)
  ))
  if (!line) return ""
  const raw = line.slice(line.indexOf("=") + 1).trim()
  if (
    raw.length >= 2
    && ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"')))
  ) {
    return raw.slice(1, -1)
  }
  return raw
}

const password = parsedValue("KITESIM_LOGIN_PASSWORD") || parsedValue("DASHBOARD_ACCESS_KEY")
if (password.length < 8 || password.length > 256) {
  throw new Error("Existing .env has no reusable account password; set KITESIM_LOGIN_PASSWORD first")
}

const retainedLines = source.split(/\r?\n/).filter((line) => {
  const name = line.trimStart().match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1] || ""
  if (!name) return true
  return !(
    /^KITESIM_TOKEN(?:S|_\d+|_NAME_\d+)?$/.test(name)
    || /^KITESIM_LOGIN_EMAIL(?:_\d+)?$/.test(name)
    || name === "KITESIM_LOGIN_PASSWORD"
    || name === "KITESIM_AUTH_ENCRYPTION_KEY"
    || name === "KITESIM_AUTH_BRIDGE_SECRET"
    || name === "DASHBOARD_ACCESS_KEY"
  )
})

while (retainedLines.at(-1) === "") retainedLines.pop()
const managedLines = [
  "",
  "# Managed Kitesim account login. Tokens are generated after manual CAPTCHA entry.",
  ...emails.map((email, index) => `KITESIM_LOGIN_EMAIL_${index + 1}=${email}`),
  `KITESIM_LOGIN_PASSWORD=${password}`,
  `KITESIM_AUTH_ENCRYPTION_KEY=${parsedValue("KITESIM_AUTH_ENCRYPTION_KEY") || randomBytes(32).toString("base64")}`,
  `KITESIM_AUTH_BRIDGE_SECRET=${parsedValue("KITESIM_AUTH_BRIDGE_SECRET") || randomBytes(32).toString("hex")}`,
  `DASHBOARD_ACCESS_KEY=${randomBytes(32).toString("base64url")}`,
  "",
]
const nextSource = [...retainedLines, ...managedLines].join("\n")
const temporaryPath = `${envPath}.tmp-${process.pid}`

await writeFile(temporaryPath, nextSource, { encoding: "utf8", mode: 0o600 })
await rename(temporaryPath, envPath)
await chmod(envPath, 0o600)

process.stdout.write(
  `Configured ${emails.length} Kitesim login accounts; removed static token variables; rotated dashboard key.\n`,
)
