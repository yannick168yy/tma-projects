-- 手动执行：清空所有实名认证记录（含证件提交历史）
-- 用法:
--   podman exec -i tma-mysql mysql -u"$DB_USER" -p"$DB_PASS" betogo < scripts/clear-all-kyc.sql
-- 影像文件需配合 scripts/clear-all-kyc.sh 一并清理 data/kyc 目录

SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM bg_kyc_doc_log;
DELETE FROM bg_kyc_submission;
DELETE FROM bg_kyc;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'bg_kyc' AS tbl, COUNT(*) AS remaining FROM bg_kyc
UNION ALL SELECT 'bg_kyc_doc_log', COUNT(*) FROM bg_kyc_doc_log
UNION ALL SELECT 'bg_kyc_submission', COUNT(*) FROM bg_kyc_submission;
