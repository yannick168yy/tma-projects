#!/usr/bin/env python3
"""Third patch: fail fast (and clearly) when the Claude Code login bills via the
API, which has no session/week quota panel for /usage to report."""
import pathlib, sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
f = root / "agent" / "claudecode" / "claude_usage.go"
src = f.read_text()

if "errClaudeUsageAPIBilling" in src:
    print("claude_usage.go: API-billing detection already present")
    sys.exit(0)

anchor = '''			if usageScreen != "" && time.Since(lastChange) >= claudeUsageStableFor {
				return usageScreen, nil
			}'''
inject = '''			if usageScreen == "" && time.Since(lastChange) >= claudeUsageAPIBillingStableFor &&
				isClaudeAPIBillingScreen(lastScreen) {
				return "", errClaudeUsageAPIBilling
			}
''' + anchor
if src.count(anchor) != 1:
    sys.exit("claude_usage.go: probe loop anchor not found")
src = src.replace(anchor, inject)

src = src.replace(
    "\tclaudeUsageActionGap            = 250 * time.Millisecond",
    "\tclaudeUsageActionGap            = 250 * time.Millisecond\n"
    "\tclaudeUsageAPIBillingStableFor  = 3 * time.Second")

src = src.replace(
    "type claudeUsageProbeState struct {",
    '''// errClaudeUsageAPIBilling is returned when Claude Code is signed in to an
// API-usage-billing account. Those have no subscription rate-limit windows, so
// /usage renders a cost/token panel instead of "Current session / Current week
// … % used" and there is nothing for this reporter to parse — waiting longer
// would only stall the command.
var errClaudeUsageAPIBilling = errors.New(
	"claudecode: 该 Claude Code 账号为 API 计费（API usage billing），没有订阅额度窗口，" +
		"/usage 只显示本次会话花费统计，无法给出用量百分比")

// isClaudeAPIBillingScreen reports whether the rendered /usage panel is the
// API-billing cost view rather than the subscription quota view.
func isClaudeAPIBillingScreen(screen string) bool {
	lower := strings.ToLower(screen)
	if usageReady(lower) {
		return false
	}
	if !claudeUsageLooseContains(lower, "total cost:") {
		return false
	}
	return claudeUsageLooseContains(lower, "api usage billing") ||
		claudeUsageLooseContains(lower, "usage stats")
}

type claudeUsageProbeState struct {''')

f.write_text(src)
print("claude_usage.go: API-billing fast-fail added")
