# 固定图片多语言目录

固定宣传图按语言放入子目录，前台会根据当前语言自动选择；对应语言缺图时回退现有英文图片。

印尼语图片目录为 `id/`，文件名必须保持如下：

- `cash-rebate-banner.webp`：首页 Cash Rebate 广告图
- `loss-rebate-banner.webp`：首页 Loss Rebate 广告图
- `bonuses-hero.webp`：Bonuses 页 Hero 图
- `task-hero.webp`：Tasks 页 Hero 图
- `rebate-hero.webp`：Rebate 页 Hero 图
- `team-hero.webp`：Team 页 Hero 图
- `3-circle-structure.webp`：Referral / Team 页 3-Circle 结构插图
- `game-loading.webp`：App 启动画面与游戏加载画面

越南语和中文分别使用 `vi/`、`zh-CN/` 目录，文件名相同。替换图片后重新构建、部署 `web-tma` 即可，不需要修改代码。

首页轮播 Banner 和钱包广告图不放在此目录，通过管理后台“首页装修”按站点上传（站点 = 后台“站点域名映射”里的所属站点），未单独上传的站点显示默认图片。
