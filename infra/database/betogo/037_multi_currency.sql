-- 037_multi_currency.sql
-- 多货币架构改造：清空测试数据 + 加 currency 字段
-- 注意：此迁移会清空所有钱包和投注数据，仅用于测试环境
-- MySQL 8.0 兼容（不使用 MariaDB-only 的 ADD COLUMN IF NOT EXISTS）

-- ── 清空测试数据 ──────────────────────────────────────────────────────────────
TRUNCATE TABLE bg_turnover_allocations;
TRUNCATE TABLE bg_turnover_logs;
TRUNCATE TABLE bg_turnover_requirements;
TRUNCATE TABLE bg_wallet_ledger;
TRUNCATE TABLE bg_wallet;
TRUNCATE TABLE bg_bet_order;
TRUNCATE TABLE bg_idempotency;
TRUNCATE TABLE bg_team_commission;
TRUNCATE TABLE bg_team_ggr_monthly;
TRUNCATE TABLE bg_team_wallet;

-- ── bg_turnover_requirements：加 currency ────────────────────────────────────
ALTER TABLE bg_turnover_requirements
  ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'PHP' AFTER user_id;

CREATE INDEX idx_turnover_req_user_currency_status
  ON bg_turnover_requirements (user_id, currency, status);

-- ── bg_turnover_logs：加 currency ────────────────────────────────────────────
ALTER TABLE bg_turnover_logs
  ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'PHP' AFTER user_id;

-- ── bg_team_ggr_monthly：加 currency，删旧唯一键，建新唯一键 ─────────────────
ALTER TABLE bg_team_ggr_monthly
  ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'PHP' AFTER period;

ALTER TABLE bg_team_ggr_monthly DROP INDEX uk_user_period;

CREATE UNIQUE INDEX uniq_ggr_user_period_currency
  ON bg_team_ggr_monthly (user_id, period, currency);

-- ── bg_team_commission：加 currency ──────────────────────────────────────────
ALTER TABLE bg_team_commission
  ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'PHP' AFTER period;

-- ── bg_team_wallet：支持多币种，改 PK 为 (user_id, currency) ─────────────────
ALTER TABLE bg_team_wallet
  ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'PHP';

-- 先删 FK（MySQL 不允许直接修改有 FK 依赖的 PK）
ALTER TABLE bg_team_wallet DROP FOREIGN KEY fk_tw_user;
ALTER TABLE bg_team_wallet DROP PRIMARY KEY;
ALTER TABLE bg_team_wallet ADD PRIMARY KEY (user_id, currency);
ALTER TABLE bg_team_wallet ADD CONSTRAINT fk_tw_user FOREIGN KEY (user_id) REFERENCES bg_user (id);
