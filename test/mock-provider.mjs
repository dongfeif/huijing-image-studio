import { createServer } from 'node:http';

const port = Number(process.env.MOCK_PROVIDER_PORT || 4319);
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrM4AAAAASUVORK5CYII=';

createServer((req, res) => {
  if (req.method !== 'POST' || !['/v1/images/generations', '/v1/chat/completions'].includes(req.url)) {
    res.writeHead(404).end();
    return;
  }

  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const validBody = req.url === '/v1/chat/completions' ? body.messages?.length : body.prompt;
    if (req.headers.authorization !== 'Bearer local-test-key' || !validBody || !body.model) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid test request' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/v1/chat/completions'
      ? { choices: [{ message: { content: '为一款便携咖啡机制作中文功能拆解图，标题为「随时醒来」。主体居中，周围展示水箱、萃取仓、电池和折叠杯，标注“15Bar压力”“Type-C快充”“一键清洗”。用于电商详情页，4:5竖版，暖白与墨绿配色，文字必须清晰，避免乱码和虚构品牌。' } }] }
      : { data: [{ b64_json: image }] }));
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`Mock image provider: http://127.0.0.1:${port}`);
});
