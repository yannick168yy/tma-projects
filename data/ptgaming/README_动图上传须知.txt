游戏卡片「动图封面」上传须知（务必先读）

✅ 唯一正确的动图源目录 = anim_covers_crop/
   - 尺寸 235×235（已裁掉四周透明边/金框），51 个，与数据库 anim_url 一一对应。
   - 上传到服务器（测试/生产）只能 rsync 这个目录到 data/kyc/covers/ptgaming-anim/。

❌ 以下目录都是「裁剪前」版本（232×235，带透明边，看着像没裁），已加「裁剪前_勿上传」前缀，切勿上传：
   - 裁剪前_勿上传_anim_covers/
   - 裁剪前_勿上传_anim_covers_upload/     ← 名字虽叫 upload，但装的是裁剪前！历史上就是它被误传导致线上动图变回裁剪前。
   - ../cover-candidates/裁剪前_勿上传_ptgaming-anim/

⚠️ 重要缓存知识（2026-07-23 踩坑）：
   - 封面走 Cache-Control: immutable（一年），且生产在 CloudFront 后面。
   - CloudFront 忽略 URL 的 ?v=/?cv= 参数 —— 改 query 只能刷浏览器，刷不动 CloudFront。
   - 重传/换图后，必须做 CloudFront 失效才能让全球用户看到新图：
       aws cloudfront create-invalidation --distribution-id ENTJ98VOUI5PZ --paths "/api/v1/home/images/covers/ptgaming-anim/*"
       aws cloudfront create-invalidation --distribution-id E4XUGLTOG2JQ --paths "/api/v1/home/images/covers/ptgaming-anim/*"
     （ENTJ98VOUI5PZ=betogo.games 主域，E4XUGLTOG2JQ=betogo.app/vip/ph 等镜像域）

生成裁剪版的脚本：scripts/cover-candidates/crop_playtime.py
