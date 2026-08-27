import { writeFile } from 'node:fs/promises';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    return [key, value.join('=')];
  })
);

const baseUrl = args['base-url'] || process.env.IMAGE_API_BASE_URL;
const apiKey = args['api-key'] || process.env.IMAGE_API_KEY;
const model = args.model || process.env.IMAGE_MODEL || 'gpt-image-2';
const prompt = args.prompt || 'A clean editorial photograph of a red paper boat on a white desk.';
const output = args.output || 'test-image.png';

if (!baseUrl || !apiKey) {
  console.error('Usage: node scripts/test-image-request.mjs --base-url=https://example.com --api-key=... [--model=gpt-image-2] [--output=test-image.png]');
  process.exit(1);
}

const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
const endpoint = normalizedBaseUrl.endsWith('/images/generations')
  ? normalizedBaseUrl
  : normalizedBaseUrl.endsWith('/v1')
    ? `${normalizedBaseUrl}/images/generations`
    : `${normalizedBaseUrl}/v1/images/generations`;

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model,
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'low',
    format: 'png'
  })
});

const payload = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(payload?.error?.message || payload?.message || `Image API returned HTTP ${response.status}`);
}

const image = payload?.data?.[0];
if (image?.b64_json) {
  await writeFile(output, Buffer.from(image.b64_json, 'base64'));
} else if (image?.url) {
  const imageResponse = await fetch(image.url);
  if (!imageResponse.ok) throw new Error(`Image download returned HTTP ${imageResponse.status}`);
  await writeFile(output, Buffer.from(await imageResponse.arrayBuffer()));
} else {
  throw new Error('Image API response contains neither data[0].b64_json nor data[0].url');
}

console.log(`Image request succeeded: ${output}`);
