# OneAPI · Cloudflare Worker 纯免费大模型聚合网关

基于 Cloudflare Workers 与 KV 构建的轻量级、零成本、高可用大模型聚合网关。向上对齐 OpenAI 与 Anthropic Claude 原生协议标准，向下聚合主流免费与高性价比模型供应商，并提供完整的可视化监控审计面板与 API Key 分发系统。

---

## 核心特性

- **零服务器成本 (Serverless)**：基于 Cloudflare Workers 边缘计算平台与 Cloudflare KV，全球边缘节点就近响应，无需采购或维护传统云服务器。
- **双协议原生兼容**：
  - OpenAI 协议：支持 `/v1/chat/completions`、`/v1/models`、`/v1/images/generations`、`/v1/audio/transcriptions`。
  - Anthropic 协议：原生支持 `/v1/messages` 接口与 Claude 原生流式协议。
- **多供应商智能路由与容灾**：
  - 聚合上海人工智能实验室 (InternAI / Discovery)、火山引擎 (Volcengine)、商汤日日新 (SenseNova)、AMD 开发者云、OpenCode、OpenRouter (Free) 及 Cloudflare Workers AI。
  - 支持智能自适应路由（`model: "auto"`）、多模态意图识别、通道健康探活、熔断降级与会话粘性哈希。
- **可视化管理与审计控制台 (`/usage`)**：
  - 实时用量监控：Token 吞吐、Prompt Cache 命中率、请求成功率、P95 延迟与参考账单测算。
  - API Key 细粒度管理：支持在线生成、停用、过期时间与 RPM 限流设置。
  - 质量诊断：支持导出审计 CSV，内置异常日志归集与边缘 AI 质量分析。
- **生产级安全架构**：
  - 供应商 API Key 与管理员主密钥统一托管在 Cloudflare Worker Secrets，代码库零硬编码泄露风险。
  - 签发的 API Key 与配额配置全量存储于 Cloudflare KV。
  - 支持来源白名单免密跨域调用，防止前端代码暴露密钥。

---

## 快速部署

### 1. 准备工作

确保本地安装了 Node.js 与 npm，并全局安装了 Cloudflare 官方 CLI 工具：

```bash
npm install -g wrangler
# 登录 Cloudflare 账号
wrangler login
```

### 2. 创建 KV 命名空间

运行以下命令创建用于存储用量日志与 API Key 的 KV 命名空间：

```bash
wrangler kv namespace create USAGE_KV
```

终端将输出类似如下的信息：

```text
[[kv_namespaces]]
binding = "USAGE_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 3. 配置项目

复制配置模板文件：

```bash
cp wrangler.toml.example wrangler.toml
```

编辑 `wrangler.toml`，将刚才生成的 KV `id` 填入相应字段，如有自定义域名可一并配置路由：

```toml
name = "oneapi"
main = "worker.js"
compatibility_date = "2026-08-29"
workers_dev = true

routes = [
  { pattern = "api.yourdomain.com", custom_domain = true }
]

[[kv_namespaces]]
binding = "USAGE_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

[ai]
binding = "AI"
```

### 4. 设置环境变量密钥 (Secrets)

运行以下命令配置管理员密码与各上游渠道的 API Key（按需配置）：

```bash
# 设置管理员控制台主密钥
echo "your-master-secret-key" | wrangler secret put MASTER_KEY

# 设置控制台免密授权 Key (可选，多个逗号分隔)
echo "sk-user-admin" | wrangler secret put ALLOWED_DASHBOARD_KEYS

# 配置各上游供应商 API Key (多个 Key 用逗号分隔实现自动轮询)
echo "your-sensenova-key" | wrangler secret put SENSENOVA_API_KEY
echo "your-volces-key"    | wrangler secret put VOLCES_API_KEY
echo "your-discovery-key" | wrangler secret put DISCOVERY_API_KEY
echo "your-openrouter-key"| wrangler secret put OPENROUTER_API_KEY
```

### 5. 发布上线

执行部署命令：

```bash
npm run deploy
```

部署完成后，即可通过分配的 `*.workers.dev` 域名或绑定的自定义域名进行访问。

---

## 调用示例

### OpenAI 兼容调用 (`/v1/chat/completions`)

```bash
curl https://api.yourdomain.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key" \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "你好，请做个简短自我介绍"}
    ],
    "stream": false
  }'
```

### Anthropic Claude 原生格式 (`/v1/messages`)

```bash
curl https://api.yourdomain.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-your-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "auto",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello Claude!"}
    ]
  }'
```

### 文生图调用 (`/v1/images/generations`)

```bash
curl https://api.yourdomain.com/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key" \
  -d '{
    "model": "sensenova-u1.5-lite",
    "prompt": "一只可爱的橘猫，高质量插画风格"
  }'
```

---

## 控制台使用

直接在浏览器中访问网关的 `/usage` 路径，输入 `MASTER_KEY` 或授权密钥即可登录管理控制台：

- **仪表盘**：直观展示当日与历史请求量、Token 统计、缓存加速率与账单折算。
- **渠道管理**：实时查看各供应商通道健康状态、熔断保护机制并支持手动启用/禁用。
- **API Key 面板**：支持一键签发不同权限角色（朋友、同事、系统应用）的 Key，支持实时封禁与配额限制。
- **数据导出**：支持导出全量 CSV 审计明细。
