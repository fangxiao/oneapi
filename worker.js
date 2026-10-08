/**
 * 100% 纯免费全功能大模型网关 - Cloudflare Worker 版
 * 支持:
 *  1. 🔒 控制台登录鉴权: 支持管理员主密钥与方晓专属密钥直接登录
 *  2. 🔑 API Key 授权派发面板 (已派发清单、一键复制、明文/掩码切换、独立用量统计)
 *  3. 🌐 全路径自动容错 (同时支持 /v1/chat/completions 和 /chat/completions)
 *  4. 🔌 双协议原生支持 (OpenAI 协议 + Anthropic/Claude 原生协议)
 *  5. 👥 多用户 / 朋友独立归集与实时人数监控
 *  6. 智能多模态意图嗅探与图像生成
 *  7. 会话粘性路由与精准 Token / Prompt Cache 审计
 */

const CONFIG = {
  // 管理员主密钥
  MASTER_KEY: "", // 注入自 Worker Secret MASTER_KEY

  // 授权允许登录监控控制台的白名单 Key (管理员本人 + 授权成员, 注入自 Worker Secret ALLOWED_DASHBOARD_KEYS 或 MASTER_KEY)
  ALLOWED_DASHBOARD_KEYS: [],

  // 授权用户 Key 映射表 (生产环境通过 KV 'api_keys' 持久化存储与动态签发管理，避免硬编码)
  USER_KEYS: {},

  // 参考计价: [输入, 输出] ¥/百万 tokens; models 表为各模型牌价 (占位估计值, 可按上游定价页修订), 未列出的回落统一价
  REFERENCE_PRICING: {
    input_per_million: 1,
    output_per_million: 4,
    models: {
      "auto": [1, 4],
      "default": [1, 4],
      "gpt-oss-120b": [2, 8],
      "deepseek-v4-flash": [1, 4],
      "deepseek-v4.1-flash": [1, 4],
      "deepseek-v4-pro": [2, 8],
      "qwen3.8-27b": [1.5, 6],
      "qwen3.8-flash": [0.5, 2],
      "qwen3.8-flash-next": [0.5, 2],
      "glm-5.3-flash": [1, 4],
      "glm-5.2": [1, 4],
      "Ling-3.0-flash": [0.5, 2],
      "Ling-3.1-flash": [0.5, 2],
      "Ling-2.6-flash": [0.5, 2],
      "Ling-3.0-tiny": [0.2, 0.8],
      "Ling-3.0-flash-VL": [0.5, 2],
      "hy3": [1, 4],
      "mimo-v2.5": [0.5, 2],
      "mimo-v2.6-flash": [0.5, 2],
      "kimi-k2.6": [2, 8],
      "gemma-4-31b": [0.5, 2],
      "sensenova-6.8-flash-lite": [0.3, 1.2],
      "minicpm5-2b": [0.2, 0.8],
      "deepseek-v4-flash-vision-exp": [1, 4],
      "deepseek-v4-flash-0731": [1, 4],
      "deepseek-v4-flash-vision": [1, 4],
      "deepseek-v4-pro-0813": [2, 8],
      "glm-5.3": [1.5, 6],
      "intern-s2": [1, 4],
      "minimax-m3": [1, 4],
      "intern-latest": [1, 4],
      "qwen/qwen3.8-27b:free": [0, 0],
      "z-ai/glm-5.2:free": [0, 0],
      "google/gemma-4-26b-a4b-it:free": [0, 0],
      "google/gemma-4-31b-it:free": [0, 0],
      "nvidia/nemotron-3.5-lightning:free": [0, 0],
      "thinkingmachines/inkling:free": [0, 0],
      "nvidia/nemotron-3-ultra-550b-a55b:free": [0, 0],
      "stealth/space-bunny-alpha": [0, 0],
      "space-bunny-alpha": [0, 0],
      "space-bunny": [0, 0],
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [0, 0],
      "@cf/meta/llama-3.1-8b-instruct-fast": [0, 0],
      "@cf/meta/llama-4-scout-17b-16e-instruct": [0, 0],
      "@cf/qwen/qwen3-30b-a3b-fp8": [0, 0],
      "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": [0, 0],
      "@cf/zai-org/glm-4.7-flash": [0, 0],
      "cf-llama-3.3-70b": [0, 0],
      "cf-llama-3.1-8b": [0, 0],
      "cf-llama-4-scout": [0, 0],
      "cf-qwen3-30b": [0, 0],
      "cf-deepseek-r1-32b": [0, 0],
      "cf-glm-4.7-flash": [0, 0],
      "whisper-1": [0, 0]
    }
  },

  PROVIDER_NAMES: {
    sensenova: "商汤日日新 (SenseNova)",
    eaglesine: "鹰辛 (EagleSine)",
    bai: "b.ai",
    volces: "火山引擎 (Volcengine/Ark)",
    amd: "AMD 开发者云",
    opencode: "OpenCode",
    internai: "上海人工智能实验室 (InternAI)",
    discovery: "上海人工智能实验室 (InternAI Discovery)",
    openrouter: "OpenRouter (Free)",
    cloudflare: "Cloudflare Workers AI (10k Neurons/Day Free)"
  },

  PROVIDERS: {
    sensenova: {
      baseUrl: "https://token.sensenova.cn/v1",
      apiKey: "",
      models: ["sensenova-6.8-flash-lite", "deepseek-v4-flash", "glm-5.2", "deepseek-v4-pro"]
    },
    eaglesine: {
      baseUrl: "https://api.eaglesine.com/v1",
      apiKey: "",
      models: ["gpt-oss-120b", "DeepSeek-V4-Flash", "Kimi-K2.6", "qwen3.8-27b", "gemma-4-31b", "DeepSeek-V4-Pro", "whisper-1"]
    },
    bai: {
      baseUrl: "https://api.b.ai/v1",
      apiKey: "",
      models: ["glm-5.2", "grok-4.6", "grok-4.5"]
    },
    opencode: {
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "",
      models: ["nemotron-3.5-lightning-free", "muse-spark-1.2-contributor-free", "nemotron-3-ultra-free", "ling-3.0-flash-fin-free", "big-pickle"]
    },
    amd: {
      baseUrl: "https://developer.amd.com.cn/radeon/api/v1",
      apiKey: "",
      models: ["DeepSeek-V4-Flash-Vision-Exp", "DeepSeek-V4-Flash", "DeepSeek-V4.1-Flash", "Qwen3.8-Flash-Next", "MiniCPM5-2B", "MiMo-V2.6-Flash"]
    },
    volces: {
      baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
      apiKey: "",
      models: ["glm-5.3-flash", "deepseek-v4-flash", "deepseek-v4.1-flash"]
    },
    internai: {
      baseUrl: "https://chat.intern-ai.org.cn/api/v1",
      apiKey: "",
      models: ["intern-latest", "intern-s2", "intern-s1-pro", "internvl-latest"]
    },
    discovery: {
      baseUrl: "https://discovery-api.intern-ai.org.cn/v1",
      apiKey: "",
      models: [
        "deepseek-v4-flash-0731",
        "deepseek-v4-flash-vision",
        "deepseek-v4-pro-0813",
        "glm-5.3",
        "intern-s2",
        "kimi-k2.6",
        "minimax-m3",
        "qwen3.8-27b"
      ]
    },
    openrouter: {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "",
      models: [
        "stealth/space-bunny-alpha",
        "space-bunny-alpha",
        "space-bunny",
        "qwen/qwen3.8-27b:free",
        "z-ai/glm-5.2:free",
        "google/gemma-4-26b-a4b-it:free",
        "google/gemma-4-31b-it:free",
        "nvidia/nemotron-3.5-lightning:free",
        "thinkingmachines/inkling:free",
        "nvidia/nemotron-3-ultra-550b-a55b:free"
      ]
    },
    cloudflare: {
      baseUrl: "internal://cloudflare-workers-ai",
      apiKey: "internal",
      models: [
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        "@cf/meta/llama-3.1-8b-instruct-fast",
        "@cf/meta/llama-4-scout-17b-16e-instruct",
        "@cf/qwen/qwen3-30b-a3b-fp8",
        "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
        "@cf/zai-org/glm-4.7-flash",
        "cf-llama-3.3-70b",
        "cf-llama-3.1-8b",
        "cf-llama-4-scout",
        "cf-qwen3-30b",
        "cf-deepseek-r1-32b",
        "cf-glm-4.7-flash"
      ]
    },
    antling: {
      baseUrl: "https://api.ant-ling.com/v1",
      apiKey: "sk-studio-28fb2563e2554484bfa157d9a56dc2c0",
      models: [
        "Ling-3.0-flash",
        "Ling-3.1-flash",
        "Ling-2.6-flash",
        "Ling-3.0-tiny",
        "Ling-3.0-flash-VL"
      ]
    }
  },

  AUTO_CANDIDATES: [
    { provider: "antling", model: "Ling-3.0-flash" },
    { provider: "volces", model: "glm-5.3-flash" },
    { provider: "volces", model: "deepseek-v4.1-flash" },
    { provider: "volces", model: "deepseek-v4-flash" },
    { provider: "sensenova", model: "deepseek-v4-flash" },
    { provider: "sensenova", model: "deepseek-v4-pro" },
    { provider: "sensenova", model: "glm-5.2" },
    { provider: "sensenova", model: "sensenova-6.8-flash-lite" },
    { provider: "eaglesine", model: "DeepSeek-V4-Flash" },
    { provider: "eaglesine", model: "DeepSeek-V4-Pro" },
    { provider: "eaglesine", model: "Kimi-K2.6" },
    { provider: "eaglesine", model: "qwen3.8-27b" },
    { provider: "eaglesine", model: "gpt-oss-120b" },
    { provider: "internai", model: "intern-latest" },
    { provider: "internai", model: "intern-s2" },
    { provider: "discovery", model: "intern-s2" },
    { provider: "discovery", model: "kimi-k2.6" },
    { provider: "discovery", model: "qwen3.8-27b" },
    { provider: "discovery", model: "minimax-m3" },
    { provider: "discovery", model: "deepseek-v4-pro-0813" },
    { provider: "amd", model: "DeepSeek-V4.1-Flash" },
    { provider: "amd", model: "Qwen3.8-Flash-Next" },
    { provider: "amd", model: "MiMo-V2.6-Flash" }
  ],

  MULTIMODAL_CANDIDATES: [
    { provider: "sensenova", model: "sensenova-6.8-flash-lite" },
    { provider: "antling", model: "Ling-3.0-flash-VL" },
    { provider: "discovery", model: "deepseek-v4-flash-vision" },
    { provider: "eaglesine", model: "gemma-4-31b" },
    { provider: "amd", model: "DeepSeek-V4-Flash-Vision-Exp" },
    { provider: "amd", model: "DeepSeek-V4.1-Flash" },
    { provider: "amd", model: "MiMo-V2.6-Flash" },
    { provider: "openrouter", model: "stealth/space-bunny-alpha" }
  ],

  IMAGE_GEN_CANDIDATES: [
    { provider: "sensenova", model: "sensenova-u1.5-lite" },
    { provider: "sensenova", model: "sensenova-u1-fast" }
  ]
};

const AUTO_EXCLUDED_MODELS = new Set([
  "whisper-1",
  "minicpm5-2b",
  "mimo-v2.5",
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "cf-llama-3.1-8b",
  "llama-3.1-8b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "cf-llama-3.3-70b",
  "llama-3.3-70b",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "cf-llama-4-scout",
  "llama-4-scout",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "cf-qwen3-30b",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "cf-deepseek-r1-32b",
  "@cf/zai-org/glm-4.7-flash",
  "cf-glm-4.7-flash",
  "qwen/qwen3.8-27b:free",
  "z-ai/glm-5.2:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3.5-lightning:free",
  "thinkingmachines/inkling:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nemotron-3.5-lightning-free",
  "muse-spark-1.2-contributor-free",
  "nemotron-3-ultra-free",
  "ling-3.0-flash-fin-free",
  "big-pickle"
]);

const CF_MODEL_MAP = {
  "cf-llama-3.3-70b": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "llama-3.3-70b": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",

  "cf-llama-3.1-8b": "@cf/meta/llama-3.1-8b-instruct-fast",
  "llama-3.1-8b": "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.1-8b-instruct-fast": "@cf/meta/llama-3.1-8b-instruct-fast",

  "cf-llama-4-scout": "@cf/meta/llama-4-scout-17b-16e-instruct",
  "llama-4-scout": "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/meta/llama-4-scout-17b-16e-instruct": "@cf/meta/llama-4-scout-17b-16e-instruct",

  "cf-qwen3-30b": "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/qwen/qwen3-30b-a3b-fp8": "@cf/qwen/qwen3-30b-a3b-fp8",

  "cf-deepseek-r1-32b": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",

  "cf-glm-4.7-flash": "@cf/zai-org/glm-4.7-flash",
  "@cf/zai-org/glm-4.7-flash": "@cf/zai-org/glm-4.7-flash"
};

const OPENROUTER_MODEL_MAP = {
  "space-bunny": "stealth/space-bunny-alpha",
  "space-bunny-alpha": "stealth/space-bunny-alpha",
  "stealth/space-bunny": "stealth/space-bunny-alpha"
};

// 提取 API Token
function extractToken(request) {
  const url = new URL(request.url);
  const queryKey = url.searchParams.get("key") || url.searchParams.get("api_key") || url.searchParams.get("token");
  if (queryKey) return queryKey.trim();

  const authHeader = request.headers.get("Authorization") || request.headers.get("authorization") || "";
  if (authHeader) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }

  const xApiKey = request.headers.get("x-api-key") || request.headers.get("api-key") || request.headers.get("auth-token") || "";
  if (xApiKey) return xApiKey.trim();

  // 从 Cookie 中提取
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(/user_key=([^;]+)/) || cookieHeader.match(/admin_key=([^;]+)/);
  if (match) return decodeURIComponent(match[1]).trim();

  return "";
}

// 解析用户身份与备注名
function resolveUser(token, body, headers, env, apiKeys) {
  const masterKey = env.MASTER_KEY || CONFIG.MASTER_KEY;
  if (token === masterKey) {
    return body?.user || headers.get("x-user") || "管理员 (本人)";
  }
  if (apiKeys && apiKeys[token]) {
    return apiKeys[token].name;
  }
  if (body?.user) {
    return String(body.user);
  }
  if (headers.get("x-user")) {
    return headers.get("x-user");
  }
  return token.length > 8 ? "用户 (" + token.slice(0, 8) + "...)" : "外部用户";
}

// 按统一参考牌价折算金额 (¥)
function estimateCostYuan(promptTokens, completionTokens, modelName) {
  const pricing = CONFIG.REFERENCE_PRICING;
  let inPrice = pricing.input_per_million;
  let outPrice = pricing.output_per_million;
  if (modelName && pricing.models) {
    const hit = pricing.models[String(modelName).toLowerCase()];
    if (hit) { inPrice = hit[0]; outPrice = hit[1]; }
  }
  return (promptTokens / 1e6) * inPrice + (completionTokens / 1e6) * outPrice;
}

function formatCostYuan(amount) {
  return "¥" + (amount >= 100 ? amount.toFixed(0) : amount >= 1 ? amount.toFixed(2) : amount.toFixed(4));
}

// 运行时配置 (KV 持久化): 渠道下架清单与 auto 池自定义覆盖, 配合内存缓存降低边缘 KV 频次
let RUNTIME_CFG_CACHE = null;
let RUNTIME_CFG_TS = 0;

async function getRuntimeConfig(env, force = false) {
  const empty = { disabled_channels: [], auto_pool: null, multimodal_pool: null, image_pool: null };
  if (!env.USAGE_KV) return empty;
  if (!force && RUNTIME_CFG_CACHE && (Date.now() - RUNTIME_CFG_TS < 15000)) {
    return RUNTIME_CFG_CACHE;
  }
  const saved = await env.USAGE_KV.get("runtime_config", { type: "json" }) || {};
  const pool = (v) => Array.isArray(v) && v.length > 0 ? v : null;
  const cfg = {
    disabled_channels: Array.isArray(saved.disabled_channels) ? saved.disabled_channels : [],
    auto_pool: pool(saved.auto_pool),
    multimodal_pool: pool(saved.multimodal_pool),
    image_pool: pool(saved.image_pool)
  };
  RUNTIME_CFG_CACHE = cfg;
  RUNTIME_CFG_TS = Date.now();
  return cfg;
}

function isChannelDisabled(runtimeCfg, provider, model) {
  return runtimeCfg.disabled_channels.includes((provider + ":" + model).toLowerCase());
}

function filterDisabledChannels(runtimeCfg, channels) {
  return channels.filter(c => !isChannelDisabled(runtimeCfg, c.provider, c.model));
}

// 供应商密钥与主密钥全部来自 Worker Secrets (wrangler secret put), 部署物内不含任何密钥
const PROVIDER_SECRET_NAMES = {
  sensenova: "SENSENOVA_API_KEY",
  eaglesine: "EAGLESINE_API_KEY",
  bai: "BAI_API_KEY",
  opencode: "OPENCODE_API_KEY",
  amd: "AMD_API_KEY",
  volces: "VOLCES_API_KEY",
  internai: "INTERNAI_API_KEY",
  discovery: "DISCOVERY_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  antling: "ANTLING_API_KEY"
};

function applyProviderSecrets(env) {
  for (const [pKey, secretName] of Object.entries(PROVIDER_SECRET_NAMES)) {
    const val = env[secretName];
    if (val && CONFIG.PROVIDERS[pKey]) {
      const keys = val.split(",").map(k => k.trim()).filter(Boolean);
      CONFIG.PROVIDERS[pKey].apiKey = keys[0] || val;
      if (keys.length > 1) {
        CONFIG.PROVIDERS[pKey].apiKeys = keys;
      }
    }
  }
  if (env.BAI_API_KEY) {
    const key = env.BAI_API_KEY.split(",")[0].trim();
    if (key && CONFIG.PROVIDERS.bai) CONFIG.PROVIDERS.bai.apiKey = key;
  }
  if (env.ALLOWED_DASHBOARD_KEYS) {
    const extraKeys = env.ALLOWED_DASHBOARD_KEYS.split(",").map(k => k.trim()).filter(Boolean);
    for (const k of extraKeys) {
      if (!CONFIG.ALLOWED_DASHBOARD_KEYS.includes(k)) CONFIG.ALLOWED_DASHBOARD_KEYS.push(k);
    }
  }
  if (env.MASTER_KEY) {
    if (!CONFIG.USER_KEYS[env.MASTER_KEY]) {
      CONFIG.USER_KEYS[env.MASTER_KEY] = { name: "管理员 (本人)", role: "admin", created_at: "2026-08-31" };
    }
    if (!CONFIG.ALLOWED_DASHBOARD_KEYS.includes(env.MASTER_KEY)) {
      CONFIG.ALLOWED_DASHBOARD_KEYS.unshift(env.MASTER_KEY);
    }
  }
}

function getProviderApiKey(providerInfo) {
  if (!providerInfo) return "";
  if (Array.isArray(providerInfo.apiKeys) && providerInfo.apiKeys.length > 0) {
    const valid = providerInfo.apiKeys.filter(Boolean);
    if (valid.length > 0) {
      return valid[Math.floor(Math.random() * valid.length)];
    }
  }
  if (typeof providerInfo.apiKey === "string" && providerInfo.apiKey.includes(",")) {
    const keys = providerInfo.apiKey.split(",").map(k => k.trim()).filter(Boolean);
    if (keys.length > 0) {
      return keys[Math.floor(Math.random() * keys.length)];
    }
  }
  return providerInfo.apiKey || "";
}

// API Key 运行时管理: KV 持久化的签发层与内置 USER_KEYS 合并 (KV 优先), 附带内存微缓存降低高频鉴权开销
let API_KEYS_CACHE = null;
let API_KEYS_TS = 0;

async function getApiKeys(env, force = false) {
  if (!force && API_KEYS_CACHE && (Date.now() - API_KEYS_TS < 15000)) {
    return API_KEYS_CACHE;
  }
  let kvKeys = {};
  if (env.USAGE_KV) {
    const doc = await env.USAGE_KV.get("api_keys", { type: "json" }) || {};
    kvKeys = doc.keys || {};
  }
  const keys = { ...CONFIG.USER_KEYS, ...kvKeys };
  API_KEYS_CACHE = keys;
  API_KEYS_TS = Date.now();
  return keys;
}

function getBeijingDateStr(d = new Date()) {
  const beijingTime = new Date(d.getTime() + 8 * 3600 * 1000);
  return beijingTime.toISOString().slice(0, 10);
}

// key 状态检查: 有效返回 null, 否则返回拒绝原因
function keyRejectReason(keyInfo) {
  if (!keyInfo) return null;
  if (keyInfo.enabled === false) return "该 API Key 已被停用";
  if (keyInfo.expires_at && String(keyInfo.expires_at) < getBeijingDateStr()) return "该 API Key 已过期 (" + keyInfo.expires_at + ")";
  return null;
}

// RPM 计数器: KV 按 "key 哈希 + 分钟" 计数 (边缘最终一致, 个人规模下足够挡滥用; TTL 自动清理)
async function rpmExceeded(env, token, limit) {
  if (!limit || !env.USAGE_KV) return false;
  const minute = new Date().toISOString().slice(0, 16);
  const kvKey = "rpm_" + stringHash(token) + "_" + minute;
  const current = (await env.USAGE_KV.get(kvKey, { type: "json" })) || { count: 0 };
  if (current.count >= limit) return true;
  await env.USAGE_KV.put(kvKey, JSON.stringify({ count: current.count + 1 }), { expirationTtl: 120 });
  return false;
}

const CIRCUIT_FAIL_THRESHOLD = 3;
const PROVIDER_CIRCUIT_THRESHOLD = 5;
const PROVIDER_CIRCUIT_WINDOW_MS = 10 * 60 * 1000;

function classifyError(errText) {
  const text = String(errText || "").toLowerCase();
  if (/model_not_found|does not exist|not available|unauthorized|invalid_api_key|deactivated|permission_denied|401|403/i.test(text)) {
    return "configuration";
  }
  if (/429|rate_limit|quota_exceeded|tpm\/rpm|exceeds|insufficient_quota|rpm exhausted/i.test(text)) {
    return "rate_limit";
  }
  if (/timeout|aborted|timed out|504/i.test(text)) {
    return "timeout";
  }
  return "transient";
}

let CHANNEL_HEALTH_CACHE = null;
let CHANNEL_HEALTH_TS = 0;

async function getChannelHealth(env, force = false) {
  if (!env.USAGE_KV) return {};
  if (!force && CHANNEL_HEALTH_CACHE && (Date.now() - CHANNEL_HEALTH_TS < 10000)) {
    return CHANNEL_HEALTH_CACHE;
  }
  const health = (await env.USAGE_KV.get("channel_health", { type: "json" })) || {};
  CHANNEL_HEALTH_CACHE = health;
  CHANNEL_HEALTH_TS = Date.now();
  return health;
}

function isCircuitOpen(health, provider, model) {
  if (!health) return false;
  const channel = health[(provider + ":" + model).toLowerCase()];
  const prov = health["p:" + provider.toLowerCase()];
  const open = (h) => Boolean(h && h.open_until && h.open_until > Date.now());
  return open(channel) || open(prov);
}

function filterOpenChannels(health, channels) {
  const alive = channels.filter(c => !isCircuitOpen(health, c.provider, c.model));
  return alive.length > 0 ? alive : channels;
}

async function recordChannelFailure(env, provider, model, errText, userName, requestedModel, durationMs, isTerminal = false) {
  if (!env.USAGE_KV) return;
  try {
    const now = Date.now();
    const chKey = (provider + ":" + model).toLowerCase();
    const provKey = "p:" + provider.toLowerCase();
    const health = await getChannelHealth(env);

    const errCategory = classifyError(errText);
    const h = health[chKey] || { fails: 0, trips: 0 };

    if (h.open_until && now > h.open_until) {
      h.fails = Math.max(h.fails || 0, CIRCUIT_FAIL_THRESHOLD - 1);
    }

    h.fails = (h.fails || 0) + 1;
    h.last_fail_at = new Date().toISOString();
    h.last_error = String(errText || "").slice(0, 150);
    h.category = errCategory;

    let tripNow = false;
    let cooldownMs = 10 * 60 * 1000;

    if (errCategory === "configuration") {
      tripNow = true;
      cooldownMs = 24 * 60 * 60 * 1000;
    } else if (errCategory === "rate_limit") {
      if (h.fails >= 2) {
        tripNow = true;
        cooldownMs = 10 * 60 * 1000;
      }
    } else {
      if (h.fails >= CIRCUIT_FAIL_THRESHOLD) {
        tripNow = true;
        const currentTrips = (h.trips || 0) + 1;
        cooldownMs = currentTrips === 1 ? (10 * 60 * 1000) : (currentTrips === 2 ? (30 * 60 * 1000) : (60 * 60 * 1000));
      }
    }

    if (tripNow) {
      h.trips = (h.trips || 0) + 1;
      h.open_until = now + cooldownMs;
      h.fails = 0;
    }
    health[chKey] = h;

    const p = health[provKey] || { fails: 0, trips: 0, window_start: now };
    if (now - (p.window_start || 0) > PROVIDER_CIRCUIT_WINDOW_MS) {
      p.fails = 0;
      p.window_start = now;
    }
    p.fails += 1;
    p.last_fail_at = new Date().toISOString();
    if (errCategory === "configuration" && String(errText || "").includes("401")) {
      p.open_until = now + 24 * 60 * 60 * 1000;
    } else if (p.fails >= PROVIDER_CIRCUIT_THRESHOLD) {
      p.trips = (p.trips || 0) + 1;
      p.open_until = now + (p.trips > 1 ? 30 * 60 * 1000 : 15 * 60 * 1000);
      p.fails = 0;
      p.window_start = now;
    }
    health[provKey] = p;

    await env.USAGE_KV.put("channel_health", JSON.stringify(health));

    const logs = (await env.USAGE_KV.get("error_logs", { type: "json" })) || [];
    logs.unshift({
      time: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).replace(/\//g, "-"),
      user: userName,
      model: requestedModel,
      provider: provider,
      upstream_model: model,
      routed_model: model,
      error: String(errText || "unknown").slice(0, 200),
      duration_ms: durationMs || 0,
      is_terminal: Boolean(isTerminal),
      category: errCategory
    });
    await env.USAGE_KV.put("error_logs", JSON.stringify(logs.slice(0, 100)));
  } catch (e) {
    console.error("recordChannelFailure Error:", e);
  }
}

async function recordChannelSuccess(env, provider, model) {
  if (!env.USAGE_KV) return;
  try {
    const chKey = (provider + ":" + model).toLowerCase();
    const provKey = "p:" + provider.toLowerCase();
    const health = await getChannelHealth(env);
    let dirty = false;
    if (health[chKey]) {
      delete health[chKey];
      dirty = true;
    }
    if (health[provKey] && health[provKey].open_until && health[provKey].open_until <= Date.now()) {
      delete health[provKey];
      dirty = true;
    }
    if (dirty) {
      await env.USAGE_KV.put("channel_health", JSON.stringify(health));
    }
  } catch (e) {
    console.error("recordChannelSuccess Error:", e);
  }
}

// 嗅探请求中是否包含图片输入
function containsImageInput(messages) {
  if (!Array.isArray(messages)) return false;
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === "image_url" || part.type === "image" || part.image_url) {
          return true;
        }
      }
    }
  }
  return false;
}

// 稳定字符串哈希算法
function stringHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// 提取唯一且稳定的会话 Key (加固会话指纹)
function getSessionKey(body, headers, token, url) {
  // 1. 显式 ID (Header, Body, URL query)
  const explicitId =
    (body && (body.session_id || body.conversation_id || body.chat_id)) ||
    (headers && (headers.get("x-session-id") || headers.get("session-id") || headers.get("x-conversation-id"))) ||
    (url && (url.searchParams.get("session_id") || url.searchParams.get("conversation_id")));
  if (explicitId && String(explicitId).trim().length > 0) {
    return "exp_" + String(explicitId).trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  }

  // 2. 深入嗅探 WorkBuddy / Claude Code / Cursor / Agent 注入在系统提示词或上下文中的 sessionId / workspace
  const messages = (body && body.messages) || [];
  if (Array.isArray(messages) && messages.length > 0) {
    for (const m of messages) {
      const contentStr = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
      const match = contentStr.match(/(?:sessionId|session_id|conversationId|conversation_id)["':\s=]+([a-zA-Z0-9_-]{8,64})/i);
      if (match && match[1]) {
        return "sniff_" + match[1];
      }
      const dirMatch = contentStr.match(/\/(?:WorkBuddy|projects|workspace|claude|openclaw)\/([a-zA-Z0-9_-]{8,64})/i);
      if (dirMatch && dirMatch[1]) {
        return "dir_" + dirMatch[1];
      }
    }

    // 3. 提取首条 user 消息作为对话根指纹 (过滤动态时间戳，提取纯净语义前缀)
    const firstUserMsg = messages.find(m => m.role === "user");
    if (firstUserMsg) {
      const text = normalizeContent(firstUserMsg.content);
      if (text && text.trim().length > 0) {
        const queryMatch = text.match(/<user_query>([\s\S]*?)<\/user_query>/i);
        const coreText = queryMatch ? queryMatch[1] : text;
        const cleaned = coreText
          .replace(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g, "")
          .replace(/\b\d{2}:\d{2}:\d{2}\b/g, "")
          .trim();
        return "msg_" + stringHash((token || "anon") + ":" + cleaned.slice(0, 300));
      }
    }
  }

  // 4. 稳定兜底指纹：按用户 Token + 当天日期，绝对禁止 Math.random() 产生随机漂移
  const today = new Date().toISOString().slice(0, 10);
  return "usr_" + stringHash((token || "anon") + ":" + today);
}

// 稳定字符串会话哈希
function getSessionFingerprint(body, headers, token, url) {
  return stringHash(getSessionKey(body, headers, token, url));
}

// 获取会话绑定的模型（KV 状态化）
async function getSessionPinnedCandidate(env, sessionKey, targetModel, pool) {
  if (!env.USAGE_KV || !sessionKey) return null;
  try {
    const normTarget = (targetModel === "default" || targetModel === "auto" || !targetModel) ? "auto" : targetModel.toLowerCase();
    const pinKey = "session_pin:" + sessionKey + ":" + normTarget;
    const pin = await env.USAGE_KV.get(pinKey, { type: "json" });
    if (pin && pin.provider && pin.model) {
      const matched = pool.find(c =>
        c.provider.toLowerCase() === pin.provider.toLowerCase() &&
        c.model.toLowerCase() === pin.model.toLowerCase()
      );
      if (matched) return matched;
    }
  } catch (e) {
    console.warn("getSessionPinnedCandidate error:", e);
  }
  return null;
}

// 记录会话锁定的模型（异步，0 延迟阻断）
async function recordSessionPin(env, sessionKey, targetModel, provider, model) {
  if (!env.USAGE_KV || !sessionKey) return;
  try {
    const normTarget = (targetModel === "default" || targetModel === "auto" || !targetModel) ? "auto" : targetModel.toLowerCase();
    const pinKey = "session_pin:" + sessionKey + ":" + normTarget;
    const pinData = {
      provider,
      model,
      pinned_at: Date.now()
    };
    await env.USAGE_KV.put(pinKey, JSON.stringify(pinData), { expirationTtl: 14400 });
  } catch (e) {
    console.error("recordSessionPin error:", e);
  }
}

function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === "string") return item;
        if (item.type === "text") return item.text;
        return "";
      })
      .join("\n");
  }
  return String(content || "");
}

function extractPromptSummary(messages, maxLen = 600) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const userMessages = messages.filter(m => m && m.role === "user");
  if (userMessages.length === 0) return "";

  const realUserMsgs = userMessages.filter(m => {
    const text = normalizeContent(m.content).trim();
    return !text.startsWith("OpenClaw runtime context") && !text.includes("<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>");
  });

  const targetMsg = realUserMsgs.length > 0 ? realUserMsgs[realUserMsgs.length - 1] : userMessages[userMessages.length - 1];
  let text = normalizeContent(targetMsg.content).trim();

  if (text.includes("<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>")) {
    text = text.split("<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>")[0].trim();
  }
  if (text.includes("OpenClaw runtime context for the immediately preceding user message")) {
    text = text.split("OpenClaw runtime context for the immediately preceding user message")[0].trim();
  }

  const prefix = userMessages.length > 1 ? `[第${userMessages.length}轮] ` : "";
  const full = prefix + text;
  if (full.length <= maxLen) return full;
  return full.slice(0, maxLen) + "...";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Anthropic tools 定义 -> OpenAI function tools
function anthropicToolsToOpenAI(tools) {
  return tools.map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.input_schema || { type: "object", properties: {} }
    }
  }));
}

// Anthropic tool_choice -> OpenAI tool_choice
function anthropicToolChoiceToOpenAI(choice) {
  if (!choice || typeof choice !== "object") return "auto";
  if (choice.type === "any") return "required";
  if (choice.type === "tool" && choice.name) return { type: "function", function: { name: choice.name } };
  if (choice.type === "none") return "none";
  return "auto";
}

// Anthropic messages -> OpenAI messages, 含 tool_use / tool_result 块转换
function convertMessagesToOpenAI(messages, keepImageContent) {
  const converted = [];
  for (const m of messages) {
    const contentArr = Array.isArray(m.content) ? m.content : null;

    if (keepImageContent && contentArr && contentArr.some(p => p && (p.type === "image" || p.type === "image_url" || p.image_url))) {
      converted.push({ role: m.role, content: contentArr });
      continue;
    }

    if (m.role === "assistant") {
      const toolUses = contentArr ? contentArr.filter(p => p && p.type === "tool_use") : [];
      const openaiToolCalls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      const textContent = contentArr
        ? contentArr.filter(p => p && p.type === "text").map(p => p.text || "").join("\n")
        : (typeof m.content === "string" ? m.content : "");
      if (toolUses.length > 0 || openaiToolCalls.length > 0) {
        converted.push({
          role: "assistant",
          content: textContent.length > 0 ? textContent : null,
          tool_calls: toolUses.length > 0
            ? toolUses.map(t => ({
                id: t.id || ("toolu_" + Math.random().toString(36).slice(2, 12)),
                type: "function",
                function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) }
              }))
            : openaiToolCalls
        });
      } else {
        converted.push({ role: "assistant", content: textContent });
      }
      continue;
    }

    if (m.role === "user" && contentArr && contentArr.some(p => p && p.type === "tool_result")) {
      for (const p of contentArr) {
        if (p && p.type === "tool_result") {
          converted.push({ role: "tool", tool_call_id: p.tool_use_id, content: normalizeContent(p.content) });
        }
      }
      const userText = contentArr.filter(p => p && p.type === "text").map(p => p.text || "").join("\n");
      if (userText.length > 0) converted.push({ role: "user", content: userText });
      continue;
    }

    if (m.role === "tool" && m.tool_call_id) {
      converted.push({ role: "tool", tool_call_id: m.tool_call_id, content: normalizeContent(m.content) });
      continue;
    }

    converted.push({ role: m.role, content: normalizeContent(m.content) });
  }
  return converted;
}

// 估算 Token 数量 (保底备用)
function estimateTokens(text) {
  if (!text) return 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fa5) {
      count += 1.2;
    } else {
      count += 0.3;
    }
  }
  return Math.max(Math.round(count), 1);
}

// 记录精准请求统计数据到 KV
// 统计写入 5 分钟批量落盘: 增量记内存, 到点读最新文档合并增量后写回 (免费版 KV 每日 1000 写额度, 仪表盘数据最多滞后 5 分钟)
const STATS_FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const statsBuffer = { date: null, dirty: false, delta: null, logs: null, lastFlush: Date.now() };

function emptyStatsDelta() {
  return { requests_total: 0, tokens_total: 0, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, models: {}, users: {}, providers: {} };
}

function mergeStatsDelta(doc, d, includeModels) {
  doc.requests_total = (doc.requests_total || 0) + d.requests_total;
  doc.tokens_total = (doc.tokens_total || 0) + d.tokens_total;
  doc.prompt_tokens = (doc.prompt_tokens || 0) + d.prompt_tokens;
  doc.completion_tokens = (doc.completion_tokens || 0) + d.completion_tokens;
  doc.cached_tokens = (doc.cached_tokens || 0) + d.cached_tokens;
  doc.reasoning_tokens = (doc.reasoning_tokens || 0) + d.reasoning_tokens;
  if (includeModels) {
    if (!doc.models) doc.models = {};
    for (const [m, s] of Object.entries(d.models)) {
      if (!doc.models[m]) doc.models[m] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
      doc.models[m].requests += s.requests;
      doc.models[m].tokens += s.tokens;
      doc.models[m].cached_tokens += s.cached_tokens;
      doc.models[m].reasoning_tokens += s.reasoning_tokens;
      doc.models[m].prompt_tokens += s.prompt_tokens;
      doc.models[m].completion_tokens += s.completion_tokens;
    }
  }
  if (!doc.users) doc.users = {};
  for (const [u, s] of Object.entries(d.users)) {
    if (!doc.users[u]) doc.users[u] = { requests: 0, tokens: 0, cached_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
    doc.users[u].requests += s.requests;
    doc.users[u].tokens += s.tokens;
    doc.users[u].cached_tokens += s.cached_tokens;
    doc.users[u].prompt_tokens += s.prompt_tokens;
    doc.users[u].completion_tokens += s.completion_tokens;
  }
  if (!doc.providers) doc.providers = {};
  for (const [p, s] of Object.entries(d.providers || {})) {
    if (!doc.providers[p]) doc.providers[p] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
    doc.providers[p].requests += s.requests;
    doc.providers[p].tokens += s.tokens;
    doc.providers[p].cached_tokens += s.cached_tokens;
    doc.providers[p].reasoning_tokens += s.reasoning_tokens;
    doc.providers[p].prompt_tokens += s.prompt_tokens;
    doc.providers[p].completion_tokens += s.completion_tokens;
  }
}

async function flushStatsBuffer(env) {
  if (!statsBuffer.dirty || !env.USAGE_KV || !statsBuffer.date) return;
  const targetDate = statsBuffer.date;
  const dayKey = "stats_" + targetDate;
  const d = statsBuffer.delta;
  const logsToFlush = statsBuffer.logs;
  statsBuffer.delta = emptyStatsDelta();
  statsBuffer.dirty = false;
  statsBuffer.lastFlush = Date.now();

  try {
    const dayDoc = (await env.USAGE_KV.get(dayKey, { type: "json" })) || { date: targetDate, requests_total: 0, tokens_total: 0, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, models: {}, users: {}, providers: {} };

    if ((!dayDoc.providers || Object.keys(dayDoc.providers).length === 0) && logsToFlush && logsToFlush.length > 0) {
      if (!dayDoc.providers) dayDoc.providers = {};
      for (const log of logsToFlush) {
        if (log.time && !log.time.startsWith(targetDate)) continue;
        if (log.provider) {
          if (!dayDoc.providers[log.provider]) {
            dayDoc.providers[log.provider] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
          }
          dayDoc.providers[log.provider].requests += 1;
          dayDoc.providers[log.provider].tokens += log.tokens || 0;
          dayDoc.providers[log.provider].cached_tokens += log.cached_tokens || 0;
          dayDoc.providers[log.provider].reasoning_tokens += log.reasoning_tokens || 0;
          const pTok = log.prompt_tokens || Math.round((log.tokens || 0) * 0.9);
          const cTok = log.completion_tokens || ((log.tokens || 0) - pTok);
          dayDoc.providers[log.provider].prompt_tokens += pTok;
          dayDoc.providers[log.provider].completion_tokens += cTok;
        }
      }
    }

    mergeStatsDelta(dayDoc, d, true);
    await env.USAGE_KV.put(dayKey, JSON.stringify(dayDoc), { expirationTtl: 86400 * 180 });
    const g = (await env.USAGE_KV.get("stats_all_time", { type: "json" })) || { requests_total: 0, tokens_total: 0, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, users: {}, providers: {} };
    mergeStatsDelta(g, d, false);
    await env.USAGE_KV.put("stats_all_time", JSON.stringify(g));
    if (logsToFlush) await env.USAGE_KV.put("recent_logs", JSON.stringify(logsToFlush));
  } catch (e) {
    console.error("flushStatsBuffer error:", e);
  }
}

async function recordUsage(env, data) {
  if (!env.USAGE_KV) return;
  try {
    const today = getBeijingDateStr();
    if (statsBuffer.date !== today) {
      if (statsBuffer.date !== null && statsBuffer.dirty) {
        await flushStatsBuffer(env);
      }
      statsBuffer.date = today;
      statsBuffer.delta = emptyStatsDelta();
      statsBuffer.dirty = false;
    }

    const model = data.model || "unknown";
    const userName = data.user || "管理员 (本人)";
    const provider = data.provider || "auto";
    const promptTokens = data.prompt_tokens || 0;
    const completionTokens = data.completion_tokens || 0;
    const cachedTokens = data.cached_tokens || 0;
    const reasoningTokens = data.reasoning_tokens || 0;
    const totalTokens = promptTokens + completionTokens;

    const d = statsBuffer.delta;
    d.requests_total += 1;
    d.tokens_total += totalTokens;
    d.prompt_tokens += promptTokens;
    d.completion_tokens += completionTokens;
    d.cached_tokens += cachedTokens;
    d.reasoning_tokens += reasoningTokens;
    if (!d.models[model]) d.models[model] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
    const dm = d.models[model];
    dm.requests += 1;
    dm.tokens += totalTokens;
    dm.cached_tokens += cachedTokens;
    dm.reasoning_tokens += reasoningTokens;
    dm.prompt_tokens += promptTokens;
    dm.completion_tokens += completionTokens;
    if (!d.users[userName]) d.users[userName] = { requests: 0, tokens: 0, cached_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
    const du = d.users[userName];
    du.requests += 1;
    du.tokens += totalTokens;
    du.cached_tokens += cachedTokens;
    du.prompt_tokens += promptTokens;
    du.completion_tokens += completionTokens;
    if (!d.providers) d.providers = {};
    if (!d.providers[provider]) d.providers[provider] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
    const dp = d.providers[provider];
    dp.requests += 1;
    dp.tokens += totalTokens;
    dp.cached_tokens += cachedTokens;
    dp.reasoning_tokens += reasoningTokens;
    dp.prompt_tokens += promptTokens;
    dp.completion_tokens += completionTokens;

    if (statsBuffer.logs === null) {
      statsBuffer.logs = (await env.USAGE_KV.get("recent_logs", { type: "json" })) || [];
    }
    const nowBeijing = new Date().toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).replace(/\//g, "-");
    statsBuffer.logs.unshift({
      time: nowBeijing,
      user: userName,
      model: model,
      routed_model: data.routed_model || model,
      provider: data.provider || "auto",
      tokens: totalTokens,
      cached_tokens: cachedTokens,
      reasoning_tokens: reasoningTokens,
      duration_ms: data.duration_ms || 0,
      prompt: data.prompt || "",
      status: "200 OK"
    });
    if (statsBuffer.logs.length > 60) statsBuffer.logs = statsBuffer.logs.slice(0, 60);
    statsBuffer.dirty = true;

    if (Date.now() - statsBuffer.lastFlush >= STATS_FLUSH_INTERVAL_MS) {
      await flushStatsBuffer(env);
    }
  } catch (e) {
    console.error("KV Record Error:", e);
  }
}

// 辅助：获取日期列表
function getDateRangeArray(startDateStr, endDateStr) {
  const dates = [];
  let current = new Date(startDateStr + "T00:00:00Z");
  const end = new Date(endDateStr + "T00:00:00Z");
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

// 从模型明细推导供应商统计（用于历史无 providers 字段的聚合回退与跨时段统计）
function deriveProvidersFromModels(models) {
  if (!models || typeof models !== "object") return null;
  const MODEL_TO_PROVIDER = {
    "gemma-4-31b": "eaglesine",
    "gpt-oss-120b": "eaglesine",
    "qwen3.8-27b": "eaglesine",
    "kimi-k2.6": "eaglesine",
    "deepseek-v4-flash": "eaglesine",
    "sensenova-6.8-flash-lite": "sensenova",
    "glm-5.2": "sensenova",
    "deepseek-v4-pro": "sensenova",
    "hy3": "bai",
    "mimo-v2.5": "bai",
    "glm-5.3-flash": "volces",
    "grok-4.6": "bai",
    "grok-4.5": "bai",
    "deepseek-v4-flash-vision-exp": "amd",
    "deepseek-v4.1-flash": "amd",
    "qwen3.8-flash-next": "amd",
    "minicpm5-2b": "amd",
    "mimo-v2.6-flash": "amd",
    "meta/muse-spark-1.3-contributor": "opencode",
    "poolside/laguna-s-2.1": "opencode",
    "upstage/solar-pro4": "opencode",
    "intern-latest": "internai",
    "intern-s2": "internai",
    "intern-s1-pro": "internai",
    "internvl-latest": "internai",
    "deepseek-v4-flash-0731": "discovery",
    "deepseek-v4-flash-vision": "discovery",
    "deepseek-v4-pro-0813": "discovery",
    "glm-5.3": "discovery",
    "minimax-m3": "discovery",
    "qwen/qwen3.8-27b:free": "openrouter",
    "z-ai/glm-5.2:free": "openrouter",
    "google/gemma-4-26b-a4b-it:free": "openrouter",
    "google/gemma-4-31b-it:free": "openrouter",
    "nvidia/nemotron-3.5-lightning:free": "openrouter",
    "thinkingmachines/inkling:free": "openrouter",
    "nvidia/nemotron-3-ultra-550b-a55b:free": "openrouter",
    "stealth/space-bunny-alpha": "openrouter",
    "space-bunny-alpha": "openrouter",
    "space-bunny": "openrouter"
  };
  const autoShares = { volces: 0.35, eaglesine: 0.35, sensenova: 0.15, internai: 0.10, amd: 0.05 };
  const res = {};
  for (const [m, s] of Object.entries(models)) {
    const mLower = String(m || "").toLowerCase();
    if (mLower === "auto" || mLower === "default" || mLower.startsWith("claude")) {
      for (const [p, share] of Object.entries(autoShares)) {
        if (!res[p]) res[p] = { requests: 0, tokens: 0, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0, reasoning_tokens: 0 };
        res[p].requests += Math.round((s.requests || 0) * share);
        res[p].tokens += Math.round((s.tokens || 0) * share);
        res[p].prompt_tokens += Math.round((s.prompt_tokens || 0) * share);
        res[p].completion_tokens += Math.round((s.completion_tokens || 0) * share);
        res[p].cached_tokens += Math.round((s.cached_tokens || 0) * share);
        res[p].reasoning_tokens += Math.round((s.reasoning_tokens || 0) * share);
      }
    } else {
      const p = MODEL_TO_PROVIDER[m] || MODEL_TO_PROVIDER[mLower] || "eaglesine";
      if (!res[p]) res[p] = { requests: 0, tokens: 0, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0, reasoning_tokens: 0 };
      res[p].requests += s.requests || 0;
      res[p].tokens += s.tokens || 0;
      res[p].prompt_tokens += s.prompt_tokens || 0;
      res[p].completion_tokens += s.completion_tokens || 0;
      res[p].cached_tokens += s.cached_tokens || 0;
      res[p].reasoning_tokens += s.reasoning_tokens || 0;
    }
  }
  return res;
}

// 合并未落盘 live delta 到统计对象中
function mergeLiveDeltaToAggregated(aggregated, d) {
  if (!d) return;
  aggregated.requests_total += d.requests_total || 0;
  aggregated.tokens_total += d.tokens_total || 0;
  aggregated.prompt_tokens += d.prompt_tokens || 0;
  aggregated.completion_tokens += d.completion_tokens || 0;
  aggregated.cached_tokens += d.cached_tokens || 0;
  aggregated.reasoning_tokens += d.reasoning_tokens || 0;
  for (const [p, s] of Object.entries(d.providers || {})) {
    if (!aggregated.providers[p]) aggregated.providers[p] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
    aggregated.providers[p].requests += s.requests || 0;
    aggregated.providers[p].tokens += s.tokens || 0;
    aggregated.providers[p].cached_tokens += s.cached_tokens || 0;
    aggregated.providers[p].reasoning_tokens += s.reasoning_tokens || 0;
    aggregated.providers[p].prompt_tokens += s.prompt_tokens || 0;
    aggregated.providers[p].completion_tokens += s.completion_tokens || 0;
  }
  for (const [m, s] of Object.entries(d.models || {})) {
    if (!aggregated.models[m]) aggregated.models[m] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
    aggregated.models[m].requests += s.requests || 0;
    aggregated.models[m].tokens += s.tokens || 0;
    aggregated.models[m].cached_tokens += s.cached_tokens || 0;
    aggregated.models[m].reasoning_tokens += s.reasoning_tokens || 0;
    aggregated.models[m].prompt_tokens += s.prompt_tokens || 0;
    aggregated.models[m].completion_tokens += s.completion_tokens || 0;
  }
  for (const [u, s] of Object.entries(d.users || {})) {
    if (u === "朋友 · 老张") continue;
    if (!aggregated.users[u]) aggregated.users[u] = { requests: 0, tokens: 0, cached_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
    aggregated.users[u].requests += s.requests || 0;
    aggregated.users[u].tokens += s.tokens || 0;
    aggregated.users[u].cached_tokens += s.cached_tokens || 0;
    aggregated.users[u].prompt_tokens += s.prompt_tokens || 0;
    aggregated.users[u].completion_tokens += s.completion_tokens || 0;
  }
}

// 统计数据内存微缓存: 20 秒 TTL, 解决连续切 Tab 或高频刷新反复拉取多日 KV 的瓶颈
const STATS_MEM_CACHE = new Map();
const STATS_MEM_TTL_MS = 20000;

// 聚合数据
async function aggregateStats(env, rangeType, customStart, customEnd) {
  const cacheKey = (rangeType || "today") + "_" + (customStart || "") + "_" + (customEnd || "");
  const cached = STATS_MEM_CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.ts < STATS_MEM_TTL_MS)) {
    const clone = JSON.parse(JSON.stringify(cached.data));
    if (statsBuffer.dirty && statsBuffer.delta && statsBuffer.date && (statsBuffer.date >= clone.start_date && statsBuffer.date <= clone.end_date)) {
      mergeLiveDeltaToAggregated(clone, statsBuffer.delta);
    }
    return clone;
  }

  const todayStr = getBeijingDateStr();
  let startStr = todayStr;
  let endStr = todayStr;
  let rangeLabel = "今日";

  if (rangeType === "7d") {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    d.setUTCDate(d.getUTCDate() - 6);
    startStr = d.toISOString().slice(0, 10);
    rangeLabel = "近 7 天 (近一周)";
  } else if (rangeType === "30d") {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    d.setUTCDate(d.getUTCDate() - 29);
    startStr = d.toISOString().slice(0, 10);
    rangeLabel = "近 30 天 (近一月)";
  } else if (rangeType === "custom" && customStart && customEnd) {
    startStr = customStart;
    endStr = customEnd;
    rangeLabel = `自定义范围 (${customStart} ~ ${customEnd})`;
  } else if (rangeType === "all") {
    rangeLabel = "历史全部累计";
  }

  let aggregated = {
    range: rangeType || "today",
    range_label: rangeLabel,
    start_date: startStr,
    end_date: endStr,
    requests_total: 0,
    tokens_total: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    cached_tokens: 0,
    reasoning_tokens: 0,
    models: {},
    users: {},
    providers: {},
    active_users_count: 0,
    daily_timeline: []
  };

  if (!env.USAGE_KV) return aggregated;

  if (rangeType === "all") {
    const globalStats = await env.USAGE_KV.get("stats_all_time", { type: "json" }) || {};
    aggregated.requests_total = globalStats.requests_total || 0;
    aggregated.tokens_total = globalStats.tokens_total || 0;
    aggregated.prompt_tokens = globalStats.prompt_tokens || 0;
    aggregated.completion_tokens = globalStats.completion_tokens || 0;
    aggregated.cached_tokens = globalStats.cached_tokens || 0;
    aggregated.reasoning_tokens = globalStats.reasoning_tokens || 0;
    aggregated.users = globalStats.users || {};
    delete aggregated.users["朋友 · 老张"];

    // 全局累计文档不含模型维度与逐日明细，从日桶汇总补齐 (日桶保留 180 天)
    let cursor;
    do {
      const listPage = await env.USAGE_KV.list({ prefix: "stats_", cursor });
      const validKeys = listPage.keys.filter(k => k.name !== "stats_all_time");
      const dayDataList = await Promise.all(validKeys.map(k => env.USAGE_KV.get(k.name, { type: "json" })));
      validKeys.forEach((k, idx) => {
        const dayData = dayDataList[idx];
        if (!dayData) return;
        aggregated.daily_timeline.push({
          date: k.name.slice(6),
          full_date: k.name.slice(6),
          tokens: dayData.tokens_total || 0,
          requests: dayData.requests_total || 0,
          prompt_tokens: dayData.prompt_tokens || 0,
          completion_tokens: dayData.completion_tokens || 0,
          cached_tokens: dayData.cached_tokens || 0
        });
        if (dayData.models) {
          for (const [m, s] of Object.entries(dayData.models)) {
            if (!aggregated.models[m]) {
              aggregated.models[m] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
            }
            aggregated.models[m].requests += s.requests || 0;
            aggregated.models[m].tokens += s.tokens || 0;
            aggregated.models[m].cached_tokens += s.cached_tokens || 0;
            aggregated.models[m].reasoning_tokens += s.reasoning_tokens || 0;
            aggregated.models[m].prompt_tokens += s.prompt_tokens || 0;
            aggregated.models[m].completion_tokens += s.completion_tokens || 0;
          }
        }
        const dayProviders = dayData.providers || deriveProvidersFromModels(dayData.models);
        if (dayProviders) {
          for (const [p, s] of Object.entries(dayProviders)) {
            if (!aggregated.providers[p]) {
              aggregated.providers[p] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
            }
            aggregated.providers[p].requests += s.requests || 0;
            aggregated.providers[p].tokens += s.tokens || 0;
            aggregated.providers[p].cached_tokens += s.cached_tokens || 0;
            aggregated.providers[p].reasoning_tokens += s.reasoning_tokens || 0;
            aggregated.providers[p].prompt_tokens += s.prompt_tokens || 0;
            aggregated.providers[p].completion_tokens += s.completion_tokens || 0;
          }
        }
      });
      cursor = listPage.list_complete ? undefined : listPage.cursor;
    } while (cursor);
    aggregated.daily_timeline.sort((a, b) => a.full_date.localeCompare(b.full_date));

    // 合并内存未刷盘 delta
    if (statsBuffer.dirty && statsBuffer.delta) {
      const d = statsBuffer.delta;
      aggregated.requests_total += d.requests_total || 0;
      aggregated.tokens_total += d.tokens_total || 0;
      aggregated.prompt_tokens += d.prompt_tokens || 0;
      aggregated.completion_tokens += d.completion_tokens || 0;
      aggregated.cached_tokens += d.cached_tokens || 0;
      aggregated.reasoning_tokens += d.reasoning_tokens || 0;
      for (const [p, s] of Object.entries(d.providers || {})) {
        if (!aggregated.providers[p]) aggregated.providers[p] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
        aggregated.providers[p].requests += s.requests || 0;
        aggregated.providers[p].tokens += s.tokens || 0;
        aggregated.providers[p].cached_tokens += s.cached_tokens || 0;
        aggregated.providers[p].reasoning_tokens += s.reasoning_tokens || 0;
        aggregated.providers[p].prompt_tokens += s.prompt_tokens || 0;
        aggregated.providers[p].completion_tokens += s.completion_tokens || 0;
      }
      for (const [m, s] of Object.entries(d.models || {})) {
        if (!aggregated.models[m]) aggregated.models[m] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
        aggregated.models[m].requests += s.requests || 0;
        aggregated.models[m].tokens += s.tokens || 0;
        aggregated.models[m].cached_tokens += s.cached_tokens || 0;
        aggregated.models[m].reasoning_tokens += s.reasoning_tokens || 0;
        aggregated.models[m].prompt_tokens += s.prompt_tokens || 0;
        aggregated.models[m].completion_tokens += s.completion_tokens || 0;
      }
      for (const [u, s] of Object.entries(d.users || {})) {
        if (u === "朋友 · 老张") continue;
        if (!aggregated.users[u]) aggregated.users[u] = { requests: 0, tokens: 0, cached_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
        aggregated.users[u].requests += s.requests || 0;
        aggregated.users[u].tokens += s.tokens || 0;
        aggregated.users[u].cached_tokens += s.cached_tokens || 0;
        aggregated.users[u].prompt_tokens += s.prompt_tokens || 0;
        aggregated.users[u].completion_tokens += s.completion_tokens || 0;
      }
    }

    // 历史补齐：若聚合统计无 providers，从 recent_logs 补齐
    if (Object.keys(aggregated.providers).length === 0) {
      const rLogs = (await env.USAGE_KV.get("recent_logs", { type: "json" })) || [];
      for (const log of rLogs) {
        if (log.provider) {
          if (!aggregated.providers[log.provider]) {
            aggregated.providers[log.provider] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
          }
          aggregated.providers[log.provider].requests += 1;
          aggregated.providers[log.provider].tokens += log.tokens || 0;
          aggregated.providers[log.provider].cached_tokens += log.cached_tokens || 0;
          aggregated.providers[log.provider].reasoning_tokens += log.reasoning_tokens || 0;
          const pTok = log.prompt_tokens || Math.round((log.tokens || 0) * 0.9);
          const cTok = log.completion_tokens || ((log.tokens || 0) - pTok);
          aggregated.providers[log.provider].prompt_tokens += pTok;
          aggregated.providers[log.provider].completion_tokens += cTok;
        }
      }
    }

    aggregated.active_users_count = Object.keys(aggregated.users).length;
    STATS_MEM_CACHE.set(cacheKey, { ts: Date.now(), data: JSON.parse(JSON.stringify(aggregated)) });
    return aggregated;
  }

  const dateList = getDateRangeArray(startStr, endStr);
  const fetchPromises = dateList.map(d => env.USAGE_KV.get(`stats_${d}`, { type: "json" }));
  const results = await Promise.all(fetchPromises);

  dateList.forEach((dStr, idx) => {
    const dayData = results[idx];
    const dayTokens = dayData ? dayData.tokens_total : 0;
    const dayRequests = dayData ? dayData.requests_total : 0;

    aggregated.daily_timeline.push({
      date: dStr.slice(5),
      full_date: dStr,
      tokens: dayTokens,
      requests: dayRequests,
      prompt_tokens: dayData ? dayData.prompt_tokens || 0 : 0,
      completion_tokens: dayData ? dayData.completion_tokens || 0 : 0,
      cached_tokens: dayData ? dayData.cached_tokens || 0 : 0
    });

    if (dayData) {
      aggregated.requests_total += dayData.requests_total || 0;
      aggregated.tokens_total += dayData.tokens_total || 0;
      aggregated.prompt_tokens += dayData.prompt_tokens || 0;
      aggregated.completion_tokens += dayData.completion_tokens || 0;
      aggregated.cached_tokens += dayData.cached_tokens || 0;
      aggregated.reasoning_tokens += dayData.reasoning_tokens || 0;

      if (dayData.models) {
        for (const [m, s] of Object.entries(dayData.models)) {
          if (!aggregated.models[m]) {
            aggregated.models[m] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
          }
          aggregated.models[m].requests += s.requests || 0;
          aggregated.models[m].tokens += s.tokens || 0;
          aggregated.models[m].cached_tokens += s.cached_tokens || 0;
          aggregated.models[m].reasoning_tokens += s.reasoning_tokens || 0;
          aggregated.models[m].prompt_tokens += s.prompt_tokens || 0;
          aggregated.models[m].completion_tokens += s.completion_tokens || 0;
        }
      }

      const dayProviders = dayData.providers || deriveProvidersFromModels(dayData.models);
      if (dayProviders) {
        for (const [p, s] of Object.entries(dayProviders)) {
          if (!aggregated.providers[p]) {
            aggregated.providers[p] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
          }
          aggregated.providers[p].requests += s.requests || 0;
          aggregated.providers[p].tokens += s.tokens || 0;
          aggregated.providers[p].cached_tokens += s.cached_tokens || 0;
          aggregated.providers[p].reasoning_tokens += s.reasoning_tokens || 0;
          aggregated.providers[p].prompt_tokens += s.prompt_tokens || 0;
          aggregated.providers[p].completion_tokens += s.completion_tokens || 0;
        }
      }

      if (dayData.users) {
        delete dayData.users["朋友 · 老张"];
        for (const [u, s] of Object.entries(dayData.users)) {
          if (!aggregated.users[u]) {
            aggregated.users[u] = { requests: 0, tokens: 0, cached_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
          }
          aggregated.users[u].requests += s.requests || 0;
          aggregated.users[u].tokens += s.tokens || 0;
          aggregated.users[u].cached_tokens += s.cached_tokens || 0;
          aggregated.users[u].prompt_tokens += s.prompt_tokens || 0;
          aggregated.users[u].completion_tokens += s.completion_tokens || 0;
        }
      }
    }
  });

  // 合并内存未刷盘 delta (若当前缓冲日期落在选定范围内)
  if (statsBuffer.dirty && statsBuffer.delta && statsBuffer.date && (statsBuffer.date >= startStr && statsBuffer.date <= endStr)) {
    const d = statsBuffer.delta;
    aggregated.requests_total += d.requests_total || 0;
    aggregated.tokens_total += d.tokens_total || 0;
    aggregated.prompt_tokens += d.prompt_tokens || 0;
    aggregated.completion_tokens += d.completion_tokens || 0;
    aggregated.cached_tokens += d.cached_tokens || 0;
    aggregated.reasoning_tokens += d.reasoning_tokens || 0;
    for (const [p, s] of Object.entries(d.providers || {})) {
      if (!aggregated.providers[p]) aggregated.providers[p] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
      aggregated.providers[p].requests += s.requests || 0;
      aggregated.providers[p].tokens += s.tokens || 0;
      aggregated.providers[p].cached_tokens += s.cached_tokens || 0;
      aggregated.providers[p].reasoning_tokens += s.reasoning_tokens || 0;
      aggregated.providers[p].prompt_tokens += s.prompt_tokens || 0;
      aggregated.providers[p].completion_tokens += s.completion_tokens || 0;
    }
    for (const [m, s] of Object.entries(d.models || {})) {
      if (!aggregated.models[m]) aggregated.models[m] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
      aggregated.models[m].requests += s.requests || 0;
      aggregated.models[m].tokens += s.tokens || 0;
      aggregated.models[m].cached_tokens += s.cached_tokens || 0;
      aggregated.models[m].reasoning_tokens += s.reasoning_tokens || 0;
      aggregated.models[m].prompt_tokens += s.prompt_tokens || 0;
      aggregated.models[m].completion_tokens += s.completion_tokens || 0;
    }
    for (const [u, s] of Object.entries(d.users || {})) {
      if (u === "朋友 · 老张") continue;
      if (!aggregated.users[u]) aggregated.users[u] = { requests: 0, tokens: 0, cached_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
      aggregated.users[u].requests += s.requests || 0;
      aggregated.users[u].tokens += s.tokens || 0;
      aggregated.users[u].cached_tokens += s.cached_tokens || 0;
      aggregated.users[u].prompt_tokens += s.prompt_tokens || 0;
      aggregated.users[u].completion_tokens += s.completion_tokens || 0;
    }
  }

  // 兜底补齐：若聚合统计无 providers，从 recent_logs 补齐
  if (Object.keys(aggregated.providers).length === 0 && env.USAGE_KV) {
    const rLogs = (await env.USAGE_KV.get("recent_logs", { type: "json" })) || [];
    for (const log of rLogs) {
      if (log.provider) {
        const logDate = (log.time || "").slice(0, 10);
        if (!logDate || (logDate >= startStr && logDate <= endStr)) {
          if (!aggregated.providers[log.provider]) {
            aggregated.providers[log.provider] = { requests: 0, tokens: 0, cached_tokens: 0, reasoning_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
          }
          aggregated.providers[log.provider].requests += 1;
          aggregated.providers[log.provider].tokens += log.tokens || 0;
          aggregated.providers[log.provider].cached_tokens += log.cached_tokens || 0;
          aggregated.providers[log.provider].reasoning_tokens += log.reasoning_tokens || 0;
          const pTok = log.prompt_tokens || Math.round((log.tokens || 0) * 0.9);
          const cTok = log.completion_tokens || ((log.tokens || 0) - pTok);
          aggregated.providers[log.provider].prompt_tokens += pTok;
          aggregated.providers[log.provider].completion_tokens += cTok;
        }
      }
    }
  }

  aggregated.active_users_count = Object.keys(aggregated.users).length;
  STATS_MEM_CACHE.set(cacheKey, { ts: Date.now(), data: JSON.parse(JSON.stringify(aggregated)) });
  return aggregated;
}

// ==========================================
// 🔍 AI 故障诊断与质量分析引擎
// ==========================================

function formatMarkdownToHtml(text) {
  if (!text) return "";
  let html = String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  html = html.replace(/^### (.*?)$/gm, '<h4 style="margin:16px 0 8px; color:#1e293b; font-size:15px; font-weight:700;">$1</h4>');
  html = html.replace(/^## (.*?)$/gm, '<h3 style="margin:20px 0 10px; color:#0f172a; font-size:17px; font-weight:700; border-bottom:1px solid #e2e8f0; padding-bottom:6px;">$1</h3>');
  html = html.replace(/^# (.*?)$/gm, '<h2 style="margin:22px 0 12px; color:#0f172a; font-size:19px; font-weight:800;">$1</h2>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#0f172a;">$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;color:#0284c7;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;font-weight:600;">$1</code>');
  html = html.replace(/^> (.*?)$/gm, '<div style="background:#f8fafc; border-left:4px solid #3b82f6; padding:8px 12px; margin:8px 0; color:#475569; font-size:13px; border-radius:0 6px 6px 0;">$1</div>');
  html = html.replace(/^\s*-\s+(.*?)$/gm, '<li style="margin-left:22px; margin-bottom:4px; line-height:1.6; color:#334155;">$1</li>');
  html = html.replace(/^---$/gm, '<hr style="border:none; border-top:1px solid #e2e8f0; margin:16px 0;">');
  html = html.replace(/\n\n/g, '<div style="height:8px;"></div>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function aggregateFailureMetrics(errors, stats, channelHealth = {}) {
  let filtered = Array.isArray(errors) ? errors : [];
  if (stats?.start_date) {
    const sDate = stats.start_date;
    const eDate = stats.end_date || sDate;
    filtered = filtered.filter(err => {
      if (!err.time) return true;
      const datePart = String(err.time).slice(0, 10);
      return datePart >= sDate && datePart <= eDate;
    });
  }
  const totalFailures = filtered.length;
  const terminalFailures = filtered.filter(err => err.is_terminal).length;
  const failoverAttempts = totalFailures - terminalFailures;
  const totalRequests = stats?.requests_total || 0;
  const overallFailRate = (totalFailures + totalRequests) > 0
    ? ((totalFailures / (totalFailures + totalRequests)) * 100).toFixed(1)
    : "0.0";
  const terminalFailRate = (terminalFailures + totalRequests) > 0
    ? ((terminalFailures / (terminalFailures + totalRequests)) * 100).toFixed(1)
    : "0.0";

  const byProvider = {};
  const byModel = {};
  let totalDuration = 0;

  for (const err of filtered) {
    const p = err.provider || "unknown";
    const m = err.upstream_model || err.routed_model || err.model || "unknown";
    const dur = Number(err.duration_ms) || 0;
    totalDuration += dur;

    if (!byProvider[p]) {
      byProvider[p] = {
        fails: 0,
        requests: stats?.providers?.[p]?.requests || 0,
        tokens: stats?.providers?.[p]?.tokens || 0,
        rate_limits: 0,
        timeouts: 0,
        server_errors: 0,
        other_errors: 0,
        total_duration: 0,
        sample_errors: [],
        models: {}
      };
    }
    const bp = byProvider[p];
    bp.fails += 1;
    bp.total_duration += dur;

    const errMsg = String(err.error || "");
    if (/429|rate_limit|tpm|rpm|exceeds/i.test(errMsg)) {
      bp.rate_limits += 1;
    } else if (/timeout|aborted|timed out|504/i.test(errMsg)) {
      bp.timeouts += 1;
    } else if (/500|502|503|server_error|internal/i.test(errMsg)) {
      bp.server_errors += 1;
    } else {
      bp.other_errors += 1;
    }

    if (bp.sample_errors.length < 3 && !bp.sample_errors.includes(errMsg)) {
      bp.sample_errors.push(errMsg);
    }
    bp.models[m] = (bp.models[m] || 0) + 1;

    const mKey = `${p}:${m}`;
    if (!byModel[mKey]) {
      byModel[mKey] = {
        provider: p,
        model: m,
        fails: 0,
        sample_errors: []
      };
    }
    byModel[mKey].fails += 1;
    if (byModel[mKey].sample_errors.length < 2 && !byModel[mKey].sample_errors.includes(errMsg)) {
      byModel[mKey].sample_errors.push(errMsg);
    }
  }

  if (stats?.providers) {
    for (const [p, s] of Object.entries(stats.providers)) {
      if (!byProvider[p]) {
        byProvider[p] = {
          fails: 0,
          requests: s.requests || 0,
          tokens: s.tokens || 0,
          rate_limits: 0,
          timeouts: 0,
          server_errors: 0,
          other_errors: 0,
          total_duration: 0,
          sample_errors: [],
          models: {}
        };
      }
    }
  }

  let worstProvider = null;
  let maxFails = -1;
  const providerList = Object.entries(byProvider).map(([p, s]) => {
    const totalCalls = s.fails + s.requests;
    const rate = totalCalls > 0 ? ((s.fails / totalCalls) * 100).toFixed(1) : "0.0";
    const avgDur = s.fails > 0 ? Math.round(s.total_duration / s.fails) : 0;
    const provName = (CONFIG.PROVIDER_NAMES && CONFIG.PROVIDER_NAMES[p]) || p;
    const isCircuitTripped = Boolean(channelHealth["p:" + p.toLowerCase()]?.open_until > Date.now());

    let status = "🟢 正常";
    if (isCircuitTripped) status = "🔥 熔断中";
    else if (s.fails >= 5 || parseFloat(rate) > 30) status = "🚨 高频异常";
    else if (s.fails > 0) status = "⚠️ 偶发异常";

    if (s.fails > maxFails) {
      maxFails = s.fails;
      worstProvider = provName;
    }

    return {
      provider: p,
      providerName: provName,
      fails: s.fails,
      requests: s.requests,
      tokens: s.tokens,
      failRate: rate,
      avgDurationMs: avgDur,
      rateLimits: s.rate_limits,
      timeouts: s.timeouts,
      serverErrors: s.server_errors,
      sampleErrors: s.sample_errors,
      status: status,
      isCircuitTripped
    };
  }).sort((a, b) => b.fails - a.fails);

  const modelList = Object.values(byModel).sort((a, b) => b.fails - a.fails);
  const avgDurationMs = totalFailures > 0 ? Math.round(totalDuration / totalFailures) : 0;
  const trippedChannelsCount = Object.keys(channelHealth).filter(k => channelHealth[k]?.open_until > Date.now()).length;

  return {
    totalFailures,
    terminalFailures,
    failoverAttempts,
    terminalFailRate,
    totalRequests,
    overallFailRate,
    worstProvider: maxFails > 0 ? worstProvider : "无故障",
    avgDurationMs,
    trippedChannelsCount,
    providers: providerList,
    models: modelList
  };
}

function generateRuleBasedDiagnosis(metrics, rangeLabel = "选定时间段") {
  if (metrics.totalFailures === 0) {
    return `### 📊 整体稳定性与服务评级：**A+ (极高稳定性)**
- **统计周期**：${rangeLabel}
- **请求总量**：共处理 ${metrics.totalRequests.toLocaleString()} 次请求，失败 0 次（失败率 **0.0%**）。
- **运行健康度**：所有活跃供应商与大模型均稳定响应，未触发任何限流（429）、超时或熔断。

---

### 🏢 供应商稳定性分析
- **全部活跃供应商**（${metrics.providers.map(p => p.providerName).join("、") || "全部"}）运行平稳，无任何报错记录。

---

### 💡 运维与路由调优建议
1. **策略维持**：现有负载均衡与故障转移链路表现优异，建议维持当前配置。
2. **容量冗余**：保底渠道与熔断恢复机制运行正常，具备良好的突发流量抵御能力。`;
  }

  const rateNum = parseFloat(metrics.overallFailRate);
  let grade = "B+ (基本稳定)";
  if (rateNum > 50) grade = "D (高风险 · 严重不稳定)";
  else if (rateNum > 25) grade = "C (中风险 · 频发故障)";
  else if (rateNum > 10) grade = "B (一般 · 局部异常)";

  const topFailedProv = metrics.providers.filter(p => p.fails > 0);
  const zeroFailProv = metrics.providers.filter(p => p.fails === 0 && p.requests > 0);

  return `### 📊 整体稳定性与服务评级：**${grade}**
- **统计周期**：${rangeLabel}
- **请求与失败概况**：周期内总请求 ${metrics.totalRequests} 次，记录失败 **${metrics.totalFailures} 次**，综合调用失败率为 **${metrics.overallFailRate}%**。
- **平均失败耗时**：${metrics.avgDurationMs} ms。
- **核心故障根因**：${topFailedProv.map(p => `${p.providerName} (${p.rateLimits > 0 ? '429 限流超额 ' + p.rateLimits + ' 次' : ''}${p.timeouts > 0 ? ' 超时中断 ' + p.timeouts + ' 次' : ''})`).join('；') || '未知异常'}。

---

### 🏢 供应商服务质量对比
${topFailedProv.map(p => `#### 🚨 ${p.providerName} (\`${p.provider}\`) · 失败率 **${p.failRate}%**
- **指标统计**：成功 ${p.requests} 次 / 失败 **${p.fails} 次** / 产生 Token: ${p.tokens.toLocaleString()}
- **故障构成**：${p.rateLimits > 0 ? `429 配额限流 **${p.rateLimits} 次**; ` : ''}${p.timeouts > 0 ? `请求超时/中断 **${p.timeouts} 次**; ` : ''}${p.serverErrors > 0 ? `服务端 5xx **${p.serverErrors} 次**; ` : ''}
- **典型报错**：${p.sampleErrors.slice(0, 2).map(e => `\`${e.replace(/[\r\n]+/g, ' ')}\``).join('、') || '无'}
- **质量定级**：${parseFloat(p.failRate) > 50 ? '⚠️ **不合格 (严重阻塞)**' : '⚡ **需重点关注**'}
`).join('\n')}
${zeroFailProv.length > 0 ? `#### 🏆 高稳定性供应商表现
${zeroFailProv.map(p => `- **${p.providerName}**：处理 ${p.requests} 次请求，消耗 ${p.tokens.toLocaleString()} Tokens，**0 失败，失败率 0.0%**，表现极佳。`).join('\n')}
` : ''}

---

### 🤖 重点故障模型诊断
${metrics.models.slice(0, 5).map((m, idx) => `${idx + 1}. **\`${m.model}\`** (渠道: \`${m.provider}\`)：累计失败 **${m.fails} 次**，主要错误：\`${(m.sample_errors[0] || '未知').slice(0, 100)}\``).join('\n')}

---

### 💡 落地优化与路由调优建议
1. **【P0 紧急】优化高频限流渠道**：针对 429 报错频繁的供应商（如 ${topFailedProv[0]?.providerName || '相关供应商'}），建议在控制台提升 TPM/RPM 额度，或在网关【模型管理】中调低其在 auto 智选池中的排序权重。
2. **【P1 路由优化】前置高可用健康渠道**：将表现优异的供应商（如 ${zeroFailProv[0]?.providerName || '稳定渠道'}）或保底渠道前置，优先承接并发流量。
3. **【P2 超时治理】针对长耗时超时模型**：对多次出现 45s~90s 超时中止的模型，建议检查上下文长度，或在【模型管理】中临时下架该渠道并启用性能更快的备用模型。`;
}

async function callInternalAi(env, runtimeCfg, messages) {
  const channelHealth = await getChannelHealth(env);
  const pool = (runtimeCfg.auto_pool || CONFIG.AUTO_CANDIDATES);
  const openChannels = filterOpenChannels(channelHealth, filterDisabledChannels(runtimeCfg, pool));
  
  const candidates = [
    ...openChannels.filter(c => c.provider === "cloudflare"),
    ...openChannels.filter(c => c.provider === "volces"),
    ...openChannels.filter(c => c.provider === "eaglesine"),
    ...openChannels.filter(c => c.provider !== "cloudflare" && c.provider !== "volces" && c.provider !== "eaglesine")
  ];

  if (candidates.length === 0) throw new Error("No available channels for internal AI call.");

  for (const candidate of candidates.slice(0, 4)) {
    const providerInfo = CONFIG.PROVIDERS[candidate.provider];
    if (!providerInfo) continue;
    if (candidate.provider === "cloudflare" && env.AI) {
      try {
        const cfModel = CF_MODEL_MAP[candidate.model] || candidate.model;
        const cfRes = await env.AI.run(cfModel, {
          messages: messages,
          temperature: 0.3,
          max_tokens: 2500
        });
        const text = cfRes?.choices?.[0]?.message?.content || cfRes?.response;
        if (text && text.trim()) {
          return { text, provider: candidate.provider, model: candidate.model };
        }
      } catch (e) {
        console.warn(`Internal AI diagnosis call to cloudflare/${candidate.model} failed:`, e);
      }
      continue;
    }
    const apiKey = getProviderApiKey(providerInfo);
    if (!apiKey) continue;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(`${providerInfo.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: candidate.model,
          messages: messages,
          temperature: 0.3,
          max_tokens: 2500
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      const raw = (data && data.data && Array.isArray(data.data.choices)) ? data.data : data;
      const text = raw?.choices?.[0]?.message?.content;
      if (text && text.trim()) {
        return { text, provider: candidate.provider, model: candidate.model };
      }
    } catch (e) {
      console.warn(`Internal AI diagnosis call to ${candidate.provider}/${candidate.model} failed:`, e);
    }
  }
  throw new Error("All AI candidates failed to respond.");
}

async function runAiFailureDiagnosis(env, runtimeCfg, metrics, rangeLabel = "选定时间段") {
  if (metrics.totalFailures === 0) {
    return generateRuleBasedDiagnosis(metrics, rangeLabel);
  }

  const prompt = `请基于以下 AI 网关在【${rangeLabel}】的真实调用失败记录与统计数据，以资深大模型基础设施架构师和 SRE 专家的身份，进行深入客观的质量分析并给出优化建议：

【监控数据汇总】
- 时间跨度：${rangeLabel}
- 成功请求量：${metrics.totalRequests} 次
- 终态失败数（用户感知失败）：${metrics.terminalFailures || 0} 次 (终态失败率: ${metrics.terminalFailRate || metrics.overallFailRate}%)
- 容灾重试数（网关自动重试吸纳的中间故障）：${metrics.failoverAttempts || 0} 次
- 渠道级调用失败记录总数：${metrics.totalFailures} 次 (渠道级尝试失败率: ${metrics.overallFailRate}%)
- 失败调用平均耗时：${metrics.avgDurationMs} ms
- 当前熔断中渠道数：${metrics.trippedChannelsCount} 个

【各供应商指标】
${metrics.providers.map(p => `- ${p.providerName} (${p.provider}): 成功 ${p.requests} 次, 失败 ${p.fails} 次 (失败率 ${p.failRate}%), 429限流 ${p.rateLimits} 次, 超时中断 ${p.timeouts} 次, 服务端5xx ${p.serverErrors} 次, 典型报错: ${p.sampleErrors.join(" | ") || "无"}`).join("\n")}

【高频故障模型】
${metrics.models.slice(0, 6).map(m => `- 模型 ${m.model} (渠道 ${m.provider}): 失败 ${m.fails} 次, 典型报错: ${m.sample_errors.join(" | ")}`).join("\n")}

请按以下 4 个结构化板块输出严谨专业、条理清晰的 Markdown 分析报告：
### 1. 📊 整体稳定性与服务评级（综合评定 A/B/C/D 级别，客观测算真实用户 SLA，区分终态失败与容灾重试，概括核心风险）
### 2. 🏢 各供应商服务质量深度剖析（逐个剖析稳定性高低、瓶颈原因、并发承受力）
### 3. 🤖 模型故障模式诊断（精准指出具体模型是在 429 TPM/RPM 超限还是耗时超时中断）
### 4. 💡 落地优化与路由调优建议（按【P0 紧急】、【P1 路由优化】、【P2 长期治理】优先级给出可直接在网关或控制台执行的调优策略）`;

  try {
    const aiResult = await callInternalAi(env, runtimeCfg, [
      { role: "system", content: "你是一位资深大模型基础设施架构师与 SRE 专家。请给出专业客观、数据详实、排版优雅的网关质量分析与优化建议，使用标准 Markdown 格式。" },
      { role: "user", content: prompt }
    ]);
    if (aiResult && aiResult.text) {
      return aiResult.text + `\n\n> 💡 *本诊断由 ${aiResult.provider} · ${aiResult.model} 深度分析生成*`;
    }
  } catch (err) {
    console.warn("AI diagnosis call error, fallback to rule-based:", err);
  }

  return generateRuleBasedDiagnosis(metrics, rangeLabel);
}

async function getOrRunAiDiagnosis(env, runtimeCfg, stats, recentErrors, forceRefresh = false) {
  const channelHealth = await getChannelHealth(env);
  const metrics = aggregateFailureMetrics(recentErrors, stats, channelHealth);
  const cacheKey = `ai_diag_${stats?.range || 'today'}`;

  if (!forceRefresh && env.USAGE_KV) {
    const cached = await env.USAGE_KV.get(cacheKey, { type: "json" });
    if (cached && cached.report && (Date.now() - (cached.timestamp || 0) < 2 * 3600 * 1000)) {
      return { metrics, report: cached.report, cached: true, timestamp: cached.timestamp };
    }
  }

  const report = await runAiFailureDiagnosis(env, runtimeCfg, metrics, stats?.range_label || "选定时间段");
  if (env.USAGE_KV) {
    await env.USAGE_KV.put(cacheKey, JSON.stringify({ report, timestamp: Date.now() }), { expirationTtl: 86400 });
  }

  return { metrics, report, cached: false, timestamp: Date.now() };
}

// 渲染管理员登录密码界面
function renderLoginModal() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>身份验证 · AI 网关监控控制台</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; width: 100%; max-width: 420px; padding: 32px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); text-align: center; }
    .icon { width: 56px; height: 56px; background: #3b82f620; border: 2px solid #3b82f6; color: #60a5fa; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 20px; }
    h2 { font-size: 20px; font-weight: 700; margin-bottom: 8px; color: #ffffff; }
    p { font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px; }
    .input-group { text-align: left; margin-bottom: 20px; }
    label { display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
    input[type="password"] { width: 100%; background: #0f172a; border: 1px solid #475569; border-radius: 8px; padding: 12px 14px; font-size: 14px; color: #fff; outline: none; font-family: monospace; transition: border-color 0.2s; }
    input[type="password"]:focus { border-color: #3b82f6; }
    button { width: 100%; background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #1d4ed8; }
    .tip { font-size: 11px; color: #64748b; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h2>控制台身份验证</h2>
    <p>请输入已授权的 API Key 解锁控制台。</p>
    <form method="GET" action="/usage" onsubmit="saveCookie(event)">
      <div class="input-group">
        <label>API Key / Secret Key</label>
        <input type="password" id="key-input" name="key" placeholder="sk-..." required autofocus>
      </div>
      <button type="submit">解锁并进入控制台</button>
    </form>
    <div class="tip">验证成功后将自动记住当前会话登录状态</div>
  </div>
  <script>
    function saveCookie(e) {
      const key = document.getElementById('key-input').value.trim();
      if (key) {
        document.cookie = "admin_key=" + encodeURIComponent(key) + "; path=/; max-age=2592000; SameSite=Lax";
      }
    }
  </script>
</body>
</html>`;
}

// 渲染多用户与 API Key 管理统一 HTML 看板
// 公开接入文档页 (无需鉴权)
function renderDocsPage(modelList) {
  const modelChips = modelList.map(m => `<code style="background:#f1f5f9;color:#0f172a;padding:3px 8px;border-radius:6px;font-size:12px;margin:2px;display:inline-block;">${m}</code>`).join("");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>免费大模型网关 · 接入文档</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 24px; }
    .wrap { max-width: 860px; margin: 0 auto; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .sub { color: #64748b; font-size: 14px; margin-bottom: 20px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    h2 { font-size: 16px; margin-bottom: 10px; }
    p, li { font-size: 14px; line-height: 1.7; color: #334155; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 8px; font-size: 12px; overflow-x: auto; line-height: 1.6; }
    .chip-box { line-height: 2.2; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>免费大模型网关 · 接入文档</h1>
    <p class="sub">OpenAI 与 Claude 双协议兼容 · 多渠道自动容灾 · 使用量统计</p>

    <div class="card">
      <h2>接入信息</h2>
      <p>接口基址: <code>https://api.ailearning.top/v1</code>。鉴权方式为请求头 <code>Authorization: Bearer &lt;你的专属 Key&gt;</code>,专属 Key 请向管理员索取,请勿外传。</p>
    </div>

    <div class="card">
      <h2>调用示例</h2>
      <p>对话 (OpenAI 协议,兼容全部 OpenAI SDK,把 base_url 换成上述基址即可):</p>
      <pre>curl https://api.ailearning.top/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"你好"}]}'</pre>
      <p>对话 (Claude 协议,兼容 Anthropic SDK):</p>
      <pre>curl https://api.ailearning.top/v1/messages \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","max_tokens":1024,"messages":[{"role":"user","content":"你好"}]}'</pre>
      <p>文生图:</p>
      <pre>curl https://api.ailearning.top/v1/images/generations \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"sensenova-u1.5-lite","prompt":"一只橘猫,扁平插画"}'</pre>
      <p>提示: model 填 <code>auto</code> 即可自动在多个免费渠道间择优与容灾;带图片的请求会自动路由到视觉模型。</p>
    </div>

    <div class="card">
      <h2>可用模型 (${modelList.length} 个)</h2>
      <div class="chip-box">${modelChips}</div>
      <p style="margin-top: 8px; font-size: 13px; color: #64748b;">模型可能因上游免费期结束而下架,以本页实时列表为准;详见 <code>GET /v1/models</code>。</p>
    </div>

    <div class="card">
      <h2>常见错误</h2>
      <p><code>401 invalid_api_key</code>: Key 无效或已停用过期。<code>403 model_disabled</code>: 模型已下架,请换其他模型。<code>429 rate_limited / daily_quota_exceeded</code>: 触发限速或当日配额用尽,稍后再试。</p>
    </div>
  </div>
</body>
</html>`;
}

function renderDashboard(stats, recentLogs, runtimeCfg = { disabled_channels: [], auto_pool: null }, isAdminUser = false, page = "overview", apiKeys = null, keyUiState = null, recentErrors = [], aiDiagnosisData = null) {
  const currentRange = stats ? stats.range : "today";
  const showOverview = page === "overview";
  const showUsagePage = page === "usage";
  const showDiagnosisPage = page === "diagnosis";
  const showKeysPage = page === "keys";
  const showModelsPage = page === "models" && isAdminUser;
  const showTestPage = page === "test" && isAdminUser;
  const showChatPage = page === "chat" && isAdminUser;
  const maxDailyTokens = stats ? Math.max(...stats.daily_timeline.map(d => d.tokens), 1) : 1;
  const totalKeysCount = Object.keys(apiKeys || CONFIG.USER_KEYS).length;
  // 历史数据缺输入输出拆分时, 用该时段全局输入占比近似折算
  const ioRatio = stats && stats.tokens_total > 0 ? stats.prompt_tokens / stats.tokens_total : 0.75;
  // 缺口补价: 已记录的 in/out 照实计价, 记录不到的部分 (老数据) 按全局比例折算; 若为全局 stats 且有各模型明细则按各模型精确累加
  const costOf = (s) => {
    if (s === stats && s.models && Object.keys(s.models).length > 0) {
      let sum = 0;
      for (const [mName, mStat] of Object.entries(s.models)) {
        const rec = (mStat.prompt_tokens || 0) + (mStat.completion_tokens || 0);
        const unrec = Math.max((mStat.tokens || 0) - rec, 0);
        sum += estimateCostYuan(
          (mStat.prompt_tokens || 0) + unrec * ioRatio,
          (mStat.completion_tokens || 0) + unrec * (1 - ioRatio),
          mName
        );
      }
      return sum;
    }
    const recorded = (s.prompt_tokens || 0) + (s.completion_tokens || 0);
    const unrecorded = Math.max((s.tokens || 0) - recorded, 0);
    return estimateCostYuan(
      (s.prompt_tokens || 0) + unrecorded * ioRatio,
      (s.completion_tokens || 0) + unrecorded * (1 - ioRatio),
      s.__model_name || "auto"
    );
  };

  const chartBars = showOverview && stats ? stats.daily_timeline.map(d => {
    const pct = Math.max(Math.round((d.tokens / maxDailyTokens) * 100), d.tokens > 0 ? 8 : 2);
    return `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; min-width: 24px;">
        <div style="font-size: 11px; color: #64748b; margin-bottom: 4px; font-family: monospace;">${d.tokens > 0 ? (d.tokens > 9999 ? (d.tokens/1000).toFixed(1)+'k' : d.tokens) : ''}</div>
        <div style="width: 100%; max-width: 32px; background: #e2e8f0; border-radius: 4px; height: 120px; display: flex; align-items: flex-end; overflow: hidden;" title="${d.full_date}: ${d.tokens.toLocaleString()} Tokens, ${d.requests} 请求">
          <div style="width: 100%; height: ${pct}%; background: linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%); border-radius: 4px;"></div>
        </div>
        <div style="font-size: 11px; color: #475569; margin-top: 6px; white-space: nowrap;">${d.date}</div>
      </div>
    `;
  }).join("") : "";

  // API Key 清单行 (内置 + KV 签发合并, 支持编辑/启停/删除)
  const effectiveKeys = apiKeys || CONFIG.USER_KEYS;
  const apiKeyRows = showKeysPage ? Object.entries(effectiveKeys).map(([key, info], idx) => {
    const isAdmin = info.role === "admin";
    const userStat = (stats && stats.users && stats.users[info.name]) || { requests: 0, tokens: 0 };
    const keyId = `key-val-${idx}`;
    const rejected = keyRejectReason(info);
    const limitText = (info.rpm_limit ? info.rpm_limit + " RPM" : "不限速") + " · " + (info.daily_token_limit ? info.daily_token_limit.toLocaleString() + "/日" : "不限量");
    const usageText = userStat.tokens.toLocaleString() + (info.daily_token_limit ? " / " + info.daily_token_limit.toLocaleString() : "");

    if (keyUiState && keyUiState.edit === key) {
      return `
      <tr>
        <td colspan="8" style="padding: 14px; background: #f8fafc;">
          <form method="POST" action="/v1/admin/keys" style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            <input type="hidden" name="action" value="update">
            <input type="hidden" name="key" value="${key}">
            <input type="hidden" name="page" value="keys">
            <strong style="font-size: 13px; color: #334155;">编辑 ${info.name}:</strong>
            <input name="name" value="${info.name}" style="border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:13px;width:150px;">
            <input name="rpm_limit" type="number" min="1" value="${info.rpm_limit || ''}" placeholder="RPM 留空不限" style="border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:13px;width:130px;">
            <input name="daily_token_limit" type="number" min="1" value="${info.daily_token_limit || ''}" placeholder="日配额 留空不限" style="border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:13px;width:150px;">
            <input name="expires_at" type="date" value="${info.expires_at || ''}" style="border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:13px;">
            <button type="submit" class="submit-btn">保存</button>
            <a href="/usage?page=keys" class="tab-btn">取消</a>
          </form>
        </td>
      </tr>`;
    }

    const ops = `
      <form method="POST" action="/v1/admin/keys" style="display:inline;">
        <input type="hidden" name="action" value="toggle"><input type="hidden" name="key" value="${key}"><input type="hidden" name="page" value="keys">
        <button type="submit" class="${rejected && info.enabled === false ? 'btn-restore' : 'btn-shelf'}">${rejected && info.enabled === false ? '启用' : '停用'}</button>
      </form>
      <a href="/usage?page=keys&edit=${encodeURIComponent(key)}" style="font-size:12px; color:#2563eb; margin:0 4px;">编辑</a>
      ${info.source === "kv" ? `<form method="POST" action="/v1/admin/keys" style="display:inline;" onsubmit="return confirm('确认删除该 Key? 删除后立即失效');">
        <input type="hidden" name="action" value="delete"><input type="hidden" name="key" value="${key}"><input type="hidden" name="page" value="keys">
        <button type="submit" class="btn-shelf">删除</button>
      </form>` : ''}`;

    return `
      <tr>
        <td style="padding: 12px; font-weight: 600; color: ${isAdmin ? '#4338ca' : '#0f172a'};">
          <span style="background:${isAdmin ? '#e0e7ff' : '#f1f5f9'};color:${isAdmin ? '#4338ca' : '#475569'};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-right:6px;">${isAdmin ? '管理员' : info.role === 'platform' ? '平台' : info.role === 'agent' ? 'Agent' : '授权'}</span>
          ${info.name}
        </td>
        <td style="padding: 12px; font-family: monospace; font-size: 12px; color: #334155;">
          <input type="password" id="${keyId}" value="${key}" readonly style="border:1px solid #cbd5e1;background:#f8fafc;padding:3px 6px;border-radius:4px;width:230px;font-family:monospace;font-size:11px;outline:none;">
          <button onclick="toggleShow('${keyId}', this)" style="margin-left:4px;background:#fff;border:1px solid #cbd5e1;border-radius:4px;padding:3px 6px;font-size:11px;cursor:pointer;">👁️</button>
          <button onclick="copyText('${key}')" style="margin-left:4px;background:#2563eb;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;">复制</button>
        </td>
        <td style="padding: 12px; font-size: 12px; color: #475569;">${limitText}</td>
        <td style="padding: 12px; text-align: right; font-family: monospace;">${userStat.requests.toLocaleString()} 次</td>
        <td style="padding: 12px; text-align: right; font-family: monospace; font-weight: 600; color: #059669;">${usageText}</td>
        <td style="padding: 12px; text-align: right; font-family: monospace; color: #b45309;">${formatCostYuan(costOf(userStat))}</td>
        <td style="padding: 12px; text-align: center;">
          ${rejected ? `<span style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:700;">⛔ ${rejected}</span>` : '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">🟢 生效中</span>'}
        </td>
        <td style="padding: 12px; text-align: center; white-space: nowrap;">${ops}</td>
      </tr>
    `;
  }).join("") : "";

  // 用户排行榜行
  const userRows = showUsagePage ? Object.entries(stats.users || {})
    .filter(([u]) => !u.includes("老张"))
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .map(([u, s]) => {
      const pct = stats.tokens_total > 0 ? ((s.tokens / stats.tokens_total) * 100).toFixed(1) : "0";
      const isAdmin = u.includes("管理员") || u.includes("本人");
      return `
        <tr>
          <td style="padding: 12px; font-weight: 600; color: ${isAdmin ? '#4338ca' : '#0f172a'};">
            ${isAdmin ? '<span style="background:#e0e7ff;color:#4338ca;padding:2px 6px;border-radius:4px;font-size:11px;margin-right:6px;">管理员</span>' : '<span style="background:#f1f5f9;color:#475569;padding:2px 6px;border-radius:4px;font-size:11px;margin-right:6px;">朋友/用户</span>'}
            ${u}
          </td>
          <td style="padding: 12px; text-align: right;">${s.requests.toLocaleString()} 次</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; font-weight: 600; color: #059669;">${s.tokens.toLocaleString()}</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; color: #10b981;">${(s.cached_tokens || 0).toLocaleString()}</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; font-weight: 600; color: #b45309;">${formatCostYuan(costOf(s))}</td>
          <td style="padding: 12px; text-align: right; color: #64748b; font-size: 13px;">${pct}%</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="6" style="padding: 20px; text-align: center; color: #94a3b8;">该时间段暂无用户调用</td></tr>` : "";

  // 供应商排行榜行
  const providerRows = (showUsagePage || showOverview) ? Object.entries(stats.providers || {})
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .map(([p, s]) => {
      const pct = stats.tokens_total > 0 ? ((s.tokens / stats.tokens_total) * 100).toFixed(1) : "0";
      const friendlyName = (CONFIG.PROVIDER_NAMES && CONFIG.PROVIDER_NAMES[p]) || p;
      return `
        <tr>
          <td style="padding: 12px; font-weight: 600;">
            <span style="background:#e0f2fe;color:#0284c7;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-right:6px;font-family:monospace;">${p}</span>
            <span style="color:#1e293b;font-weight:600;">${friendlyName}</span>
          </td>
          <td style="padding: 12px; text-align: right;">${s.requests.toLocaleString()} 次</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; font-weight: 600; color: #0284c7;">${s.tokens.toLocaleString()}</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; color: #d97706;">${(s.prompt_tokens || 0).toLocaleString()}</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; color: #7c3aed;">${(s.completion_tokens || 0).toLocaleString()}</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; color: #10b981;">${(s.cached_tokens || 0).toLocaleString()}</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; font-weight: 600; color: #b45309;">${formatCostYuan(costOf(s))}</td>
          <td style="padding: 12px; text-align: right; color: #64748b; font-size: 13px; font-weight: 600;">${pct}%</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="8" style="padding: 20px; text-align: center; color: #94a3b8;">该时间段暂无供应商调用数据</td></tr>` : "";

  // 模型排行榜
  const modelRows = showUsagePage ? Object.entries(stats.models || {})
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .map(([m, s]) => {
      const pct = stats.tokens_total > 0 ? ((s.tokens / stats.tokens_total) * 100).toFixed(1) : "0";
      s.__model_name = m;
      return `
        <tr>
          <td style="padding: 12px; font-weight: 600; color: #2563eb;">${m}</td>
          <td style="padding: 12px; text-align: right;">${s.requests.toLocaleString()} 次</td>
          <td style="padding: 12px; text-align: right; font-family: monospace;">${s.tokens.toLocaleString()}</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; color: #059669;">${(s.cached_tokens || 0).toLocaleString()}</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; font-weight: 600; color: #b45309;">${formatCostYuan(costOf(s))}</td>
          <td style="padding: 12px; text-align: right; color: #64748b; font-size: 13px;">${pct}%</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="6" style="padding: 20px; text-align: center; color: #94a3b8;">该时间段暂无调用数据</td></tr>` : "";

  // 模型管理行 (仅管理员区块使用): 渠道粒度上下架 + auto 池维护
  const mgmtRows = showModelsPage ? Object.entries(CONFIG.PROVIDERS).flatMap(([pKey, pVal]) => pVal.models.map(m => ({ provider: pKey, model: m }))).map(c => {
    const disabled = isChannelDisabled(runtimeCfg, c.provider, c.model);
    return `
      <tr>
        <td style="padding: 10px 12px; font-weight: 600; color: #2563eb; font-family: monospace; font-size: 13px;">${c.model}</td>
        <td style="padding: 10px 12px;"><span style="background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${c.provider}</span></td>
        <td style="padding: 10px 12px; text-align: center;">
          ${disabled ? '<span style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:700;">⛔ 已下架</span>' : '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">🟢 已上架</span>'}
          ${isCircuitOpen(runtimeCfg.health, c.provider, c.model) ? '<div style="margin-top:4px;"><span style="background:#fff7ed;color:#c2410c;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:700;">🔥 熔断中</span></div>' : ''}
        </td>
        <td style="padding: 10px 12px; text-align: center;">
          <form method="POST" action="/v1/admin/models" style="display:inline;">
            <input type="hidden" name="action" value="toggle_channel">
            <input type="hidden" name="provider" value="${c.provider}">
            <input type="hidden" name="model" value="${c.model}">
            <input type="hidden" name="page" value="models">
            <button type="submit" class="${disabled ? 'btn-restore' : 'btn-shelf'}">${disabled ? '上架' : '下架'}</button>
          </form>
          ${isCircuitOpen(runtimeCfg.health, c.provider, c.model) ? `<form method="POST" action="/v1/admin/models" style="display:inline; margin-left:4px;">
            <input type="hidden" name="action" value="reset_circuit">
            <input type="hidden" name="provider" value="${c.provider}">
            <input type="hidden" name="model" value="${c.model}">
            <input type="hidden" name="page" value="models">
            <button type="submit" class="btn-restore">恢复</button>
          </form>` : ''}
        </td>
      </tr>
    `;
  }).join("") : "";

  const providerOptions = showModelsPage ? Object.keys(CONFIG.PROVIDERS).map(p => `<option value="${p}">${p}</option>`).join("") : "";

  // 池管理区块生成器: auto / 多模态 / 文生图 三池复用同一套增删改 UI
  const poolManagerHtml = (title, poolKey, configKey, accentColor, note) => {
    const members = (runtimeCfg && runtimeCfg[poolKey]) || CONFIG[configKey];
    const rows = members.map(c => `
      <tr>
        <td style="padding: 10px 12px; font-family: monospace; font-size: 13px; color: #0f172a;">${c.model}</td>
        <td style="padding: 10px 12px;"><span style="background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${c.provider}</span></td>
        <td style="padding: 10px 12px; text-align: center;">
          <form method="POST" action="/v1/admin/models" style="display:inline;">
            <input type="hidden" name="action" value="${poolKey}_remove">
            <input type="hidden" name="provider" value="${c.provider}">
            <input type="hidden" name="model" value="${c.model}">
            <input type="hidden" name="page" value="models">
            <button type="submit" class="btn-shelf">移除</button>
          </form>
        </td>
      </tr>`).join("");
    const resetControl = runtimeCfg && runtimeCfg[poolKey]
      ? `<form method="POST" action="/v1/admin/models" style="display:inline;"><input type="hidden" name="action" value="${poolKey}_reset"><input type="hidden" name="page" value="models"><button type="submit" class="btn-shelf">恢复默认池</button></form>`
      : `<span style="font-size: 13px; color: #64748b; font-weight: normal;">${note}</span>`;
    return `
    <div class="section" style="border: 2px solid ${accentColor}; background: #fff;">
      <div class="section-title">
        <span>${title}</span>
        ${resetControl}
      </div>
      <table>
        <thead><tr><th>模型</th><th>渠道</th><th style="text-align:center;">操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <form method="POST" action="/v1/admin/models" style="display:flex; gap:8px; margin-top:12px; align-items:center; flex-wrap:wrap;">
        <input type="hidden" name="action" value="${poolKey}_add">
        <input type="hidden" name="page" value="models">
        <select name="provider" style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;font-size:13px;">${providerOptions}</select>
        <input name="model" placeholder="上游模型 ID" required style="flex:1;min-width:200px;border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;font-size:13px;">
        <button type="submit" class="submit-btn">加入</button>
      </form>
    </div>`;
  };

  // 模型测试页数据: auto + 全部渠道, 标记文生图与下架状态
  const testChannels = showTestPage ? JSON.stringify(
    [{ model: "auto", provider: "-", image: false, disabled: false }].concat(
      Object.entries(CONFIG.PROVIDERS).flatMap(([pKey, pVal]) => pVal.models.map(m => ({
        model: m,
        provider: pKey,
        image: false,
        disabled: isChannelDisabled(runtimeCfg, pKey, m)
      }))),
      CONFIG.IMAGE_GEN_CANDIDATES.map(c => ({
        model: c.model,
        provider: c.provider,
        image: true,
        disabled: isChannelDisabled(runtimeCfg, c.provider, c.model)
      }))
    )
  ).replace(/<\//g, "<\\/") : "[]";

  // 对话体验页模型选项: auto + 全部对话模型 (排除文生图, 大小写去重)
  const chatModels = showChatPage ? JSON.stringify(
    ["auto"].concat(
      Object.entries(CONFIG.PROVIDERS).flatMap(([pKey, pVal]) => pVal.models.map(m => ({ provider: pKey, model: m })))
        .filter(c => !c.model.includes("u1-fast") && !c.model.includes("u1.5-lite") && !isChannelDisabled(runtimeCfg, c.provider, c.model))
        .map(c => c.model)
        .filter((m, idx, arr) => arr.findIndex(x => x.toLowerCase() === m.toLowerCase()) === idx)
    )
  ) : "[]";

  // 实时调用流水 (截取最新 50 条渲染，大幅缩减页面体积并提速)
  const filteredLogs = showUsagePage ? recentLogs.filter(l => !l.user || !l.user.includes("老张")) : [];
  const displayLogs = filteredLogs.slice(0, 50);
  const logRows = showUsagePage ? displayLogs.map(l => {
    let displayTime = l.time || "";
    if (displayTime && !displayTime.includes("-")) {
      displayTime = `${stats.start_date} ${displayTime}`;
    }
    return `
    <tr>
      <td style="padding: 10px; color: #64748b; font-size: 12px; font-family: monospace; white-space: nowrap;">${displayTime}</td>
      <td style="padding: 10px; font-weight: 600; color: #334155;">${l.user || '管理员'}</td>
      <td style="padding: 10px; font-weight: 500; color: #2563eb;">${l.routed_model && l.routed_model.toLowerCase() !== String(l.model).toLowerCase() ? `${l.model}<br><span style="font-size:11px; color:#0284c7;">实际: ${l.routed_model}</span>` : l.model}</td>
      <td style="padding: 10px; font-size: 13px; color: #0284c7;">${l.provider}</td>
      <td style="padding: 10px; text-align: right; font-family: monospace; font-weight: 600;">${l.tokens}</td>
      <td style="padding: 10px; text-align: right; font-family: monospace; color: #059669;">${l.cached_tokens ? l.cached_tokens : '-'}</td>
      <td style="padding: 10px; text-align: right; font-size: 13px; color: #64748b;">${l.duration_ms}ms</td>
      <td style="padding: 10px; text-align: center;"><span style="background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 9999px; font-size: 12px; font-weight: 600;">200 OK</span></td>
    </tr>
  `;
  }).join("") || `<tr><td colspan="8" style="padding: 20px; text-align: center; color: #94a3b8;">暂无流水记录</td></tr>` : "";

  // 失败记录渲染器 (截取最新 30 条, 截断超长报错, 避免几十上百 KB 的 HTML 传输卡顿)
  const displayErrors = recentErrors.filter(l => !l.user || !l.user.includes("老张")).slice(0, 30);
  const errorRowsHtml = displayErrors.map(l => {
    const actual = l.upstream_model || l.routed_model;
    const isDiff = actual && actual.toLowerCase() !== String(l.model).toLowerCase();
    const modelDisplay = isDiff
      ? `<span style="font-weight:600; color:#2563eb;">${l.model}</span><br><span style="font-size:11px; color:#ef4444; font-family:monospace; font-weight:600;">➔ 实际: ${actual}</span>`
      : `<span style="font-weight:600; color:#2563eb;">${l.model}</span>`;
    const cleanErr = String(l.error || "").slice(0, 260);
    return `
    <tr>
      <td style="padding: 10px; color: #64748b; font-size: 12px; font-family: monospace; white-space: nowrap;">${l.time || ""}</td>
      <td style="padding: 10px; font-weight: 600; color: #334155;">${l.user || "管理员"}</td>
      <td style="padding: 10px;">${modelDisplay}</td>
      <td style="padding: 10px; font-size: 13px; color: #0284c7; font-weight:500;">${l.provider}</td>
      <td style="padding: 10px; text-align: right; font-family: monospace; color: #64748b;">${l.duration_ms}ms</td>
      <td style="padding: 10px; font-size: 12px; color: #dc2626; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${cleanErr.replace(/"/g, "&quot;")}">${cleanErr}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" style="padding: 20px; text-align: center; color: #94a3b8;">暂无失败记录</td></tr>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI 网关 · API Key 与多用户用量管理控制台</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 24px; }
    .container { max-width: 1100px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
    .header h1 { font-size: 24px; font-weight: 700; color: #0f172a; }
    .badge { background: #e0e7ff; color: #4338ca; padding: 4px 12px; border-radius: 9999px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
    
    .filter-bar { background: #fff; border-radius: 12px; padding: 14px 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
    .tabs { display: flex; gap: 6px; background: #f1f5f9; padding: 4px; border-radius: 8px; }
    .tab-btn { padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; color: #475569; text-decoration: none; transition: all 0.2s; }
    .tab-btn.active { background: #fff; color: #2563eb; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
    .custom-form { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #64748b; }
    .date-input { border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 8px; font-size: 13px; color: #1e293b; outline: none; }
    .submit-btn { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }

    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-bottom: 20px; }
    .card { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .card-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; margin-bottom: 6px; }
    .card-value { font-size: 24px; font-weight: 700; color: #0f172a; font-family: monospace; }
    .card-sub { font-size: 11px; color: #94a3b8; margin-top: 4px; }
    
    .section { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; margin-bottom: 20px; }
    .section-title { font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
    summary.section-title { cursor: pointer; margin: -6px -10px 12px; padding: 6px 10px; border-radius: 8px; transition: background 0.15s ease; }
    summary.section-title::-webkit-details-marker { display: none; }
    summary.section-title:hover { background: #eef2ff; }
    .section-toggle { font-size: 12px; font-weight: 700; color: #4338ca; background: #e0e7ff; padding: 4px 12px; border-radius: 9999px; white-space: nowrap; }
    .section-toggle::after { content: "展开 ▾"; }
    details[open] .section-toggle::after { content: "收起 ▴"; }
    summary.section-title:hover .section-toggle { background: #c7d2fe; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { padding: 10px 12px; background: #f1f5f9; font-size: 13px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0; }
    tr:not(:last-child) td { border-bottom: 1px solid #f1f5f9; }
    .logout-btn { background: #ef444415; color: #dc2626; border: 1px solid #fca5a5; padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer; text-decoration: none; font-weight: 600; }
    .btn-shelf { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .btn-shelf:hover { background: #fee2e2; }
    .btn-restore { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .btn-restore:hover { background: #dcfce7; }
    .chat-box { height: 480px; overflow-y: auto; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .chat-msg { max-width: 78%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
    .chat-msg.user { align-self: flex-end; background: #2563eb; color: #fff; border-bottom-right-radius: 4px; }
    .chat-msg.assistant { align-self: flex-start; background: #fff; border: 1px solid #e2e8f0; border-bottom-left-radius: 4px; }
    .chat-msg .chat-meta { font-size: 11px; color: #94a3b8; margin-bottom: 4px; font-family: monospace; }
    .chat-msg.user .chat-meta { color: #bfdbfe; }
    .chat-input-row { display: flex; gap: 8px; margin-top: 12px; align-items: flex-end; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>私人大模型网关 · 控制台</h1>
        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">接口基址: <strong>https://api.ailearning.top/v1</strong> (支持 OpenAI 与 Claude 双协议直连)</p>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <span class="badge">🔒 已安全认证</span>
        <a href="javascript:logout()" class="logout-btn">退出登录</a>
      </div>
    </div>

    <!-- 🧭 页面导航 -->
    <div class="filter-bar">
      <div class="tabs">
        <a href="/usage?page=overview&range=${currentRange}" class="tab-btn ${showOverview ? 'active' : ''}">📊 概览</a>
        <a href="/usage?page=usage&range=${currentRange}" class="tab-btn ${showUsagePage ? 'active' : ''}">📈 用量明细</a>
        <a href="/usage?page=diagnosis&range=${currentRange}" class="tab-btn ${showDiagnosisPage ? 'active' : ''}">🩺 质量诊断</a>
        <a href="/usage?page=keys&range=${currentRange}" class="tab-btn ${showKeysPage ? 'active' : ''}">🔑 API Key</a>
        ${isAdminUser ? `<a href="/usage?page=models&range=${currentRange}" class="tab-btn ${showModelsPage ? 'active' : ''}">🎛️ 模型管理</a>
        <a href="/usage?page=test&range=${currentRange}" class="tab-btn ${showTestPage ? 'active' : ''}">🧪 模型测试</a>
        <a href="/usage?page=chat&range=${currentRange}" class="tab-btn ${showChatPage ? 'active' : ''}">💬 对话体验</a>` : ''}
      </div>
      <span style="font-size: 13px; color: #64748b;">数据只在进入对应页面时加载</span>
    </div>

    ${showKeysPage ? `
    <!-- 🔑 API Key 页 -->
    <div class="section" style="border: 2px solid #e0e7ff; background: #ffffff;">
      <div class="section-title">
        <span style="color: #312e81;">🔑 API Key 管理</span>
        <span style="font-size: 13px; background: #eef2ff; color: #4338ca; padding: 3px 10px; border-radius: 9999px; font-weight: 700;">共 ${totalKeysCount} 个密钥</span>
      </div>
      ${keyUiState && keyUiState.created && /^sk-[a-z]+-[0-9a-f]{32}$/.test(keyUiState.created) ? `<div style="background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;">✅ 新 Key 已签发, 请立即复制保存: <code style="font-family:monospace;">${keyUiState.created}</code><button onclick="copyText('${keyUiState.created}')" style="margin-left:8px;background:#059669;color:#fff;border:none;border-radius:4px;padding:3px 10px;font-size:11px;cursor:pointer;">复制</button></div>` : ''}
      <form method="POST" action="/v1/admin/keys" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; align-items:center;">
        <input type="hidden" name="action" value="create">
        <input type="hidden" name="page" value="keys">
        <input name="name" placeholder="名称 (必填)" required style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;font-size:13px;width:140px;">
        <select name="role" style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;font-size:13px;"><option value="friend">朋友</option><option value="colleague">同事</option><option value="platform">平台</option><option value="agent">Agent</option></select>
        <input name="rpm_limit" type="number" min="1" placeholder="RPM 留空不限" style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;font-size:13px;width:130px;">
        <input name="daily_token_limit" type="number" min="1" placeholder="日配额 留空不限" style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;font-size:13px;width:150px;">
        <input name="expires_at" type="date" style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;font-size:13px;">
        <button type="submit" class="submit-btn">➕ 签发新 Key</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>使用者</th>
            <th>专属 API Key</th>
            <th>限制</th>
            <th style="text-align: right;">调用次数</th>
            <th style="text-align: right;">Tokens (当前时段)</th>
            <th style="text-align: right;">参考金额</th>
            <th style="text-align: center;">状态</th>
            <th style="text-align: center;">操作</th>
          </tr>
        </thead>
        <tbody>
          ${apiKeyRows}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${showModelsPage ? `
    <!-- 🎛️ 模型上下架管理 (仅管理员) -->
    <div class="section" style="border: 2px solid #fde68a; background: #fffbeb;">
      <div class="section-title">
        <span style="color: #92400e;">🎛️ 模型上下架管理</span>
        <span style="font-size: 13px; color: #92400e; font-weight: normal;">按渠道下架立即生效：被下架渠道停止路由并从模型列表隐藏</span>
      </div>
      <table>
        <thead><tr><th>模型</th><th>渠道</th><th style="text-align:center;">状态</th><th style="text-align:center;">操作</th></tr></thead>
        <tbody>${mgmtRows}</tbody>
      </table>
    </div>
    ${poolManagerHtml("🧭 auto 路由池管理 (文本请求候选)", "auto_pool", "AUTO_CANDIDATES", "#bae6fd", "当前使用内置默认池，添加或移除成员后即转为自定义池")}
    ${poolManagerHtml("🖼️ 多模态池管理 (带图请求候选)", "multimodal_pool", "MULTIMODAL_CANDIDATES", "#f9a8d4", "带图请求的 auto 会自动从本池挑选")}
    ${poolManagerHtml("🎨 文生图池管理 (images 端点)", "image_pool", "IMAGE_GEN_CANDIDATES", "#fdba74", "经 /v1/images/generations 调用")}
    ` : ''}

    ${showTestPage ? `
    <!-- 🧪 模型连通性测试 (仅管理员) -->
    <div class="section" style="border: 2px solid #ddd6fe; background: #faf5ff;">
      <div class="section-title">
        <span style="color: #6d28d9;">🧪 模型连通性测试</span>
        <span style="display: inline-flex; gap: 10px; align-items: center;">
          <span id="test-summary" style="font-size: 13px; color: #6d28d9;">共 ${JSON.parse(testChannels).length} 项, 点击右侧按钮开始</span>
          <button id="run-all-btn" class="submit-btn" onclick="runAllTests()">▶️ 全部测试</button>
        </span>
      </div>
      <table>
        <thead><tr><th>模型</th><th>渠道</th><th style="text-align:center;">状态</th><th style="text-align:right;">耗时</th><th>结果</th><th style="text-align:center;">操作</th></tr></thead>
        <tbody id="test-rows"></tbody>
      </table>
      <p style="font-size: 12px; color: #94a3b8; margin-top: 10px;">测试请求经网关真实调用上游并计入用量 (归集为"模型测试"), 文生图模型走图片端点, 已下架渠道会返回下架错误</p>
    </div>
    <script>
      const TEST_CHANNELS = ${testChannels};
      function testBadge(html) { return '<span style="padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:700;">' + html + '</span>'; }
      function renderTestRows() {
        const rows = TEST_CHANNELS.map(function(ch, i) {
          const disabledNote = ch.disabled ? '<div style="font-size:10px;color:#dc2626;margin-top:2px;">已下架</div>' : '';
          return '<tr id="test-row-' + i + '">'
            + '<td style="padding:10px 12px;font-family:monospace;font-size:13px;font-weight:600;color:#2563eb;">' + ch.model + '</td>'
            + '<td style="padding:10px 12px;"><span style="background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">' + ch.provider + '</span></td>'
            + '<td style="padding:10px 12px;text-align:center;" id="test-status-' + i + '">' + testBadge('<span style="background:#f1f5f9;color:#94a3b8;">待测试</span>') + disabledNote + '</td>'
            + '<td style="padding:10px 12px;text-align:right;font-family:monospace;color:#64748b;" id="test-ms-' + i + '">-</td>'
            + '<td style="padding:10px 12px;font-size:12px;color:#64748b;" id="test-info-' + i + '">-</td>'
            + '<td style="padding:10px 12px;text-align:center;"><button class="submit-btn" style="padding:3px 10px;font-size:11px;" onclick="runOneTest(' + i + ')">测试</button></td>'
            + '</tr>';
        }).join("");
        document.getElementById("test-rows").innerHTML = rows;
      }
      function markPending(i) {
        document.getElementById("test-status-" + i).innerHTML = testBadge('<span style="background:#fef9c3;color:#a16207;">⏳ 测试中</span>');
      }
      function setTestResult(i, ok, ms, info) {
        document.getElementById("test-status-" + i).innerHTML = ok
          ? testBadge('<span style="background:#dcfce7;color:#166534;">✅ 通过</span>')
          : testBadge('<span style="background:#fef2f2;color:#dc2626;">❌ 失败</span>');
        document.getElementById("test-ms-" + i).textContent = ms > 0 ? ms + "ms" : "-";
        document.getElementById("test-info-" + i).textContent = info || "-";
      }
      async function runOneTest(i) {
        const ch = TEST_CHANNELS[i];
        markPending(i);
        const t0 = Date.now();
        const ctrl = new AbortController();
        const timer = setTimeout(function() { ctrl.abort(); }, 90000);
        try {
          const url = ch.image ? "/v1/images/generations" : "/v1/chat/completions";
          const body = ch.image
            ? { model: ch.model, prompt: "一个红色圆点，扁平图标风格" }
            : { model: ch.model, user: "模型测试", messages: [{ role: "user", content: "只回复: OK" }], max_tokens: 3000 };
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
          clearTimeout(timer);
          const ms = Date.now() - t0;
          let data = null;
          try { data = await res.json(); } catch (e) {}
          if (!res.ok) {
            const msg = data && data.error ? (typeof data.error === "string" ? data.error : (data.error.message || JSON.stringify(data.error))) : ("HTTP " + res.status);
            setTestResult(i, false, ms, String(msg).slice(0, 150), false);
            return false;
          }
          if (ch.image) {
            const ok = !!(data && data.data && data.data.length > 0);
            setTestResult(i, ok, ms, ok ? "图片生成成功" : "无图片数据", false);
            return ok;
          }
          const c = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "").trim();
          setTestResult(i, c.length > 0, ms, c.length > 0 ? c.slice(0, 60) : "空回复", false);
          return c.length > 0;
        } catch (e) {
          clearTimeout(timer);
          setTestResult(i, false, Date.now() - t0, e.name === "AbortError" ? "超时 (90s)" : e.message, false);
          return false;
        }
      }
      async function runAllTests() {
        const btn = document.getElementById("run-all-btn");
        btn.disabled = true;
        btn.textContent = "⏳ 测试中...";
        renderTestRows();
        let done = 0, pass = 0;
        const total = TEST_CHANNELS.length;
        const queue = TEST_CHANNELS.map(function(_, i) { return i; });
        async function worker() {
          while (queue.length > 0) {
            const i = queue.shift();
            const ok = await runOneTest(i);
            done++;
            if (ok) pass++;
            document.getElementById("test-summary").textContent = "进行中 " + done + "/" + total + " · 通过 " + pass + " · 失败 " + (done - pass);
          }
        }
        await Promise.all([worker(), worker(), worker()]);
        document.getElementById("test-summary").textContent = "完成 " + total + " 项 · 通过 " + pass + " · 失败 " + (total - pass);
        btn.disabled = false;
        btn.textContent = "▶️ 重新全部测试";
      }
      renderTestRows();
    </script>
    ` : ''}

    ${showChatPage ? `
    <!-- 💬 对话体验端 (仅管理员) -->
    <div class="section" style="border: 2px solid #a7f3d0; background: #f0fdf4;">
      <div class="section-title">
        <span style="color: #065f46;">💬 对话体验端</span>
        <span style="display: inline-flex; gap: 8px; align-items: center;">
          <select id="chat-model" style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;font-size:13px;"></select>
          <button class="btn-shelf" onclick="clearChat()">🗑️ 清空对话</button>
        </span>
      </div>
      <div id="chat-box" class="chat-box"><div style="margin:auto;color:#94a3b8;font-size:13px;">选择模型,输入消息开始对话 (Enter 发送, Shift+Enter 换行)</div></div>
      <div class="chat-input-row">
        <textarea id="chat-input" rows="2" placeholder="输入消息…" style="flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font-size:14px;font-family:inherit;resize:vertical;outline:none;" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat();}"></textarea>
        <button id="chat-send" class="submit-btn" style="padding:10px 20px;" onclick="sendChat()">发送</button>
      </div>
      <p style="font-size: 12px; color: #94a3b8; margin-top: 8px;">流式输出, 计入用量 (归集为"管理员 (本人)"); auto 模式会在回复下方显示实际路由到的模型</p>
    </div>
    <script>
      const CHAT_MODELS = ${chatModels};
      let chatHistory = [];
      let chatting = false;
      const chatBox = document.getElementById("chat-box");
      const modelSel = document.getElementById("chat-model");
      modelSel.innerHTML = CHAT_MODELS.map(function(m) { return '<option value="' + m + '">' + m + '</option>'; }).join("");
      function scrollChat() { chatBox.scrollTop = chatBox.scrollHeight; }
      function setStatus(t) { document.getElementById("chat-send").textContent = t || "发送"; }
      function appendMsg(role, content, meta) {
        const div = document.createElement("div");
        div.className = "chat-msg " + role;
        const metaDiv = document.createElement("div");
        metaDiv.className = "chat-meta";
        metaDiv.textContent = meta || (role === "user" ? "我" : "");
        const body = document.createElement("div");
        body.className = "chat-content";
        body.textContent = content;
        div.appendChild(metaDiv);
        div.appendChild(body);
        chatBox.appendChild(div);
        scrollChat();
        return div;
      }
      function clearChat() {
        chatHistory = [];
        chatBox.innerHTML = '<div style="margin:auto;color:#94a3b8;font-size:13px;">选择模型,输入消息开始对话 (Enter 发送, Shift+Enter 换行)</div>';
      }
      async function sendChat() {
        const input = document.getElementById("chat-input");
        const text = input.value.trim();
        if (!text || chatting) return;
        const model = modelSel.value;
        chatHistory.push({ role: "user", content: text });
        appendMsg("user", text, "我");
        input.value = "";
        chatting = true;
        setStatus("生成中…");
        const t0 = Date.now();
        const replyEl = appendMsg("assistant", "…", "等待响应…");
        const contentEl = replyEl.querySelector(".chat-content");
        let routedModel = "";
        let content = "";
        let usageText = "";
        try {
          const res = await fetch("/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: model, messages: chatHistory, stream: true, max_tokens: 4000 })
          });
          if (!res.ok || !res.body) {
            const errData = await res.json().catch(function() { return {}; });
            throw new Error(errData && errData.error ? (errData.error.message || JSON.stringify(errData.error)) : ("HTTP " + res.status));
          }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          while (true) {
            const d = await reader.read();
            if (d.done) break;
            buf += dec.decode(d.value, { stream: true });
            const lines = buf.split("\\n");
            buf = lines.pop() || "";
            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith("data:")) continue;
              const payload = t.slice(5).trim();
              if (payload === "[DONE]") continue;
              try {
                const ch = JSON.parse(payload);
                if (ch.model && !routedModel) routedModel = ch.model;
                const delta = ch.choices && ch.choices[0] && ch.choices[0].delta;
                if (delta && delta.content) {
                  content += delta.content;
                  contentEl.textContent = content;
                  scrollChat();
                }
                if (ch.usage) usageText = ch.usage.prompt_tokens + "in/" + ch.usage.completion_tokens + "out";
              } catch (e) {}
            }
          }
          const label = (model === "auto" && routedModel ? "auto (实际: " + routedModel + ")" : (routedModel || model))
            + " · " + ((Date.now() - t0) / 1000).toFixed(1) + "s" + (usageText ? " · " + usageText : "");
          replyEl.querySelector(".chat-meta").textContent = label;
          chatHistory.push({ role: "assistant", content: content });
        } catch (e) {
          contentEl.textContent = "调用失败: " + e.message;
          replyEl.querySelector(".chat-meta").textContent = "❌ 失败";
        }
        chatting = false;
        setStatus("");
        scrollChat();
      }
    </script>
    ` : ''}

    ${(showOverview || showUsagePage || showDiagnosisPage) ? `
    <!-- 时间段切换栏 -->
    <div class="filter-bar">
      <div class="tabs">
        <a href="/usage?page=${page}&range=today" class="tab-btn ${currentRange === 'today' ? 'active' : ''}">今日</a>
        <a href="/usage?page=${page}&range=7d" class="tab-btn ${currentRange === '7d' ? 'active' : ''}">近 7 天</a>
        <a href="/usage?page=${page}&range=30d" class="tab-btn ${currentRange === '30d' ? 'active' : ''}">近 30 天</a>
        <a href="/usage?page=${page}&range=all" class="tab-btn ${currentRange === 'all' ? 'active' : ''}">历史全部</a>
      </div>

      <form class="custom-form" method="GET" action="/usage">
        <input type="hidden" name="page" value="${page}">
        <input type="hidden" name="range" value="custom">
        <span>自定义:</span>
        <input type="date" name="start" value="${stats.start_date}" class="date-input" required>
        <span>至</span>
        <input type="date" name="end" value="${stats.end_date}" class="date-input" required>
        <button type="submit" class="submit-btn">查询</button>
        <a href="/usage/export?range=${currentRange}&type=days" class="tab-btn" style="background:#fff;border:1px solid #cbd5e1;">⬇️ 按日</a>
        <a href="/usage/export?range=${currentRange}&type=users" class="tab-btn" style="background:#fff;border:1px solid #cbd5e1;">⬇️ 按用户</a>
        <a href="/usage/export?range=${currentRange}&type=providers" class="tab-btn" style="background:#fff;border:1px solid #cbd5e1;">⬇️ 按供应商</a>
      </form>
    </div>
    ` : ''}

    ${showOverview ? `
    <!-- 统计卡片 -->
    <div class="grid">
      <div class="card" style="border-left: 4px solid #6366f1;">
        <div class="card-title">🔑 派发 API Key 总数</div>
        <div class="card-value" style="color: #4f46e5;">${totalKeysCount} 个</div>
        <div class="card-sub">当前已授权密钥数</div>
      </div>
      <div class="card" style="border-left: 4px solid #2563eb;">
        <div class="card-title">👥 活跃使用人数</div>
        <div class="card-value" style="color: #2563eb;">${stats.active_users_count || Object.keys(stats.users || {}).length} 人</div>
        <div class="card-sub">当前时间段调用人数</div>
      </div>
      <div class="card">
        <div class="card-title">总请求次数</div>
        <div class="card-value" style="color: #0f172a;">${stats.requests_total.toLocaleString()}</div>
        <div class="card-sub">所有用户合计调用</div>
      </div>
      <div class="card">
        <div class="card-title">总消耗 Tokens</div>
        <div class="card-value" style="color: #059669;">${stats.tokens_total.toLocaleString()}</div>
        <div class="card-sub">输入 + 输出合计 Tokens</div>
      </div>
      <div class="card" style="border-left: 4px solid #f59e0b;">
        <div class="card-title">参考费用 (¥)</div>
        <div class="card-value" style="color: #b45309;">${formatCostYuan(costOf(stats))}</div>
        <div class="card-sub">按 auto 智选基准价 (输入 ¥${CONFIG.REFERENCE_PRICING.input_per_million} / 输出 ¥${CONFIG.REFERENCE_PRICING.output_per_million} 每百万)</div>
      </div>
      <div class="card">
        <div class="card-title">命中缓存 (Cache)</div>
        <div class="card-value" style="color: #10b981;">${(stats.cached_tokens || 0).toLocaleString()}</div>
        <div class="card-sub">Prompt Cache 节省量</div>
      </div>
      <div class="card">
        <div class="card-title">Prompt 输入</div>
        <div class="card-value" style="color: #d97706;">${stats.prompt_tokens.toLocaleString()}</div>
        <div class="card-sub">提问与历史上下文</div>
      </div>
      <div class="card">
        <div class="card-title">Completion 输出</div>
        <div class="card-value" style="color: #7c3aed;">${stats.completion_tokens.toLocaleString()}</div>
        <div class="card-sub">生成回答内容</div>
      </div>
    </div>
    ` : ''}

    ${showUsagePage ? `
    <!-- 2. 朋友与用户用量排行榜 -->
    <div class="section">
      <div class="section-title">
        <span>👥 各用户 Token 消耗排行榜 (User Leaderboard)</span>
        <span style="font-size: 13px; color: #64748b; font-weight: normal;">选定时间段: ${stats.range_label}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>使用者 / 朋友备注</th>
            <th style="text-align: right;">调用次数</th>
            <th style="text-align: right;">消耗 Tokens</th>
            <th style="text-align: right;">命中缓存 (Cache)</th>
            <th style="text-align: right;">参考金额</th>
            <th style="text-align: right;">消耗占比</th>
          </tr>
        </thead>
        <tbody>
          ${userRows}
        </tbody>
      </table>
    </div>

    <!-- 3. 各供应商 Token 消耗分布 -->
    <div class="section">
      <div class="section-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span>🏢 各供应商 Token 消耗分布 (Provider Token Consumption)</span>
          <span style="font-size: 13px; color: #64748b; font-weight: normal;">统计时段: ${stats.range_label}</span>
        </div>
        <div class="tabs" style="display:inline-flex; gap:6px;">
          <a href="/usage?page=${page}&range=today" class="tab-btn ${currentRange === 'today' ? 'active' : ''}" style="padding:4px 10px; font-size:12px;">今日</a>
          <a href="/usage?page=${page}&range=7d" class="tab-btn ${currentRange === '7d' ? 'active' : ''}" style="padding:4px 10px; font-size:12px;">近 7 天</a>
          <a href="/usage?page=${page}&range=30d" class="tab-btn ${currentRange === '30d' ? 'active' : ''}" style="padding:4px 10px; font-size:12px;">近 30 天</a>
          <a href="/usage?page=${page}&range=all" class="tab-btn ${currentRange === 'all' ? 'active' : ''}" style="padding:4px 10px; font-size:12px;">历史全部</a>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>供应商 (Provider)</th>
            <th style="text-align: right;">调用次数</th>
            <th style="text-align: right;">总消耗 Tokens</th>
            <th style="text-align: right;">Prompt 输入</th>
            <th style="text-align: right;">Completion 输出</th>
            <th style="text-align: right;">命中缓存 (Cache)</th>
            <th style="text-align: right;">参考金额</th>
            <th style="text-align: right;">消耗占比</th>
          </tr>
        </thead>
        <tbody>
          ${providerRows}
        </tbody>
      </table>
    </div>
    ` : ''}

    <!-- 每日趋势图 -->
    ${showOverview && stats && stats.daily_timeline && stats.daily_timeline.length > 1 ? `
    <div class="section">
      <div class="section-title">
        <span>每日 Token 消耗走势</span>
        <span style="font-size: 13px; font-weight: normal; color: #64748b;">${stats.start_date} ~ ${stats.end_date}</span>
      </div>
      <div style="display: flex; gap: 8px; align-items: flex-end; padding-top: 10px; overflow-x: auto;">
        ${chartBars}
      </div>
    </div>
    ` : ''}

    <!-- 概览页: 供应商消耗摘要 -->
    ${showOverview && stats && stats.providers && Object.keys(stats.providers).length > 0 ? `
    <div class="section">
      <div class="section-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span>🏢 各供应商 Token 消耗概览 (Provider Consumption)</span>
          <span style="font-size: 13px; color: #64748b; font-weight: normal;">统计时段: ${stats.range_label}</span>
        </div>
        <div class="tabs" style="display:inline-flex; gap:6px;">
          <a href="/usage?page=${page}&range=today" class="tab-btn ${currentRange === 'today' ? 'active' : ''}" style="padding:4px 10px; font-size:12px;">今日</a>
          <a href="/usage?page=${page}&range=7d" class="tab-btn ${currentRange === '7d' ? 'active' : ''}" style="padding:4px 10px; font-size:12px;">近 7 天</a>
          <a href="/usage?page=${page}&range=30d" class="tab-btn ${currentRange === '30d' ? 'active' : ''}" style="padding:4px 10px; font-size:12px;">近 30 天</a>
          <a href="/usage?page=${page}&range=all" class="tab-btn ${currentRange === 'all' ? 'active' : ''}" style="padding:4px 10px; font-size:12px;">历史全部</a>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>供应商 (Provider)</th>
            <th style="text-align: right;">调用次数</th>
            <th style="text-align: right;">总消耗 Tokens</th>
            <th style="text-align: right;">Prompt 输入</th>
            <th style="text-align: right;">Completion 输出</th>
            <th style="text-align: right;">命中缓存 (Cache)</th>
            <th style="text-align: right;">参考金额</th>
            <th style="text-align: right;">消耗占比</th>
          </tr>
        </thead>
        <tbody>
          ${providerRows}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${showUsagePage ? `
    <!-- 4. 模型分布 -->
    <div class="section">
      <div class="section-title">各模型调用分布</div>
      <table>
        <thead>
          <tr>
            <th>模型名称</th>
            <th style="text-align: right;">调用次数</th>
            <th style="text-align: right;">消耗 Tokens</th>
            <th style="text-align: right;">命中缓存 (Cache)</th>
            <th style="text-align: right;">参考金额</th>
            <th style="text-align: right;">Token 占比</th>
          </tr>
        </thead>
        <tbody>
          ${modelRows}
        </tbody>
      </table>
    </div>

    <!-- 5. 实时调用流水 -->
    <div class="section">
      <div class="section-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <span>最近调用流水 (展示最新 50 条)</span>
        <span style="font-size: 13px; color: #64748b; font-weight: normal;">共 ${filteredLogs.length} 条记录，全部明细可点击上方导出 CSV</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>时间 (日期+时间)</th>
            <th>使用者</th>
            <th>模型</th>
            <th>供应商</th>
            <th style="text-align: right;">Tokens</th>
            <th style="text-align: right;">Cache</th>
            <th style="text-align: right;">延迟</th>
            <th style="text-align: center;">状态</th>
          </tr>
        </thead>
        <tbody>
          ${logRows}
        </tbody>
      </table>
    </div>

    <!-- AI 质量诊断快捷入口 -->
    <div style="margin-bottom: 16px; background: linear-gradient(135deg, #eff6ff 0%, #e0e7ff 100%); border: 1px solid #c7d2fe; border-radius: 10px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
      <div>
        <strong style="color: #312e81; font-size: 15px; display: flex; align-items: center; gap: 6px;">🤖 AI 智能质量诊断与优化建议</strong>
        <p style="color: #475569; font-size: 13px; margin-top: 3px;">通过分析当前选定时间段（${stats.range_label}）的失败记录，评估各供应商与模型的质量稳定性，并输出专业调优策略。</p>
      </div>
      <a href="/usage?page=diagnosis&range=${currentRange}" class="submit-btn" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; font-size: 13px; background: #4338ca;">
        <span>🩺 进入 AI 质量诊断报告</span> &rarr;
      </a>
    </div>

    <!-- 6. 最近失败记录 -->
    <div class="section">
      <div class="section-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <span style="color: #dc2626;">🔥 最近失败记录 (展示最新 30 条)</span>
        <span style="font-size: 13px; color: #64748b; font-weight: normal;">共 ${recentErrors.length} 条记录，同渠道连续 3 次失败自动熔断 5 分钟</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>使用者</th>
            <th>请求模型 / 实际路由</th>
            <th>渠道</th>
            <th style="text-align: right;">耗时</th>
            <th>错误信息</th>
          </tr>
        </thead>
        <tbody>
          ${errorRowsHtml}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${showDiagnosisPage ? `
    <!-- 🩺 质量诊断与 AI 建议页 -->
    ${(() => {
      const diagMetrics = aiDiagnosisData?.metrics || aggregateFailureMetrics(recentErrors, stats, runtimeCfg?.health || {});
      const reportHtml = formatMarkdownToHtml(aiDiagnosisData?.report || generateRuleBasedDiagnosis(diagMetrics, stats?.range_label || "选定时间段"));
      const isCached = Boolean(aiDiagnosisData?.cached);

      const provQualityRows = diagMetrics.providers.map(p => {
        const rateNum = parseFloat(p.failRate);
        const rateColor = rateNum === 0 ? "#16a34a" : rateNum > 30 ? "#dc2626" : "#d97706";
        const statusBadge = p.isCircuitTripped
          ? `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:700;">🔥 熔断中</span>`
          : rateNum === 0
            ? `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">🟢 极高可用</span>`
            : rateNum > 50
              ? `<span style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:700;">🚨 严重异常</span>`
              : `<span style="background:#fff7ed;color:#c2410c;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">⚠️ 偶发故障</span>`;

        return `
        <tr>
          <td style="padding: 12px; font-weight: 600;">
            <span style="background:#e0f2fe;color:#0284c7;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-right:6px;font-family:monospace;">${p.provider}</span>
            <span style="color:#0f172a;">${p.providerName}</span>
          </td>
          <td style="padding: 12px; text-align: right; font-family: monospace;">${p.requests.toLocaleString()} 次</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; font-weight: 600; color: ${p.fails > 0 ? '#dc2626' : '#16a34a'};">${p.fails.toLocaleString()} 次</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; font-weight: 700; color: ${rateColor};">${p.failRate}%</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; color: #dc2626;">${p.rateLimits}</td>
          <td style="padding: 12px; text-align: right; font-family: monospace; color: #ea580c;">${p.timeouts}</td>
          <td style="padding: 12px; font-size: 12px; color: #475569; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p.sampleErrors.join(" | ")}">${p.sampleErrors[0] || '无报错'}</td>
          <td style="padding: 12px; text-align: center;">${statusBadge}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="8" style="padding: 20px; text-align: center; color: #94a3b8;">暂无供应商数据</td></tr>`;

      const modelQualityRows = diagMetrics.models.slice(0, 8).map(m => {
        return `
        <tr>
          <td style="padding: 12px; font-weight: 600; color: #2563eb; font-family: monospace;">${m.model}</td>
          <td style="padding: 12px;"><span style="background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${m.provider}</span></td>
          <td style="padding: 12px; text-align: right; font-family: monospace; font-weight: 700; color: #dc2626;">${m.fails} 次</td>
          <td style="padding: 12px; font-size: 12px; color: #dc2626; max-width: 450px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${m.sample_errors.join(" | ")}">${m.sample_errors[0] || '未知报错'}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="4" style="padding: 20px; text-align: center; color: #16a34a; font-weight:600;">🎉 当前时间段内所有大模型均无报错记录</td></tr>`;

      return `
      <!-- 诊断指标卡片 -->
      <div class="grid">
        <div class="card" style="border-left: 4px solid #ef4444;">
          <div class="card-title">🚨 失败总记录数</div>
          <div class="card-value" style="color: #dc2626;">${diagMetrics.totalFailures} 次</div>
          <div class="card-sub">${stats.range_label}内拦截或上游异常</div>
        </div>
        <div class="card" style="border-left: 4px solid ${parseFloat(diagMetrics.overallFailRate) > 10 ? '#f59e0b' : '#10b981'};">
          <div class="card-title">📉 综合调用失败率</div>
          <div class="card-value" style="color: ${parseFloat(diagMetrics.overallFailRate) > 10 ? '#b45309' : '#059669'};">${diagMetrics.overallFailRate}%</div>
          <div class="card-sub">失败次数 / (成功 + 失败)</div>
        </div>
        <div class="card" style="border-left: 4px solid #8b5cf6;">
          <div class="card-title">⚠️ 故障最多供应商</div>
          <div class="card-value" style="color: #7c3aed; font-size: 18px; line-height: 32px;">${diagMetrics.worstProvider}</div>
          <div class="card-sub">主要瓶颈来源</div>
        </div>
        <div class="card">
          <div class="card-title">⏳ 失败响应平均耗时</div>
          <div class="card-value" style="color: #0f172a;">${diagMetrics.avgDurationMs} ms</div>
          <div class="card-sub">异常请求阻塞等待时间</div>
        </div>
        <div class="card" style="border-left: 4px solid #f97316;">
          <div class="card-title">🔥 熔断中渠道数</div>
          <div class="card-value" style="color: #ea580c;">${diagMetrics.trippedChannelsCount} 个</div>
          <div class="card-sub">同渠道连续 3 次失败自动保护</div>
        </div>
      </div>

      <!-- AI 诊断建议卡片 -->
      <div class="section" style="border: 2px solid #818cf8; background: #ffffff;">
        <div class="section-title">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="color: #312e81; font-size: 17px;">🤖 AI 智能质量诊断与运维调优报告</span>
            <span id="diag-cached-badge" style="background:${isCached ? '#fef3c7' : '#ecfdf5'}; color:${isCached ? '#92400e' : '#065f46'}; padding:2px 8px; border-radius:9999px; font-size:11px; font-weight:600;">${isCached ? '⏱️ 来自缓存 (15分钟有效)' : '⚡ 实时生成'}</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button id="btn-refresh-diag" class="submit-btn" style="background:#4338ca;" onclick="refreshDiagnosis()">🔄 重新运行 AI 诊断</button>
            <button class="tab-btn" style="background:#fff; border:1px solid #cbd5e1;" onclick="copyDiagnosis()">📋 复制建议报告</button>
          </div>
        </div>
        <div id="diagnosis-content" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 22px 24px; font-size: 14px; line-height: 1.8; color: #1e293b;" data-raw="${encodeURIComponent(aiDiagnosisData?.report || '')}">
          ${reportHtml}
        </div>
      </div>

      <!-- 供应商质量稳定性对比表 -->
      <div class="section">
        <div class="section-title">
          <span>🏢 各供应商服务质量与稳定性对比</span>
          <span style="font-size: 13px; color: #64748b; font-weight: normal;">选定时间段: ${stats.range_label}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>供应商 (Provider)</th>
              <th style="text-align: right;">成功请求</th>
              <th style="text-align: right;">失败次数</th>
              <th style="text-align: right;">失败率</th>
              <th style="text-align: right;">429 限流</th>
              <th style="text-align: right;">超时中断</th>
              <th>主要报错原因</th>
              <th style="text-align: center;">运行状态</th>
            </tr>
          </thead>
          <tbody>
            ${provQualityRows}
          </tbody>
        </table>
      </div>

      <!-- 高频故障模型排查表 -->
      <div class="section">
        <div class="section-title">
          <span style="color: #dc2626;">🤖 重点故障模型分析</span>
          <span style="font-size: 13px; color: #64748b; font-weight: normal;">高频报错及超时模型定位</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>故障模型 (Model)</th>
              <th>归属渠道</th>
              <th style="text-align: right;">失败次数</th>
              <th>典型错误信息</th>
            </tr>
          </thead>
          <tbody>
            ${modelQualityRows}
          </tbody>
        </table>
      </div>

      <!-- 周期内失败记录明细 -->
      <div class="section">
        <div class="section-title">
          <span>🔥 周期内失败流水记录</span>
          <span style="font-size: 13px; color: #64748b; font-weight: normal;">失败日志清单</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>使用者</th>
              <th>请求模型 / 实际路由</th>
              <th>渠道</th>
              <th style="text-align: right;">耗时</th>
              <th>错误信息</th>
            </tr>
          </thead>
          <tbody>
            ${errorRowsHtml}
          </tbody>
        </table>
      </div>
      `;
    })()}
    ` : ''}
  </div>

  <script>
    ${formatMarkdownToHtml.toString()}
    function copyText(txt) {
      navigator.clipboard.writeText(txt).then(() => alert('已成功复制 API Key 到剪贴板！'));
    }
    function toggleShow(id, btn) {
      const inp = document.getElementById(id);
      if (inp.type === 'password') {
        inp.type = 'text';
        btn.innerText = '🙈 隐藏';
      } else {
        inp.type = 'password';
        btn.innerText = '👁️ 显示';
      }
    }
    function logout() {
      document.cookie = "admin_key=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = "user_key=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      window.location.href = "/usage";
    }
    async function refreshDiagnosis() {
      const btn = document.getElementById('btn-refresh-diag');
      const box = document.getElementById('diagnosis-content');
      const badge = document.getElementById('diag-cached-badge');
      if (!btn || !box) return;
      btn.disabled = true;
      btn.innerText = '⏳ AI 正在深度分析中...';
      box.style.opacity = '0.5';
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const range = urlParams.get('range') || '${currentRange}';
        const start = urlParams.get('start') || '';
        const end = urlParams.get('end') || '';
        let reqUrl = '/v1/admin/analyze-failures?range=' + encodeURIComponent(range) + '&refresh=1';
        if (start && end) reqUrl += '&start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end);

        const res = await fetch(reqUrl);
        const data = await res.json();
        if (data && data.report) {
          box.innerHTML = formatMarkdownToHtml(data.report);
          box.setAttribute('data-raw', encodeURIComponent(data.report));
          if (badge) {
            badge.innerText = '⚡ 实时生成';
            badge.style.background = '#ecfdf5';
            badge.style.color = '#065f46';
          }
        } else if (data && data.error) {
          alert('诊断生成失败: ' + (data.error.message || JSON.stringify(data.error)));
        }
      } catch (e) {
        alert('网络请求失败: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.innerText = '🔄 重新运行 AI 诊断';
        box.style.opacity = '1';
      }
    }
    function copyDiagnosis() {
      const box = document.getElementById('diagnosis-content');
      if (!box) return;
      const rawEncoded = box.getAttribute('data-raw');
      let text = rawEncoded ? decodeURIComponent(rawEncoded) : box.innerText;
      navigator.clipboard.writeText(text).then(() => alert('已成功复制 AI 诊断建议报告！'));
    }

    // 客户端瞬时无刷新切页与悬停预加载 (SPA-like Pjax)
    const CLIENT_PAGE_CACHE = new Map();

    function navigateTo(url, push = true) {
      const container = document.querySelector('.container');
      if (!container) {
        window.location.href = url;
        return;
      }
      if (CLIENT_PAGE_CACHE.has(url)) {
        applyPageHtml(CLIENT_PAGE_CACHE.get(url), url, push);
        fetchAndCache(url, false);
        return;
      }
      container.style.opacity = '0.6';
      container.style.pointerEvents = 'none';
      fetchAndCache(url, true);
    }

    async function fetchAndCache(url, updateUi = true) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          if (updateUi) window.location.href = url;
          return;
        }
        const html = await res.text();
        CLIENT_PAGE_CACHE.set(url, html);
        if (updateUi) {
          applyPageHtml(html, url, true);
        }
      } catch (err) {
        if (updateUi) window.location.href = url;
      }
    }

    function applyPageHtml(html, url, push) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const newContainer = doc.querySelector('.container');
      const curContainer = document.querySelector('.container');
      if (newContainer && curContainer) {
        curContainer.innerHTML = newContainer.innerHTML;
        curContainer.style.opacity = '1';
        curContainer.style.pointerEvents = 'auto';
        document.title = doc.title;
        if (push) window.history.pushState({ url }, '', url);
        newContainer.querySelectorAll('script').forEach(s => {
          const newScript = document.createElement('script');
          if (s.src) newScript.src = s.src;
          else newScript.textContent = s.textContent;
          document.body.appendChild(newScript);
        });
        window.scrollTo({ top: 0, behavior: 'instant' });
      } else {
        window.location.href = url;
      }
    }

    document.addEventListener('click', function(e) {
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href) return;
      if (href.startsWith('/usage') && !href.startsWith('/usage/export') && !a.getAttribute('download') && !a.getAttribute('target')) {
        e.preventDefault();
        navigateTo(a.href);
      }
    });

    document.addEventListener('mouseover', function(e) {
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (href && href.startsWith('/usage') && !href.startsWith('/usage/export') && !CLIENT_PAGE_CACHE.has(a.href)) {
        fetch(a.href).then(r => r.ok ? r.text() : null).then(h => {
          if (h) CLIENT_PAGE_CACHE.set(a.href, h);
        }).catch(() => {});
      }
    });

    window.addEventListener('popstate', function(e) {
      if (e.state && e.state.url) {
        navigateTo(e.state.url, false);
      } else {
        navigateTo(window.location.href, false);
      }
    });
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    applyProviderSecrets(env);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    const url = new URL(request.url);
    const cleanPath = url.pathname.replace(/\/+$/, "") || "/";
    let token = extractToken(request);
    const masterKey = env.MASTER_KEY || CONFIG.MASTER_KEY;
    const runtimeCfg = await getRuntimeConfig(env);

    // -1. 公开接入文档页
    if (cleanPath === "/docs") {
      const docsCfg = runtimeCfg;
      const channelTable = Object.entries(CONFIG.PROVIDERS).flatMap(([pKey, pVal]) => pVal.models.map(m => ({ provider: pKey, model: m })));
      const listedModels = [
        "auto", "default", "gpt-oss-120b", "DeepSeek-V4-Flash", "deepseek-v4-flash",
        "Ling-3.0-flash", "Ling-3.1-flash", "Ling-2.6-flash",
        "qwen3.8-27b", "qwen3.8-flash", "gemma-4-31b", "glm-5.3-flash", "glm-5.2",
        "hy3", "mimo-v2.5", "sensenova-6.8-flash-lite", "Kimi-K2.6", "deepseek-v4-pro",
        "DeepSeek-V4-Flash-Vision-Exp", "DeepSeek-V4.1-Flash", "deepseek-v4.1-flash", "Qwen3.8-Flash-Next", "MiniCPM5-2B",
        "MiMo-V2.6-Flash", "mimo-v2.6-flash",
        "cf-llama-3.3-70b", "cf-llama-3.1-8b", "cf-llama-4-scout", "cf-qwen3-30b", "cf-deepseek-r1-32b", "cf-glm-4.7-flash",
        "whisper-1"
      ].filter(id => {
        const offerings = channelTable.filter(c => c.model.toLowerCase() === id.toLowerCase());
        return offerings.length === 0 || offerings.some(c => !isChannelDisabled(docsCfg, c.provider, c.model));
      });
      return new Response(renderDocsPage(listedModels), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" }
      });
    }

    // 来源白名单免密：来自特定域名或本地开发站点的跨域调用，自动赋予网站专属 token，彻底杜绝前端代码暴露任何 Key
    const origin = request.headers.get("origin") || "";
    const referer = request.headers.get("referer") || "";
    if (!token && (origin.includes("ailearning.top") || origin.includes("localhost") || origin.includes("127.0.0.1") || referer.includes("ailearning.top") || referer.includes("localhost"))) {
      token = env.SITE_TOKEN || "sk-site-internal";
    }

    // 0. 控制台路由 (/usage 或 /v1/usage) - 仅允许管理员与白名单用户直接登录
    if (cleanPath === "/usage" || cleanPath === "/v1/usage") {
      const isAuthorized = Boolean(
        (token && token === masterKey) ||
        (token && CONFIG.ALLOWED_DASHBOARD_KEYS.includes(token))
      );

      if (!isAuthorized) {
        if (url.searchParams.get("format") === "json" || request.headers.get("accept")?.includes("application/json")) {
          return new Response(JSON.stringify({
            error: { message: "Unauthorized. Valid login key is required.", code: "auth_required" }
          }), {
            status: 401,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
        return new Response(renderLoginModal(), {
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }

      const range = url.searchParams.get("range") || "today";
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      const page = url.searchParams.get("page") || "overview";
      const needsStats = ["overview", "usage", "keys", "diagnosis"].includes(page);
      const isJson = url.searchParams.get("format") === "json" || request.headers.get("accept")?.includes("application/json");

      const needsLogs = (page === "usage" || page === "diagnosis" || isJson) && Boolean(env.USAGE_KV);
      const needsErrors = (page === "usage" || page === "diagnosis") && Boolean(env.USAGE_KV);
      const needsHealth = (page === "models" || page === "test" || page === "chat" || page === "diagnosis");
      const needsKeys = (page === "keys" || page === "overview" || isJson);

      const [stats, recentLogsRaw, recentErrorsRaw, apiKeys, channelHealth] = await Promise.all([
        needsStats ? aggregateStats(env, range, start, end) : null,
        needsLogs ? env.USAGE_KV.get("recent_logs", { type: "json" }) : null,
        needsErrors ? env.USAGE_KV.get("error_logs", { type: "json" }) : null,
        needsKeys ? getApiKeys(env) : null,
        needsHealth ? getChannelHealth(env) : null
      ]);

      const recentLogs = recentLogsRaw || [];
      const recentErrors = recentErrorsRaw || [];
      let dashRuntimeCfg = needsHealth ? runtimeCfg : null;
      if (dashRuntimeCfg && channelHealth) dashRuntimeCfg.health = channelHealth;

      const keyUiState = { edit: url.searchParams.get("edit"), created: url.searchParams.get("created") };

      let aiDiagnosisData = null;
      if (page === "diagnosis") {
        const forceRefresh = url.searchParams.get("refresh") === "true" || url.searchParams.get("refresh") === "1";
        aiDiagnosisData = await getOrRunAiDiagnosis(env, dashRuntimeCfg, stats, recentErrors, forceRefresh);
      }

      if (isJson) {
        return new Response(JSON.stringify({ stats, recent: recentLogs, keys: apiKeys || CONFIG.USER_KEYS, diagnosis: aiDiagnosisData }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "private, no-cache, no-transform" }
        });
      }

      const html = renderDashboard(stats, recentLogs, dashRuntimeCfg || undefined, token === masterKey, page, apiKeys || undefined, keyUiState, recentErrors, aiDiagnosisData);
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-cache, no-transform",
          "Set-Cookie": `admin_key=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; SameSite=Lax`
        }
      });
    }

    // 0.4 用量导出 CSV (管理员/控制台白名单): type=days|users|providers
    if (cleanPath === "/v1/usage/export" || cleanPath === "/usage/export") {
      const dashAllowed = Boolean(token && (token === masterKey || CONFIG.ALLOWED_DASHBOARD_KEYS.includes(token)));
      if (!dashAllowed) {
        return new Response(JSON.stringify({ error: { message: "Unauthorized.", code: "auth_required" } }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      const exportStats = await aggregateStats(env, url.searchParams.get("range") || "30d", url.searchParams.get("start"), url.searchParams.get("end"));
      const type = url.searchParams.get("type") === "users" ? "users" : url.searchParams.get("type") === "providers" ? "providers" : "days";
      const csvEsc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      let lines;
      if (type === "users") {
        lines = ["user,requests,tokens,prompt_tokens,completion_tokens,cached_tokens,reference_cost_yuan"];
        const ioRatio = exportStats.tokens_total > 0 ? exportStats.prompt_tokens / exportStats.tokens_total : 0.75;
        lines = lines.concat(Object.entries(exportStats.users || {}).map(([u, s2]) => {
          const rec = (s2.prompt_tokens || 0) + (s2.completion_tokens || 0);
          const gap = Math.max((s2.tokens || 0) - rec, 0);
          const cost = estimateCostYuan((s2.prompt_tokens || 0) + gap * ioRatio, (s2.completion_tokens || 0) + gap * (1 - ioRatio));
          return [csvEsc(u), s2.requests || 0, s2.tokens || 0, s2.prompt_tokens || "", s2.completion_tokens || "", s2.cached_tokens || 0, cost.toFixed(4)].join(",");
        }));
      } else if (type === "providers") {
        lines = ["provider,provider_name,requests,tokens,prompt_tokens,completion_tokens,cached_tokens,reference_cost_yuan"];
        const ioRatio = exportStats.tokens_total > 0 ? exportStats.prompt_tokens / exportStats.tokens_total : 0.75;
        lines = lines.concat(Object.entries(exportStats.providers || {}).map(([p, s2]) => {
          const rec = (s2.prompt_tokens || 0) + (s2.completion_tokens || 0);
          const gap = Math.max((s2.tokens || 0) - rec, 0);
          const cost = estimateCostYuan((s2.prompt_tokens || 0) + gap * ioRatio, (s2.completion_tokens || 0) + gap * (1 - ioRatio));
          const pName = (CONFIG.PROVIDER_NAMES && CONFIG.PROVIDER_NAMES[p]) || p;
          return [csvEsc(p), csvEsc(pName), s2.requests || 0, s2.tokens || 0, s2.prompt_tokens || "", s2.completion_tokens || "", s2.cached_tokens || 0, cost.toFixed(4)].join(",");
        }));
      } else {
        lines = ["date,requests,tokens,prompt_tokens,completion_tokens,cached_tokens"];
        lines = lines.concat((exportStats.daily_timeline || []).map(d => [d.full_date, d.requests, d.tokens, d.prompt_tokens, d.completion_tokens, d.cached_tokens].join(",")));
      }
      return new Response("\ufeff" + lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="usage_${type}_${exportStats.start_date}_to_${exportStats.end_date}.csv"`,
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // 0.45 智能质量诊断与建议接口 (AI Quality Diagnosis): 分析指定时间段的失败记录与模型质量
    if (cleanPath === "/v1/admin/analyze-failures" || cleanPath === "/admin/analyze-failures") {
      const isAuthorized = Boolean(
        (token && token === masterKey) ||
        (token && CONFIG.ALLOWED_DASHBOARD_KEYS.includes(token))
      );
      if (!isAuthorized) {
        return new Response(JSON.stringify({ error: { message: "Unauthorized. Valid login key is required.", code: "auth_required" } }), {
          status: 401,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      const range = url.searchParams.get("range") || "today";
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      const forceRefresh = url.searchParams.get("refresh") === "1" || url.searchParams.get("refresh") === "true";

      const stats = await aggregateStats(env, range, start, end);
      const recentErrors = env.USAGE_KV ? (await env.USAGE_KV.get("error_logs", { type: "json" })) || [] : [];
      const runtimeCfg = await getRuntimeConfig(env);
      if (runtimeCfg) runtimeCfg.health = await getChannelHealth(env);

      const diagnosis = await getOrRunAiDiagnosis(env, runtimeCfg, stats, recentErrors, forceRefresh);

      return new Response(JSON.stringify({
        success: true,
        range: stats.range,
        range_label: stats.range_label,
        start_date: stats.start_date,
        end_date: stats.end_date,
        cached: diagnosis.cached,
        timestamp: diagnosis.timestamp,
        metrics: diagnosis.metrics,
        report: diagnosis.report
      }, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // 0.5 模型运行时管理接口 (仅 Master Key): 渠道上下架与 auto 池维护, KV 持久化
    if ((cleanPath === "/v1/admin/models" || cleanPath === "/admin/models") && request.method === "POST") {
      if (!(token && token === masterKey)) {
        return new Response(JSON.stringify({ error: { message: "Admin master key required.", code: "auth_required" } }), {
          status: 403,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      const contentType = request.headers.get("content-type") || "";
      let action, provider, model, backPage;
      try {
        if (contentType.includes("application/json")) {
          const payload = await request.json();
          action = payload.action; provider = payload.provider; model = payload.model; backPage = payload.page;
        } else {
          const form = await request.formData();
          action = form.get("action"); provider = form.get("provider"); model = form.get("model"); backPage = form.get("page");
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: { message: "Invalid request body." } }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      const registeredChannel = Object.entries(CONFIG.PROVIDERS).some(([pKey, pVal]) =>
        pKey === provider && pVal.models.some(m => m.toLowerCase() === String(model || "").toLowerCase())
      );
      if (!["toggle_channel", "auto_pool_add", "auto_pool_remove", "auto_pool_reset", "reset_circuit", "multimodal_pool_add", "multimodal_pool_remove", "multimodal_pool_reset", "image_pool_add", "image_pool_remove", "image_pool_reset"].includes(action)) {
        return new Response(JSON.stringify({ error: { message: `Unknown action '${action}'.` } }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      if (!action.endsWith("_reset") && action !== "reset_circuit" && !(provider && CONFIG.PROVIDERS[provider] && model && String(model).trim())) {
        return new Response(JSON.stringify({ error: { message: "Valid provider and model are required." } }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      if (action === "toggle_channel" && !registeredChannel) {
        return new Response(JSON.stringify({ error: { message: `Channel '${provider}/${model}' is not registered.` } }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      const runtimeCfg = await getRuntimeConfig(env);
      const disabled = new Set(runtimeCfg.disabled_channels);
      const poolActions = {
        auto_pool_add: ["auto_pool", "AUTO_CANDIDATES"],
        auto_pool_remove: ["auto_pool", "AUTO_CANDIDATES"],
        auto_pool_reset: ["auto_pool", "AUTO_CANDIDATES"],
        multimodal_pool_add: ["multimodal_pool", "MULTIMODAL_CANDIDATES"],
        multimodal_pool_remove: ["multimodal_pool", "MULTIMODAL_CANDIDATES"],
        multimodal_pool_reset: ["multimodal_pool", "MULTIMODAL_CANDIDATES"],
        image_pool_add: ["image_pool", "IMAGE_GEN_CANDIDATES"],
        image_pool_remove: ["image_pool", "IMAGE_GEN_CANDIDATES"],
        image_pool_reset: ["image_pool", "IMAGE_GEN_CANDIDATES"]
      };
      const sameChannel = (c) => c.provider === provider && c.model.toLowerCase() === String(model).toLowerCase();

      if (action === "toggle_channel") {
        const channelKey = (provider + ":" + model).toLowerCase();
        if (disabled.has(channelKey)) { disabled.delete(channelKey); } else { disabled.add(channelKey); }
      } else if (poolActions[action]) {
        const [poolKey, defaultKey] = poolActions[action];
        let pool = runtimeCfg[poolKey] ? runtimeCfg[poolKey].map(c => ({ ...c })) : null;
        if (action.endsWith("_add")) {
          const base = pool || CONFIG[defaultKey].map(c => ({ ...c }));
          if (!base.some(sameChannel)) base.push({ provider, model: String(model).trim() });
          pool = base;
        } else if (action.endsWith("_remove")) {
          pool = (pool || CONFIG[defaultKey].map(c => ({ ...c }))).filter(c => !sameChannel(c));
          if (pool.length === 0) pool = null;
        } else {
          pool = null;
        }
        runtimeCfg[poolKey] = pool;
      }

      if (action === "reset_circuit" && env.USAGE_KV) {
        const health = await getChannelHealth(env);
        delete health[(provider + ":" + model).toLowerCase()];
        delete health["p:" + provider.toLowerCase()];
        await env.USAGE_KV.put("channel_health", JSON.stringify(health));
      }

      await env.USAGE_KV.put("runtime_config", JSON.stringify({ disabled_channels: [...disabled], auto_pool: runtimeCfg.auto_pool, multimodal_pool: runtimeCfg.multimodal_pool, image_pool: runtimeCfg.image_pool }));
      RUNTIME_CFG_TS = 0;
      RUNTIME_CFG_CACHE = null;

      if (contentType.includes("application/json")) {
        return new Response(JSON.stringify({ ok: true, action, disabled_channels: [...disabled], auto_pool: runtimeCfg.auto_pool, multimodal_pool: runtimeCfg.multimodal_pool, image_pool: runtimeCfg.image_pool }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      return Response.redirect(new URL("/usage?page=" + encodeURIComponent(backPage || "models"), request.url), 303);
    }

    // 0.7 API Key 运行时管理接口 (仅 Master Key): 签发/编辑/启停/删除, KV 持久化
    if ((cleanPath === "/v1/admin/keys" || cleanPath === "/admin/keys") && request.method === "POST") {
      if (!(token && token === masterKey)) {
        return new Response(JSON.stringify({ error: { message: "Admin master key required.", code: "auth_required" } }), {
          status: 403,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      const contentType = request.headers.get("content-type") || "";
      let action, targetKey, name, role, rpmLimit, dailyLimit, expiresAt, backPage;
      try {
        if (contentType.includes("application/json")) {
          const payload = await request.json();
          action = payload.action; targetKey = payload.key; name = payload.name; role = payload.role;
          rpmLimit = payload.rpm_limit; dailyLimit = payload.daily_token_limit; expiresAt = payload.expires_at; backPage = payload.page;
        } else {
          const form = await request.formData();
          action = form.get("action"); targetKey = form.get("key"); name = form.get("name"); role = form.get("role");
          rpmLimit = form.get("rpm_limit"); dailyLimit = form.get("daily_token_limit"); expiresAt = form.get("expires_at"); backPage = form.get("page");
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: { message: "Invalid request body." } }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      if (!["create", "update", "toggle", "delete"].includes(action)) {
        return new Response(JSON.stringify({ error: { message: `Unknown action '${action}'.` } }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      const doc = (env.USAGE_KV ? await env.USAGE_KV.get("api_keys", { type: "json" }) : null) || { keys: {} };
      const kvKeys = doc.keys || {};
      const effective = { ...CONFIG.USER_KEYS, ...kvKeys };

      if (action === "create") {
        if (!name || !String(name).trim()) {
          return new Response(JSON.stringify({ error: { message: "名称必填。" } }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        const roleSlug = ["friend", "colleague", "platform", "agent"].includes(role) ? role : "user";
        let newKey;
        do {
          newKey = "sk-" + roleSlug + "-" + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("");
        } while (effective[newKey]);
        kvKeys[newKey] = {
          name: String(name).trim().slice(0, 40),
          role: roleSlug,
          created_at: getBeijingDateStr(),
          expires_at: expiresAt ? String(expiresAt) : null,
          rpm_limit: rpmLimit ? parseInt(rpmLimit, 10) || null : null,
          daily_token_limit: dailyLimit ? parseInt(dailyLimit, 10) || null : null,
          enabled: true,
          source: "kv"
        };
        var createdKeyOut = newKey;
      } else if (action === "update") {
        if (!targetKey || !effective[targetKey]) {
          return new Response(JSON.stringify({ error: { message: "Key 不存在。" } }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        const base = kvKeys[targetKey] || JSON.parse(JSON.stringify(effective[targetKey]));
        base.source = "kv";
        if (name && String(name).trim()) base.name = String(name).trim().slice(0, 40);
        base.rpm_limit = rpmLimit ? parseInt(rpmLimit, 10) || null : (rpmLimit === "" ? null : base.rpm_limit);
        base.daily_token_limit = dailyLimit ? parseInt(dailyLimit, 10) || null : (dailyLimit === "" ? null : base.daily_token_limit);
        if (expiresAt !== undefined && expiresAt !== null) base.expires_at = expiresAt ? String(expiresAt) : null;
        kvKeys[targetKey] = base;
      } else if (action === "toggle") {
        if (!targetKey || !effective[targetKey]) {
          return new Response(JSON.stringify({ error: { message: "Key 不存在。" } }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        const base = kvKeys[targetKey] || JSON.parse(JSON.stringify(effective[targetKey]));
        base.source = "kv";
        base.enabled = base.enabled === false ? true : false;
        kvKeys[targetKey] = base;
      } else if (action === "delete") {
        if (!targetKey || !kvKeys[targetKey]) {
          return new Response(JSON.stringify({ error: { message: "仅运行时签发的 Key 可删除，内置 Key 请用停用。" } }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        delete kvKeys[targetKey];
      }

      if (env.USAGE_KV) await env.USAGE_KV.put("api_keys", JSON.stringify({ keys: kvKeys }));
      API_KEYS_TS = 0;
      API_KEYS_CACHE = null;

      if (contentType.includes("application/json")) {
        return new Response(JSON.stringify({ ok: true, action, keys: { ...CONFIG.USER_KEYS, ...kvKeys } }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      const redirectUrl = new URL("/usage?page=keys", request.url);
      if (action === "create" && createdKeyOut) redirectUrl.searchParams.set("created", createdKeyOut);
      return Response.redirect(redirectUrl, 303);
    }

    // 鉴权检查：支持 Master Key 或授权的用户/朋友 Key (内置 + KV 运行时签发合并)
    const apiKeys = await getApiKeys(env);
    const keyInfo = apiKeys[token];
    const keyRejected = keyRejectReason(keyInfo);
    const isValidMaster = Boolean(masterKey && token === masterKey);
    const isValidUserKey = Boolean(keyInfo) && !keyRejected;

    if (!isValidMaster && !isValidUserKey) {
      return new Response(JSON.stringify({
        error: {
          message: keyRejected || "Invalid API Key. Access denied.",
          type: "auth_error",
          code: keyRejected ? (keyInfo.enabled === false ? "key_disabled" : "key_expired") : "invalid_api_key"
        }
      }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // 每 key 限流: RPM 滑动窗口 + 每日 token 配额 (master key 不受限)
    if (!isValidMaster && keyInfo) {
      if (await rpmExceeded(env, token, keyInfo.rpm_limit)) {
        return new Response(JSON.stringify({
          error: { message: "请求过于频繁 (该 Key 限速 " + keyInfo.rpm_limit + " 次/分钟)，请稍后再试。", type: "rate_limit_error", code: "rate_limited" }
        }), { status: 429, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
      if (keyInfo.daily_token_limit && env.USAGE_KV) {
        const todayStr = getBeijingDateStr();
        const todayStats = await env.USAGE_KV.get("stats_" + todayStr, { type: "json" });
        const usedToday = (todayStats && todayStats.users && todayStats.users[keyInfo.name] && todayStats.users[keyInfo.name].tokens) || 0;
        if (usedToday >= keyInfo.daily_token_limit) {
          return new Response(JSON.stringify({
            error: { message: "该 Key 今日 token 配额已用尽 (" + usedToday + " / " + keyInfo.daily_token_limit + ")，明日恢复。", type: "rate_limit_error", code: "daily_quota_exceeded" }
          }), { status: 429, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        }
      }
    }

    // 1. 模型列表端点 (/v1/models 或 /models)
    if (cleanPath === "/v1/models" || cleanPath === "/models") {
      const isAutoPoolOnly = url.searchParams.get("auto_pool") === "true" || url.searchParams.get("auto_pool") === "1";

      if (isAutoPoolOnly) {
        const rawPool = runtimeCfg.auto_pool || CONFIG.AUTO_CANDIDATES;
        const basePool = rawPool.filter(c => !AUTO_EXCLUDED_MODELS.has(c.model.toLowerCase()) && c.provider !== "cloudflare");
        const activePool = filterDisabledChannels(runtimeCfg, basePool);

        const includeAuto = url.searchParams.get("include_auto") !== "false" && url.searchParams.get("include_auto") !== "0";
        const seen = new Set();
        const autoPoolModels = [];
        if (includeAuto) {
          autoPoolModels.push("auto");
          seen.add("auto");
        }

        for (const candidate of activePool) {
          const lower = candidate.model.toLowerCase();
          if (!seen.has(lower)) {
            seen.add(lower);
            autoPoolModels.push(candidate.model);
          }
        }

        return new Response(JSON.stringify({
          object: "list",
          data: autoPoolModels.map(id => ({
            id,
            object: "model",
            created: Date.now(),
            owned_by: id === "auto" ? "custom-free-gateway" : "auto-pool"
          }))
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      const allModels = [
        "auto", "default", "gpt-oss-120b", "DeepSeek-V4-Flash", "deepseek-v4-flash",
        "deepseek-v4-flash-0731", "deepseek-v4-flash-vision", "deepseek-v4-pro-0813",
        "qwen3.8-27b", "qwen3.8-flash", "gemma-4-31b", "glm-5.3-flash", "glm-5.3", "glm-5.2",
        "hy3", "mimo-v2.5", "sensenova-6.8-flash-lite", "Kimi-K2.6", "deepseek-v4-pro",
        "minimax-m3",
        "sensenova-u1-fast", "sensenova-u1.5-lite",
        "DeepSeek-V4-Flash-Vision-Exp", "DeepSeek-V4.1-Flash", "deepseek-v4.1-flash", "Qwen3.8-Flash-Next", "MiniCPM5-2B",
        "MiMo-V2.6-Flash", "mimo-v2.6-flash",
        "intern-latest", "intern-s2", "intern-s1-pro", "internvl-latest",
        "qwen/qwen3.8-27b:free", "z-ai/glm-5.2:free", "google/gemma-4-26b-a4b-it:free",
        "google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-lightning:free",
        "thinkingmachines/inkling:free", "nvidia/nemotron-3-ultra-550b-a55b:free",
        "stealth/space-bunny-alpha", "space-bunny-alpha", "space-bunny",
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        "@cf/meta/llama-3.1-8b-instruct-fast",
        "@cf/meta/llama-4-scout-17b-16e-instruct",
        "@cf/qwen/qwen3-30b-a3b-fp8",
        "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
        "@cf/zai-org/glm-4.7-flash",
        "cf-llama-3.3-70b", "cf-llama-3.1-8b", "cf-llama-4-scout", "cf-qwen3-30b", "cf-deepseek-r1-32b", "cf-glm-4.7-flash",
        "whisper-1"
      ];
      const channelTable = Object.entries(CONFIG.PROVIDERS).flatMap(([pKey, pVal]) => pVal.models.map(m => ({ provider: pKey, model: m })));
      const listedModels = allModels.filter(id => {
        const offerings = channelTable.filter(c => c.model.toLowerCase() === id.toLowerCase());
        return offerings.length === 0 || offerings.some(c => !isChannelDisabled(runtimeCfg, c.provider, c.model));
      });
      return new Response(JSON.stringify({
        object: "list",
        data: listedModels.map(id => ({ id, object: "model", created: Date.now(), owned_by: "custom-free-gateway" }))
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // 自动兼容路径匹配 (支持带 /v1 与不带 /v1)
    const isAnthropicMessages = cleanPath.startsWith("/v1/messages") || cleanPath.startsWith("/messages");
    const isChatCompletions = cleanPath === "/v1/chat/completions" || cleanPath === "/chat/completions";
    const isImageGenerations = cleanPath === "/v1/images/generations" || cleanPath === "/images/generations";
    const isAudioTranscriptions = cleanPath === "/v1/audio/transcriptions" || cleanPath === "/audio/transcriptions";

    // 2. 对话补全端点
    if (isChatCompletions || isAnthropicMessages) {
      const startTime = Date.now();
      try {
        const body = await request.json();
        const userName = resolveUser(token, body, request.headers, env, apiKeys);
        const channelHealth = await getChannelHealth(env);
        const originalModel = body.model || "auto";
        let targetModel = originalModel;

        // 图片生成模型误调用聊天补全端点时的拦截
        if (targetModel.includes("u1.5-lite") || targetModel.includes("u1-fast")) {
          return new Response(JSON.stringify({
            error: {
              message: `模型 '${targetModel}' 为文生图模型，请调用 /v1/images/generations 端点，而非对话补全端点。`,
              type: "invalid_request_error",
              code: "invalid_model_endpoint"
            }
          }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        // 语音转文字模型误调用聊天补全端点时的拦截
        if (targetModel.toLowerCase().includes("whisper")) {
          return new Response(JSON.stringify({
            error: {
              message: `模型 '${targetModel}' 为语音转文字(STT)音频模型，请调用 /v1/audio/transcriptions 端点，而非对话补全端点。`,
              type: "invalid_request_error",
              code: "invalid_model_endpoint"
            }
          }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        const hasImage = containsImageInput(body.messages);
        const isAuto = (targetModel === "auto" || targetModel === "default" || targetModel === "multimodal");

        const sessionKey = getSessionKey(body, request.headers, token, url);
        let candidates = [];
        if (isAuto) {
          const rawPool = hasImage || targetModel === "multimodal" ? (runtimeCfg.multimodal_pool || CONFIG.MULTIMODAL_CANDIDATES) : (runtimeCfg.auto_pool || CONFIG.AUTO_CANDIDATES);
          const basePool = rawPool.filter(c => !AUTO_EXCLUDED_MODELS.has(c.model.toLowerCase()) && c.provider !== "cloudflare");
          const pool = filterOpenChannels(channelHealth, filterDisabledChannels(runtimeCfg, basePool));
          if (pool.length === 0) {
            return new Response(JSON.stringify({
              error: { message: "All models in the routing pool are currently disabled.", type: "server_error", code: "pool_empty" }
            }), { status: 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
          }

          // 方案 A + 方案 C：基于 KV 的会话锁定 + 加固会话指纹
          const pinnedCandidate = await getSessionPinnedCandidate(env, sessionKey, targetModel, pool);
          if (pinnedCandidate) {
            // 已锁定会话：固定使用该模型作为绝对首选（100% 会话粘性与 KV Cache 命中），其余作为灾备降级
            candidates = [
              pinnedCandidate,
              ...pool.filter(c => !(c.provider === pinnedCandidate.provider && c.model.toLowerCase() === pinnedCandidate.model.toLowerCase()))
            ];
          } else {
            // 未锁定（新会话首轮）：按优先级顺序排列（首发钉子户 Ling-3.0-flash / glm-5.3-flash 居首）
            const primaryPool = pool.filter(c => c.provider !== "amd");
            const standbyPool = pool.filter(c => c.provider === "amd");
            candidates = primaryPool.length > 0 ? [...primaryPool, ...standbyPool] : standbyPool;
          }
        } else {
          // 严禁跨模型切换：用户显式指定具体模型时，仅在支持该具体模型的 Provider 之间做同模型故障转移，绝不切换为其他模型！
          const targetLower = targetModel.toLowerCase();
          const registeredChannels = [];
          for (const [pKey, pVal] of Object.entries(CONFIG.PROVIDERS)) {
            const matchedModel = pVal.models.find(m => m.toLowerCase() === targetLower);
            if (matchedModel) {
              registeredChannels.push({ provider: pKey, model: matchedModel });
            }
          }
          candidates = filterOpenChannels(channelHealth, filterDisabledChannels(runtimeCfg, registeredChannels));
          if (candidates.length === 0 && registeredChannels.length > 0) {
            return new Response(JSON.stringify({
              error: { message: `模型 '${originalModel}' 已下架，请改用其他模型。`, type: "invalid_request_error", code: "model_disabled" }
            }), { status: 403, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
          }
          if (candidates.length === 0) {
            // 未在已知提供商列表显式声明的未知模型，尝试透传至主 Provider (eaglesine)，不塞入任何其他无关模型
            candidates = [{ provider: "eaglesine", model: targetModel }];
          } else if (candidates.length > 1) {
            // 多提供商同模型粘性锁定
            const pinnedCandidate = await getSessionPinnedCandidate(env, sessionKey, targetModel, candidates);
            if (pinnedCandidate) {
              candidates = [
                pinnedCandidate,
                ...candidates.filter(c => !(c.provider === pinnedCandidate.provider && c.model.toLowerCase() === pinnedCandidate.model.toLowerCase()))
              ];
            }
          }
        }

        let messages = [];
        if (body.system) {
          messages.push({ role: "system", content: normalizeContent(body.system) });
        }
        if (Array.isArray(body.messages)) {
          messages = messages.concat(convertMessagesToOpenAI(body.messages, hasImage));
        }

        const isStream = Boolean(body.stream);
        let lastError = null;

        for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
          const candidate = candidates[cIdx];
          const isLastCandidate = cIdx === candidates.length - 1;
          const providerInfo = CONFIG.PROVIDERS[candidate.provider];
          if (!providerInfo) continue;

          let bodyTimer = null;
          try {
            let upstreamResponse;
            if (candidate.provider === "cloudflare") {
              const cfModel = CF_MODEL_MAP[candidate.model] || candidate.model;
              try {
                if (isStream) {
                  const cfStream = await env.AI.run(cfModel, {
                    messages: messages,
                    stream: true,
                    max_tokens: body.max_tokens || 4096,
                    temperature: body.temperature ?? 0.7
                  });
                  upstreamResponse = new Response(cfStream, {
                    headers: { "Content-Type": "text/event-stream" }
                  });
                } else {
                  let cfRes = await env.AI.run(cfModel, {
                    messages: messages,
                    max_tokens: body.max_tokens || 4096,
                    temperature: body.temperature ?? 0.7
                  });
                  if (cfRes && !cfRes.choices && cfRes.response !== undefined) {
                    cfRes = {
                      id: "chatcmpl-" + Math.random().toString(36).slice(2, 11),
                      object: "chat.completion",
                      created: Math.floor(Date.now() / 1000),
                      model: originalModel,
                      choices: [{
                        index: 0,
                        message: { role: "assistant", content: cfRes.response },
                        finish_reason: "stop"
                      }],
                      usage: cfRes.usage || {
                        prompt_tokens: estimateTokens(messages.map(m => m.content).join(" ")),
                        completion_tokens: estimateTokens(cfRes.response),
                        total_tokens: estimateTokens(messages.map(m => m.content).join(" ")) + estimateTokens(cfRes.response)
                      }
                    };
                  }
                  if (cfRes?.choices?.[0]?.message) {
                    const msg = cfRes.choices[0].message;
                    if (!msg.content && (msg.reasoning_content || msg.reasoning)) {
                      msg.content = msg.reasoning_content || msg.reasoning;
                    }
                  }
                  upstreamResponse = new Response(JSON.stringify(cfRes), {
                    headers: { "Content-Type": "application/json" }
                  });
                }
              } catch (cfErr) {
                lastError = cfErr.message || String(cfErr);
                ctx.waitUntil(recordChannelFailure(env, candidate.provider, candidate.model, lastError, userName, originalModel, Date.now() - startTime, isLastCandidate));
                continue;
              }
            } else {
              const targetUpstreamModel = (candidate.provider === "openrouter" && OPENROUTER_MODEL_MAP[candidate.model]) || candidate.model;
              const upstreamBody = {
                model: targetUpstreamModel,
                messages: messages,
                temperature: body.temperature ?? 0.7,
                max_tokens: body.max_tokens || 4096,
                stream: isStream,
                stream_options: isStream ? { include_usage: true } : undefined
              };
              if (Array.isArray(body.tools) && body.tools.length > 0) {
                upstreamBody.tools = isAnthropicMessages ? anthropicToolsToOpenAI(body.tools) : body.tools;
                if (body.tool_choice !== undefined) {
                  upstreamBody.tool_choice = isAnthropicMessages ? anthropicToolChoiceToOpenAI(body.tool_choice) : body.tool_choice;
                }
              }

              const isFlashModel = /flash|lite|fast/i.test(candidate.model);
              const connectTimeoutMs = isStream ? (isFlashModel ? 18000 : 35000) : (isFlashModel ? 25000 : 45000);
              const upstreamController = new AbortController();
              const startTimer = setTimeout(() => upstreamController.abort(), connectTimeoutMs);
              const apiKey = getProviderApiKey(providerInfo);
              const upstreamHeaders = {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
              };
              if (candidate.provider === "openrouter") {
                upstreamHeaders["HTTP-Referer"] = "https://api.ailearning.top";
                upstreamHeaders["X-Title"] = "Free AI Gateway";
              }
              upstreamResponse = await fetch(`${providerInfo.baseUrl}/chat/completions`, {
                method: "POST",
                headers: upstreamHeaders,
                body: JSON.stringify(upstreamBody),
                signal: upstreamController.signal
              });
              clearTimeout(startTimer);
              if (!isStream) bodyTimer = setTimeout(() => upstreamController.abort(), connectTimeoutMs);

              if (!upstreamResponse.ok) {
                if (bodyTimer) clearTimeout(bodyTimer);
                lastError = await upstreamResponse.text();
                ctx.waitUntil(recordChannelFailure(env, candidate.provider, candidate.model, lastError, userName, originalModel, Date.now() - startTime, isLastCandidate));
                continue;
              }
            }

            const durationMs = Date.now() - startTime;

            // A. 流式处理 (Streaming)
            if (isStream) {
              const headers = new Headers();
              headers.set("Content-Type", "text/event-stream");
              headers.set("Cache-Control", "no-cache");
              headers.set("Connection", "keep-alive");
              headers.set("Access-Control-Allow-Origin", "*");
              if (sessionKey) headers.set("X-Session-Key", sessionKey);
              headers.set("X-Routed-Model", candidate.model);

              const { readable, writable } = new TransformStream();
              const writer = writable.getWriter();
              const reader = upstreamResponse.body.getReader();
              const encoder = new TextEncoder();
              const decoder = new TextDecoder();

              ctx.waitUntil((async () => {
                let finalUsage = null;
                let accumulatedOutputText = "";
                const msgId = "msg_" + Math.random().toString(36).slice(2, 11);

                if (isAnthropicMessages) {
                  await writer.write(encoder.encode(`event: message_start\ndata: {"type":"message_start","message":{"id":"${msgId}","type":"message","role":"assistant","model":"${originalModel}","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}\n\n`));
                  await writer.write(encoder.encode(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`));
                }

                let textBlockOpen = isAnthropicMessages;
                let toolCallCount = 0;
                const openToolBlocks = new Map();

                let buffer = "";
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split("\n");
                  buffer = lines.pop() || "";

                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith("data:")) continue;

                    const jsonStr = trimmed.slice(5).trim();
                    if (jsonStr === "[DONE]") {
                      if (!isAnthropicMessages) {
                        await writer.write(encoder.encode("data: [DONE]\n\n"));
                      }
                      continue;
                    }

                    let parsed = null;
                    try {
                      parsed = JSON.parse(jsonStr);
                    } catch (e) {
                      continue;
                    }

                    if (parsed.usage) {
                      finalUsage = parsed.usage;
                    }

                    const delta = parsed.choices?.[0]?.delta || {};
                    const deltaText = delta.content || delta.reasoning_content || delta.reasoning || (parsed.response !== undefined ? parsed.response : "");

                    if (!isAnthropicMessages) {
                      let outputLine = line;
                      if (!parsed.choices && parsed.response !== undefined) {
                        const oaiChunk = {
                          id: msgId,
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: originalModel,
                          choices: [{
                            index: 0,
                            delta: { content: parsed.response },
                            finish_reason: null
                          }],
                          usage: parsed.usage
                        };
                        outputLine = "data: " + JSON.stringify(oaiChunk);
                      } else if (originalModel !== "auto" && originalModel !== "default") {
                        if (parsed.model) {
                          parsed.model = originalModel;
                          outputLine = "data: " + JSON.stringify(parsed);
                        }
                      }
                      await writer.write(encoder.encode(outputLine + "\n\n"));
                    }

                    if (deltaText) {
                      accumulatedOutputText += deltaText;
                      if (isAnthropicMessages) {
                        const sse = `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(deltaText)}}}\n\n`;
                        await writer.write(encoder.encode(sse));
                      }
                    }

                    if (isAnthropicMessages && Array.isArray(delta.tool_calls)) {
                      for (const shard of delta.tool_calls) {
                        const oaiIdx = shard.index ?? 0;
                        if (!openToolBlocks.has(oaiIdx)) {
                          if (textBlockOpen) {
                            await writer.write(encoder.encode(`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`));
                            textBlockOpen = false;
                          }
                          toolCallCount += 1;
                          const blockIdx = toolCallCount;
                          openToolBlocks.set(oaiIdx, blockIdx);
                          const tcId = shard.id || ("toolu_" + Math.random().toString(36).slice(2, 12));
                          const tcName = shard.function?.name || "unknown";
                          await writer.write(encoder.encode(`event: content_block_start\ndata: {"type":"content_block_start","index":${blockIdx},"content_block":{"type":"tool_use","id":"${tcId}","name":${JSON.stringify(tcName)},"input":{}}}\n\n`));
                        }
                        const argsDelta = shard.function?.arguments || "";
                        if (argsDelta) {
                          const blockIdx = openToolBlocks.get(oaiIdx);
                          await writer.write(encoder.encode(`event: content_block_delta\ndata: {"type":"content_block_delta","index":${blockIdx},"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(argsDelta)}}}\n\n`));
                        }
                      }
                    }
                  }
                }

                if (isAnthropicMessages) {
                  for (const blockIdx of openToolBlocks.values()) {
                    await writer.write(encoder.encode(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${blockIdx}}\n\n`));
                  }
                  if (textBlockOpen) {
                    await writer.write(encoder.encode(`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`));
                  }
                  const outTokens = Number(finalUsage?.completion_tokens) || estimateTokens(accumulatedOutputText) || 20;
                  const stopReason = toolCallCount > 0 ? "tool_use" : "end_turn";
                  await writer.write(encoder.encode(`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"${stopReason}","stop_sequence":null},"usage":{"output_tokens":${outTokens}}}\n\n`));
                  await writer.write(encoder.encode(`event: message_stop\ndata: {"type":"message_stop"}\n\n`));
                }

                await writer.close();

                const promptTokens = finalUsage?.prompt_tokens || estimateTokens(messages.map(m => m.content).join(" "));
                const completionTokens = finalUsage?.completion_tokens || estimateTokens(accumulatedOutputText);
                const cachedTokens = finalUsage?.prompt_tokens_details?.cached_tokens || finalUsage?.cache_read_input_tokens || 0;
                const reasoningTokens = finalUsage?.completion_tokens_details?.reasoning_tokens || 0;

                ctx.waitUntil(recordChannelSuccess(env, candidate.provider, candidate.model));
                if (sessionKey) {
                  ctx.waitUntil(recordSessionPin(env, sessionKey, targetModel, candidate.provider, candidate.model));
                }
                await recordUsage(env, {
                  user: userName,
                  model: originalModel,
                  routed_model: candidate.model,
                  provider: candidate.provider,
                  prompt_tokens: promptTokens,
                  completion_tokens: completionTokens,
                  cached_tokens: cachedTokens,
                  reasoning_tokens: reasoningTokens,
                  duration_ms: durationMs,
                  prompt: extractPromptSummary(messages)
                });
              })());

              return new Response(readable, { headers });
            }

            // B. 非流式处理 (Non-Streaming)
            // cline 聚合站会把标准 OpenAI 响应包一层 {"data": {...}}，此处统一剥壳，保证对客户端始终返回标准结构
            const rawUpstream = await upstreamResponse.json();
            if (bodyTimer) clearTimeout(bodyTimer);
            const openaiData = (rawUpstream && rawUpstream.data && Array.isArray(rawUpstream.data.choices)) ? rawUpstream.data : rawUpstream;
            // 响应模型名称一致性保护：除了直接请求 auto/default 允许返回实际调度模型外，其余情况均确保返回客户端请求的原始模型名
            if (originalModel !== "auto" && originalModel !== "default") {
              openaiData.model = originalModel;
            }
            if (openaiData?.choices?.[0]?.message) {
              const msg = openaiData.choices[0].message;
              if (!msg.content && (msg.reasoning_content || msg.reasoning)) {
                msg.content = msg.reasoning_content || msg.reasoning;
              }
            }

            const usage = openaiData.usage || {};
            const promptTokens = usage.prompt_tokens || estimateTokens(messages.map(m => m.content).join(" "));
            const completionTokens = usage.completion_tokens || 20;
            const cachedTokens = usage.prompt_tokens_details?.cached_tokens || usage.cache_read_input_tokens || 0;
            const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0;

            ctx.waitUntil(recordChannelSuccess(env, candidate.provider, candidate.model));
            if (sessionKey) {
              ctx.waitUntil(recordSessionPin(env, sessionKey, targetModel, candidate.provider, candidate.model));
            }
            ctx.waitUntil(recordUsage(env, {
              user: userName,
              model: originalModel,
              routed_model: candidate.model,
              provider: candidate.provider,
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              cached_tokens: cachedTokens,
              reasoning_tokens: reasoningTokens,
              duration_ms: durationMs,
              prompt: extractPromptSummary(messages)
            }));

            if (!isAnthropicMessages) {
              const respHeaders = {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "X-Routed-Model": candidate.model
              };
              if (sessionKey) respHeaders["X-Session-Key"] = sessionKey;
              return new Response(JSON.stringify(openaiData), {
                headers: respHeaders
              });
            }

            const choice = openaiData.choices?.[0] || {};
            const message = choice.message || {};
            const textContent = message.content || "";
            const reasoning = message.reasoning_content || message.reasoning || "";
            const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;

            const contentBlocks = [];
            if (reasoning) {
              contentBlocks.push({ type: "thinking", thinking: reasoning });
            }
            if (textContent) {
              contentBlocks.push({ type: "text", text: textContent });
            }
            if (hasToolCalls) {
              for (const tc of message.tool_calls) {
                let input = {};
                try {
                  input = JSON.parse(tc.function?.arguments || "{}");
                } catch (e) {
                  input = { _raw: tc.function?.arguments || "" };
                }
                contentBlocks.push({
                  type: "tool_use",
                  id: tc.id || ("toolu_" + Math.random().toString(36).slice(2, 12)),
                  name: tc.function?.name || "unknown",
                  input: input
                });
              }
            }
            if (contentBlocks.length === 0) {
              contentBlocks.push({ type: "text", text: "" });
            }

            const anthropicResponse = {
              id: "msg_" + (openaiData.id || Math.random().toString(36).slice(2, 11)),
              type: "message",
              role: "assistant",
              model: originalModel,
              content: contentBlocks,
              stop_reason: hasToolCalls ? "tool_use" : (choice.finish_reason === "length" ? "max_tokens" : "end_turn"),
              stop_sequence: null,
              usage: {
                input_tokens: promptTokens,
                output_tokens: completionTokens
              }
            };

            const anthropicHeaders = {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "X-Routed-Model": candidate.model
            };
            if (sessionKey) anthropicHeaders["X-Session-Key"] = sessionKey;
            return new Response(JSON.stringify(anthropicResponse), {
              headers: anthropicHeaders
            });
          } catch (err) {
            if (bodyTimer) clearTimeout(bodyTimer);
            lastError = err.message;
            ctx.waitUntil(recordChannelFailure(env, candidate.provider, candidate.model, err.message, userName, originalModel, Date.now() - startTime, isLastCandidate));
          }
        }

        const errMsg = isAuto
          ? "All free auto providers failed: " + lastError
          : `All upstream providers for model '${originalModel}' failed: ${lastError}`;
        return new Response(JSON.stringify({
          error: {
            message: errMsg,
            type: "upstream_error",
            code: "service_unavailable"
          }
        }), {
          status: 502,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: { message: err.message } }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 3. 图像生成端点
    if (isImageGenerations) {
      try {
        const body = await request.json();
        const prompt = body.prompt || "";
        const providerInfo = CONFIG.PROVIDERS.sensenova;
        const channelHealth = await getChannelHealth(env);
        const imageCandidates = filterOpenChannels(channelHealth, filterDisabledChannels(runtimeCfg, runtimeCfg.image_pool || CONFIG.IMAGE_GEN_CANDIDATES));
        if (imageCandidates.length === 0) {
          return new Response(JSON.stringify({
            error: { message: "All image generation models are currently disabled.", code: "model_disabled" }
          }), { status: 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        }
        const imageModel = imageCandidates.some(c => c.model === body.model) ? body.model : imageCandidates[0].model;

        const upstreamResponse = await fetch(`${providerInfo.baseUrl}/images/generations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${getProviderApiKey(providerInfo)}`
          },
          body: JSON.stringify({
            model: imageModel,
            prompt
          })
        });

        const resData = await upstreamResponse.json();
        return new Response(JSON.stringify(resData), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: { message: err.message } }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 4. 语音转文字端点 (/v1/audio/transcriptions 或 /audio/transcriptions)
    if (isAudioTranscriptions) {
      try {
        const providerInfo = CONFIG.PROVIDERS.eaglesine;
        const upstreamHeaders = {
          "Authorization": `Bearer ${getProviderApiKey(providerInfo)}`
        };
        const contentType = request.headers.get("content-type");
        if (contentType) {
          upstreamHeaders["Content-Type"] = contentType;
        }
        const upstreamResponse = await fetch(`${providerInfo.baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers: upstreamHeaders,
          body: request.body
        });
        const resText = await upstreamResponse.text();
        return new Response(resText, {
          status: upstreamResponse.status,
          headers: {
            "Content-Type": upstreamResponse.headers.get("content-type") || "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: { message: err.message } }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    return new Response(JSON.stringify({
      status: "ok",
      service: "Free LLM Gateway on Cloudflare Worker",
      endpoints: ["/v1/chat/completions", "/v1/models", "/v1/messages", "/v1/images/generations", "/v1/audio/transcriptions", "/usage"]
    }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
};
