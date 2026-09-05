#!/usr/bin/env python3
"""Patch cc-connect v1.5.0 so the Telegram /usage command stops timing out."""
import pathlib, sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()

eng = root / "core" / "engine.go"
src = eng.read_text()
old = ("\tfetchCtx, cancel := context.WithTimeout(e.ctx, 10*time.Second)\n"
       "\tdefer cancel()\n"
       "\n"
       "\treport, err := reporter.GetUsage(fetchCtx)")
new = ("\tfetchCtx, cancel := context.WithTimeout(e.ctx, usageFetchTimeout())\n"
       "\tdefer cancel()\n"
       "\n"
       "\treport, err := reporter.GetUsage(fetchCtx)")
if new in src:
    print("engine.go: already patched")
else:
    if src.count(old) != 1:
        sys.exit("engine.go: cmdUsage timeout block not found (%d matches)" % src.count(old))
    src = src.replace(old, new)
    src += '''
// usageFetchTimeout is the deadline for a /usage lookup.
//
// The Claude Code reporter has to cold-start a `claude` TUI in a pty, dismiss
// the folder-trust prompt, send /usage and wait for the panel to come back
// from the network. On a loaded machine or a slow link that regularly takes
// longer than the 10s this used to allow, which surfaced as
// "timed out waiting for Claude Code /usage panel: context deadline exceeded".
// Default 60s; override with CC_USAGE_TIMEOUT_SECONDS.
func usageFetchTimeout() time.Duration {
	if raw := strings.TrimSpace(os.Getenv("CC_USAGE_TIMEOUT_SECONDS")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return 60 * time.Second
}
'''
    eng.write_text(src)
    print("engine.go: patched")

usage = root / "agent" / "claudecode" / "claude_usage.go"
src = usage.read_text()
old = ('\t\t\treturn "", fmt.Errorf("claudecode: timed out waiting for Claude Code '
       '/usage panel: %w", probeCtx.Err())')
new = ('\t\t\tslog.Warn("claudecode: usage probe timed out", "elapsed", time.Since(lastChange), '
       '"screen", lastScreen, "stderr", stderr.String())\n' + old)
if 'usage probe timed out' in src:
    print("claude_usage.go: already patched")
else:
    if src.count(old) != 1:
        sys.exit("claude_usage.go: timeout branch not found (%d matches)" % src.count(old))
    usage.write_text(src.replace(old, new))
    print("claude_usage.go: patched")
