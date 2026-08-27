import { createServer } from 'node:http';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(projectRoot, 'public');
const promptConfigPath = join(projectRoot, 'data/prompts.json');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

export function createAppServer(options = {}) {
  const defaults = {
    baseUrl: options.baseUrl ?? process.env.IMAGE_API_BASE_URL ?? '',
    apiKey: options.apiKey ?? process.env.IMAGE_API_KEY ?? '',
    model: options.model ?? process.env.IMAGE_MODEL ?? 'gpt-image-2',
    inspirationModel: options.inspirationModel ?? process.env.INSPIRATION_MODEL ?? 'gpt-5.6-sol'
  };
  const promptsPath = options.promptsPath ?? promptConfigPath;
  const configPath = options.configPath ?? process.env.CONFIG_PATH ?? join(projectRoot, '.runtime/config.json');
  const configStore = createConfigStore(defaults, configPath);

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/config') {
        return json(res, 200, publicConfig(await configStore.get()));
      }
      if (req.method === 'POST' && url.pathname === '/api/config') {
        try {
          return json(res, 200, publicConfig(await configStore.save(await readJson(req))));
        } catch (error) {
          return json(res, 400, { error: 'INVALID_CONFIG', message: error.message });
        }
      }
      if (req.method === 'DELETE' && url.pathname === '/api/config') {
        return json(res, 200, publicConfig(await configStore.clear()));
      }
      if (req.method === 'GET' && url.pathname === '/api/prompts') {
        const prompts = await readFile(promptsPath);
        res.writeHead(200, { 'Content-Type': mimeTypes['.json'], 'Cache-Control': 'no-store' });
        return res.end(prompts);
      }
      if (req.method === 'POST' && url.pathname === '/api/generate') {
        return await generate(req, res, await configStore.get());
      }
      if (req.method === 'POST' && url.pathname === '/api/inspiration') {
        return await inspire(req, res, await configStore.get());
      }
      if (req.method === 'GET') return await serveStatic(url.pathname, res);
      return json(res, 405, { error: 'METHOD_NOT_ALLOWED', message: '不支持的请求方法' });
    } catch (error) {
      console.error(error.message);
      return json(res, 500, { error: 'INTERNAL_ERROR', message: '本地服务处理请求失败' });
    }
  });
}

async function generate(req, res, config) {
  const body = await readJson(req);
  const prompt = String(body.prompt || '').trim();
  const size = String(body.size || '1024x1024');
  const quality = String(body.quality || 'low');
  const format = String(body.format || 'jpeg');

  if (!config.baseUrl || !config.apiKey || !config.model) {
    return json(res, 503, { error: 'SERVER_NOT_CONFIGURED', message: '请先在设置中配置图片接口' });
  }
  if (!prompt) {
    return json(res, 400, { error: 'MISSING_PROMPT', message: '请选择提示词并输入创作内容' });
  }
  if (prompt.length > 20000) {
    return json(res, 400, { error: 'PROMPT_TOO_LONG', message: '提示词不能超过 20000 个字符' });
  }

  try {
    const payload = await requestUpstream(config, 'images/generations', {
      model: config.model,
      prompt,
      n: 1,
      size,
      quality,
      format
    }, 180_000);

    const image = payload?.data?.[0];
    if (image?.b64_json) {
      const mime = format === 'jpg' ? 'jpeg' : format;
      return json(res, 200, { image: `data:image/${mime};base64,${image.b64_json}` });
    }
    if (image?.url) return json(res, 200, { image: image.url });
    return json(res, 502, { error: 'INVALID_UPSTREAM_RESPONSE', message: '图片接口未返回 b64_json 或图片 URL' });
  } catch (error) {
    const message = error.name === 'AbortError' ? '图片生成超时，请重试' : `图片接口请求失败：${error.message}`;
    return json(res, 502, { error: 'UPSTREAM_ERROR', message });
  }
}

async function inspire(req, res, config) {
  const body = await readJson(req);
  const template = String(body.template || '').trim();
  const title = String(body.title || '').trim();
  const category = String(body.category || '').trim();

  if (!config.baseUrl || !config.apiKey || !config.inspirationModel) {
    return json(res, 503, { error: 'SERVER_NOT_CONFIGURED', message: '请先在设置中配置大模型接口' });
  }
  if (!template || template.length > 20000) {
    return json(res, 400, { error: 'INVALID_TEMPLATE', message: '当前提示词模板为空或过长' });
  }

  try {
    const payload = await requestUpstream(config, 'chat/completions', {
      model: config.inspirationModel,
      messages: [
        {
          role: 'system',
          content: '你是图片创作助手。根据图片提示词模板，为不熟悉英文的用户写一段可直接填入“创作内容”的中文示例。示例要具体，包含主题、主体、画面文字、使用场景和关键限制，长度控制在120到220个中文字符。只输出示例正文，不要解释，不要标题，不要Markdown。'
        },
        {
          role: 'user',
          content: `案例标题：${title || '未命名'}\n案例分类：${category || '未分类'}\n\n提示词模板：\n${template}`
        }
      ]
    }, 60_000);
    const content = payload?.choices?.[0]?.message?.content ?? payload?.output_text ?? '';
    const inspiration = Array.isArray(content)
      ? content.map((part) => part?.text || '').join('').trim()
      : String(content).trim();
    if (!inspiration) throw new Error('大模型没有返回示例内容');
    return json(res, 200, { inspiration, model: config.inspirationModel });
  } catch (error) {
    const message = error.name === 'AbortError' ? '灵感生成超时，请重试' : `灵感生成失败：${error.message}`;
    return json(res, 502, { error: 'INSPIRATION_FAILED', message });
  }
}

async function requestUpstream(config, resource, body, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiEndpoint(config.baseUrl, resource), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `上游接口返回 HTTP ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function createConfigStore(defaults, configPath) {
  let loaded = false;
  let current = { ...defaults, source: defaults.baseUrl && defaults.apiKey ? 'env' : 'empty' };

  async function load() {
    if (loaded) return current;
    loaded = true;
    try {
      current = { ...current, ...JSON.parse(await readFile(configPath, 'utf8')), source: 'saved' };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return current;
  }

  return {
    get: load,
    async save(input) {
      const previous = await load();
      const baseUrl = String(input.baseUrl || previous.baseUrl || '').trim();
      const apiKey = String(input.apiKey || previous.apiKey || '').trim();
      const model = String(input.imageModel || input.model || previous.model || 'gpt-image-2').trim();
      const inspirationModel = String(input.inspirationModel || previous.inspirationModel || 'gpt-5.6-sol').trim();
      if (!baseUrl || !apiKey) throw new Error('Base URL 与 API Key 必须同时配置');
      const parsed = new URL(baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Base URL 必须使用 HTTP 或 HTTPS');
      const saved = { baseUrl, apiKey, model, inspirationModel };
      await mkdir(dirname(configPath), { recursive: true });
      const temporaryPath = `${configPath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(saved), { mode: 0o600 });
      await rename(temporaryPath, configPath);
      current = { ...saved, source: 'saved' };
      return current;
    },
    async clear() {
      await unlink(configPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      current = { ...defaults, source: defaults.baseUrl && defaults.apiKey ? 'env' : 'empty' };
      loaded = true;
      return current;
    }
  };
}

function publicConfig(config) {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    inspirationModel: config.inspirationModel,
    apiConfigured: Boolean(config.baseUrl && config.apiKey),
    source: config.source
  };
}

function apiEndpoint(value, resource) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid protocol');
  const base = value.replace(/\/$/, '').replace(/\/images\/generations$/, '');
  return base.endsWith('/v1') ? `${base}/${resource}` : `${base}/v1/${resource}`;
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Request body too large');
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

async function serveStatic(pathname, res) {
  if (pathname === '/favicon.ico') return res.writeHead(204).end();
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = resolve(publicRoot, requested);
  if (!file.startsWith(`${resolve(publicRoot)}/`) && file !== resolve(publicRoot, 'index.html')) {
    return json(res, 403, { error: 'FORBIDDEN' });
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': mimeTypes[extname(file)] || 'application/octet-stream' });
    return res.end(content);
  } catch {
    return json(res, 404, { error: 'NOT_FOUND', message: '页面不存在' });
  }
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '0.0.0.0';
  createAppServer().listen(port, host, () => {
    console.log(`GPT Image Studio API listening on ${host}:${port}`);
  });
}
