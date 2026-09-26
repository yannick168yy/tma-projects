-- 237: 统一 236 两个同号迁移留下的 cs_faq.market 归属。
-- 236_cs_faq_market_india（加 market 列并回填）与 236_seed_high_frequency_cs_knowledge（补高频问答）
-- 在测试机与生产的执行先后不同：测试机上 seed 先跑，其英文条目被回填成 PH；生产按文件名排序
-- market_india 先跑，seed 的条目全部落成 NULL。这里按内容本意对齐两边：
-- 高频英文问答是各市场通用内容 → NULL；印地语只服务印度 → IN。
UPDATE `cs_faq` SET `market` = NULL
WHERE `lang` = 'en' AND `question` IN (
  'My withdrawal failed or was rejected. What should I do?',
  'Why can I not submit another withdrawal while one is pending?',
  'Why does my withdrawal amount look different?',
  'What are the requirements for uploading an ID?',
  'How can I pass face verification?',
  'What should I do if phone or OTP verification fails?',
  'How do I talk to a human agent and follow up on my ticket?'
);

UPDATE `cs_faq` SET `market` = 'IN' WHERE `lang` = 'hi' AND `market` IS NULL;
