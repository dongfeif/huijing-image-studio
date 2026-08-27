import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = resolve(projectRoot, 'data/prompts.json');
const publicPath = resolve(projectRoot, 'public/prompts.json');
const baseUrl = process.env.IMAGE_API_BASE_URL || '';
const apiKey = process.env.IMAGE_API_KEY || '';
const model = process.env.TRANSLATION_MODEL || process.env.INSPIRATION_MODEL || 'gpt-5.6-sol';
const maxBatchChars = Number(process.env.TRANSLATION_BATCH_CHARS || 28000);
const concurrency = Number(process.env.TRANSLATION_CONCURRENCY || 3);
const requestedIds = new Set((process.argv.find((arg) => arg.startsWith('--ids='))?.slice(6) || '').split(',').filter(Boolean));

if (!baseUrl || !apiKey) throw new Error('请先在 .env 配置 IMAGE_API_BASE_URL 和 IMAGE_API_KEY');

const library = JSON.parse(await readFile(dataPath, 'utf8'));
for (const item of library.prompts) normalizeSourceFields(item);
for (const item of library.prompts) {
  if (requestedIds.has(String(item.id))) {
    item.titleZh = '';
    item.promptZh = '';
  }
}

const pending = library.prompts.filter((item) => !item.titleZh || !item.promptZh);
if (!pending.length) {
  await saveLibrary();
  console.log('所有提示词均已有最新中文译文');
  process.exit(0);
}

const batches = makeBatches(pending, maxBatchChars);
console.log(`待翻译 ${pending.length} 条，共 ${batches.length} 批，模型 ${model}，并发 ${concurrency}`);

let completed = 0;
for (let index = 0; index < batches.length; index += concurrency) {
  const group = batches.slice(index, index + concurrency);
  const translations = await Promise.all(group.map((batch) => translateWithRetry(batch)));

  group.forEach((batch, groupIndex) => {
    const translatedById = new Map(translations[groupIndex].map((item) => [String(item.id), item]));
    for (const source of batch) {
      const result = translatedById.get(String(source.id));
      if (!result?.titleZh?.trim() || !result?.promptZh?.trim()) {
        throw new Error(`第 ${index + groupIndex + 1} 批缺少模板 ${source.id} 的译文`);
      }
      source.titleZh = result.titleZh.trim();
      source.promptZh = restorePlaceholders(source.promptEn, result.promptZh.trim());
    }
  });

  await saveLibrary();
  completed += group.flat().length;
  console.log(`已完成 ${Math.min(index + group.length, batches.length)}/${batches.length} 批（累计 ${completed}/${pending.length} 条）`);
}

function normalizeSourceFields(item) {
  item.titleEn ||= item.title || '';
  item.promptEn ||= item.prompt || '';
  item.title = item.titleEn;
  item.prompt = item.promptEn;
  item.sourceHash ||= createHash('sha256').update(`${item.titleEn}\0${item.promptEn}`).digest('hex').slice(0, 16);
  if (isChineseDominant(item.titleEn)) item.titleZh = item.titleEn;
  if (isChineseDominant(item.promptEn)) item.promptZh = item.promptEn;
  if (item.promptZh) item.promptZh = restorePlaceholders(item.promptEn, item.promptZh);
}

function isChineseDominant(value) {
  const chinese = String(value).match(/[\u3400-\u9fff]/g)?.length || 0;
  const latin = String(value).match(/[A-Za-z]/g)?.length || 0;
  return chinese > latin;
}

function restorePlaceholders(source, translation) {
  const pattern = /\[(?!\s*["{])[^\]\n]{1,500}\]|\{[A-Za-z][A-Za-z0-9_. -]{0,80}\}/g;
  const sourceTokens = String(source).match(pattern) || [];
  const translatedTokens = String(translation).match(pattern) || [];
  if (sourceTokens.length !== translatedTokens.length) return translation;
  let index = 0;
  return String(translation).replace(pattern, () => sourceTokens[index++]);
}

function makeBatches(items, limit) {
  const batches = [];
  let batch = [];
  let size = 0;
  for (const item of items) {
    const itemSize = item.titleEn.length + item.promptEn.length;
    if (batch.length && size + itemSize > limit) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(item);
    size += itemSize;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function translateBatch(batch) {
  const masks = new Map();
  const input = batch.map(({ id, titleEn, promptEn }) => {
    const masked = maskPlaceholders(promptEn);
    masks.set(String(id), masked.tokens);
    return { id, titleEn, promptEn: masked.text };
  });
  const response = await fetch(endpoint(baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: [
            '你是专业的 AI 图片提示词翻译师。将输入数组中每条 titleEn 和 promptEn 精准翻译为简体中文。',
            '目标是让中文提示词生成效果尽可能等同于英文原文。不得总结、删减、补充、改写创意或弱化约束。',
            '保持原有 Markdown、JSON、列表、段落、换行、字段顺序和层级。保留模型名、参数、尺寸、比例、URL、代码和占位符。',
            '所有要求在生成图片中逐字出现的引号内文案必须原样保留；专有名词在不确定时保留英文。',
            '负面约束、数量、方位、材质、光线、镜头和排版要求必须完整准确。',
            '只输出合法 JSON 数组，不要 Markdown 代码块或任何解释。每项只包含 id、titleZh、promptZh。'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify(input)
        }
      ]
    }),
    signal: AbortSignal.timeout(300_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `翻译接口返回 HTTP ${response.status}`);
  const raw = payload?.choices?.[0]?.message?.content ?? payload?.output_text ?? '';
  const text = Array.isArray(raw) ? raw.map((part) => part?.text || '').join('') : String(raw);
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const result = JSON.parse(clean);
  if (!Array.isArray(result)) throw new Error('翻译接口没有返回 JSON 数组');
  for (const item of result) item.promptZh = unmaskPlaceholders(item.promptZh, masks.get(String(item.id)) || []);
  return result;
}

function maskPlaceholders(value) {
  const pattern = /\[(?!\s*["{])[^\]\n]{1,500}\]|\{[A-Za-z][A-Za-z0-9_. -]{0,80}\}/g;
  const tokens = [];
  const text = String(value).replace(pattern, (token) => {
    const marker = `__HUJING_PLACEHOLDER_${String(tokens.length + 1).padStart(3, '0')}__`;
    tokens.push({ marker, token });
    return marker;
  });
  return { text, tokens };
}

function unmaskPlaceholders(value, tokens) {
  let text = String(value || '');
  for (const { marker, token } of tokens) text = text.replaceAll(marker, token);
  if (/__HUJING_PLACEHOLDER_\d+__/.test(text) || tokens.some(({ token }) => !text.includes(token))) {
    throw new Error('模型没有完整保留提示词占位符');
  }
  return text;
}

async function translateWithRetry(batch) {
  try {
    return await translateBatch(batch);
  } catch (error) {
    console.warn(`批次请求失败，正在重试：${error.message}`);
    return translateBatch(batch);
  }
}

async function saveLibrary() {
  const serialized = `${JSON.stringify(library, null, 2)}\n`;
  await Promise.all([writeFile(dataPath, serialized), writeFile(publicPath, serialized)]);
}

function endpoint(value, resource) {
  const base = value.replace(/\/$/, '').replace(/\/chat\/completions$/, '');
  return base.endsWith('/v1') ? `${base}/${resource}` : `${base}/v1/${resource}`;
}
