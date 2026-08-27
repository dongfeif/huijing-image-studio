import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createAppServer } from '../server.mjs';

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrM4AAAAASUVORK5CYII=';
let provider;
let app;
let providerUrl;
let appUrl;
let temporaryDirectory;
let configPath;
const providerRequests = [];

before(async () => {
  provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const request = {
        url: req.url,
        authorization: req.headers.authorization,
        body: JSON.parse(raw)
      };
      providerRequests.push(request);
      const respond = () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(req.url === '/v1/chat/completions'
          ? { choices: [{ message: { content: '为一家社区咖啡店设计春季新品海报，主标题为「花香醒来」，画面主体是一杯樱花拿铁，使用场景为小红书宣传，要求中文清晰、粉绿配色、4:5竖版，避免英文和复杂背景。' } }] }
          : { data: [{ b64_json: pixel }] }));
      };
      if (request.body.prompt === 'slow image') setTimeout(respond, 21_000);
      else respond();
    });
  });
  await listen(provider);
  providerUrl = `http://127.0.0.1:${provider.address().port}`;
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'huijing-test-'));
  configPath = join(temporaryDirectory, 'config.json');

  app = createAppServer({
    baseUrl: providerUrl,
    apiKey: 'server-test-key',
    model: 'test-image-model',
    inspirationModel: 'gpt-5.6-sol',
    configPath
  });
  await listen(app);
  appUrl = `http://127.0.0.1:${app.address().port}`;
});

after(async () => {
  await Promise.all([close(app), close(provider)]);
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test('serves the synchronized prompt library', async () => {
  const response = await fetch(`${appUrl}/api/prompts`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.total, 535);
  assert.equal(payload.prompts.length, 535);
});

test('does not expose the server API key', async () => {
  const response = await fetch(`${appUrl}/api/config`);
  const payload = await response.json();
  assert.deepEqual(payload, {
    baseUrl: providerUrl,
    model: 'test-image-model',
    inspirationModel: 'gpt-5.6-sol',
    apiConfigured: true,
    source: 'env'
  });
});

test('proxies generation and returns a browser-ready image', async () => {
  const response = await fetch(`${appUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: 'https://client-must-not-override.example',
      apiKey: 'client-key-must-not-override',
      model: 'client-model-must-not-override',
      prompt: 'test prompt',
      size: '1024x1024',
      quality: 'low',
      format: 'png'
    })
  });
  const payload = await response.json();
  const request = providerRequests.findLast((item) => item.url === '/v1/images/generations');

  assert.equal(response.status, 200);
  assert.equal(payload.image, `data:image/png;base64,${pixel}`);
  assert.equal(request.authorization, 'Bearer server-test-key');
  assert.deepEqual(request.body, {
    model: 'test-image-model',
    prompt: 'test prompt',
    n: 1,
    size: '1024x1024',
    quality: 'low',
    format: 'png'
  });
});

test('saves configuration in the backend without returning the API key', async () => {
  const saveResponse = await fetch(`${appUrl}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: providerUrl,
      apiKey: 'saved-backend-key',
      imageModel: 'saved-image-model',
      inspirationModel: 'saved-inspiration-model'
    })
  });
  const saved = await saveResponse.json();
  const diskConfig = JSON.parse(await readFile(configPath, 'utf8'));

  assert.equal(saveResponse.status, 200);
  assert.equal(saved.apiConfigured, true);
  assert.equal(saved.source, 'saved');
  assert.equal(saved.model, 'saved-image-model');
  assert.equal('apiKey' in saved, false);
  assert.equal(diskConfig.apiKey, 'saved-backend-key');

  const response = await fetch(`${appUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'saved configuration prompt', format: 'png' })
  });
  const request = providerRequests.findLast((item) => item.url === '/v1/images/generations');

  assert.equal(response.status, 200);
  assert.equal(request.authorization, 'Bearer saved-backend-key');
  assert.equal(request.body.model, 'saved-image-model');
});

test('keeps the saved API key when only models are updated', async () => {
  const response = await fetch(`${appUrl}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl: providerUrl, imageModel: 'updated-image-model' })
  });
  const payload = await response.json();
  const diskConfig = JSON.parse(await readFile(configPath, 'utf8'));

  assert.equal(response.status, 200);
  assert.equal(payload.model, 'updated-image-model');
  assert.equal(diskConfig.apiKey, 'saved-backend-key');
  assert.equal('apiKey' in payload, false);
});

test('generates Chinese inspiration with the configured text model', async () => {
  const response = await fetch(`${appUrl}/api/inspiration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '商品海报', category: '海报', template: 'Create a product poster with exact readable text.' })
  });
  const payload = await response.json();
  const request = providerRequests.findLast((item) => item.url === '/v1/chat/completions');

  assert.equal(response.status, 200);
  assert.match(payload.inspiration, /社区咖啡店/);
  assert.equal(payload.model, 'saved-inspiration-model');
  assert.equal(request.authorization, 'Bearer saved-backend-key');
  assert.equal(request.body.model, 'saved-inspiration-model');
  assert.match(request.body.messages[1].content, /Create a product poster/);
});

test('allows image generation to run longer than the connector 20 second limit', async () => {
  const startedAt = Date.now();
  const response = await fetch(`${appUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'slow image', format: 'png' })
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.image, `data:image/png;base64,${pixel}`);
  assert.ok(Date.now() - startedAt >= 20_000);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
