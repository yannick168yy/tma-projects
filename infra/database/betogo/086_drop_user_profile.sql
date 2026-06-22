-- 086: 移除"个人信息/资料"业务——前后台不再维护 first_name/last_name/gender/dob 等资料字段。
-- 实名认证(bg_kyc)是独立业务，不受影响；email 保留在 bg_user.email。
-- 迁移按 schema_migrations 记录只执行一次，DROP 不会重跑清数据。
DROP TABLE IF EXISTS bg_user_profile;
