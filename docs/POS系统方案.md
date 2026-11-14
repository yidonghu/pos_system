# 单店本地收银系统 方案 v3

> v3 变更：删除店员账号体系与会员模块，改由「设备」承担身份；每台设备自定义名字、本地保存 ID；数据库统一 SQLite。



***

## 一、方案定位



| 项  | 结论                                 |
| -- | ---------------------------------- |
| 部署 | 店内一台 Windows 主机，装完即用，不连互联网         |
| 数据 | 单一 SQLite 文件 `pos.db`，不做 MySQL、不做云 |
| 门店 | 单店                                 |
| 人员 | **无店员账号、无登录、无会员**。谁在收银由「设备名」体现     |
| 终端 | PC 收银台、手机浏览器、安卓自助机，同一局域网           |
| 规模 | SKU ≤ 5000、日单量 ≤ 800、设备 ≤ 5 台      |

删掉账号与会员后，实施量再降约 1 周：不用管密码、不用管排班、不用管储值资金安全。



***

## 二、设备身份机制（本版核心）

### 2.1 数据流



```
首次打开页面
  → 前端 crypto.randomUUID() 生成 device_id
  → 一次性向导：给设备起名（如"前台1""自助机A"）
  → POST /api/device/register {device_id, name, type}
  → 服务端 upsert 到 device 表
  → 前端把 {id, name} 写入 localStorage 主存 + IndexedDB 副本
后续每次写请求
  → Header: X-Device-Id / X-Device-Name
  → 服务端校验设备存在且启用，落库时带 device_id 与设备名快照
```

### 2.2 关键规则



| 项目   | 规则                                                        |
| ---- | --------------------------------------------------------- |
| ID   | 客户端生成 UUIDv4（`crypto.randomUUID`），全局唯一，不依赖服务端分配，断网首启也能完成  |
| 名称   | 可自定义、随时可改；改的是 device 表，**历史订单保留当时名字快照**，改名不会让老小票错乱        |
| 存储   | `localStorage['pos.device']` 主存 + IndexedDB 副本双写，防止单一存储被清 |
| 丢失恢复 | 浏览器清数据后，用后台「设备管理」的 6 位设备码重新绑定                             |
| 显示   | 收银页顶部徽标、小票页脚（"收银台：前台 1"）、订单列表、操作日志                        |
| 权限   | 权限挂在设备上（能否改价、能否退货、能否盘点），不再挂在人身上                           |
| 台账   | device 表记录 last\_seen、创建时间、类型，后台可停用某台设备                   |

### 2.3 为什么可行

单店场景里 "谁收银" 的实际约束力本来就弱，真正要防的是**误操作**，不是内部舞弊。设备级身份能把 "哪台机器做了什么" 记清楚，且完全不引入账号运维成本。防误操作用设备权限开关 + 后台管理员密码（仅后台需要）即可。



***

## 三、架构



```
        店内 Wi-Fi（路由器，不需要宽带）
                 │
   ┌─────────────┼──────────────┐
 手机           自助机          收银 PC（可即主机）
 /pos            /pos            /pos
   └─────────────┴──────────────┘
                 │
        ┌────────┴─────────┐
        │  Windows 主机      │
        │ Spring Boot 单jar  │  ← 内置 JRE + Windows 服务 + 静态前端
        │ SQLite pos.db(WAL) │  ← 唯一数据源
        │ 定时备份 / 打印代理 │
        └────────────────────┘
```

**关于 "离线" 的准确含义**：这里的离线 = **不依赖互联网**。主机正常、Wi-Fi 通，所有终端都能收银，断外网无影响。但主机宕机或路由故障时手机端不可用（它只是瘦客户端）。这是纯本地架构的固有边界，靠备份 + 备用机兜底，不靠 "终端各存一份"—— 那会让多终端库存对不上。



***

## 四、技术选型



| 层     | 选型                                                            | 说明        |
| ----- | ------------------------------------------------------------- | --------- |
| 后端    | Spring Boot 3 + Java 17 + `sqlite-jdbc`                       | 单个可执行 jar |
| 数据库   | **SQLite（WAL、**`busy_timeout=5000`**、**`foreign_keys=ON`**）** | 全系统唯一数据库  |
| PC 后台 | Vue 3 + TS + Vite + Element Plus（定制主题）                        | 构建后打进 jar |
| 移动 H5 | Vue 3 + Vant 4 + 自研数字键盘                                       | 同工程，按路由分流 |
| 打包    | jlink 精简 JRE + WinSW 服务 + Inno Setup                          | 双击安装      |
| 打印    | 浏览器打印 + jar 内置 ESC/POS 代理（58/80mm）                            | 免驱动       |
| 扫码    | USB HID 按键流；手机摄像头 `BarcodeDetector` → ZXing 降级（**手机必须走 https://IP:8443**，安卓 http 页面禁止调摄像头） | 免驱        |



***

## 五、SQLite 专项设计



| 项目   | 做法                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------- |
| 文件   | `data/pos.db`，WAL 模式附带 `-wal`/`-shm`                                                                      |
| 连接   | 单写连接（写串行化）+ 读连接池，`busy_timeout=5000` 避免 `database is locked`                                              |
| 事务   | 结算 = 扣库存 + 写订单 + 写支付 + 写流水 + 更新班次，**一个事务**，失败全回滚                                                          |
| 主键   | `INTEGER` 雪花 ID；另设 `order_no` 业务号便于人读                                                                     |
| 金额   | 全部 `INTEGER` 存「分」，杜绝浮点误差                                                                                  |
| 时间   | 统一 `INTEGER` 毫秒时间戳（UTC），展示层转本地时区                                                                          |
| 索引   | `product_barcode(barcode)`、`order(occur_at)`、`order(order_no)`、`inventory_movement(product_id, occur_at)` |
| 迁移   | `schema_version` 表 + 版本化 SQL 脚本，启动自动升级，升级前强制备份                                                            |
| 备份   | 用 `VACUUM INTO` 做一致性快照，**不直接复制 .db**（WAL 未合并会得到残库）                                                        |
| 容量   | 800 单 / 日 ≈ 30 万单 / 年，含明细约 300MB / 年，完全可控                                                                 |
| 归档   | 超 2 年的订单导入归档库并清理主库                                                                                        |
| 外部查看 | 备份文件可直接用 DB Browser for SQLite 打开，无需装服务                                                                   |

### 5.1 核心表（节选）



```
CREATE TABLE device (
  id           TEXT PRIMARY KEY,           -- 前端生成的 UUIDv4
  name         TEXT NOT NULL,              -- 自定义设备名，如"前台1"
  type         TEXT NOT NULL,              -- pc / phone / kiosk
  permissions  TEXT NOT NULL DEFAULT '{}', -- JSON：改价/退货/盘点/折扣上限
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  last_seen    INTEGER
);

CREATE TABLE product (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  category_id   INTEGER,
  unit          TEXT NOT NULL DEFAULT '件',
  is_weight     INTEGER NOT NULL DEFAULT 0,
  cost_price    INTEGER NOT NULL DEFAULT 0,  -- 分
  sale_price    INTEGER NOT NULL DEFAULT 0,  -- 分
  status        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE inventory_movement (            -- 库存唯一事实来源
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL,
  type        TEXT NOT NULL,                 -- in/out/sale/return/adjust/check/scrap
  qty         INTEGER NOT NULL,              -- 正入库、负出库
  unit_cost   INTEGER,
  ref_no      TEXT,
  device_id   TEXT NOT NULL,
  occur_at    INTEGER NOT NULL
);

CREATE TABLE "order" (
  id          INTEGER PRIMARY KEY,
  order_no    TEXT NOT NULL UNIQUE,
  device_id   TEXT NOT NULL,
  device_name TEXT NOT NULL,                 -- 下单时快照
  total       INTEGER NOT NULL,              -- 分
  discount    INTEGER NOT NULL DEFAULT 0,
  round_off   INTEGER NOT NULL DEFAULT 0,
  shift_id    INTEGER,
  status      TEXT NOT NULL,                 -- paid / returned
  occur_at    INTEGER NOT NULL
);

CREATE TABLE payment (
  id        INTEGER PRIMARY KEY,
  order_id  INTEGER NOT NULL,
  method    TEXT NOT NULL,                   -- cash/wechat/alipay/bank
  amount    INTEGER NOT NULL,
  trade_no  TEXT
);

CREATE TABLE shift (                         -- 按设备开班/交班，不按人
  id            INTEGER PRIMARY KEY,
  device_id     TEXT NOT NULL,
  start_at      INTEGER NOT NULL,
  end_at        INTEGER,
  cash_expected INTEGER NOT NULL DEFAULT 0,
  cash_actual   INTEGER,
  diff          INTEGER
);
```



***

## 六、功能模块

### 6.1 PC 管理后台（`/admin`，仅此需要管理员密码）



| 模块     | 功能                                       |
| ------ | ---------------------------------------- |
| 工作台    | 今日营业额 / 单量 / 客单价、支付占比、库存预警、近 7 日趋势       |
| 商品     | 分类、SKU（一品多码 / 规格 / 称重）、进价售价、图片、批量导入导出    |
| 库存     | 实时库存、入库 / 出库 / 报损 / 盘点、安全库存预警、负库存拦截、流水追溯 |
| 订单     | 列表 / 详情、退货红冲、重打小票、异常单、按设备 / 时段筛选         |
| **设备** | 设备列表、改名、类型、最近活跃、6 位设备码、权限开关、启用停用         |
| 报表     | 销售汇总 / 明细、商品排行、支付对账、毛利、时段热力、设备对比         |
| 数据     | 一键备份 / 恢复、Excel 导入导出、归档清理                |
| 系统     | 小票模板、店名 / 地址 / 电话、扫码开台二维码、操作日志           |

### 6.2 收银端（`/pos`，无登录）



| 场景     | 设计                                               |
| ------ | ------------------------------------------------ |
| 竖屏手机   | 顶部设备名 + 扫描条 + 商品网格 2 列 + 底部吸底结算栏                 |
| 横屏自助机  | 左 60% 商品网格（4–5 列），右 40% 购物车 + 数字键盘 + 支付，按钮 ≥56px |
| PC 收银台 | 左商品右购物车，F2 结算 / F4 挂单 / Esc 清空                   |
| 扫码     | USB 枪按键流（回车结尾），一品多码                              |
| 结算     | 现金（自动找零）、微信 / 支付宝 / 银行卡记账、组合支付                   |
| 辅助     | 挂单、整单折扣（受设备权限限制）、抹零、退货、设备交接班、小票预览                |



***

## 七、权限（设备级）



| 能力           | 管理员（后台） | 普通设备 | 受限设备（自助机） |
| ------------ | ------- | ---- | --------- |
| 查看营业额 / 毛利   | ✓       | ✗    | ✗         |
| 商品建档 / 改价    | ✓       | ✗    | ✗         |
| 收银结算         | ✗       | ✓    | ✓         |
| 收银端改价        | ✗       | 可开关  | ✗         |
| 折扣上限         | —       | 10%  | 0%        |
| 退货红冲         | ✓       | 可开关  | ✗         |
| 盘点 / 报损      | ✓       | 可开关  | ✗         |
| 备份 / 恢复 / 导出 | ✓       | ✗    | ✗         |



***

## 八、设计规范



| 项       | 规范                                                              |
| ------- | --------------------------------------------------------------- |
| 主色      | 深青 `#0F766E`，悬停 `#0D9488`                                       |
| 语义色     | 琥珀 `#F59E0B` 预警、红 `#DC2626` 异常、绿 `#16A34A` 成功                   |
| 中性      | 背景 `#F8FAFC`、卡片 `#FFFFFF`、线 `#E2E8F0`、主文 `#0F172A`、次文 `#64748B` |
| 圆角 / 阴影 | 卡片 12px；按钮与输入 8px；阴影只两级                                         |
| 字体      | 系统中文字体栈，数字 `tabular-nums` 等宽                                    |
| 字号      | 后台 14/16/20/28；收银金额 32–40px 加粗                                  |
| 触控      | 手机 ≥44px、自助机 ≥56px                                              |
| 状态反馈    | 扫码成功 = 轻震动 + 绿色高亮 200ms；失败 = 红色 + 提示音                           |
| 设备标识    | 顶部常驻设备名小徽标，点击可看设备信息                                             |



***

## 九、实施计划



| 阶段 | 内容                                        | 工期    |
| -- | ----------------------------------------- | ----- |
| M1 | 骨架、SQLite 建表与迁移、设备注册绑定、管理员登录、商品 CRUD、导入导出 | 1.5 周 |
| M2 | 收银台三形态、扫码枪、购物车、结算、支付记账、小票打印               | 1.5 周 |
| M3 | 库存流水、出入库、盘点、预警、负库存拦截                      | 1 周   |
| M4 | 报表、设备管理页、备份恢复、设备交班对账、一键安装包与压测             | 1 周   |

合计 **4.5–5 周**。



***

## 十、风险与兜底



| 风险             | 影响     | 措施                                                 |
| -------------- | ------ | -------------------------------------------------- |
| 主机硬盘坏          | 数据丢失   | 每日 02:00 `VACUUM INTO` 备份 + 每次交班备份，保留 30 份，U 盘一键导出 |
| 主机宕机           | 手机端不可用 | 备用小主机，导入备份 5 分钟恢复；PC 应急纸质记账                        |
| 断电             | 收银中断   | 500VA UPS（主机 + 路由，约 15 分钟）                         |
| 路由故障           | 终端断连   | PC 走 [localhost](https://localhost) 不受影响；路由单独供电    |
| Windows 自动更新重启 | 中断     | 关闭自动重启，设维护窗口，服务自启                                  |
| 杀毒误杀           | 服务起不来  | 安装时加白名单 + 看门狗自动重启                                  |
| IP 变动          | 手机扫不到  | DHCP 绑定 + `pos.local` 主机名 + 收银台贴二维码                |
| 浏览器清数据         | 设备身份丢失 | 双写 localStorage/IndexedDB + 后台 6 位设备码重新绑定          |
| 多设备同时改价        | 金额错乱   | 改价权限收敛到后台，收银端默认只读价格                                |



***

## 十一、可扩展（仍本地）

称重秤直连、ESC/POS 钱箱与客显、多机热备（局域网主从）、简易会员（需要时再开）。