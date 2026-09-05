-- P1-4 收尾：ACME 自动签发。
--
-- 签发在**宿主机**跑（deploy/single-node/issue-tenant-certs.sh + systemd timer），
-- 不在 bff-node 里：容器碰不到宿主机的 nginx 配置与 certbot，把签发塞进容器只能得到
-- 一个永远失败的按钮。平台库这边只负责「哪些域名该签」与「上次签得怎么样」。
--
-- 平台子域名不进签发队列：它们由泛域名证书 *.<平台根域名> 覆盖，开站即可用。
SET NAMES utf8mb4;

ALTER TABLE `pf_tenant_domain`
  ADD COLUMN `acme_enabled` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '0=不自动签发（证书在 Cloudflare 等外部托管，平台不要去动）' AFTER `dns_resolved_ip`,
  ADD COLUMN `cert_issued_at` DATETIME(3) NULL COMMENT '最近一次签发成功时间' AFTER `acme_enabled`,
  ADD COLUMN `cert_last_error` VARCHAR(255) NULL COMMENT '最近一次签发失败原因，供人工排查' AFTER `cert_issued_at`;

-- 自营站的 11 条历史域名证书是手工签的、也在别处续期，别让自动签发去碰它们。
-- 新登记的域名默认 acme_enabled=1。
UPDATE `pf_tenant_domain` d
   JOIN `pf_tenant` t ON t.id = d.tenant_id
    SET d.acme_enabled = 0
  WHERE t.self_operated = 1;
