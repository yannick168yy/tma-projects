-- 129: 补全当前数据库缺失的中文表注释和字段注释
--
-- 说明：
-- 1. 只处理 information_schema 中 TABLE_COMMENT / COLUMN_COMMENT 为空的对象。
-- 2. 字段通过 MODIFY COLUMN 补 COMMENT，字段类型、默认值、AUTO_INCREMENT、ON UPDATE 保持现状。
-- 3. 不写入、不删除任何业务数据。

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS `__migrate_129`;
DELIMITER $$
CREATE PROCEDURE `__migrate_129`()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_table VARCHAR(128);
  DECLARE v_comment VARCHAR(255);
  DECLARE v_column VARCHAR(128);
  DECLARE v_definition TEXT;
  DECLARE v_sql TEXT;

  DECLARE table_cur CURSOR FOR
    SELECT t.TABLE_NAME,
      CASE t.TABLE_NAME
        WHEN 'bg_app_download_claim' THEN 'APP 下载奖励领取记录'
        WHEN 'bg_home_content' THEN '首页运营内容配置'
        WHEN 'payment_channel_rules' THEN '支付渠道路由规则'
        WHEN 'payment_channels' THEN '支付渠道配置'
        WHEN 'provider_balance_snapshot' THEN '支付服务商余额快照'
        WHEN 'provider_balance_snapshot_history' THEN '支付服务商余额快照历史'
        WHEN 'schema_migrations' THEN '数据库迁移执行记录'
        ELSE CONCAT('业务表：', t.TABLE_NAME)
      END AS table_comment
    FROM information_schema.TABLES t
    WHERE t.TABLE_SCHEMA = DATABASE()
      AND COALESCE(t.TABLE_COMMENT, '') = '';

  DECLARE column_cur CURSOR FOR
    SELECT c.TABLE_NAME,
      c.COLUMN_NAME,
      CONCAT(
        c.COLUMN_TYPE,
        IF(c.CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET ', c.CHARACTER_SET_NAME, ' COLLATE ', c.COLLATION_NAME)),
        IF(c.IS_NULLABLE = 'NO', ' NOT NULL', ' NULL'),
        CASE
          WHEN c.EXTRA LIKE '%auto_increment%' THEN ''
          WHEN c.COLUMN_DEFAULT IS NULL THEN ''
          WHEN UPPER(c.COLUMN_DEFAULT) LIKE 'CURRENT_TIMESTAMP%' THEN CONCAT(' DEFAULT ', c.COLUMN_DEFAULT)
          ELSE CONCAT(' DEFAULT ', QUOTE(c.COLUMN_DEFAULT))
        END,
        CASE
          WHEN c.EXTRA LIKE '%on update%' THEN CONCAT(' ON UPDATE ', SUBSTRING_INDEX(c.EXTRA, 'on update ', -1))
          ELSE ''
        END,
        IF(c.EXTRA LIKE '%auto_increment%', ' AUTO_INCREMENT', ''),
        ' COMMENT ',
        QUOTE(
          CASE
            WHEN c.TABLE_NAME = 'schema_migrations' AND c.COLUMN_NAME = 'version' THEN '迁移版本号'
            WHEN c.TABLE_NAME = 'schema_migrations' AND c.COLUMN_NAME = 'executed_at' THEN '迁移执行时间'
            WHEN c.TABLE_NAME = 'bg_568win_agent' AND c.COLUMN_NAME = 'min_bet' THEN '568Win Agent 最小投注额'
            WHEN c.TABLE_NAME = 'bg_568win_agent' AND c.COLUMN_NAME = 'max_bet' THEN '568Win Agent 最大投注额'
            WHEN c.TABLE_NAME = 'bg_568win_agent' AND c.COLUMN_NAME = 'max_bet_per_match' THEN '568Win Agent 单场最大投注额'
            WHEN c.TABLE_NAME = 'bg_568win_agent' AND c.COLUMN_NAME = 'casino_table_limit' THEN '568Win 真人桌台限额等级'
            WHEN c.TABLE_NAME = 'bg_568win_report_bet' AND c.COLUMN_NAME = 'raw_bet' THEN '568Win 注单原始 JSON'
            WHEN c.TABLE_NAME = 'bg_568win_report_bet' AND c.COLUMN_NAME = 'raw_response' THEN '568Win 报表响应原文'
            WHEN c.TABLE_NAME = 'bg_568win_wallet_txn' AND c.COLUMN_NAME = 'raw_request' THEN '568Win 钱包回调原始请求'
            WHEN c.TABLE_NAME = 'bg_app_download_claim' AND c.COLUMN_NAME = 'user_agent' THEN '领取时浏览器 User-Agent'
            WHEN c.TABLE_NAME = 'bg_app_download_claim' AND c.COLUMN_NAME = 'ip' THEN '领取时 IP 地址'
            WHEN c.TABLE_NAME = 'bg_home_content' AND c.COLUMN_NAME = 'kind' THEN '内容类型：banner/card/wallet_banner'
            WHEN c.TABLE_NAME = 'bg_home_content' AND c.COLUMN_NAME = 'slot' THEN '展示槽位序号'
            WHEN c.TABLE_NAME = 'bg_home_content' AND c.COLUMN_NAME = 'image_key' THEN '图片资源键'
            WHEN c.TABLE_NAME = 'bg_home_content' AND c.COLUMN_NAME = 'action_type' THEN '点击动作类型'
            WHEN c.TABLE_NAME = 'bg_home_content' AND c.COLUMN_NAME = 'action_value' THEN '点击动作参数'
            WHEN c.TABLE_NAME = 'bg_home_content' AND c.COLUMN_NAME = 'value_text' THEN '卡片数值文案'
            WHEN c.TABLE_NAME = 'bg_home_content' AND c.COLUMN_NAME = 'label_text' THEN '卡片标签文案'
            WHEN c.TABLE_NAME = 'payment_channels' AND c.COLUMN_NAME = 'deposit_fee_value' THEN '充值手续费数值'
            WHEN c.TABLE_NAME = 'payment_channels' AND c.COLUMN_NAME = 'withdraw_fee_type' THEN '提现手续费类型'
            WHEN c.TABLE_NAME = 'payment_channels' AND c.COLUMN_NAME = 'withdraw_fee_value' THEN '提现手续费数值'
            WHEN c.TABLE_NAME = 'payment_channel_rules' AND c.COLUMN_NAME = 'tx_type' THEN '适用交易类型：充值/提现/两者'
            WHEN c.TABLE_NAME = 'provider_balance_snapshot' AND c.COLUMN_NAME = 'error_msg' THEN '余额查询错误信息'
            WHEN c.TABLE_NAME = 'provider_balance_snapshot_history' AND c.COLUMN_NAME = 'raw_response' THEN '服务商余额原始响应'
            WHEN c.COLUMN_NAME = 'id' THEN '自增主键'
            WHEN c.COLUMN_NAME = 'user_id' THEN '关联用户 ID'
            WHEN c.COLUMN_NAME = 'agent_id' THEN '关联渠道代理 ID'
            WHEN c.COLUMN_NAME = 'provider' THEN '服务商或供应商代码'
            WHEN c.COLUMN_NAME = 'provider_id' THEN '供应商 ID'
            WHEN c.COLUMN_NAME = 'game_provider_id' THEN '游戏供应商 ID'
            WHEN c.COLUMN_NAME = 'game_id' THEN '游戏 ID'
            WHEN c.COLUMN_NAME = 'portfolio' THEN '568Win 产品组合'
            WHEN c.COLUMN_NAME = 'ref_no' THEN '568Win 注单编号'
            WHEN c.COLUMN_NAME = 'external_username' THEN '外部游戏平台用户名'
            WHEN c.COLUMN_NAME = 'currency' THEN '币种代码'
            WHEN c.COLUMN_NAME = 'currency_code' THEN '币种代码'
            WHEN c.COLUMN_NAME = 'status' THEN '业务状态'
            WHEN c.COLUMN_NAME = 'enabled' THEN '是否启用'
            WHEN c.COLUMN_NAME = 'remark' THEN '备注'
            WHEN c.COLUMN_NAME = 'created_by' THEN '创建管理员 ID'
            WHEN c.COLUMN_NAME = 'created_at' THEN '创建时间'
            WHEN c.COLUMN_NAME = 'updated_at' THEN '更新时间'
            WHEN c.COLUMN_NAME = 'paid_at' THEN '支付时间'
            WHEN c.COLUMN_NAME = 'settled_at' THEN '结算时间'
            WHEN c.COLUMN_NAME = 'calculated_at' THEN '计算时间'
            WHEN c.COLUMN_NAME = 'fetched_at' THEN '抓取时间'
            WHEN c.COLUMN_NAME = 'reviewed_at' THEN '审核时间'
            WHEN c.COLUMN_NAME = 'submitted_at' THEN '提交时间'
            WHEN c.COLUMN_NAME = 'doc_submitted_at' THEN '证件提交时间'
            WHEN c.COLUMN_NAME = 'face_submitted_at' THEN '人脸提交时间'
            WHEN c.COLUMN_NAME = 'bound_at' THEN '绑定时间'
            WHEN c.COLUMN_NAME = 'last_launched_at' THEN '最后启动时间'
            WHEN c.COLUMN_NAME = 'order_time' THEN '下注时间'
            WHEN c.COLUMN_NAME = 'settle_time' THEN '结算时间'
            WHEN c.COLUMN_NAME = 'win_lost_date' THEN '输赢归属日期'
            WHEN c.COLUMN_NAME = 'modify_date' THEN '上游修改时间'
            WHEN c.COLUMN_NAME = 'voided_at' THEN '作废时间'
            WHEN c.COLUMN_NAME = 'order_id' THEN '订单号'
            WHEN c.COLUMN_NAME = 'merchant_order_no' THEN '商户订单号'
            WHEN c.COLUMN_NAME = 'channel' THEN '通道代码'
            WHEN c.COLUMN_NAME = 'channel_id' THEN '支付渠道 ID'
            WHEN c.COLUMN_NAME = 'chain' THEN '链网络'
            WHEN c.COLUMN_NAME = 'tx_hash' THEN '链上交易哈希'
            WHEN c.COLUMN_NAME = 'from_address' THEN '付款地址'
            WHEN c.COLUMN_NAME = 'to_address' THEN '收款地址'
            WHEN c.COLUMN_NAME = 'amount' THEN '金额'
            WHEN c.COLUMN_NAME = 'balance' THEN '余额'
            WHEN c.COLUMN_NAME = 'frozen' THEN '冻结金额'
            WHEN c.COLUMN_NAME = 'available' THEN '可用余额'
            WHEN c.COLUMN_NAME = 'version' THEN '乐观锁版本号'
            WHEN c.COLUMN_NAME = 'credited' THEN '是否已入账'
            WHEN c.COLUMN_NAME = 'refunded' THEN '是否已退款'
            WHEN c.COLUMN_NAME = 'extra' THEN '扩展数据 JSON'
            WHEN c.COLUMN_NAME = 'extra_data' THEN '扩展数据 JSON'
            WHEN c.COLUMN_NAME = 'raw_response' THEN '原始响应 JSON'
            WHEN c.COLUMN_NAME = 'raw_request' THEN '原始请求 JSON'
            WHEN c.COLUMN_NAME = 'response_snapshot' THEN '响应快照 JSON'
            WHEN c.COLUMN_NAME = 'product_type' THEN '产品类型'
            WHEN c.COLUMN_NAME = 'game_type' THEN '游戏类型'
            WHEN c.COLUMN_NAME = 'gpid' THEN '游戏供应商产品 ID'
            WHEN c.COLUMN_NAME = 'round_id' THEN '游戏局号'
            WHEN c.COLUMN_NAME = 'txn_type' THEN '交易类型'
            WHEN c.COLUMN_NAME = 'transaction_id' THEN '交易流水号'
            WHEN c.COLUMN_NAME = 'stake' THEN '投注金额'
            WHEN c.COLUMN_NAME = 'win_lost' THEN '输赢金额'
            WHEN c.COLUMN_NAME = 'bet_cents' THEN '投注金额（分）'
            WHEN c.COLUMN_NAME = 'win_cents' THEN '派彩金额（分）'
            WHEN c.COLUMN_NAME = 'turnover_cents' THEN '有效流水金额（分）'
            WHEN c.COLUMN_NAME = 'php_equivalent_cents' THEN '折算 PHP 金额（分）'
            WHEN c.COLUMN_NAME = 'fx_rate' THEN '汇率'
            WHEN c.COLUMN_NAME = 'currency_breakdown' THEN '分币种明细 JSON'
            WHEN c.COLUMN_NAME = 'rate_pct' THEN '费率百分比'
            WHEN c.COLUMN_NAME = 'commission_cents' THEN '佣金金额（分）'
            WHEN c.COLUMN_NAME = 'min_bet' THEN '最小投注额'
            WHEN c.COLUMN_NAME = 'max_bet' THEN '最大投注额'
            WHEN c.COLUMN_NAME = 'max_bet_per_match' THEN '单场最大投注额'
            WHEN c.COLUMN_NAME = 'launch_count' THEN '启动次数'
            WHEN c.COLUMN_NAME = 'sort_category' THEN '前端分类'
            WHEN c.COLUMN_NAME = 'sort_order' THEN '排序权重'
            WHEN c.COLUMN_NAME = 'weight' THEN '权重'
            WHEN c.COLUMN_NAME = 'rule_id' THEN '规则 ID'
            WHEN c.COLUMN_NAME = 'rule_code' THEN '规则代码'
            WHEN c.COLUMN_NAME = 'verdict' THEN '审核结论'
            WHEN c.COLUMN_NAME = 'actual_value' THEN '规则实际值'
            WHEN c.COLUMN_NAME = 'threshold' THEN '阈值'
            WHEN c.COLUMN_NAME = 'detail' THEN '明细 JSON'
            WHEN c.COLUMN_NAME = 'reason' THEN '原因'
            WHEN c.COLUMN_NAME = 'reject_reason' THEN '拒绝原因'
            WHEN c.COLUMN_NAME = 'reviewer' THEN '审核人'
            WHEN c.COLUMN_NAME = 'note' THEN '审核备注'
            WHEN c.COLUMN_NAME = 'type' THEN '类型'
            WHEN c.COLUMN_NAME = 'source' THEN '来源'
            WHEN c.COLUMN_NAME = 'source_type' THEN '来源类型'
            WHEN c.COLUMN_NAME = 'source_ref' THEN '来源关联 ID'
            WHEN c.COLUMN_NAME = 'source_order_id' THEN '来源订单号'
            WHEN c.COLUMN_NAME = 'log_id' THEN '流水日志 ID'
            WHEN c.COLUMN_NAME = 'requirement_id' THEN '流水要求 ID'
            WHEN c.COLUMN_NAME = 'required_amount' THEN '要求完成金额'
            WHEN c.COLUMN_NAME = 'completed_amount' THEN '已完成金额'
            WHEN c.COLUMN_NAME = 'allocated_amount' THEN '分配金额'
            WHEN c.COLUMN_NAME = 'bet_amount' THEN '投注金额'
            WHEN c.COLUMN_NAME = 'rate' THEN '倍率'
            WHEN c.COLUMN_NAME = 'is_reversed' THEN '是否已冲正'
            WHEN c.COLUMN_NAME = 'task_key' THEN '任务键'
            WHEN c.COLUMN_NAME = 'platform' THEN '平台'
            WHEN c.COLUMN_NAME = 'verify_strategy' THEN '验证策略'
            WHEN c.COLUMN_NAME = 'title' THEN '标题'
            WHEN c.COLUMN_NAME = 'subtitle' THEN '副标题'
            WHEN c.COLUMN_NAME = 'reward_type' THEN '奖励类型'
            WHEN c.COLUMN_NAME = 'reward_amount' THEN '奖励金额'
            WHEN c.COLUMN_NAME = 'reward_spin' THEN '奖励转盘次数'
            WHEN c.COLUMN_NAME = 'turnover_x' THEN '打码倍数'
            WHEN c.COLUMN_NAME = 'screenshot_url' THEN '截图 URL'
            WHEN c.COLUMN_NAME = 'ip' THEN 'IP 地址'
            WHEN c.COLUMN_NAME = 'device_id' THEN '设备 ID'
            WHEN c.COLUMN_NAME = 'fp_visitor' THEN '浏览器指纹 ID'
            WHEN c.COLUMN_NAME = 'fp_signals' THEN '设备指纹原始信号'
            WHEN c.COLUMN_NAME = 'full_name' THEN '实名姓名'
            WHEN c.COLUMN_NAME = 'doc_type' THEN '证件类型'
            WHEN c.COLUMN_NAME = 'doc_image_key' THEN '证件图片资源键'
            WHEN c.COLUMN_NAME = 'selfie_image_key' THEN '自拍图片资源键'
            WHEN c.COLUMN_NAME = 'phone_verified' THEN '手机号是否已验证'
            WHEN c.COLUMN_NAME = 'doc_verified' THEN '证件是否已验证'
            WHEN c.COLUMN_NAME = 'face_verified' THEN '人脸是否已验证'
            WHEN c.COLUMN_NAME = 'verify_mode' THEN '验证模式'
            WHEN c.COLUMN_NAME = 'gemini_confidence' THEN 'Gemini 识别置信度'
            WHEN c.COLUMN_NAME = 'gemini_result' THEN 'Gemini 识别结果 JSON'
            WHEN c.COLUMN_NAME = 'reject_step' THEN '拒绝步骤'
            WHEN c.COLUMN_NAME = 'name' THEN '名称'
            WHEN c.COLUMN_NAME = 'image_key' THEN '图片资源键'
            WHEN c.COLUMN_NAME = 'amount_php' THEN 'PHP 金额'
            WHEN c.COLUMN_NAME = 'deposit_amount_php' THEN '存款金额（PHP）'
            WHEN c.COLUMN_NAME = 'min_deposit_php' THEN '最低存款金额（PHP）'
            WHEN c.COLUMN_NAME = 'max_deposit_php' THEN '最高存款金额（PHP）'
            WHEN c.COLUMN_NAME = 'chances' THEN '发放次数'
            WHEN c.COLUMN_NAME = 'chances_total' THEN '总次数'
            WHEN c.COLUMN_NAME = 'chances_used' THEN '已使用次数'
            WHEN c.COLUMN_NAME = 'chance_id' THEN '转盘机会 ID'
            WHEN c.COLUMN_NAME = 'prize_id' THEN '奖品 ID'
            WHEN c.COLUMN_NAME = 'prize_name' THEN '奖品名称'
            WHEN c.COLUMN_NAME = 'ledger_id' THEN '账变流水 ID'
            WHEN c.COLUMN_NAME = 'kind' THEN '类型'
            WHEN c.COLUMN_NAME = 'checkin_tier' THEN '签到奖励档位'
            WHEN c.COLUMN_NAME = 'period' THEN '结算周期'
            WHEN c.COLUMN_NAME = 'settlement_hour' THEN '自动结算小时'
            WHEN c.COLUMN_NAME = 'commission_basis' THEN '佣金计算口径'
            WHEN c.COLUMN_NAME = 'rate_plan_id' THEN '佣金方案 ID'
            WHEN c.COLUMN_NAME = 'l1_referrer_id' THEN '一级推荐人 ID'
            WHEN c.COLUMN_NAME = 'l2_referrer_id' THEN '二级推荐人 ID'
            WHEN c.COLUMN_NAME = 'l3_referrer_id' THEN '三级推荐人 ID'
            WHEN c.COLUMN_NAME = 'activated' THEN '是否已激活'
            WHEN c.COLUMN_NAME = 'activation_cents' THEN '激活金额（分）'
            WHEN c.COLUMN_NAME = 'activated_at' THEN '激活时间'
            WHEN c.COLUMN_NAME = 'currency_breakdown' THEN '分币种统计 JSON'
            WHEN c.COLUMN_NAME = 'action' THEN '动作'
            WHEN c.COLUMN_NAME = 'computed_at' THEN '计算时间'
            WHEN c.COLUMN_NAME = 'current_level' THEN '当前 VIP 等级'
            WHEN c.COLUMN_NAME = 'awarded_level' THEN '历史最高 VIP 等级'
            WHEN c.COLUMN_NAME = 'quarter_key' THEN '保级考核季度'
            WHEN c.COLUMN_NAME = 'quarter_start_turnover' THEN '季度起始累计流水'
            WHEN c.COLUMN_NAME = 'executed_at' THEN '执行时间'
            ELSE CONCAT('字段：', c.COLUMN_NAME)
          END
        )
      ) AS column_definition
    FROM information_schema.COLUMNS c
    WHERE c.TABLE_SCHEMA = DATABASE()
      AND COALESCE(c.COLUMN_COMMENT, '') = '';

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN table_cur;
  table_loop: LOOP
    FETCH table_cur INTO v_table, v_comment;
    IF done = 1 THEN
      LEAVE table_loop;
    END IF;
    SET v_sql = CONCAT('ALTER TABLE `', REPLACE(v_table, '`', '``'), '` COMMENT = ', QUOTE(v_comment));
    SET @sql = v_sql;
    PREPARE st FROM @sql;
    EXECUTE st;
    DEALLOCATE PREPARE st;
  END LOOP;
  CLOSE table_cur;

  SET done = 0;
  OPEN column_cur;
  column_loop: LOOP
    FETCH column_cur INTO v_table, v_column, v_definition;
    IF done = 1 THEN
      LEAVE column_loop;
    END IF;
    SET v_sql = CONCAT(
      'ALTER TABLE `', REPLACE(v_table, '`', '``'),
      '` MODIFY COLUMN `', REPLACE(v_column, '`', '``'), '` ',
      v_definition
    );
    SET @sql = v_sql;
    PREPARE st FROM @sql;
    EXECUTE st;
    DEALLOCATE PREPARE st;
  END LOOP;
  CLOSE column_cur;
END $$
DELIMITER ;

CALL `__migrate_129`();
DROP PROCEDURE IF EXISTS `__migrate_129`;
