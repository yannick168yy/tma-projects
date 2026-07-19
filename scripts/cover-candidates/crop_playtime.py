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

# 传入的 im 必须已转 RGBA（含 P/LA 等带透明的调色板模式，之前漏转导致未裁切）
def opaque_bbox(ims):
    x0 = y0 = 10**9; x1 = y1 = -1
    W, H = ims[0].size
    for im in ims:
        a = np.array(im.split()[3]); ys, xs = np.where(a >= THR)
        if len(xs) == 0: continue
        x0 = min(x0, xs.min()); y0 = min(y0, ys.min()); x1 = max(x1, xs.max()+1); y1 = max(y1, ys.max()+1)
    if x1 < 0: return (0, 0, W, H)
    return (int(x0), int(y0), int(x1), int(y1))

OVERCROP = 0.03  # 裁到不透明 bbox 后每边再内缩 3%，切掉 playtime 图自带的薄金框(~4px)

def square_box(W, H, bb, ov=OVERCROP):
    x0, y0, x1, y1 = bb
    cx, cy = (x0+x1)/2, (y0+y1)/2; half = max(x1-x0, y1-y0)/2
    l, t, r, b = int(cx-half), int(cy-half), int(cx+half), int(cy+half)
    if l < 0: r -= l; l = 0
    if t < 0: b -= t; t = 0
    if r > W: l -= (r-W); r = W
    if b > H: t -= (b-H); b = H
    l, t = max(0, l), max(0, t)
    pad = int((r-l) * ov)  # 内缩去金框
    return (l+pad, t+pad, r-pad, b-pad)

# ── 静图 ──
# 输入=cover_matches.json 匹配到的 basename（git 稳定）→ data/ptgaming/images 原图
# 输出到 data/ptgaming/ 下，避开 data/cover-candidates/（build.mjs 开头会 rmSync 整个目录，多会话冲突）
src_images = f'{ROOT}/data/ptgaming/images'
out_static = f'{ROOT}/data/ptgaming/covers_crop'
matches = json.load(open(f'{ROOT}/scripts/ptgaming-crawler/cover_matches.json'))
basenames = sorted({m['basename'] for m in matches})
shutil.rmtree(out_static, ignore_errors=True); os.makedirs(out_static)
cropped = copied = missing = 0
for f in basenames:
    p = os.path.join(src_images, f)
    if not os.path.exists(p):
        missing += 1; continue
    try:
        im = Image.open(p)
    except Exception:
        shutil.copyfile(p, os.path.join(out_static, f)); copied += 1; continue
    W, H = im.size
    rgba = im.convert('RGBA')  # P/LA/RGB 统一转 RGBA 再判透明边（修：旧版只认 RGBA 漏裁调色板图）
    x0, y0, x1, y1 = opaque_bbox([rgba])
    l, t, r, b = square_box(W, H, (x0, y0, x1, y1))  # 含 3% 过裁去金框
    out = rgba.crop((l, t, r, b))
    if f.lower().endswith(('.jpg', '.jpeg')):  # JPEG 不支持 alpha
        out = out.convert('RGB')
    out.save(os.path.join(out_static, f))
    cropped += 1
print(f'静图: 裁剪 {cropped}, 源缺失 {missing} / 共 {len(basenames)}')

# ── 动图 ──
anim = json.load(open(f'{ROOT}/scripts/ptgaming-crawler/anim_cover_matches.json'))
# webp 名 → 原始游戏 id（帧目录名）。anim_cover_matches.basename 形如 Provider__Name__ID.png
def game_id(basename):
    return basename.rsplit('__', 1)[1].rsplit('.', 1)[0]

out_anim = f'{ROOT}/data/ptgaming/anim_covers_crop'
shutil.rmtree(out_anim, ignore_errors=True); os.makedirs(out_anim)
tmp = f'{ROOT}/data/ptgaming/_anim_crop_tmp'
built = 0
for a in anim:
    gid = game_id(a['basename']); webp = a['webp']
    fdir = f'{ROOT}/data/ptgaming/anim_frames/{gid}'
    if not os.path.isdir(fdir):
        print(f'  缺帧目录 {gid} ({webp})'); continue
    frames = sorted(f for f in os.listdir(fdir) if f.endswith('.png'))
    ims = [Image.open(os.path.join(fdir, f)).convert('RGBA') for f in frames]
    x0, y0, x1, y1 = opaque_bbox(ims)
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
