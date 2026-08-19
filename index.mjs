/**
 * dsh-win-notify — Windows 11 system notification bridge for DeepSeek Harness.
 *
 * Shows branded system toasts (DeepSeek name, whale icon, sound) in two
 * scenarios:
 *   1. `approval/request` — a tool action needs user confirmation
 *      (looping alarm sound, title 「需要确认」).
 *   2. `agent/status` running → idle — the model finished running
 *      (default sound, title 「运行完成」). Subagent completions are skipped.
 *
 * Windows only; `apply` is a no-op elsewhere. On every load the plugin
 * regenerates the DeepSeek whale icon (pure Node, no rendering library — see
 * `icon.mjs`), writes it under `%LOCALAPPDATA%\DeepSeekHarness\deepseek.ico`,
 * and (re)registers the AppUserModelID in
 * `HKCU\Software\Classes\AppUserModelId\<aumid>` with the display name and
 * icon URI, so Windows attributes toasts to DeepSeek Harness instead of
 * PowerShell. All toasts go through `CreateToastNotifier(aumid)`.
 *
 * Zero runtime dependencies: only Node builtins + the Cordis context passed
 * by the harness. No build step — this file is the package entry.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildWhaleIcon } from './icon.mjs'

export const name = 'win-notify'
export const inject = []

/** Default configuration; every field can be overridden from the plugin row. */
export const DEFAULTS = Object.freeze({
  /** Whether the bridge is active. */
  enabled: true,
  /** Display name registered for the toast app. */
  appName: 'DeepSeek Harness',
  /** AppUserModelID under which the branded toasts are shown. */
  aumid: 'DeepSeekAI.DeepSeekHarness',
  /** Title of the confirmation toast. */
  confirmationTitle: 'DeepSeek Harness · 需要确认',
  /** Title of the completion toast. */
  completionTitle: 'DeepSeek Harness · 运行完成',
  /** Windows toast sound event for the confirmation toast. */
  confirmationSound: 'Notification.Looping.Alarm',
  /** Windows toast sound event for the completion toast. */
  completionSound: 'Notification.Default',
})

/** Escape one text fragment for the toast XML document. */
function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Build the toast XML payload with the given title, body, and sound. */
function toastXml(title, body, sound, loop) {
  return '<toast duration="long">'
    + '<visual><binding template="ToastGeneric">'
    + `<text>${esc(title)}</text>`
    + `<text>${esc(body)}</text>`
    + '</binding></visual>'
    + `<audio src="ms-winsoundevent:${sound}" loop="${loop ? 'true' : 'false'}"/>`
    + '</toast>'
}

/** Run one fire-and-forget child process, ignoring output. */
function run(argv) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: 'ignore', windowsHide: true })
    child.on('error', () => resolve())
    child.on('close', () => resolve())
  })
}

/** Show one branded Windows toast under the configured AppUserModelID. */
function notify(config, title, body, sound, loop) {
  const xml = toastXml(title, body, sound, loop)
  const b64 = Buffer.from(xml, 'utf8').toString('base64')
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    `$b64='${b64}'`,
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null',
    '$x=New-Object Windows.Data.Xml.Dom.XmlDocument',
    '$x.LoadXml([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64)))',
    '$t=New-Object Windows.UI.Notifications.ToastNotification $x',
    `$appId='${config.aumid}'`,
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($t)',
    'Start-Sleep -Milliseconds 300',
  ].join('\n')
  return run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script])
}

/** Stable per-user location for the DeepSeek whale icon file. */
function iconFile() {
  const base = process.env.LOCALAPPDATA ?? process.env.USERPROFILE ?? '.'
  const dir = join(base, 'DeepSeekHarness')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'deepseek.ico')
}

/**
 * Idempotent branding setup: regenerate the whale icon (self-healing — the
 * file is rewritten on every load) and (re)register the AppUserModelID with
 * the display name and icon URI. Failures are logged and never throw.
 */
function ensureBranding(config) {
  let icon = ''
  try {
    icon = iconFile()
    writeFileSync(icon, buildWhaleIcon())
  } catch (error) {
    console.error(`[win-notify] icon build failed (continuing without a custom icon): ${String(error)}`)
  }
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${config.aumid}`
  Promise.all([
    run(['reg.exe', 'add', key, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', config.appName, '/f']),
    run(['reg.exe', 'add', key, '/v', 'IconUri', '/t', 'REG_SZ', '/d', icon, '/f']),
  ]).catch(() => {})
}

/** Compose the confirmation-toast body from the pending approval request. */
function confirmationBody(request) {
  const tool = request.toolName
  const reason = request.reason
  if (reason && tool) return `${tool}：${reason}`
  if (reason) return reason
  if (tool) return `${tool}：需要你确认是否继续`
  return '有操作需要你在页面上确认是否继续'
}

/** Subagent sessions are filtered out so their completions do not spam. */
function isSubagent(agent) {
  try {
    return agent?.session?.header?.origin === 'subagent'
  } catch {
    return false
  }
}

/**
 * Load the win-notify plugin: ensure DeepSeek branding and wire the two
 * notification listeners. No-op when disabled or on a non-Windows platform.
 * @param {object} ctx - Cordis context that owns the listeners.
 * @param {object} [config] - plugin configuration (defaults applied).
 */
export function apply(ctx, config = {}) {
  const resolved = { ...DEFAULTS, ...config }
  if (!resolved.enabled) return
  if (process.platform !== 'win32') return

  ensureBranding(resolved)

  const running = new Set()

  // 场景一：需要用户确认。瀑布事件只旁路观察，必须放行 next()。
  ctx.on('approval/request', (request, next) => {
    try {
      notify(resolved, resolved.confirmationTitle, confirmationBody(request), resolved.confirmationSound, true)
    } catch (error) {
      console.error(`[win-notify] approval listener: ${String(error)}`)
    }
    return next()
  })

  // 场景二：模型运行完成。只有观察到 running → idle 才发通知，并过滤子代理。
  ctx.on('agent/status', ({ agent, status }) => {
    try {
      if (status === 'running') {
        running.add(agent.id)
        return
      }
      if (status !== 'idle') return
      if (!running.delete(agent.id)) return
      if (isSubagent(agent)) return
      notify(resolved, resolved.completionTitle, '模型已完成本轮运行，结果已就绪，请回到页面查看。', resolved.completionSound, false)
    } catch (error) {
      console.error(`[win-notify] status listener: ${String(error)}`)
    }
  })
}

export default { name: 'win-notify', apply }
