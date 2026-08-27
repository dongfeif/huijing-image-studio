import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const library = JSON.parse(await readFile(resolve(projectRoot, 'data/prompts.json'), 'utf8'));
const issues = [];

for (const item of library.prompts) {
  if (!item.titleZh?.trim() || !item.promptZh?.trim()) {
    issues.push(`${item.id}: 缺少中文标题或提示词`);
    continue;
  }

  const sourceTokens = placeholders(item.promptEn || item.prompt);
  const translatedTokens = placeholders(item.promptZh);
  if (JSON.stringify(sourceTokens) !== JSON.stringify(translatedTokens)) {
    issues.push(`${item.id}: 占位符不一致 ${JSON.stringify(sourceTokens)} -> ${JSON.stringify(translatedTokens)}`);
  }

  const source = item.promptEn || item.prompt;
  const englishDominant = (source.match(/[A-Za-z]/g)?.length || 0) > source.length * 0.35;
  if (source.length > 80 && englishDominant && source === item.promptZh) {
    issues.push(`${item.id}: 英文提示词未翻译`);
  }
}

if (issues.length) {
  console.error(`翻译校验失败，共 ${issues.length} 条：`);
  console.error(issues.slice(0, 30).join('\n'));
  process.exit(1);
}

console.log(`翻译校验通过：${library.prompts.length} 条模板均有中英文版本，占位符保持一致`);

function placeholders(value) {
  const matches = String(value).match(/\[(?!\s*["{])[^\]\n]{1,500}\]|\{[A-Za-z][A-Za-z0-9_. -]{0,80}\}/g) || [];
  return [...new Set(matches)].sort();
}
