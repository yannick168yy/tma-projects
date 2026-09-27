# 印度市场游戏初始权重

不依赖 Gemini 或其他模型 API。原始证据位于 `data/india-market/evidence.csv`，运行：

```bash
node scripts/india-market-research/build-initial-weights.mjs
```

输出位于 `scripts/india-market-research/output/`：

- `matched.csv`：已与 568Win 目录按游戏名和厂商匹配，可作为 INR 初始权重候选。
- `ambiguous.csv`：同名、多厂商或厂商不符，必须人工确认。
- `gaps.csv`：印度资料中有热度、我方目录未找到。
- `provider-score.csv`：从已匹配头部游戏反推的厂商初始权重。
- `report.md`：评分方法、数量和头部结果。

脚本不会连接数据库或写入运营配置。
