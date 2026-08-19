# dsh-win-notify

> Windows 11 system notification bridge plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

[![CI](https://github.com/linfunss/dsh-win-notify/actions/workflows/ci.yml/badge.svg)](https://github.com/linfunss/dsh-win-notify/actions/workflows/ci.yml)

Branded system toasts (DeepSeek name + whale icon + sound) when a tool action needs **user confirmation** and when the **model finishes running** — so you don't have to keep staring at the Harness window.

**Zero runtime dependencies. Zero build step. Plain ESM JavaScript.**

---

## Features

| Scenario | Event | Title | Sound |
| --- | --- | --- | --- |
| User confirmation needed | `approval/request` (waterfall, observed only) | 需要确认 | `Notification.Looping.Alarm` (looping) |
| Model finished running | `agent/status` `running → idle` (subagents filtered) | 运行完成 | `Notification.Default` |

**DeepSeek branding, self-healing.** On every load the plugin:
1. regenerates the DeepSeek whale icon in pure Node (no rendering library) and writes it to `%LOCALAPPDATA%\DeepSeekHarness\deepseek.ico`;
2. (re)registers the AppUserModelID `DeepSeekAI.DeepSeekHarness` in `HKCU\Software\Classes\AppUserModelId\...` with the display name and icon URI.

Toasts are sent via `CreateToastNotifier(aumid)`, so Windows attributes them to **DeepSeek Harness** instead of PowerShell — correct name, correct logo, correct sound.

> Note: the icon is rasterized directly from the official favicon path data because librsvg (the renderer behind `sharp`) mis-scales this specific path into a thin strip. The scanline rasterizer in `icon.mjs` bypasses that.

---

## Requirements

- Windows 10/11 (the plugin is a no-op on other platforms)
- DeepSeek Harness with a Web/desktop profile (provides the `@deepseek-ai/cordis` peer)

---

## Install

The package is a standard DSH **bundle**: add it to your profile's `dsh.profile.bundles`, or insert the row manually.

### Option A — local clone (recommended for development)

```powershell
git clone https://github.com/<your-name>/dsh-win-notify.git
```

Then reference it from your profile's `package.json` (`$DSH_HOME/profiles/<profile>/package.json`):

```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "dsh-win-notify": "file:C:/path/to/dsh-win-notify"
  }
}
```

Install and add to the bundle list:

```bash
dsh plugin --profile web install
# then add "dsh-win-notify" to dsh.profile.bundles in the profile package.json
```

### Option B — npm (once published)

```bash
dsh plugin --profile web add dsh-win-notify
```

### Option C — git URL dependency

```json
"dependencies": {
  "dsh-win-notify": "github:<your-name>/dsh-win-notify"
}
```

Then `pnpm install` inside your profile directory (or `dsh plugin --profile web install`).

---

## Enable

Add the package to the profile's `dsh.profile.bundles` (its `cordis.patch.yml` inserts the `win-notify` row), or insert it yourself in the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: win-notify
      name: 'dsh-win-notify'
```

Restart DSH. You should now see a "DeepSeek Harness" entry in **Settings → System → Notifications** (make sure its toggle is on; Focus Assist can silence toasts).

---

## Config

All fields are optional:

```yaml
- id: win-notify
  name: 'dsh-win-notify'
  config:
    enabled: true                      # default: true
    appName: DeepSeek Harness
    aumid: DeepSeekAI.DeepSeekHarness
    confirmationTitle: DeepSeek Harness · 需要确认
    completionTitle: DeepSeek Harness · 运行完成
    confirmationSound: Notification.Looping.Alarm
    completionSound: Notification.Default
```

---

## Test

```bash
node tests/icon.test.mjs      # or: npm test
```

Verifies the ICO structure, PNG entries, and that the whale actually renders.

---

## Known limitations

- System notification settings must allow the "DeepSeek Harness" app; Focus Assist may suppress toasts.
- Windows may cache a previously registered icon until the notification center refreshes (restart DSH to clear).
- Toasts are informative only; clicking them does not focus the Harness window (no `ToastActivatorCLSID` registered).

---

## License

[MIT](LICENSE)

---

# 中文说明

**DeepSeek Harness 的 Windows 11 系统通知桥接插件**：当工具操作需要**用户确认**、以及**模型运行完成**时，弹出带 DeepSeek 品牌（名称、鲸鱼图标、音效）的系统通知，不用一直盯着 Harness 窗口。

**零运行时依赖、零构建步骤、纯 ESM JavaScript。**

## 功能

| 场景 | 事件 | 标题 | 音效 |
| --- | --- | --- | --- |
| 需要用户确认 | `approval/request`（瀑布事件，仅旁观） | 需要确认 | `Notification.Looping.Alarm`（循环警报） |
| 模型运行完成 | `agent/status` `running → idle`（过滤子代理） | 运行完成 | `Notification.Default`（默认提示音） |

**品牌自愈**：每次加载时用纯 Node 重新生成 DeepSeek 鲸鱼图标（不依赖渲染库），写入 `%LOCALAPPDATA%\DeepSeekHarness\deepseek.ico`，并把 AppUserModelID `DeepSeekAI.DeepSeekHarness` 重新注册进 `HKCU\Software\Classes\AppUserModelId\...`（显示名 + 图标路径）。通知经 `CreateToastNotifier(aumid)` 发出，Windows 会将其归属为 **DeepSeek Harness** 而不是 PowerShell——名称、图标、音效都正确。

> 图标直接由官方 favicon 路径数据光栅化生成，因为 librsvg（sharp 底层）会把这条特定路径压扁成一条细线；`icon.mjs` 里的扫描线光栅化绕开了该缺陷。

## 安装

方式 A：本地 clone 后在 profile 的 `package.json` 里加 `"dsh-win-notify": "file:...路径"`，再 `dsh plugin --profile <profile> install`。
方式 B：发布到 npm 后 `dsh plugin --profile <profile> add dsh-win-notify`。
方式 C：git 依赖 `"dsh-win-notify": "github:<你的账号>/dsh-win-notify"` 后 `pnpm install`。

## 启用

把包加入 profile 的 `dsh.profile.bundles`（自带 `cordis.patch.yml` 会插入 `win-notify` 行），或在 profile 的 `cordis.patch.yml` 手动插入：

```yaml
- insert:
    - id: win-notify
      name: 'dsh-win-notify'
```

重启 DSH。此时「设置 → 系统 → 通知」里会出现 **DeepSeek Harness** 条目（确保开关打开；专注助手可能静音）。

## 配置

全部可选：

```yaml
- id: win-notify
  name: 'dsh-win-notify'
  config:
    enabled: true
    appName: DeepSeek Harness
    aumid: DeepSeekAI.DeepSeekHarness
    confirmationTitle: DeepSeek Harness · 需要确认
    completionTitle: DeepSeek Harness · 运行完成
    confirmationSound: Notification.Looping.Alarm
    completionSound: Notification.Default
```

## 测试

```bash
node tests/icon.test.mjs      # 或 npm test
```

验证 ICO 结构、PNG 条目与鲸鱼渲染内容。

## 已知限制

- 需在系统通知设置中允许「DeepSeek Harness」；专注助手可能静音。
- Windows 可能缓存旧图标直到通知中心刷新（重启 DSH 可清除）。
- 通知仅作提示，点击不会聚焦 Harness 窗口（未注册 `ToastActivatorCLSID`）。

## 许可证

[MIT](LICENSE)
