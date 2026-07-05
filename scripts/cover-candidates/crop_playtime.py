#!/usr/bin/env python3
# 裁剪 playtime 封面的透明边距，使内容满幅（金框/画面贴边），与 568win 满幅图对齐。
# 静图：裁到不透明 bbox 补正方形（已满幅/无 alpha 的原样复制）
# 动图：对每款帧序列取并集 bbox 补正方形裁所有帧，缩放后由 img2webp 重新合成（保留动画）
# 输出：data/cover-candidates/ptgaming_crop/ + ptgaming-anim_crop/（覆盖上传服务器）
import os, sys, json, subprocess, shutil
from PIL import Image
import numpy as np

ROOT = '/Users/yannicky/tma-projects'
THR = 200  # 不透明阈值（金框/画面为实心，透明边距+阴影 < 200）

def opaque_bbox(ims):
    x0 = y0 = 10**9; x1 = y1 = -1
    for im in ims:
        if im.mode != 'RGBA':
            return (0, 0, im.size[0], im.size[1], False)  # 无 alpha = 满幅
        a = np.array(im.split()[3]); ys, xs = np.where(a >= THR)
        if len(xs) == 0: continue
        x0 = min(x0, xs.min()); y0 = min(y0, ys.min()); x1 = max(x1, xs.max()+1); y1 = max(y1, ys.max()+1)
    if x1 < 0: return (0, 0, ims[0].size[0], ims[0].size[1], False)
    return (int(x0), int(y0), int(x1), int(y1), True)

def square_box(W, H, bb):
    x0, y0, x1, y1 = bb
    cx, cy = (x0+x1)/2, (y0+y1)/2; half = max(x1-x0, y1-y0)/2
    l, t, r, b = int(cx-half), int(cy-half), int(cx+half), int(cy+half)
    if l < 0: r -= l; l = 0
    if t < 0: b -= t; t = 0
    if r > W: l -= (r-W); r = W
    if b > H: t -= (b-H); b = H
    return (max(0, l), max(0, t), r, b)

# ── 静图 ──
src_static = f'{ROOT}/data/cover-candidates/ptgaming'
out_static = f'{ROOT}/data/cover-candidates/ptgaming_crop'
shutil.rmtree(out_static, ignore_errors=True); os.makedirs(out_static)
cropped = copied = 0
for f in os.listdir(src_static):
    p = os.path.join(src_static, f)
    try:
        im = Image.open(p)
    except Exception:
        shutil.copyfile(p, os.path.join(out_static, f)); copied += 1; continue
    W, H = im.size
    x0, y0, x1, y1, has_alpha = opaque_bbox([im.convert('RGBA')]) if im.mode == 'RGBA' else (0, 0, W, H, False)
    occ = max((x1-x0)/W, (y1-y0)/H)
    if not has_alpha or occ >= 0.98:  # 已满幅，原样保留（避免无意义裁切损失）
        shutil.copyfile(p, os.path.join(out_static, f)); copied += 1; continue
    l, t, r, b = square_box(W, H, (x0, y0, x1, y1))
    im.convert('RGBA').crop((l, t, r, b)).save(os.path.join(out_static, f))
    cropped += 1
print(f'静图: 裁剪 {cropped}, 原样 {copied}')

# ── 动图 ──
anim = json.load(open(f'{ROOT}/scripts/ptgaming-crawler/anim_cover_matches.json'))
# webp 名 → 原始游戏 id（帧目录名）。anim_cover_matches.basename 形如 Provider__Name__ID.png
def game_id(basename):
    return basename.rsplit('__', 1)[1].rsplit('.', 1)[0]

out_anim = f'{ROOT}/data/cover-candidates/ptgaming-anim_crop'
shutil.rmtree(out_anim, ignore_errors=True); os.makedirs(out_anim)
tmp = f'{ROOT}/data/cover-candidates/_anim_tmp'
built = 0
for a in anim:
    gid = game_id(a['basename']); webp = a['webp']
    fdir = f'{ROOT}/data/ptgaming/anim_frames/{gid}'
    if not os.path.isdir(fdir):
        print(f'  缺帧目录 {gid} ({webp})'); continue
    frames = sorted(f for f in os.listdir(fdir) if f.endswith('.png'))
    ims = [Image.open(os.path.join(fdir, f)).convert('RGBA') for f in frames]
    x0, y0, x1, y1, _ = opaque_bbox(ims)
    l, t, r, b = square_box(ims[0].size[0], ims[0].size[1], (x0, y0, x1, y1))
    gtmp = os.path.join(tmp, gid); shutil.rmtree(gtmp, ignore_errors=True); os.makedirs(gtmp)
    for f, im in zip(frames, ims):
        im.crop((l, t, r, b)).resize((235, 235), Image.LANCZOS).save(os.path.join(gtmp, f))
    frame_paths = [os.path.join(gtmp, f) for f in frames]
    subprocess.run(['img2webp', '-loop', '0', '-lossy', '-q', '60', '-d', '100', *frame_paths,
                    '-o', os.path.join(out_anim, webp)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    built += 1
shutil.rmtree(tmp, ignore_errors=True)
print(f'动图: 重新合成 {built}/{len(anim)}')
