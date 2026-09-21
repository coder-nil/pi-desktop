# 手机扫码编程的公网访问（π.ink + 局域网优先）

本文档描述把 Pi Desktop 的手机遥控页（`/m`）从「只能在同一个 Wi-Fi 用」扩展到「任意网络都能用」的完整方案，以及一份可以照着敲的操作手册（Cloudflare Tunnel + 自建域名 `π.ink`）。

- 目标读者：在本机维护 Pi Desktop 的人（也就是你）。命令默认在 macOS 上执行。
- 最后更新：2026-09-20。

---

## 1. 目标与范围

**目标**

1. 手机在任意网络（家里 Wi-Fi、公司网络、蜂窝流量）扫码后都能打开遥控页 `/m`，可以看会话、发消息、看流式输出、回答 `ask_user`。
2. 在家/公司的同一网络里时，**优先走局域网直连**：延迟低、流量不出内网、不占用公网隧道带宽。
3. 不在同一网络时，**自动走公网入口 `https://π.ink`**（Cloudflare Tunnel 反代到本机）。
4. 认证、限流、日志**只有一份实现**：继续复用现有的 Rust 入口代理（`src-tauri/src/lan_proxy.rs`），公网与局域网是同一个进程、同一份配置、同一个日志文件。

**不在范围内**

- 多用户 / 账号体系 / 把 agent 能力开放给第三方。
- 手机端的原生 App。

---

## 2. 现状：哪些东西直接复用，哪些是硬约束

| 现有能力 | 位置 | 公网化时的作用 |
| --- | --- | --- |
| 唯一入口反向代理（监听 `0.0.0.0` 的随机端口，HTTP Basic，密码热加载） | `src-tauri/src/lan_proxy.rs` | 隧道 origin 就打这个端口，认证/限流/日志继续只有一份 |
| `Host` / `Origin` 改写为回环、强制 `Connection: close` | `lan_proxy.rs::rewrite_request_head()` | 隧道进来后 Next 仍视其为回环请求，`proxy.ts` 的 Host/Origin 校验与 `PI_WEB_DESKTOP_API_ORIGIN` 都不用改 |
| 免密资源白名单（`/manifest.webmanifest`、`/sw.js`、`/icons/*` 等） | `lan_proxy.rs::is_public_asset_request()` | 已经是「路径白名单」的雏形，公网白名单照这个模式扩 |
| 认证失败计数 + 指数退避 | `lan_proxy.rs::backoff_after_failure()` | 公网限流的地基 |
| SSE 流 + 30 秒心跳 | `lib/agent-event-stream.ts`（`HEARTBEAT_INTERVAL_MS`） | 30 秒心跳足以喂饱 Cloudflare 的空闲超时，隧道不需要额外改造 |
| 配对信息纯函数 + 单测 | `lib/mobile-pair.ts` / `lib/mobile-pair.test.mjs` | 路由判定继续写在这里（纯函数、可单测） |
| 运行态回写（`lanPort`、计数、`lastPeer`） | `~/.pi/agent/desktop-access.runtime.json` | 追加 `publicIp` / `tunnelUrl` 等字段 |
| 手机端页面与投影 | `app/m/page.tsx`、`components/MobileRemoteView.tsx`、`lib/mobile-state.ts` | 不需要为公网改造；它只用相对路径调 API |

**两条硬约束**

1. **隧道的 origin 必须是 `127.0.0.1:<lanPort>`（Rust 代理），绝不能是 Next 自己的端口。** 否则绕过唯一闸门：Next 的「非回环必须带密码」判定形同虚设，也没有任何日志。
2. **`lanPort` 每次启动都可能变。** 代理绑定的是端口 0（内核分配随机空闲端口），真正的端口回写在 `~/.pi/agent/desktop-access.runtime.json`。所以隧道配置里的端口不能长期写死——手动阶段每次重启应用后要重新确认，自动化阶段（P1）由桌面端在启动隧道前生成配置文件。

---

## 3. 目标架构

```
                                    ┌──── 同一网络：直接打（首选）────┐
                                    │                                ▼
手机 Safari / PWA ──────────────────┤                 http://<lan-ip>:<lanPort>
                                    │                 （Rust 入口代理）
                                    └─ https://π.ink ──TLS──▶ cloudflared ──▶ 127.0.0.1:<lanPort>
                                            (Cloudflare 边缘)                 （同一个 Rust 入口代理）
                                                                                       │
                                       唯一闸门：HTTP Basic、限流、真实 IP、路径白名单、审计日志
                                                                                       ▼
                                                                    127.0.0.1:<next-port>
                                                                    /m、/api/mobile/*、/api/agent/*
```

无论走哪条链路，终点都是**同一个代理进程**。这一点是整个方案的地基：安全策略只维护一份，不存在「公网那条路少了一道检查」的可能。

---

## 4. 局域网 / 公网：判定与切换

### 4.1 为什么不能「客户端先探测局域网，探不通再走公网」

这是本方案最容易踩的坑，先说清楚：

- 公网入口是 **HTTPS**，局域网地址是 **HTTP**（`http://192.168.x.x:<lanPort>`）。
- HTTPS 页面里发起的**子资源请求**（`fetch` / `XMLHttpRequest` / `<img>` / `<iframe>` / `<script>`）只要目标是 `http://`，一律被浏览器按**混合内容（mixed content）**拦掉，请求根本发不出去。Chrome/Edge 在「公网页面 → 私网地址」之上还叠了一层 Private Network Access 预检（响应需要带 `Access-Control-Allow-Private-Network: true`）；iOS 18 起 Safari 对网页访问本地网络还会弹单独的授权提示。
- **只有顶层导航是例外**：`https://` 页面里执行 `location.href = "http://192.168.1.5:8080/m"` 是允许的（浏览器会提示「连接不安全」）。

反向那条路同样走不通：如果让二维码指向局域网地址、打不开时再跳公网——手机连不上时浏览器直接给错误页，页面里的 JS 没有任何机会运行。

所以结论是：**判定必须发生在服务端，客户端只负责一次顶层跳转。**

### 4.2 服务端判定算法

判定输入有两边：

| 输入 | 来源 |
| --- | --- |
| **手机端出口 IP**（`clientIp`） | 请求头 `CF-Connecting-IP`（Cloudflare Tunnel 必带）→ 退回 `X-Forwarded-For` 的第一段 → 退回 TCP peer 地址。**来源必须是可信入口**（本机代理收到的请求都来自 cloudflared 的回环连接） |
| **桌面端出口 IP**（`desktopIp`） | 桌面端每 5 分钟主动查一次 `https://cloudflare.com/cdn-cgi/trace` 的 `ip=`，IPv4 与 IPv6 各一次，结果缓存在内存 + `desktop-access.runtime.json` |

判定规则（`ipMatchMode` 默认 `subnet`）：

| 情况 | 判定 |
| --- | --- |
| 两侧都是 IPv4，且**前 24 位相同**（同一 `/24` 网段） | 同网 → **走局域网** |
| 两侧都是 IPv6，且**前 64 位相同**（同一 `/64` 前缀） | 同网 → **走局域网** |
| `clientIp` 本身是私网/回环地址（说明请求本来就是从内网进来的） | 同网 → **走局域网** |
| 一侧有 IPv4、另一侧只有 IPv6（双栈对不上） | 判不出来 → **走公网** |
| 其它 | **走公网** |

补充规则：

- 判定结果按 `clientIp` 缓存 5 分钟，避免每个请求都算。
- 判定不出来的默认方向是**公网**——公网一定可达，这是失败代价最小的一侧。
- 如果你希望「零误判优先」，把 `ipMatchMode` 改成 `exact`：只有出口 IP 完全相等（IPv6 仍按 `/64`）才走局域网。
- `subnet` 的代价：同一个运营商 CGNAT 池里的**不同**用户，公网 IP 也常常落在同一个 `/24` 里。这时会被判成「同网」，手机跳到内网地址后打不开。缓解手段见 4.3。

### 4.3 跳转与兜底

1. 手机打开公网入口 `https://π.ink/m?session=<id>&cwd=<path>`。
2. 服务端判定为「同网」时，**不要用 HTTP 302**，而是返回一个 200 的小决策页，页面里用 JS 跳转：
   ```js
   location.replace(lanUrl);   // 页面同时显示：“3 秒内没有反应，请按返回键用外网打开”
   ```
   用 302 的话这一页会被从浏览历史里抹掉，误判时用户没有退路；用 200 + JS 跳转，**浏览器返回键能回到 HTTPS 决策页**。
3. 局域网页面（HTTP）里放一个「用外网打开」按钮，指回 `https://π.ink/m?...`。`http → https` 方向不受任何限制，所以这条路永远可用。
4. 误判记忆：局域网页面加载成功时，用 `<img src="https://π.ink/...">` 之类的信标向公网侧回报一次「我活着」。连续两次跳过去失败的设备，之后直接走公网（记在各 origin 自己的 `localStorage` 里）。
5. **两个 origin 的状态不共享**：`https://π.ink` 与 `http://192.168.x.x:<lanPort>` 是两个来源，`localStorage` / `sessionStorage` / HTTP Basic 凭据都不互通。切过去之后手机需要在新的 origin 上再认证一次，这是浏览器规则，不是实现问题。
6. 局域网模式是明文 HTTP，**不是安全上下文**：没有 Service Worker，不能「添加到主屏」离线化。想要 PWA 就得用 `https://π.ink` 那一侧。

---

## 5. 安全边界

这一节的结论是：**认证策略沿用现状（扫码 + 密码 + 不可猜的 `sessionId`/`cwd`）是可以的，但下面几项必须在公网开启前补齐。**

### 5.1 沿用现状的部分

- HTTP Basic 认证，用户名固定 `pi`，密码在 设置 → 手机访问 里配置（至少 8 位）。
- 密码存在 `~/.pi/agent/desktop-access.json`（权限 600），代理每 400ms 检查一次文件，改密码**不需要重启任何进程**。
- 无密码时代理拒绝启用；配置文件损坏时一律退回「未启用」。
- 免密白名单只有 PWA 静态资源（`/manifest.webmanifest`、`/sw.js`、`/offline.html`、`/icons/*`），且只允许 GET/HEAD。

### 5.2 公网暴露必须补齐的部分

1. **只暴露 443。** Cloudflare 边缘开启 Always Use HTTPS；隧道 origin 只监听回环；不要在路由器上做任何端口映射。
2. **公网路径白名单（价值最高、成本最低的一项）。** 公网入口只放行手机遥控真正需要的路径，其余一律 403：

   | 放行（公网） | 拦截（公网） |
   | --- | --- |
   | `/m`、`/_next/static/*`、`/sw.js`、`/offline.html`、`/manifest.webmanifest`、`/icons/*` | `/api/files/*`、`/api/sessions*`、`/api/sessions/*/export` |
   | `/api/mobile/state`、`/api/mobile/pair`、`/api/agent/[id]`（prompt / abort / extension_ui_response） | `/api/models*`、`/api/models-config/*`、`/api/auth/*` |
   | `/api/agent/[id]/events`（SSE）、`/api/agent/new` | `/api/skills/*`、`/api/plugins/*`、`/api/worktrees/*`、`/api/cwd/*`、`/api/default-cwd` |

   加上**配对范围绑定**：公网只允许操作配对时那一个 session 与它的 `cwd`，`/api/agent/new` 的 `cwd` 也锁定在同一个目录。
3. **真实来源 IP 必须由代理写入，并且不可信客户端自带的同名头。** 代理在处理请求时先**删除**所有进来的 `CF-Connecting-IP` / `X-Forwarded-For` / `X-Pi-*`，再写入自己算出的值。否则任何人伪造 `X-Forwarded-For: <你的公网 IP>` 就能骗到「同网」判定。
4. **限流要按 IP 再做一层。** 现有 `recordFailedWebAuthAttempt` 是进程级 20 次/60 秒；公网建议再叠一个「按来源 IP：5 次/分钟 + 封禁 10 分钟」。
5. **自动关闭。** 公网开关默认关闭；打开后可设 `autoOffHours`（建议默认 12 小时），设置页显示剩余时间，主窗口显示常驻横幅 + 「一键断开」。
6. **日志留痕。** `~/.pi/agent/desktop-access.log` 里记录的 `peer` 要换成真实来源 IP——隧道场景下 peer 永远是 `127.0.0.1`，看不出是谁。
7. **密码卫生。** 不要与其它服务复用；Basic 凭据会被浏览器记住，轮换密码后需要在手机上清除该站点的数据；手机丢失时唯一的撤销手段就是改密码。

### 5.3 已接受的取舍（明确写下，方便日后复审）

**不上设备令牌**，理由是「必须扫码才能拿到链接，`sessionId` + `cwd` 撞不出来」。这个判断在**链接不外传**的前提下成立，但它同时意味着：

- Basic 密码一旦泄露（手机被借用、浏览器同步、截图泄露、密码复用）= 本机 agent 的任意命令执行。
- 没有细粒度撤销：只能整体改密码，无法只踢掉某一台手机。
- 白名单是唯一能限制「泄露之后能干什么」的机制，所以 5.2 的第 2 条建议不要省。

**触发以下任一条件时，应重新考虑设备令牌方案**：公网开关需要长期常开 / 多台设备共享同一个密码 / 该密码在别处用过 / 手机可能被他人短期使用。

---

## 6. 代码落点（P1 及之后）

**Node 侧**

- `lib/mobile-pair.ts`：`MobilePairInfo` 增加 `publicUrl` / `lanUrl` / `route`；新增纯函数 `resolveMobileRoute({ clientIp, desktopIp, ipMatchMode })` → `"lan" | "public"`，配单测（`lib/mobile-pair.test.mjs`）。
- 新增 `lib/desktop-public-ip.ts`：出口 IP 抓取 + 5 分钟缓存（内存 + 回写 `desktop-access.runtime.json`）。
- 新增 `app/api/mobile/entry/route.ts`：判定 + 决策页（200 + JS 跳转）或 `?decision=json` 返回 JSON 供页面用。
- `app/api/mobile/pair/route.ts`：返回双地址（局域网 + 公网）与当前建议路由。
- `lib/desktop-access.ts`：`desktop-access.json` 扩展为 `{ enabled, password, public: { enabled, hostname, ipMatchMode, autoOffAt }, devices: [] }`；**坏配置一律退回「全部关闭」**（沿用现在的原则）。

**Rust 侧**

- `lan_proxy.rs`：新增纯函数 `real_client_ip(head)`（可信头白名单 + 先剥后写）与 `is_public_path_allowed(path)`，都配 `cargo test --lib lan_proxy`；`desktop-access.runtime.json` 增加 `publicIp` / `tunnelUrl`。
- 新增 `src-tauri/src/tunnel.rs`（或并入现有 manager 线程）：管理 cloudflared 子进程——按当前 `lanPort` 生成配置、启动、健康检查、把公网 URL 回写 runtime、应用退出时清理。
- `src-tauri/src/lib.rs`：`start_lan_proxy()` → `start_mobile_access()`（代理 + 隧道一起管）；`stop_server()` 里一并停隧道。

**前端 / i18n**

- `components/MobileAccessSettings.tsx`：新增「外网访问」分区（开关、域名、判定模式、自动关闭倒计时、公网访问中横幅）。
- `components/MobilePairDialog.tsx`：模式开关（自动 / 只局域网 / 只外网）+ 同时显示两个地址 + 一键复制。
- `lib/i18n/messages/*`：所有语言包补齐新 key（当前是 en 与 zh-CN 两个）。
- 测试：`lib/mobile-pair.test.mjs`、`components/MobileRemoteView.test.mjs`（继续保证 `/m` 不引入桌面渲染器）。

---

## 7. 分期

| 阶段 | 内容 | 是否需要改代码 |
| --- | --- | --- |
| **P0** | 挂 Cloudflare Tunnel 直通 `127.0.0.1:<lanPort>`，手动拼 `https://π.ink/m?session=&cwd=` 使用（就是下面第 8 节的操作手册） | 不需要 |
| **P1** | 配对弹窗输出公网地址 + 服务端同网判定 + 跳转兜底 | 需要 |
| **P2** | 公网路径白名单 + 按 IP 限流 + 自动关闭 + 常驻横幅 + 真实 IP 日志 | 需要 |
| **P3**（可选） | 局域网也上 HTTPS（`*.lan.pi.ink` 泛域名证书 + 私网 A 记录），客户端真探活，判定 100% 准 + 局域网也能装 PWA | 需要 |

**P0 零代码是成立的**：现有代理已经处理了认证、Host/Origin 改写、SSE 逐字节转发，手机页面只用相对路径调 API，所以把隧道打到代理端口上就能直接用。P0 的唯一不适是「地址要自己拼」。

---

## 8. 操作手册：Cloudflare Tunnel + π.ink

### 8.0 前置检查

1. **域名先落到 Cloudflare —— IDN 域名最容易卡住的就是这一步。** Cloudflare 只能把**已注册**的域名当成 zone 托管，所以先确认状态：

   ```bash
   # π.ink 的 punycode 形式是 xn--1xa.ink（浏览器/证书/SNI 内部都用它）
   node -e "console.log(new URL('https://π.ink').hostname)"
   dig +short NS xn--1xa.ink @1.1.1.1     # 有 NS 才说明已注册并已解析
   whois -h whois.nic.ink xn--1xa.ink     # "No Data Found" = 还没注册
   ```

   然后按实际情况走其中一条：

   - **用已经持有的域名（推荐，零成本）**：`pi.ink` 已经在你的名下（注册商阿里云 / HiChina，2027-03 到期），把它的 zone 搬到 Cloudflare 最省事：入口可以直接用 `pi.ink`，也可以用 `π.pi.ink`（punycode `xn--1xa.pi.ink`，浏览器里同样显示 π）。**搬迁前先把现有解析抄下来**：当前 `pi.ink` 与 `www.pi.ink` 的 A 记录都是 `47.245.33.102`，NS 换到 Cloudflare 后要把这些记录在 Cloudflare 里重建，否则原站点会断。
   - **注册 `π.ink`**：`xn--1xa.ink` 目前注册局查询结果是「未注册」，但单字符标签在不少注册局是保留或溢价域名，能不能注册、多少钱，要在注册商搜索框里用 `π.ink` / `xn--1xa.ink` 实际查一次为准。
   - **换一个别的域名**：任意一个已在 Cloudflare 的域名都能用，本方案不依赖 `π` 这个字形。
2. **在 Cloudflare 添加站点**：Dashboard → Add a site → 输入域名（unicode 或 punycode 都接受，仪表盘里会以 punycode 形式显示 zone）→ 选 Free 套餐 → 核对它扫描出的 DNS 记录 → Cloudflare 给出两个 NS 地址。
3. **到注册商把 NS 换成 Cloudflare 给的那两个**（阿里云：域名 → 管理 → DNS 修改 → 自定义 DNS；`clientTransferProhibited` 只锁转移，不影响改 NS）。等 zone 状态变成 **Active**，通常几分钟，最多 24 小时。
4. **等 Universal SSL 签发完**：zone 激活后 Cloudflare 会自动为 `xn--1xa.ink` 和 `*.xn--1xa.ink` 签证书（免费版覆盖根域 + 一级通配符）。证书没签好之前 `https://π.ink` 会报证书错误，这是后面 `curl` 失败的常见原因。
5. **命令行与配置文件统一写 punycode**：`cloudflared`、`dig`、`curl` 对 unicode 域名的支持不一致，统一用 `xn--1xa.ink`；手机浏览器输入 `π.ink` 会自动转换，不受影响。
6. Pi Desktop 的局域网访问已经跑通：
   - 设置 → 手机访问：打开开关，设置一个至少 8 位的密码。
   - 手机连**同一个 Wi-Fi**，用应用里「扫码」按钮出的二维码打开遥控页，确认能看会话、能发消息。
   - 这一步没过就不要动 DNS，否则会同时引入两个问题。
7. 记下当前入口端口（**每次重启应用都可能变**）：
   ```bash
   cat ~/.pi/agent/desktop-access.runtime.json
   # {"lanPort":53124,"listening":true,"authSuccesses":0,...}
   ```
8. 确认应用正在运行、且手机访问开关是开着的。开关关掉时代理根本不监听，隧道会直接 502。

### 8.1 安装 cloudflared

```bash
brew install cloudflared
cloudflared --version
```

### 8.2 授权（只需一次）

```bash
cloudflared tunnel login
```

浏览器会打开 Cloudflare，选中 `π.ink` 这个 zone 并授权，成功后证书落在 `~/.cloudflared/cert.pem`。

### 8.3 先用临时隧道验证链路（不碰域名，可随时丢弃）

```bash
PORT=$(node -e "console.log(require(process.env.HOME + '/.pi/agent/desktop-access.runtime.json').lanPort)")
cloudflared tunnel --url http://127.0.0.1:$PORT
```

终端会打印一个 `https://xxxx-xxxx.trycloudflare.com` 地址。手机**切到蜂窝流量**（关键：验证外网路径），打开：

```
https://xxxx-xxxx.trycloudflare.com/m?session=<会话 id>&cwd=<会话的工作目录>
```

期望：弹出 Basic 认证 → 输入 `pi` 和密码 → 遥控页正常打开、能发消息、能看到流式输出。

**这一步通过**说明 Basic 认证、Host/Origin 改写、SSE 转发、CF 到本机的链路都没问题，可以继续绑定域名。**不通过**就先看 8.9 排障，不要继续。

拿到会话 id 的办法：在桌面端打开那个会话，URL 里的 `session=` 参数就是；`cwd` 是会话的工作目录（可从侧边栏项目路径读，注意 URL 编码）。

### 8.4 建 named tunnel 并绑定 π.ink

```bash
cloudflared tunnel create pi-desktop
# 输出里会给出 UUID，凭证文件：~/.cloudflared/<UUID>.json

cloudflared tunnel route dns pi-desktop xn--1xa.ink
cloudflared tunnel list
```

`route dns` 会在 Cloudflare 上为 `π.ink`（zone 里记录为 `xn--1xa.ink`）建一条指向 `<UUID>.cfargotunnel.com` 的 CNAME。命令行里用 punycode 更保险，写 unicode 一般也可以。

### 8.5 写配置

`~/.cloudflared/config.yml`：

```yaml
tunnel: <UUID>
credentials-file: /Users/<你的用户名>/.cloudflared/<UUID>.json

ingress:
  # 用 punycode 形式最保险；也可以写 π.ink，cloudflared 会做转换
  - hostname: xn--1xa.ink
    service: http://127.0.0.1:<lanPort>
    originRequest:
      # 让 Next 侧看到的是回环地址（代理本身也会改写 Host，这里是双保险）
      httpHostHeader: 127.0.0.1:<lanPort>
      # 必须保持 false：开启后响应不再是 chunked，SSE 会断流
      disableChunkedEncoding: false
      connectTimeout: 30s
  - service: http_status:404
```

把 `<lanPort>` 换成 8.0 第 3 步读到的端口。**重启 Pi Desktop 后端口可能变化，需要重新确认并改这里**（P1 之后由桌面端自动生成，不再手改）。

### 8.6 启动与验证

```bash
cloudflared tunnel run pi-desktop
```

前台跑着，观察日志。另开一个终端验证（IDN 域名在命令行里如果解析不了，用 8.0 的 punycode 形式替代）：

```bash
HOST=$(node -e "console.log(new URL('https://π.ink').hostname)")

# 1) 无凭据：期望 401
curl -s -o /dev/null -w '%{http_code}\n' "https://$HOST/m"

# 2) 带凭据：期望 200
curl -s -o /dev/null -w '%{http_code}\n' -u 'pi:你的密码' "https://$HOST/m"

# 3) 手机接口：期望一段 JSON（注意 session 参数）
curl -s -u 'pi:你的密码' "https://$HOST/api/mobile/state?limit=5" | head -c 200
```

三条都对，就在桌面端核对一次日志：

```bash
tail -n 20 ~/.pi/agent/desktop-access.log
# 期望看到 auth OK peer=127.0.0.1 ... forwarded
```

最后用手机验证：**关掉 Wi-Fi 用蜂窝**打开 `https://π.ink/m?session=<id>&cwd=<path>`，发一条消息，确认流式输出能逐字出来（这一步才真正验证 SSE 经 Cloudflare 没有被缓冲）。

### 8.7 Cloudflare 侧设置

| 位置 | 设置 | 原因 |
| --- | --- | --- |
| SSL/TLS → Edge Certificates | **Always Use HTTPS: On** | 避免 `http://π.ink` 明文访问 |
| Speed → Optimization | **Rocket Loader: Off** | 它重写页面 JS，对 Next 应用没好处 |
| Caching → Cache Rules | 新建规则：`URI Path` 以 `/api/` 开头 → **Bypass cache**；`/m` 也 Bypass | 保险起见，API 与遥控页绝不能被缓存 |
| Security → Settings | **不要开 Under Attack Mode / Bot Fight Mode** | 会给手机页面加 JS 挑战，可能拦掉 POST API |
| Network | WebSockets 保持开启（默认开） | 生产不需要，但保持默认即可 |

隧道场景下不需要动 SSL/TLS 的加密模式：Cloudflare 与 cloudflared 之间走的是隧道内的加密连接，cloudflared 到本机是回环明文。

### 8.8 常驻（可选，P1 之后推荐交给桌面端）

临时后台跑：

```bash
nohup cloudflared tunnel run pi-desktop > /tmp/cloudflared.log 2>&1 &
```

长期常驻建议用 launchd（`KeepAlive` 自动重启）。但更推荐等 P1：由 Pi Desktop 自己拉起隧道，好处是**应用退出即断开公网**，不会出现「忘了关公网，机器长期裸奔」。

### 8.9 排障手册

| 症状 | 检查点 |
| --- | --- |
| 手机白屏 / 一直转圈 | `~/.pi/agent/desktop-access.log` 里有没有 `auth OK peer=127.0.0.1`。完全没有 → 隧道没打到代理：检查 `config.yml` 里的端口与 `desktop-access.runtime.json` 是否一致、Pi Desktop 是否在运行、手机访问开关是否打开（关掉时代理不监听，隧道会 502） |
| 反复弹认证 / 一直 401 | 密码不对，或手机记住了旧凭据（Safari → 网站数据里清掉该站点后重试） |
| 出现 429 | 触发了失败认证的限流。等 60 秒；若持续出现，说明有人在试密码，直接关掉公网入口并改密码 |
| 页面能打开，但发消息返回 `{"error":"Untrusted API request"}` | 隧道的转发头把**公网协议**带进了回环上游：Cloudflare 写的 `X-Forwarded-Proto: https` 会让 Next 把 `request.url` 算成 `https://127.0.0.1:<lanPort>`，与代理改写后的 `Origin: http://127.0.0.1:<lanPort>` 对不上，同源校验失败。只有带 `Origin` 的请求会中招，也就是写操作（发消息），GET / SSE 不带 Origin 所以看起来正常。修复：入口代理转发前丢掉 `X-Forwarded-Proto` / `X-Forwarded-Host`（`rewrite_request_head()`）。同时确认隧道 origin 是 `127.0.0.1:<lanPort>`（入口代理），不是 Next 自己的端口 |
| 页面能打开，但发消息没有任何反应 | SSE 被缓冲：确认 `config.yml` 里 `disableChunkedEncoding: false`；确认响应头里有 `Cache-Control: no-transform`（代码已带）；确认 Cloudflare 的 Cache Rule 没把 `/api/` 缓存 |
| `curl` 通了但手机打不开 | 手机侧 DNS / 蜂窝网络问题；先用手机浏览器直接打开 `https://π.ink`，或用蜂窝和 Wi-Fi 各试一次 |
| `https://π.ink` 报证书错误 | zone 刚激活，Universal SSL 还在签发（等 15–30 分钟）；或者域名根本没注册 / 没托管到 Cloudflare（回到 8.0 第 1–4 步核对） |
| 重启应用后全部 502 | `lanPort` 变了，改 `config.yml` 后重启 cloudflared |
| 走局域网跳过去打不开 | 同网判定误判（常见于同一运营商 CGNAT 的 `/24` 撞段）：按浏览器返回键回到 HTTPS 页，用「用外网打开」；长期方案是把 `ipMatchMode` 改成 `exact` |

### 8.10 关闭与轮换

```bash
# 临时断开：停掉隧道进程（前台 Ctrl+C，后台 pkill -f 'cloudflared tunnel run'）
# 彻底撤销：删隧道 + 删 DNS 记录
cloudflared tunnel delete pi-desktop
# 再在 Cloudflare 控制台删除 π.ink 上那条 CNAME
```

轮换密码：设置 → 手机访问 → 改密码（立即生效，不需要重启任何进程），然后在手机上清掉该站点数据重新认证。

### 8.11 备选方案：自建 VPS + frp

如果你不想依赖 Cloudflare：把 `π.ink` 的 A 记录指向自己的 VPS，VPS 上跑 `frps`（配好 TLS 证书），本机跑 `frpc` 把本地 `127.0.0.1:<lanPort>` 暴露到 VPS 的 443。要点与前文完全一致——**origin 必须还是那个入口代理端口**；额外需要自己处理证书续期、VPS 加固、以及 frps 侧的访问日志。工作量明显高于 Cloudflare Tunnel，只在「必须完全自控」时选它。

---

## 9. 后续待办

- [ ] P1：`lib/mobile-pair.ts` 增加 `resolveMobileRoute()` 与单测。
- [ ] P1：`app/api/mobile/entry/route.ts` 决策页（200 + JS 跳转，保留 history）。
- [ ] P1：`MobilePairDialog` 输出公网地址 + 模式开关。
- [ ] P2：`lan_proxy.rs` 增加 `real_client_ip()` 与 `is_public_path_allowed()`，附 Rust 单测。
- [ ] P2：`desktop-access.json` 增加 `public` 分区 + 自动关闭 + 真实 IP 日志。
- [ ] P2：`src-tauri/src/tunnel.rs`：跟随应用生命周期管理 cloudflared，并按当前 `lanPort` 生成配置。
- [ ] P3（可选）：局域网 HTTPS + 泛域名证书，客户端真探活。
