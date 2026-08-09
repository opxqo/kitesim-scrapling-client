#!/usr/bin/env node

import { chmod, readFile, rename, writeFile } from "node:fs/promises"
import { resolve } from "node:path"


const envPath = resolve(process.cwd(), ".env")
const managedNames = new Set([
  "KITESIM_AUTH_AUTOMATION_ENABLED",
  "KITESIM_AI_BASE_URL",
  "KITESIM_AI_API_KEY",
  "KITESIM_AI_MODEL",
  "KITESIM_AI_TIMEOUT_SECONDS",
  // Remove EdgeOne's auto-filled gateway pair so it cannot be mistaken for this custom gateway.
  "AI_GATEWAY_BASE_URL",
  "AI_GATEWAY_API_KEY",
  "AI_GATEWAY_MODEL",
  "KITESIM_AUTH_MAX_CAPTCHA_ATTEMPTS",
  "KITESIM_AUTH_MAINTENANCE_INTERVAL_HOURS",
  "AI_GATEWAY_TIMEOUT_SECONDS",
])


async function readSecret(prompt) {
  if (!process.stdin.isTTY) {
    process.stdin.setEncoding("utf8")
    let piped = ""
    for await (const chunk of process.stdin) piped += chunk
    return piped.trim()
  }
  return new Promise((resolveSecret, reject) => {
    const input = process.stdin
    const output = process.stdout
    let value = ""

    function cleanup() {
      input.off("data", onData)
      input.setRawMode(false)
      input.pause()
      output.write("\n")
    }

    function onData(chunk) {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          cleanup()
          reject(new Error("Cancelled"))
          return
        }
        if (character === "\r" || character === "\n") {
          cleanup()
          resolveSecret(value)
          return
        }
        if (character === "\u007f") {
          value = value.slice(0, -1)
        } else if (character >= " " && character !== "\u007f") {
          value += character
        }
      }
    }

    output.write(prompt)
    input.setRawMode(true)
    input.setEncoding("utf8")
    input.resume()
    input.on("data", onData)
  })
}


const apiKey = (await readSecret("AI Gateway API key (input hidden): ")).trim()
if (apiKey.length < 16 || apiKey.length > 2048 || /\s/.test(apiKey)) {
  throw new Error("AI Gateway API key must be 16-2048 non-whitespace characters")
}

let source = ""
try {
  source = await readFile(envPath, "utf8")
} catch (error) {
  if (error?.code !== "ENOENT") throw error
}

const retainedLines = source.split(/\r?\n/).filter((line) => {
  const name = line.trimStart().match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1] || ""
  return !managedNames.has(name)
})
while (retainedLines.at(-1) === "") retainedLines.pop()

const managedLines = [
  "",
  "# AI CAPTCHA automation. The model receives only the CAPTCHA image.",
  "KITESIM_AUTH_AUTOMATION_ENABLED=true",
  "KITESIM_AI_BASE_URL=https://ai.opxqo.com/compat/v1",
  `KITESIM_AI_API_KEY=${apiKey}`,
  "KITESIM_AI_MODEL=google-ai-studio/gemini-3.1-flash-lite-preview",
  "KITESIM_AUTH_MAX_CAPTCHA_ATTEMPTS=3",
  "KITESIM_AUTH_MAINTENANCE_INTERVAL_HOURS=20",
  "KITESIM_AI_TIMEOUT_SECONDS=12",
  "",
]
const temporaryPath = `${envPath}.tmp-${process.pid}`
await writeFile(temporaryPath, [...retainedLines, ...managedLines].join("\n"), {
  encoding: "utf8",
  mode: 0o600,
})
await rename(temporaryPath, envPath)
await chmod(envPath, 0o600)

process.stdout.write("Configured local AI CAPTCHA automation; no secret was printed.\n")
