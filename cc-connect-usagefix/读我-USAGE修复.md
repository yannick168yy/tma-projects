# cc-connect `/usage` 超时修复

## 现象
Telegram 里执行 `/usage`（claudecode 项目）返回：
`获取 usage 失败：claudecode: timed out waiting for Claude Code /usage panel: context deadline exceeded`

## 原因
cc-connect 取 Claude Code 用量的方式是：在临时目录里用 pty 冷启动一个 `claude` TUI，
回车唤醒 → 输入 `/usage` → 抓屏解析（`agent/claudecode/claude_usage.go`）。
整个过程被 `core/engine.go` 的 `cmdUsage` 硬编码成 **10 秒** 超时，且没有任何配置项。
冷启动 Claude Code + 拉取用量面板（要走网络）在这台机器上经常超过 10 秒，于是就报这个错。

## 本补丁做了两件事
1. `core/engine.go`：`/usage` 超时 10s → 60s，并支持环境变量 `CC_USAGE_TIMEOUT_SECONDS` 覆盖。
2. `agent/claudecode/claude_usage.go`：超时时把抓到的 Claude Code 屏幕内容写进日志
   （`~/.cc-connect/logs/cc-connect.log`，WARN "usage probe timed out"），万一还失败可以直接看到卡在哪一屏。

改动见同目录 `usage-timeout.patch`（基线是上游 tag v1.5.0，也就是你当前装的版本）。

## 怎么用
```bash
cd "$(dirname "$0")"        # 本目录
export GOPROXY=https://goproxy.cn,direct   # 国内建议加
./build-and-install.sh
```
脚本会：编译 → 备份原二进制为 `cc-connect.orig` → 覆盖安装 → `cc-connect daemon restart`。

## 回滚
```bash
T=/usr/local/Cellar/node/25.8.0/lib/node_modules/cc-connect/bin/cc-connect
cp "$T.orig" "$T" && cc-connect daemon restart
```
注意：以后跑 `npm i -g cc-connect` 或 `cc-connect update` 会覆盖掉这个补丁版本，需要重新跑一次脚本。

## 顺手可做的验证（不用编译）
在终端里手动跑一遍 cc-connect 内部用的那条探测命令，看它到底要多久：
```bash
cd "$(mktemp -d)" && time claude --tools "" --permission-mode plan --no-chrome
# 进去以后输入 /usage，看面板多久出来；超过 10 秒就证实了上面的判断
```

---

## 补丁 2（2026-08-31，真正的病根）

打上补丁 1 后日志抓到了卡死时的那一屏：

```
Accessingworkspace:
Quicksafetycheck:Isthisaprojectyoucreatedoroneyoutrust?...
❯1.Yes,Itrustthisfolder ✔
2.No,exit
Entertoconfirm·Esctocancel
```

**所有空格都没了。** `claudeUsageTerminal.applyCSI` 只实现了 `A/B/C/D/H/f/J/K`，
没实现 **`CSI n G`（CHA，光标绝对列）**——而 Claude Code 的 TUI 正是用 `\e[9G`
这类序列逐词定位的。于是整屏被压成一串无空格文本，`promptActionForScreen` 里
`"quick safety check"` / `"yes, i trust this folder"` / `"enter to confirm"` 全部匹配失败，
信任目录的确认框没人回车，探测就一直卡着直到超时；同理 `usageReady` 的
`"current session"` / `"current week"` 也永远匹配不上。

`apply_patch2.py` 做了三件事（都在 `agent/claudecode/claude_usage.go`）：

1. `applyCSI` 增加 `case 'G'`（绝对列）和 `case 'd'`（绝对行）——修复空格丢失；
2. 提示语/就绪判断改用 `claudeUsageLooseContains`（忽略空白差异），并补上
   新版文案 `"do you trust the files in this folder"`；
3. `parseClaudeUsageWindow` 找 `Current session` / `Current week` 段落时同样忽略空白。

补丁 1 的 60s 超时保留（冷启动本来就慢，留点余量），但真正的修复是这一版。

改完重新跑 `./build-and-install.sh` 即可。
