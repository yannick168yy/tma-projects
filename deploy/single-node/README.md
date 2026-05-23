# single-node 部署

当前阶段：MySQL + Redis + RabbitMQ + BFF + Core + 静态前端，同机 Docker / PM2 / systemd。

未来：将各 `apps/*` 拆为独立容器，仅增加 compose 服务块，**不改业务代码**。
