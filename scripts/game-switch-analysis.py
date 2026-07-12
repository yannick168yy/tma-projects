#!/usr/bin/env python3
# 568Win 游戏开关筛选分析：对比 data/ 下 5 家竞品数据，产出关闭清单
# 输入:
#   our_games.tsv (从 bg_568win_game LEFT JOIN override 导出, 见 scripts/backfill 同目录说明)
#   data/provider-alias.json  厂商名归一化映射
#   data/{bingoplus,gzone,ptgaming,fbmplay,casinoplus}/games.csv
# 输出(输出目录由 argv[2] 指定):
#   report_summary.txt / closed_providers.csv / closed_games.csv
#   manual_confirm.csv / high_weight_not_in_comp.csv / close_game_ids.txt
# 用法: python3 scripts/game-switch-analysis.py <our_games.tsv> <outdir>
import csv, json, re, sys, os
from collections import defaultdict
from difflib import SequenceMatcher

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
our_tsv, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)

alias = json.load(open(os.path.join(DATA, 'provider-alias.json')))
COMP_ALIAS, OUR_ALIAS = alias['competitor'], alias['ours']
COMP_ALIAS_CI = {k.lower(): v for k, v in COMP_ALIAS.items()}
OUR_ALIAS_CI = {k.lower(): v for k, v in OUR_ALIAS.items()}
SPECIAL_KEEP = {k: v for k, v in alias['special_keep'].items() if not k.startswith('_')}

def norm_name(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())

# ---------- 竞品数据 ----------
comp_names_by_prov = defaultdict(set)   # canonical provider -> {norm_name}
comp_names_global = set()               # 全部竞品游戏名(含无厂商的), 仅用于"救活"
comp_providers = set()
comp_unmapped = defaultdict(int)

def feed(site, prov_raw, name):
    n = norm_name(name)
    if not n:
        return
    comp_names_global.add(n)
    prov_raw = (prov_raw or '').strip()
    if not prov_raw:
        return
    canon = COMP_ALIAS.get(prov_raw) or COMP_ALIAS_CI.get(prov_raw.lower())
    if canon is None:
        comp_unmapped[(site, prov_raw)] += 1
        return
    comp_providers.add(canon)
    comp_names_by_prov[canon].add(n)

for r in csv.DictReader(open(os.path.join(DATA, 'bingoplus/games.csv'))):
    feed('bingoplus', r['platformName'], r['gameName'])
for r in csv.DictReader(open(os.path.join(DATA, 'gzone/games.csv'))):
    feed('gzone', r['platformName'], r['name'])
for r in csv.DictReader(open(os.path.join(DATA, 'ptgaming/games.csv'))):
    feed('ptgaming', r['provider'], r['name'])
for r in csv.DictReader(open(os.path.join(DATA, 'fbmplay/games.csv'))):
    feed('fbmplay', r['provider'], r['name'])
for r in csv.DictReader(open(os.path.join(DATA, 'casinoplus/games.csv'))):
    feed('casinoplus', r['provider'], r['name'])

# ---------- 我方数据 ----------
ours = list(csv.DictReader(open(our_tsv, encoding='utf-8', errors='replace'),
                           delimiter='\t', quoting=csv.QUOTE_NONE))
our_unmapped = defaultdict(int)
for g in ours:
    p = g['provider'].strip()
    canon = OUR_ALIAS.get(p) or OUR_ALIAS_CI.get(p.lower())
    if canon is None and p not in ('', '0'):
        our_unmapped[p] += 1
    g['canon'] = canon if canon else ('__dirty__' if p in ('', '0') else '__unmapped__')
    g['rank'] = int(g['rank_no']) if g['rank_no'] else 9999
    g['eff_weight'] = int(g['ov_weight']) if g['ov_weight'] else max(1, 10000 - g['rank'])

def is_protected(g):
    """高权重=运营手工标记 featured / 手工权重>=8000 / 上游厂商内排名前10"""
    if g['ov_featured'] == '1':
        return True
    if g['ov_weight'] and int(g['ov_weight']) >= 8000:
        return True
    return g['rank'] <= 10

def comp_match(g):
    """返回 (matched:bool, how:str)"""
    n = norm_name(g['name_en'])
    if not n:
        return False, 'no_name'
    canon = g['canon']
    if n in comp_names_by_prov.get(canon, ()):  # 同厂精确
        return True, 'exact'
    if n in comp_names_global:                   # 跨厂/无厂救活
        return True, 'global'
    # 同厂模糊 (>=0.92)
    pool = comp_names_by_prov.get(canon, ())
    if pool and len(n) >= 6:
        for cn in pool:
            if abs(len(cn) - len(n)) <= 3 and SequenceMatcher(None, n, cn).ratio() >= 0.92:
                return True, 'fuzzy:' + cn
    return False, 'none'

closed_games = []     # (game, reason)
manual_confirm = []   # (game, reason)
kept = []
prov_close_stats = defaultdict(lambda: [0, 0])  # canon -> [close, total]

# 用户拍板(2026-07-12): 97家整厂全关(仅FunkyGames保留)、高权重豁免跟随规则关闭、
# 体育/斗鸡/彩票保留、无名厂商杂盘关闭
for g in ours:
    canon = g['canon']
    reasons = []
    if canon in SPECIAL_KEEP:
        kept.append((g, 'special:' + SPECIAL_KEEP[canon]))
        continue
    if canon in ('__dirty__', '__unmapped__'):
        closed_games.append((g, 'dirty_provider(%s)' % g['provider']))
        prov_close_stats[canon][0] += 1
        prov_close_stats[canon][1] += 1
        continue

    provider_absent = canon not in comp_providers
    if provider_absent:
        reasons.append('provider_absent')
    else:
        if g['site_cat'] == 'lobby':
            kept.append((g, 'lobby'))
            continue
        matched, how = comp_match(g)
        if not matched:
            reasons.append('game_absent')

    # 规则4: 币种/设备 (上游 is_enabled=0/维护中运行时已隐藏,不写 override)
    if g['php_ok'] == '0' and g['usd_ok'] == '0':
        reasons.append('no_php_usd')
    if g['device'] == 'd':
        reasons.append('desktop_only')

    if not reasons:
        kept.append((g, 'match'))
        continue

    if is_protected(g):
        manual_confirm.append((g, 'closed_high_weight:' + '+'.join(reasons)))  # 已关,仅提示
    closed_games.append((g, '+'.join(reasons)))
    prov_close_stats[canon][0] += 1
    prov_close_stats[canon][1] += 1

# ---------- 我方权重高但竞品未开放(提示清单, 不影响动作) ----------
high_not_in_comp = []
for g in ours:
    if g['canon'] in SPECIAL_KEEP or g['canon'].startswith('__') or g['canon'] == '568win':
        continue
    if not is_protected(g):
        continue
    if g['canon'] not in comp_providers:
        high_not_in_comp.append((g, 'provider_absent'))
    else:
        matched, how = comp_match(g)
        if not matched:
            high_not_in_comp.append((g, 'game_absent'))

# ---------- 输出 ----------
def dump(path, rows):
    with open(os.path.join(outdir, path), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['game_id', 'game_provider_id', 'provider', 'name_en', 'site_cat',
                    'eff_weight', 'ov_weight', 'ov_featured', 'is_enabled', 'device', 'reason'])
        for g, reason in sorted(rows, key=lambda x: -x[0]['eff_weight']):
            w.writerow([g['game_id'], g['game_provider_id'], g['provider'], g['name_en'],
                        g['site_cat'], g['eff_weight'], g['ov_weight'], g['ov_featured'],
                        g['is_enabled'], g['device'], reason])

dump('closed_games.csv', closed_games)
dump('manual_confirm.csv', manual_confirm)
dump('high_weight_not_in_comp.csv', high_not_in_comp)

with open(os.path.join(outdir, 'close_game_ids.txt'), 'w') as f:
    for g, _ in closed_games:
        f.write('%s\t%s\n' % (g['game_provider_id'], g['game_id']))

# 整厂关闭清单 = 该厂全部游戏都进了 closed
full_close_provs = []
by_canon_total = defaultdict(int)
for g in ours:
    by_canon_total[g['canon']] += 1
for canon, (c, t) in sorted(prov_close_stats.items(), key=lambda x: -x[1][0]):
    if canon not in comp_providers and c > 0:
        full_close_provs.append((canon, c, by_canon_total[canon]))
with open(os.path.join(outdir, 'closed_providers.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['canonical', 'closed_games', 'total_games'])
    for row in full_close_provs:
        w.writerow(row)

with open(os.path.join(outdir, 'report_summary.txt'), 'w') as f:
    def p(*a):
        print(*a, file=f)
    p('我方总游戏数:', len(ours))
    p('保留:', len(kept), ' 关闭:', len(closed_games), ' 其中高权重被关(提示):', len(manual_confirm))
    p('竞品厂商(canonical) %d 个:' % len(comp_providers), sorted(comp_providers))
    p('\n竞品未映射厂商名(忽略):', dict(comp_unmapped))
    p('我方未映射厂商名(进人工确认):', dict(our_unmapped))
    p('\n整厂关闭 %d 家:' % len(full_close_provs))
    for canon, c, t in full_close_provs:
        p('  %-20s 关%d/共%d' % (canon, c, t))
    p('\n游戏级关闭(竞品有该厂但没这款):')
    game_level = defaultdict(int)
    for g, r in closed_games:
        if 'game_absent' in r:
            game_level[g['canon']] += 1
    for canon, c in sorted(game_level.items(), key=lambda x: -x[1]):
        p('  %-20s %d/%d' % (canon, c, by_canon_total[canon]))
    rule4 = [1 for _, r in closed_games if 'no_php_usd' in r or 'desktop_only' in r]
    p('\n规则4(币种/设备)命中:', len(rule4))
    p('无名厂商杂盘关闭:', len([1 for _, r in closed_games if r.startswith('dirty_provider')]))
    p('特殊保留(568win/funkygames/体育斗鸡彩票):', len([1 for _, r in kept if r.startswith('special')]))
    p('高权重但竞品未开放(提示清单):', len(high_not_in_comp))
    p('保护定义: featured / 手工weight>=8000 / 厂商内rank<=10')

# ---------- 生成执行SQL(手动执行,不进迁移) ----------
today = '20260712'
with open(os.path.join(outdir, 'close_override.sql'), 'w') as f:
    f.write('-- 568Win 游戏开关筛选：本地关闭 %d 款（手动执行，不自动部署）\n' % len(closed_games))
    f.write('-- 依据 data/game-switch-review/ 清单，用户已确认。回滚用 rollback_override.sql\n')
    f.write('CREATE TABLE IF NOT EXISTS bg_568win_game_override_bak_%s AS SELECT * FROM bg_568win_game_override;\n\n' % today)
    pairs = [(g['game_provider_id'], g['game_id']) for g, _ in closed_games]
    for i in range(0, len(pairs), 500):
        chunk = pairs[i:i + 500]
        f.write('INSERT INTO bg_568win_game_override (game_provider_id, game_id, is_active) VALUES\n')
        f.write(',\n'.join('(%s,%s,0)' % pr for pr in chunk))
        f.write('\nON DUPLICATE KEY UPDATE is_active = 0;\n\n')
    f.write("SELECT CONCAT('closed=', COUNT(*)) FROM bg_568win_game_override WHERE is_active = 0;\n")
with open(os.path.join(outdir, 'rollback_override.sql'), 'w') as f:
    f.write('-- 回滚：is_active 还原到备份时状态（本次新插入的行还原为 NULL=跟随上游）\n')
    f.write('UPDATE bg_568win_game_override o\n'
            'LEFT JOIN bg_568win_game_override_bak_%s b USING (game_provider_id, game_id)\n'
            'SET o.is_active = b.is_active\n'
            'WHERE o.is_active = 0;\n' % today)

print('done. closed=%d manual=%d kept=%d' % (len(closed_games), len(manual_confirm), len(kept)))
