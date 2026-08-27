# 绘境

本地提示词选择与图片生成网站。提示词同步自
[`freestylefly/awesome-gpt-image-2`](https://github.com/freestylefly/awesome-gpt-image-2)，
图片接口使用 OpenAI 兼容的 `/v1/images/generations` 协议。

## 启动

```bash
npm start
```

访问 <http://127.0.0.1:4173>。默认从项目根目录的 `.env` 读取接口配置：

```bash
cp .env.example .env
# 编辑 .env
npm start
```

Base URL 支持三种形式：

```text
https://example.com
https://example.com/v1
https://example.com/v1/images/generations
```

页面右上角的“设置”会把 Base URL、API Key 和模型配置保存到后端私有配置文件。读取配置时
只返回 Base URL、模型和配置状态，不返回 API Key。灵感与图片生成请求均由后端发往模型接口，
浏览器不直接连接模型服务。

容器部署时可通过 `CONFIG_PATH` 指定运行时配置文件位置。配置文件和 `.env` 都已排除在 Git 与
Docker 构建上下文之外。

点击“给我灵感”会把当前标题、分类和提示词模板发送给 `INSPIRATION_MODEL`，生成一段可直接编辑的
中文创作内容。默认模型为 `gpt-5.6-sol`。

分类始终显示中文。提示词模板默认显示中文，可以在创作面板中切换到英文原文；生成图片时使用
当前选中的语言版本。

## 先测试图片接口

```bash
node scripts/test-image-request.mjs \
  --base-url=https://example.com \
  --api-key=your-api-key \
  --model=gpt-image-2 \
  --output=test-image.png
```

也可以使用 `IMAGE_API_BASE_URL`、`IMAGE_API_KEY` 和 `IMAGE_MODEL` 环境变量。

## 更新提示词

```bash
npm run sync:prompts
npm run translate:prompts
```

第一条命令重新读取上游 `data/cases.json`，生成 `data/prompts.json` 和静态部署使用的
`public/prompts.json`。第二条命令使用 `INSPIRATION_MODEL` 增量翻译新增或有变更的模板。
已翻译且源哈希未变化的内容会直接复用。可以通过 `PROMPT_SOURCE_URL` 或
`--source-url=...` 切换数据源。

## 测试

```bash
npm test
```

测试会启动本地兼容图片接口，验证后端配置保存与脱敏、请求参数、Base64 图片响应，以及超过
连接器 20 秒限制的图片生成请求。
