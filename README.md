# MoveCar_Android - 智能挪车通知系统（多车管理增强版）

基于 Cloudflare Workers 的智能挪车通知系统，扫码即可通知车主，保护双方隐私。本版本引入了强大的**多车辆管理**层，支持超级管理员和独立车主后台。

> 本版基于 [原项目](https://github.com/lesnolie/movecar) 进行深度重构，不仅优化了国内安卓用户体验，还增加了完整的后台管理系统。

## 核心功能

- **多车管理**：一个项目支持无限量车辆管理，每个车拥有独立 ID。
- **两层管理**：
  - **超级管理员** (`/admin`)：增删改查所有车辆，启用/禁用车辆。
  - **车辆管理员** (`/v/:id/admin`)：车主可自行修改车牌、联系电话及推送方式。
- **多样化推送**：支持 Server酱、Gotify、Webhook、HTTP POST、SMTP 邮件等多种推送方式，且支持**多通道并发推送**。
- **隐私保护**：通过短链接或 6 位随机 ID 访问，不直接暴露车主电话。
- **地理位置**：支持 WGS-84 转 GCJ-02 坐标，高德/Apple 地图精准导航。

## 路由说明

- **挪车页面**：`https://你的域名/v/:vehicle_id`（如 `/v/123456`）
- **车主后台**：`https://你的域名/v/:vehicle_id/admin`（需车辆管理密码）
- **超管后台**：`https://你的域名/admin`（需 `SUPER_ADMIN_PASSWD` 环境变量）

## 与原版的主要区别

| 功能 | 原版 (MoveCar) | 本增强版 |
| :--- | :--- | :--- |
| **车辆支持** | 单车固定配置 | **多车动态管理** |
| **推送通道** | Bark (iOS) | **Server酱/Gotify/Webhook/SMTP/HTTP POST** |
| **管理后台** | 无 | **超管后台 + 车辆独立后台** |
| **推送逻辑** | 单一推送 | **多通道同时推送** |
| **配置存储** | 环境变量 | **Cloudflare KV 独立存储** |
| **输入框** | textarea | **富文本 (contenteditable) + 快捷标签** |

## 部署步骤

### 第一步：创建 KV 存储

1. 登录 Cloudflare Dashboard -> Storage & Databases -> Workers KV。
2. 点击『Create instance』，名称填 `MOVE_CAR_STATUS`。

### 第二步：部署 Worker

1. 创建一个新的 Worker，命名为 `movecar`。
2. 点击『Edit code』，将 `movecar_android.js` 的内容全部复制并粘贴进去。
3. 在 Worker 的『Settings』->『Bindings』中，点击『Add binding』：
   - Variable name: `MOVE_CAR_STATUS`
   - KV Namespace: 选择刚才创建的 `MOVE_CAR_STATUS`。
4. 在『Settings』->『Variables and Secrets』中，点击『Add』：
   - Variable name: `SUPER_ADMIN_PASSWD`
   - Value: **设置你的超级管理员登录密码**。

### 第三步：初始化系统

1. 访问 `https://你的项目.workers.dev/admin`。
2. 使用刚才设置的 `SUPER_ADMIN_PASSWD` 登录。
3. 点击『添加车辆』，系统会自动生成 6 位随机 ID，你可以设置车牌号、车主管理密码以及推送配置。

## 推送配置参考

- **Server酱**: 填入 `SendKey` 即可。
- **Gotify**: 填入 `Gotify URL` 和 `App Token`。
- **Webhook**: 填入接收 POST 请求的 URL。
- **HTTP POST**: 填入 `URL` 和 `Bearer Token`。
- **SMTP**: 填入发件邮箱和收件邮箱（基于 Mailchannels）。

## 生成挪车二维码

1. 在超管后台或车辆后台获取车辆的专属链接（如 `https://.../v/123456`）。
2. 使用任意二维码生成工具将其转换为二维码。
3. 打印后放置于挡风玻璃处。

## License

MIT
