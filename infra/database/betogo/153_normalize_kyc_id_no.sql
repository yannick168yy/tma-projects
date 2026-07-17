-- 153: 存量证件号归一化(去分隔符只留字母数字+大写),与新提交口径一致,保证跨格式查重命中
UPDATE `bg_kyc`
SET `extracted_id_no` = UPPER(REGEXP_REPLACE(`extracted_id_no`, '[^A-Za-z0-9]', ''))
WHERE `extracted_id_no` IS NOT NULL;
