import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultSource = 'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/cases.json';
const sourceUrl = process.argv.find((arg) => arg.startsWith('--source-url='))?.slice(13)
  || process.env.PROMPT_SOURCE_URL
  || defaultSource;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(projectRoot, 'data/prompts.json');
const publicOutput = resolve(projectRoot, 'public/prompts.json');

const categoryLabels = {
  'UI & Interfaces': '界面与交互',
  'Charts & Infographics': '图表与信息图',
  'Posters & Typography': '海报与字体排版',
  'Products & E-commerce': '产品与电商',
  'Brand & Logos': '品牌与标志',
  'Architecture & Spaces': '建筑与空间',
  'Photography & Realism': '摄影与写实',
  'Illustration & Art': '插画与艺术',
  'Characters & People': '人物与角色',
  'Scenes & Storytelling': '场景与叙事',
  'History & Classical Themes': '历史与古典题材',
  'Documents & Publishing': '文档与出版',
  'Other Use Cases': '其他应用场景'
};

const previous = await readJson(output);
const previousById = new Map((previous?.prompts || []).map((item) => [item.id, item]));

const response = await fetch(sourceUrl, {
  headers: { 'User-Agent': 'gpt-image-studio-prompt-sync/1.0' }
});
if (!response.ok) throw new Error(`Prompt source returned HTTP ${response.status}`);

const source = await response.json();
const cases = Array.isArray(source) ? source : source.cases;
if (!Array.isArray(cases) || !cases.length) throw new Error('Prompt source does not contain a non-empty cases array');

const prompts = cases.map((item) => {
  if (!item.id || !item.title || !item.prompt) throw new Error(`Invalid prompt item: ${JSON.stringify(item).slice(0, 160)}`);
  const sourceHash = hashSource(item.title, item.prompt);
  const old = previousById.get(item.id);
  const translationIsCurrent = old?.sourceHash === sourceHash;
  return {
    id: item.id,
    title: item.title,
    prompt: item.prompt,
    titleEn: item.title,
    titleZh: translationIsCurrent ? old.titleZh || '' : '',
    promptEn: item.prompt,
    promptZh: translationIsCurrent ? old.promptZh || '' : '',
    sourceHash,
    category: item.category || 'Other',
    categoryZh: categoryLabels[item.category] || '其他应用场景',
    styles: item.styles || [],
    scenes: item.scenes || [],
    image: item.image?.startsWith('/')
      ? `https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data${item.image}`
      : item.image || '',
    imageAlt: item.imageAlt || item.title,
    sourceLabel: item.sourceLabel || '',
    sourceUrl: item.sourceUrl || '',
    githubUrl: item.githubUrl || '',
    featured: Boolean(item.featured)
  };
});

const config = {
  schemaVersion: 2,
  source: {
    repository: source.repository || 'https://github.com/freestylefly/awesome-gpt-image-2',
    dataUrl: sourceUrl,
    syncedAt: new Date().toISOString()
  },
  total: prompts.length,
  categories: [...new Set(prompts.map((item) => item.category))].sort(),
  categoryLabels,
  styles: [...new Set(prompts.flatMap((item) => item.styles))].sort(),
  scenes: [...new Set(prompts.flatMap((item) => item.scenes))].sort(),
  prompts
};

await mkdir(dirname(output), { recursive: true });
const serialized = `${JSON.stringify(config, null, 2)}\n`;
await Promise.all([
  writeFile(output, serialized),
  writeFile(publicOutput, serialized)
]);
console.log(`Synced ${prompts.length} prompts to ${output} and ${publicOutput}`);

function hashSource(title, prompt) {
  return createHash('sha256').update(`${title}\0${prompt}`).digest('hex').slice(0, 16);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}
