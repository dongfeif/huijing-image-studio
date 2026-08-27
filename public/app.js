const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map((element) => [element.id, element]));
const TOUR_KEY = 'huijing-tour-complete-v1';
const IS_ISPACE_HOST = location.hostname === 'workspace.sy.soyoung.com';
const BACKEND_URL = document.querySelector('meta[name="api-base"]')?.content.replace(/\/$/, '') || '';
const API_BASE = IS_ISPACE_HOST && BACKEND_URL ? `${BACKEND_URL}/api` : '/api';

localStorage.removeItem('huijing-settings-v1');
sessionStorage.removeItem('huijing-api-key');

const state = {
  library: null,
  filtered: [],
  selected: null,
  category: '',
  visibleCount: 48,
  language: 'zh',
  drafts: {},
  serverAvailable: false,
  envConfigured: false,
  imageModel: 'gpt-image-2',
  inspirationModel: 'gpt-5.6-sol',
  settings: { baseUrl: '', apiKeyConfigured: false, imageModel: '', inspirationModel: '' },
  generatedImage: '',
  tourIndex: -1
};

const tourSteps = [
  { target: () => elements.settingsButton, title: '先配置接口', description: '本地可直接使用 .env，也可以在设置中填写一套网页配置覆盖它。' },
  { target: () => elements.categoryBar, title: '选择创作分类', description: '分类均已翻译成中文，先缩小范围会更容易找到合适的模板。' },
  { target: () => document.querySelector('.promptCard'), title: '挑选提示词模板', description: '浏览示例图片，点击喜欢的模板进入创作。' },
  { target: () => elements.contentSection, title: '写下你的创作内容', description: '不知如何开始时，点击“给我灵感”获得一段可直接修改的示例。', prepare: openFirstPrompt },
  { target: () => elements.generateButton, title: '生成你的图片', description: '确认模板语言和参数后，点击按钮生成图片。', prepare: openFirstPrompt }
];

document.body.classList.toggle('ispaceHost', IS_ISPACE_HOST);
await initialize();

async function initialize() {
  try {
    const [config, library] = await Promise.all([loadConfig(), loadPrompts()]);
    state.library = library;
    state.serverAvailable = config.serverAvailable;
    state.envConfigured = Boolean(config.apiConfigured);
    state.settings = { ...config, imageModel: config.model };
    state.imageModel = config.model || 'gpt-image-2';
    state.inspirationModel = config.inspirationModel || 'gpt-5.6-sol';
    bindEvents();
    renderCategories();
    filterPrompts();
    updateConfigStatus();
    const syncedAt = library.source?.syncedAt ? new Date(library.source.syncedAt).toLocaleDateString('zh-CN') : '本地';
    elements.libraryMeta.textContent = `${library.total} 个模板 · 更新于 ${syncedAt}`;
    if (!localStorage.getItem(TOUR_KEY)) setTimeout(startTour, 500);
  } catch (error) {
    elements.libraryMeta.textContent = error.message;
    elements.emptyState.hidden = false;
  }
}

async function loadConfig() {
  try {
    const response = await fetch(`${API_BASE}/config`);
    if (!response.ok) throw new Error();
    return { ...(await response.json()), serverAvailable: true };
  } catch {
    return { model: 'gpt-image-2', inspirationModel: 'gpt-5.6-sol', apiConfigured: false, serverAvailable: false };
  }
}

async function loadPrompts() {
  for (const url of ['./prompts.json', `${API_BASE}/prompts`]) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Try the static prompt bundle next.
    }
  }
  throw new Error('提示词库载入失败');
}

function bindEvents() {
  elements.searchInput.addEventListener('input', resetAndFilter);
  elements.featuredFilter.addEventListener('input', resetAndFilter);
  elements.loadMoreButton.addEventListener('click', () => { state.visibleCount += 48; renderGrid(); });
  elements.settingsButton.addEventListener('click', openSettings);
  elements.closeSettingsButton.addEventListener('click', closeSettings);
  elements.saveSettingsButton.addEventListener('click', saveSettings);
  elements.clearSettingsButton.addEventListener('click', clearSettings);
  elements.closeComposerButton.addEventListener('click', closeComposer);
  elements.templateInput.addEventListener('input', () => {
    if (state.selected) state.drafts[state.selected.id][state.language] = elements.templateInput.value;
    updateFinalPrompt();
  });
  elements.contentInput.addEventListener('input', updateFinalPrompt);
  elements.languageSwitch.addEventListener('click', (event) => {
    const button = event.target.closest('[data-language]');
    if (button) switchLanguage(button.dataset.language);
  });
  elements.inspirationButton.addEventListener('click', requestInspiration);
  elements.generateButton.addEventListener('click', generateImage);
  elements.downloadButton.addEventListener('click', downloadImage);
  elements.tourButton.addEventListener('click', startTour);
  elements.tourNextButton.addEventListener('click', nextTourStep);
  elements.tourSkipButton.addEventListener('click', finishTour);
  elements.composerOverlay.addEventListener('click', (event) => { if (event.target === elements.composerOverlay) closeComposer(); });
  elements.settingsOverlay.addEventListener('click', (event) => { if (event.target === elements.settingsOverlay) closeSettings(); });
  window.addEventListener('resize', positionTourBubble);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!elements.tourLayer.hidden) finishTour();
    else if (!elements.settingsOverlay.hidden) closeSettings();
    else if (!elements.composerOverlay.hidden) closeComposer();
  });
}

function renderCategories() {
  const categories = [{ value: '', label: '全部' }, ...state.library.categories.map((value) => ({
    value,
    label: state.library.categoryLabels?.[value] || state.library.prompts.find((item) => item.category === value)?.categoryZh || value
  }))];
  elements.categoryTrack.replaceChildren(...categories.map(({ value, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.category = value;
    button.textContent = label;
    button.classList.toggle('active', value === state.category);
    button.addEventListener('click', () => {
      state.category = value;
      state.visibleCount = 48;
      renderCategories();
      filterPrompts();
    });
    return button;
  }));
}

function resetAndFilter() {
  state.visibleCount = 48;
  filterPrompts();
}

function filterPrompts() {
  const query = elements.searchInput.value.trim().toLocaleLowerCase();
  state.filtered = state.library.prompts.filter((item) => {
    const searchable = [item.titleZh, item.titleEn, item.title, item.promptZh, item.promptEn, item.prompt, ...item.styles, ...item.scenes].join(' ').toLocaleLowerCase();
    return (!query || searchable.includes(query))
      && (!state.category || item.category === state.category)
      && (!elements.featuredFilter.checked || item.featured);
  });
  renderGrid();
}

function renderGrid() {
  const fragment = document.createDocumentFragment();
  state.filtered.slice(0, state.visibleCount).forEach((item, index) => {
    const card = elements.promptCardTemplate.content.firstElementChild.cloneNode(true);
    const imageButton = card.querySelector('.cardImage');
    const image = card.querySelector('img');
    const title = localizedTitle(item, 'zh');
    card.dataset.promptId = item.id;
    imageButton.style.setProperty('--ratio', cardRatio(item, index));
    image.src = item.image;
    image.alt = item.imageAlt || title;
    imageButton.setAttribute('aria-label', `使用模板：${title}`);
    card.querySelector('.featuredMark').hidden = !item.featured;
    card.querySelector('.cardMeta strong').textContent = title;
    card.querySelector('.cardMeta span').textContent = item.categoryZh || state.library.categoryLabels?.[item.category] || item.category;
    imageButton.addEventListener('click', () => openComposer(item));
    fragment.append(card);
  });
  elements.promptGrid.replaceChildren(fragment);
  elements.emptyState.hidden = state.filtered.length > 0;
  elements.loadMoreButton.hidden = state.visibleCount >= state.filtered.length;
  elements.loadMoreButton.textContent = `查看更多模板（${Math.min(state.visibleCount, state.filtered.length)} / ${state.filtered.length}）`;
}

function cardRatio(item, index) {
  const options = ['4 / 5', '1 / 1', '3 / 4', '4 / 3', '2 / 3'];
  const seed = [...String(item.id)].reduce((total, char) => total + char.charCodeAt(0), index);
  return options[seed % options.length];
}

function openComposer(item) {
  state.selected = item;
  state.language = 'zh';
  state.drafts[item.id] ||= { zh: item.promptZh || item.promptEn || item.prompt || '', en: item.promptEn || item.prompt || '' };
  elements.selectedImage.src = item.image;
  elements.selectedImage.alt = item.imageAlt || localizedTitle(item, 'zh');
  elements.selectedId.textContent = `模板 #${item.id}`;
  elements.selectedTags.replaceChildren(...[...item.styles, ...item.scenes].slice(0, 8).map((tag) => {
    const span = document.createElement('span');
    span.textContent = tag;
    return span;
  }));
  elements.sourceLink.hidden = !item.githubUrl && !item.sourceUrl;
  elements.sourceLink.href = item.githubUrl || item.sourceUrl || '#';
  elements.contentInput.value = '';
  updateComposerLanguage();
  resetResult();
  elements.composerOverlay.hidden = false;
  syncBodyLock();
}

function closeComposer() {
  elements.composerOverlay.hidden = true;
  syncBodyLock();
}

function switchLanguage(language) {
  if (!state.selected || language === state.language) return;
  state.drafts[state.selected.id][state.language] = elements.templateInput.value;
  state.language = language;
  updateComposerLanguage();
}

function updateComposerLanguage() {
  const item = state.selected;
  elements.composerTitle.textContent = localizedTitle(item, state.language);
  elements.composerCategory.textContent = item.categoryZh || state.library.categoryLabels?.[item.category] || item.category;
  elements.templateInput.value = state.drafts[item.id][state.language];
  [...elements.languageSwitch.querySelectorAll('button')].forEach((button) => button.classList.toggle('active', button.dataset.language === state.language));
  updateFinalPrompt();
}

function localizedTitle(item, language) {
  return language === 'zh' ? item.titleZh || item.titleEn || item.title : item.titleEn || item.title;
}

function updateFinalPrompt() {
  const template = elements.templateInput.value.trim();
  const content = elements.contentInput.value.trim();
  const heading = state.language === 'zh' ? '具体创作内容：' : 'Creative brief:';
  elements.finalPrompt.textContent = content ? `${template}\n\n${heading}\n${content}` : template;
}

function openSettings() {
  elements.baseUrlInput.value = state.settings.baseUrl || '';
  elements.apiKeyInput.value = '';
  elements.apiKeyInput.placeholder = state.settings.apiKeyConfigured ? '已保存在后端，留空则不修改' : '输入接口密钥';
  elements.imageModelInput.value = state.settings.imageModel || state.imageModel;
  elements.inspirationModelInput.value = state.settings.inspirationModel || state.inspirationModel;
  elements.settingsSource.textContent = state.serverAvailable
    ? (state.envConfigured ? '配置已保存在后端，API Key 不会返回浏览器' : '后端已连接，请完成接口配置')
    : '后端服务暂时无法连接';
  elements.settingsOverlay.hidden = false;
  syncBodyLock();
  setTimeout(() => elements.baseUrlInput.focus(), 0);
}

function closeSettings() {
  elements.settingsOverlay.hidden = true;
  syncBodyLock();
}

async function saveSettings() {
  const baseUrl = elements.baseUrlInput.value.trim();
  const apiKey = elements.apiKeyInput.value.trim();
  if (!baseUrl || (!apiKey && !state.settings.apiKeyConfigured)) {
    elements.settingsSource.textContent = '首次配置必须填写 Base URL 与 API Key';
    elements.settingsSource.classList.add('error');
    return;
  }
  elements.saveSettingsButton.disabled = true;
  elements.saveSettingsButton.textContent = '保存中…';
  try {
    const config = await postJson(`${API_BASE}/config`, {
      baseUrl,
      apiKey,
      imageModel: elements.imageModelInput.value.trim() || 'gpt-image-2',
      inspirationModel: elements.inspirationModelInput.value.trim() || 'gpt-5.6-sol'
    });
    state.settings = { ...config, imageModel: config.model };
    state.envConfigured = Boolean(config.apiConfigured);
    state.imageModel = config.model;
    state.inspirationModel = config.inspirationModel;
    elements.settingsSource.classList.remove('error');
    closeSettings();
    updateConfigStatus();
  } catch (error) {
    elements.settingsSource.textContent = error.message;
    elements.settingsSource.classList.add('error');
  } finally {
    elements.saveSettingsButton.disabled = false;
    elements.saveSettingsButton.textContent = '保存设置';
  }
}

async function clearSettings() {
  try {
    const response = await fetch(`${API_BASE}/config`, { method: 'DELETE' });
    const config = await response.json();
    if (!response.ok) throw new Error(config.message || '清除后端配置失败');
    state.settings = { ...config, imageModel: config.model };
    state.envConfigured = Boolean(config.apiConfigured);
    state.imageModel = config.model || 'gpt-image-2';
    state.inspirationModel = config.inspirationModel || 'gpt-5.6-sol';
    closeSettings();
    updateConfigStatus();
  } catch (error) {
    elements.settingsSource.textContent = error.message;
    elements.settingsSource.classList.add('error');
  }
}

function updateConfigStatus() {
  const configured = state.serverAvailable && state.envConfigured;
  elements.configStatus.classList.toggle('ready', configured);
  elements.configStatus.querySelector('span').textContent = configured ? '后端已连接' : '未配置';
}

async function requestInspiration() {
  const template = elements.templateInput.value.trim();
  if (!isConfigured() || !template) return setStatus(isConfigured() ? '当前提示词模板为空' : '请先完成接口配置', true);
  elements.inspirationButton.disabled = true;
  elements.inspirationButton.textContent = '构思中…';
  setStatus(`正在使用 ${state.inspirationModel} 构思示例`);
  try {
    const body = {
      title: localizedTitle(state.selected, state.language),
      category: state.selected.categoryZh || state.selected.category,
      template
    };
    const payload = await postJson(`${API_BASE}/inspiration`, body, 90_000);
    elements.contentInput.value = payload.inspiration;
    updateFinalPrompt();
    setStatus('灵感已填入，可以继续修改');
  } catch (error) {
    setStatus(formatRequestError(error), true);
  } finally {
    elements.inspirationButton.disabled = false;
    elements.inspirationButton.textContent = '给我灵感';
  }
}

async function generateImage() {
  const prompt = elements.finalPrompt.textContent.trim();
  if (!isConfigured() || !prompt) return setStatus(isConfigured() ? '请选择提示词模板' : '请先完成接口配置', true);
  const body = {
    prompt,
    size: elements.sizeInput.value,
    quality: elements.qualityInput.value,
    format: elements.formatInput.value
  };
  setGenerating(true);
  try {
    const payload = await postJson(`${API_BASE}/generate`, body, 200_000);
    state.generatedImage = payload.image;
    elements.outputImage.src = payload.image;
    elements.outputImage.hidden = false;
    elements.resultPlaceholder.hidden = true;
    elements.downloadButton.hidden = false;
    elements.outputModel.textContent = state.imageModel;
    elements.outputSpec.textContent = `${body.size} · ${elements.qualityInput.selectedOptions[0].text} · ${body.format.toUpperCase()}`;
    setStatus('生成完成');
  } catch (error) {
    elements.resultPlaceholder.hidden = false;
    setStatus(formatRequestError(error), true);
  } finally {
    setGenerating(false);
  }
}

async function postJson(url, body, timeout = 30_000) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `请求失败（HTTP ${response.status}）`);
  return payload;
}

function isConfigured() {
  return state.serverAvailable && state.envConfigured;
}

function formatRequestError(error) {
  if (/fetch/i.test(error.message)) return '无法连接后端服务，请稍后重试';
  return error.name === 'TimeoutError' ? '请求超时，请稍后重试' : error.message;
}

function setGenerating(active) {
  elements.generateButton.disabled = active;
  elements.generateButton.textContent = active ? '生成中…' : '生成图片';
  elements.resultLoading.hidden = !active;
  if (active) {
    elements.resultPlaceholder.hidden = true;
    elements.outputImage.hidden = true;
    elements.downloadButton.hidden = true;
    setStatus('图片接口正在创作');
  }
}

function resetResult() {
  state.generatedImage = '';
  elements.outputImage.hidden = true;
  elements.outputImage.removeAttribute('src');
  elements.resultPlaceholder.hidden = false;
  elements.resultLoading.hidden = true;
  elements.downloadButton.hidden = true;
  elements.outputModel.textContent = '—';
  elements.outputSpec.textContent = '—';
  setStatus('准备就绪');
}

function setStatus(message, error = false) {
  elements.requestStatus.textContent = message;
  elements.requestStatus.classList.toggle('error', error);
}

function downloadImage() {
  if (!state.generatedImage) return;
  const anchor = document.createElement('a');
  anchor.href = state.generatedImage;
  anchor.download = `huijing-${state.selected?.id || 'result'}.${elements.formatInput.value}`;
  anchor.target = '_blank';
  anchor.click();
}

function startTour() {
  state.tourIndex = 0;
  elements.tourLayer.hidden = false;
  showTourStep();
}

function nextTourStep() {
  if (state.tourIndex >= tourSteps.length - 1) return finishTour();
  state.tourIndex += 1;
  showTourStep();
}

function showTourStep() {
  document.querySelector('.tourTarget')?.classList.remove('tourTarget');
  const step = tourSteps[state.tourIndex];
  step.prepare?.();
  const target = step.target();
  target?.classList.add('tourTarget');
  if (target && elements.composerOverlay.hidden) {
    const rect = target.getBoundingClientRect();
    const nextTop = window.scrollY + rect.top - (window.innerHeight - rect.height) / 2;
    window.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
  }
  elements.tourProgress.textContent = `${state.tourIndex + 1} / ${tourSteps.length}`;
  elements.tourTitle.textContent = step.title;
  elements.tourDescription.textContent = step.description;
  elements.tourNextButton.textContent = state.tourIndex === tourSteps.length - 1 ? '开始创作' : '下一步';
  setTimeout(positionTourBubble, 260);
}

function positionTourBubble() {
  if (elements.tourLayer.hidden || state.tourIndex < 0) return;
  const target = tourSteps[state.tourIndex].target();
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const bubble = elements.tourBubble;
  const width = Math.min(330, window.innerWidth - 32);
  bubble.style.width = `${width}px`;
  const bubbleHeight = bubble.offsetHeight || 190;
  let left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 16);
  let top = rect.bottom + 14;
  if (top + bubbleHeight > window.innerHeight - 16) top = Math.max(16, rect.top - bubbleHeight - 14);
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

function finishTour() {
  document.querySelector('.tourTarget')?.classList.remove('tourTarget');
  elements.tourLayer.hidden = true;
  state.tourIndex = -1;
  localStorage.setItem(TOUR_KEY, '1');
}

function openFirstPrompt() {
  if (!state.selected) openComposer(state.filtered[0] || state.library.prompts[0]);
  else elements.composerOverlay.hidden = false;
  syncBodyLock();
}

function syncBodyLock() {
  document.body.classList.toggle('locked', !elements.composerOverlay.hidden || !elements.settingsOverlay.hidden);
}
