# 体育首页封面

这组原创方形封面通过现有游戏换图机制覆盖菲律宾站和印度站首页的体育入口。

## 对应关系

- 菲律宾：568Win Sports → 网球；Lucky Sports Basketball → 篮球；AFB Sports → 足球。
- 印度：Panda Sports → 板球；BTi Sports → 篮球；Saba Sports → 足球。

图片为 600×600 WebP，不含文字、品牌标识或真实明星肖像。文件名带版本号，避免浏览器一年期 immutable 缓存导致后续换图不生效。

`apply_overrides.sql` 是一次性配置脚本，不属于数据库迁移。它会同时设置当前封面，并把 6 张图登记到后台“更换封面”的候选图库。执行前需把 `assets/` 上传到服务端存储目录的 `covers/sports/` 子目录，执行后刷新游戏缓存。
