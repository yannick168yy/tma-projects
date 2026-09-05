#!/usr/bin/env python3
"""Second patch: teach cc-connect's mini terminal emulator about CSI G / d, and
match prompt/panel text whitespace-insensitively as a belt-and-braces.

Claude Code's TUI positions nearly every word with CSI n G (absolute column).
The emulator in claude_usage.go ignored that sequence, so the captured screen
came out as one unspaced blob ("Quicksafetycheck:..."), no prompt matcher ever
fired, the folder-trust dialog was never confirmed, and the probe timed out.
"""
import pathlib, sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
f = root / "agent" / "claudecode" / "claude_usage.go"
src = f.read_text()
changed = False

old_case = """	case 'H', 'f':
		row, col := parseCSICursor(params)"""
new_case = """	case 'G':
		// CHA — absolute column. Claude Code's TUI positions nearly every
		// word with this; without it the whole screen collapses into one
		// unspaced blob and every text match below fails.
		col := parseCSIInt(params, 1) - 1
		if col < 0 {
			col = 0
		}
		t.col = col
		t.ensureRow(t.row)
	case 'd':
		// VPA — absolute row.
		row := parseCSIInt(params, 1) - 1
		if row < 0 {
			row = 0
		}
		t.row = row
		t.ensureRow(t.row)
	case 'H', 'f':
		row, col := parseCSICursor(params)"""
if "case 'G':" in src:
    print("claude_usage.go: CSI G already handled")
else:
    if src.count(old_case) != 1:
        sys.exit("claude_usage.go: applyCSI cursor case not found")
    src = src.replace(old_case, new_case)
    changed = True
    print("claude_usage.go: CSI G/d handling added")

if "func claudeUsageLooseContains" not in src:
    src = src.replace(
        '''func usageReady(screen string) bool {
	lower := strings.ToLower(screen)
	return strings.Contains(lower, "current session") &&
		strings.Contains(lower, "current week") &&
		strings.Contains(lower, "resets") &&
		claudeUsagePercentRe.MatchString(screen)
}''',
        '''func usageReady(screen string) bool {
	lower := strings.ToLower(screen)
	return claudeUsageLooseContains(lower, "current session") &&
		claudeUsageLooseContains(lower, "current week") &&
		claudeUsageLooseContains(lower, "resets") &&
		claudeUsagePercentRe.MatchString(screen)
}

// claudeUsageLooseContains reports whether needle appears in the (already
// lowercased) screen, ignoring whitespace differences. Terminal repainting can
// drop or add spacing between words, so an exact match is too brittle to gate
// the probe on.
func claudeUsageLooseContains(lowerScreen, lowerNeedle string) bool {
	if strings.Contains(lowerScreen, lowerNeedle) {
		return true
	}
	return strings.Contains(
		claudeUsageAnySpaceRe.ReplaceAllString(lowerScreen, ""),
		claudeUsageAnySpaceRe.ReplaceAllString(lowerNeedle, ""),
	)
}''')
    src = src.replace(
        '\tclaudeUsageRuleLineRe   = regexp.MustCompile(`^[\\p{Zs}\\-─━_=]{4,}$`)',
        '\tclaudeUsageRuleLineRe   = regexp.MustCompile(`^[\\p{Zs}\\-─━_=]{4,}$`)\n\tclaudeUsageAnySpaceRe   = regexp.MustCompile(`\\s+`)')
    old_prompt = '''	if strings.Contains(lower, "quick safety check") || strings.Contains(lower, "yes, i trust this folder") {
		return "\\r"
	}
	if (strings.Contains(lower, "telemetry") || strings.Contains(lower, "help improve") || strings.Contains(lower, "usage data")) &&
		(strings.Contains(lower, "2. no") || strings.Contains(lower, "2. disable") || strings.Contains(lower, "2. don't")) {
		return "\\x1b[B\\r"
	}
	if strings.Contains(lower, "enter to confirm") && !usageReady(lower) {
		return "\\r"
	}'''
    new_prompt = '''	if claudeUsageLooseContains(lower, "quick safety check") ||
		claudeUsageLooseContains(lower, "yes, i trust this folder") ||
		claudeUsageLooseContains(lower, "do you trust the files in this folder") {
		return "\\r"
	}
	if (claudeUsageLooseContains(lower, "telemetry") || claudeUsageLooseContains(lower, "help improve") || claudeUsageLooseContains(lower, "usage data")) &&
		(claudeUsageLooseContains(lower, "2. no") || claudeUsageLooseContains(lower, "2. disable") || claudeUsageLooseContains(lower, "2. don't")) {
		return "\\x1b[B\\r"
	}
	if claudeUsageLooseContains(lower, "enter to confirm") && !usageReady(lower) {
		return "\\r"
	}'''
    if src.count(old_prompt) != 1:
        sys.exit("claude_usage.go: promptActionForScreen body not found")
    src = src.replace(old_prompt, new_prompt)
    changed = True
    print("claude_usage.go: loose matching added")
else:
    print("claude_usage.go: loose matching already present")

old_scan = '''	start := -1
	headerLower := strings.ToLower(header)
	for i, line := range lines {
		lower := strings.ToLower(strings.TrimSpace(line))
		if strings.HasPrefix(lower, headerLower) {
			start = i
			break
		}
	}'''
new_scan = '''	start := -1
	headerLower := strings.ToLower(header)
	headerSquashed := claudeUsageAnySpaceRe.ReplaceAllString(headerLower, "")
	for i, line := range lines {
		lower := strings.ToLower(strings.TrimSpace(line))
		if strings.HasPrefix(lower, headerLower) ||
			strings.HasPrefix(claudeUsageAnySpaceRe.ReplaceAllString(lower, ""), headerSquashed) {
			start = i
			break
		}
	}'''
if "headerSquashed" in src:
    print("claude_usage.go: header scan already patched")
elif src.count(old_scan) == 1:
    src = src.replace(old_scan, new_scan)
    changed = True
    print("claude_usage.go: header scan made whitespace-insensitive")
else:
    sys.exit("claude_usage.go: window header scan not found")

if changed:
    f.write_text(src)
    print("done")
