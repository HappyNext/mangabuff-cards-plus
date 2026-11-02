// ==UserScript==
// @name         MangaBuff Cards Plus
// @namespace    https://github.com/HappyNext/mangabuff-cards-plus
// @version      1.0.0
// @description  Расширенная аналитика, медианные цены и статистика карточек на MangaBuff
// @author       HappyNext
// @match        https://mangabuff.ru/*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiMxODE4MWIiLz48cmVjdCB4PSIyNSIgeT0iMTAiIHdpZHRoPSIyNiIgaGVpZ2h0PSIzNiIgcng9IjUiIGZpbGw9IiMzOGJkZjgiIGZpbGwtb3BhY2l0eT0iLjMiIHRyYW5zZm9ybT0icm90YXRlKDEyIDM4IDI4KSIvPjxyZWN0IHg9IjEyIiB5PSIxNSIgd2lkdGg9IjI4IiBoZWlnaHQ9IjM5IiByeD0iNSIgZmlsbD0iIzI3MjcyYSIgc3Ryb2tlPSIjMzhiZGY4IiBzdHJva2Utd2lkdGg9IjMiLz48cGF0aCBkPSJNMTkgNDZ2LTgiIHN0cm9rZT0iIzM0ZDM5OSIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cGF0aCBkPSJNMjYgNDZWMjYiIHN0cm9rZT0iIzM4YmRmOCIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cGF0aCBkPSJNMzMgNDZWMzMiIHN0cm9rZT0iI2Y0M2Y1ZSIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cGF0aCBkPSJNNTAgNDB2MTJNNDQgNDZoMTIiIHN0cm9rZT0iIzM0ZDM5OSIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48L3N2Zz4=
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

/* global GM_getValue, GM_setValue, GM_registerMenuCommand */

(() => {
  'use strict';

  const STORAGE_KEY = 'mbcp:settings';
  const CACHE_PREFIX = 'mbcp:cache:';
  const CACHE_TTL_MS = 10 * 60 * 1000;
  // Ошибки кэшируются ненадолго: если сайт пересоздаст модалку, упавший запрос не уйдёт в цикл.
  const ERROR_TTL_MS = 30 * 1000;
  const SYNC_DELAY_MS = 50;

  const DEFAULT_SETTINGS = Object.freeze({ period: 30, source: 'all', format: 'ranks' });

  const SETTING_FIELDS = Object.freeze([
    {
      key: 'period',
      label: 'Период',
      options: [
        { value: 7, label: '7 дней' },
        { value: 30, label: '30 дней' },
        { value: 60, label: '60 дней' },
      ],
    },
    {
      key: 'source',
      label: 'Источник сделок',
      options: [
        { value: 'all', label: 'Все' },
        { value: 'market', label: 'Только лоты' },
        { value: 'requests', label: 'Только заявки' },
      ],
    },
    {
      key: 'format',
      label: 'Формат цен',
      options: [
        { value: 'ranks', label: 'В рангах карты (2 S)' },
        { value: 'points', label: 'Сырые очки (256 pts)' },
      ],
    },
  ]);

  // Запасные веса на случай, если в ответе API не окажется поля weights.
  const DEFAULT_WEIGHTS = Object.freeze({ E: 1, D: 2, C: 4, B: 8, A: 16, S: 128, X: 256 });

  // Источники базового ID карты. Ссылку /market/create?card_id=... использовать нельзя:
  // в ней ID экземпляра инвентаря, а не карты каталога.
  const CARD_ID_SOURCES = Object.freeze([
    { selector: 'a[href*="/market/requests/create?card_id="]', pattern: /[?&]card_id=(\d+)/ },
    { selector: 'a[href*="/cards/"][href*="/users"]', pattern: /\/cards\/(\d+)\/users/ },
    { selector: 'a[href*="replace_id="]', pattern: /[?&]replace_id=(\d+)/ },
  ]);

  const RANK_ELEMENTS_SELECTOR = '[data-rank], [data-card-rank], [class*="rank"]';
  const RANK_CLASS_PATTERN = /(?:^|[\s_-])rank[-_]+([a-z0-9]+)(?=\s|$)/gi;
  const RANK_TEXT_PATTERN = /ранг\s*[:—-]?\s*([a-z])\b/i;

  // ---------------------------------------------------------------------------
  // Настройки
  // ---------------------------------------------------------------------------

  const hasGmStorage = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

  function readStoredSettings() {
    if (hasGmStorage) {
      try {
        return GM_getValue(STORAGE_KEY, null);
      } catch {
        // Переходим на localStorage.
      }
    }
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  function writeStoredSettings(value) {
    if (hasGmStorage) {
      try {
        GM_setValue(STORAGE_KEY, value);
        return;
      } catch {
        // Переходим на localStorage.
      }
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Хранилище недоступно: настройки продолжат действовать до перезагрузки вкладки.
    }
  }

  function sanitizeSettings(raw) {
    const result = { ...DEFAULT_SETTINGS };
    for (const { key, options } of SETTING_FIELDS) {
      const match = options.find(({ value }) => String(value) === String(raw?.[key]));
      if (match) result[key] = match.value;
    }
    return result;
  }

  let settings = sanitizeSettings(readStoredSettings());

  // ---------------------------------------------------------------------------
  // API и кэш
  // ---------------------------------------------------------------------------

  const memoryCache = new Map();
  let cacheGeneration = 0;

  function readSessionCache(key) {
    try {
      const raw = sessionStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (entry.expires > Date.now()) return entry;
      sessionStorage.removeItem(CACHE_PREFIX + key);
    } catch {
      // Повреждённая запись или недоступное хранилище равны промаху кэша.
    }
    return null;
  }

  function writeSessionCache(key, data, expires) {
    try {
      sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, expires }));
    } catch {
      // Например, переполнена квота: остаётся кэш в памяти.
    }
  }

  function clearCache() {
    cacheGeneration += 1;
    memoryCache.clear();
    try {
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith(CACHE_PREFIX))
        .forEach((key) => sessionStorage.removeItem(key));
    } catch {
      // Хранилище недоступно: очищать нечего.
    }
  }

  async function requestPriceHistory(cardId, period, source) {
    const response = await fetch(
      `/market/cards/${cardId}/price-history?days=${period}&source=${source}`,
      {
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /** Возвращает промис, который не отклоняется: { ok: true, data } или { ok: false }. */
  function getPriceHistory(cardId, { period, source }) {
    const key = `${cardId}_${period}_${source}`;

    const cached = memoryCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.promise;

    const stored = readSessionCache(key);
    if (stored) {
      const promise = Promise.resolve({ ok: true, data: stored.data });
      memoryCache.set(key, { promise, expires: stored.expires });
      return promise;
    }

    const generation = cacheGeneration;
    const entry = { expires: Infinity, promise: null };
    entry.promise = requestPriceHistory(cardId, period, source)
      .then((data) => {
        entry.expires = Date.now() + CACHE_TTL_MS;
        // Ответ на запрос, начатый до сброса кэша, сохранять нельзя.
        if (generation === cacheGeneration) writeSessionCache(key, data, entry.expires);
        return { ok: true, data };
      })
      .catch((error) => {
        entry.expires = Date.now() + ERROR_TTL_MS;
        console.debug('[MangaBuff Cards Plus] Не удалось получить цены:', error);
        return { ok: false };
      });
    memoryCache.set(key, entry);
    return entry.promise;
  }

  // ---------------------------------------------------------------------------
  // Форматирование цен
  // ---------------------------------------------------------------------------

  function resolveWeights(apiWeights) {
    const weights = { ...DEFAULT_WEIGHTS };
    for (const [rank, weight] of Object.entries(apiWeights ?? {})) {
      const value = Number(weight);
      if (Number.isFinite(value) && value > 0) weights[rank.toUpperCase()] = value;
    }
    return weights;
  }

  function formatNumber(value) {
    if (value > 0 && value < 0.005) return '<0.01';
    return String(Number(value.toFixed(2)));
  }

  /** Раскладывает очки по рангам не выше ранга карты: 288 для S — «2 S + 2 A». */
  function decomposePoints(points, rank, weights) {
    const ranks = Object.entries(weights)
      .filter(([, weight]) => weight <= weights[rank])
      .sort(([, a], [, b]) => b - a);

    const parts = [];
    let rest = points;
    for (const [name, weight] of ranks) {
      const amount = Math.floor(rest / weight);
      if (amount > 0) {
        parts.push(`${amount} ${name}`);
        rest -= amount * weight;
      }
    }
    if (rest > 0.001) parts.push(`${formatNumber(rest)} pts`);
    return parts.join(' + ') || `0 ${rank}`;
  }

  function formatPrice(rawPoints, rank, weights, format) {
    const points = rawPoints === null || rawPoints === undefined ? NaN : Number(rawPoints);
    if (!Number.isFinite(points)) return { text: '—', title: '' };

    const pointsText = `${formatNumber(points)} pts`;
    if (format === 'points') return { text: pointsText, title: '' };
    if (!rank) {
      return { text: pointsText, title: 'Ранг карты не определён, цена показана в очках' };
    }
    return {
      text: `${formatNumber(points / weights[rank])} ${rank}`,
      title: `${pointsText} = ${decomposePoints(points, rank, weights)}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Чтение данных из DOM
  // ---------------------------------------------------------------------------

  function extractBaseCardId(root) {
    for (const { selector, pattern } of CARD_ID_SOURCES) {
      for (const link of root.querySelectorAll(selector)) {
        const match = link.getAttribute('href').match(pattern);
        if (match) return match[1];
      }
    }
    return null;
  }

  function collectRankCandidates(data, scope) {
    const candidates = [data?.rank, data?.card?.rank];

    if (scope) {
      for (const element of [scope, ...scope.querySelectorAll(RANK_ELEMENTS_SELECTOR)]) {
        candidates.push(element.getAttribute('data-rank'), element.getAttribute('data-card-rank'));
        const className = element.getAttribute('class') ?? '';
        for (const [, token] of className.matchAll(RANK_CLASS_PATTERN)) candidates.push(token);
      }
      candidates.push(scope.textContent.match(RANK_TEXT_PATTERN)?.[1]);
    }
    return candidates;
  }

  /** Первый кандидат, который есть в таблице весов. Так «rank-up» не примется за ранг. */
  function detectRank(data, scope, weights) {
    for (const candidate of collectRankCandidates(data, scope)) {
      const rank = String(candidate ?? '').trim().toUpperCase();
      if (rank && Object.hasOwn(weights, rank)) return rank;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Стили и утилиты DOM
  // ---------------------------------------------------------------------------

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function injectStyles() {
    if (document.getElementById('mbcp-styles')) return;
    const style = createElement('style');
    style.id = 'mbcp-styles';
    style.textContent = `
      .mbcp-badge {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 12px 0;
        padding: 10px 14px;
        color: #e4e4e7;
        font-size: 13px;
        line-height: 1.35;
        text-align: left;
        background: rgba(24, 24, 27, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 10px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
        -webkit-backdrop-filter: blur(10px);
        backdrop-filter: blur(10px);
      }
      .mbcp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: #a1a1aa;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .mbcp-header-side {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        gap: 6px;
      }
      .mbcp-gear {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        margin: 0;
        padding: 0;
        color: #a1a1aa;
        font: inherit;
        font-size: 14px;
        line-height: 1;
        background: transparent;
        border: 0;
        border-radius: 6px;
        cursor: pointer;
        transition: color 0.15s, background-color 0.15s;
      }
      .mbcp-gear:hover {
        color: #e4e4e7;
        background: rgba(255, 255, 255, 0.1);
      }
      .mbcp-gear:focus-visible,
      .mbcp-button:focus-visible,
      .mbcp-select:focus-visible {
        outline: 2px solid #38bdf8;
        outline-offset: 1px;
      }
      .mbcp-message { color: #a1a1aa; }
      .mbcp-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .mbcp-stat {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .mbcp-stat-label {
        color: #a1a1aa;
        font-size: 11px;
      }
      .mbcp-stat-value {
        color: #38bdf8;
        font-size: 15px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
      .mbcp-stat-value--q1 { color: #34d399; }
      .mbcp-stat-value--q3 { color: #f43f5e; }

      .mbcp-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(0, 0, 0, 0.6);
        color-scheme: dark;
      }
      .mbcp-dialog {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 14px;
        width: 100%;
        max-width: 340px;
        max-height: 100%;
        overflow-y: auto;
        padding: 18px;
        color: #e4e4e7;
        font-size: 14px;
        line-height: 1.35;
        text-align: left;
        background: rgba(24, 24, 27, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 10px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
        -webkit-backdrop-filter: blur(10px);
        backdrop-filter: blur(10px);
      }
      .mbcp-dialog-title {
        margin: 0;
        color: #e4e4e7;
        font-size: 16px;
        font-weight: 600;
      }
      .mbcp-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 0;
        color: #a1a1aa;
        font-size: 12px;
      }
      .mbcp-select {
        box-sizing: border-box;
        width: 100%;
        height: auto;
        margin: 0;
        padding: 8px 10px;
        color: #e4e4e7;
        font: inherit;
        font-size: 14px;
        background: #27272a;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 8px;
      }
      .mbcp-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 2px;
      }
      .mbcp-button {
        margin: 0;
        padding: 8px 14px;
        color: #e4e4e7;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        background: #3f3f46;
        border: 0;
        border-radius: 8px;
        cursor: pointer;
        transition: filter 0.15s;
      }
      .mbcp-button:hover { filter: brightness(1.15); }
      .mbcp-button--primary {
        color: #082f49;
        background: #38bdf8;
      }
    `;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Плашка
  // ---------------------------------------------------------------------------

  const badgeStates = new WeakMap();

  function createBadge(cardId, rankScope, extraClass) {
    const badge = createElement('div', `mbcp-badge ${extraClass}`);
    badge.dataset.cardId = cardId;

    const title = createElement('span');
    const count = createElement('span');
    const gear = createElement('button', 'mbcp-gear', '⚙');
    gear.type = 'button';
    gear.title = 'Настройки MangaBuff Cards Plus';
    gear.setAttribute('aria-label', gear.title);
    gear.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSettings(gear);
    });

    const side = createElement('div', 'mbcp-header-side');
    side.append(count, gear);
    const header = createElement('div', 'mbcp-header');
    header.append(title, side);
    const body = createElement('div');
    body.setAttribute('aria-live', 'polite');
    badge.append(header, body);

    badgeStates.set(badge, { cardId, rankScope, title, count, body, token: 0 });
    return badge;
  }

  function renderStat(label, price, modifier) {
    const stat = createElement('div', 'mbcp-stat');
    const value = createElement('span', `mbcp-stat-value ${modifier}`.trim(), price.text);
    if (price.title) value.title = price.title;
    stat.append(createElement('span', 'mbcp-stat-label', label), value);
    return stat;
  }

  function renderMessage(state, text) {
    state.body.replaceChildren(createElement('span', 'mbcp-message', text));
  }

  function renderResult(state, result, { format }) {
    if (!result.ok) {
      renderMessage(state, 'Не удалось загрузить цены маркета');
      return;
    }

    const { data } = result;
    if (!data || !data.stats || data.count === 0) {
      renderMessage(state, 'Нет сделок за выбранный период');
      return;
    }

    state.count.textContent = `Сделок: ${data.count ?? '—'}`;

    const weights = resolveWeights(data.weights);
    const rank = format === 'ranks' ? detectRank(data, state.rankScope, weights) : null;
    const price = (points) => formatPrice(points, rank, weights, format);

    const grid = createElement('div', 'mbcp-grid');
    grid.append(
      renderStat('Медиана', price(data.stats.median_points), ''),
      renderStat('Мин (Q1)', price(data.stats.q1_points), 'mbcp-stat-value--q1'),
      renderStat('Макс (Q3)', price(data.stats.q3_points), 'mbcp-stat-value--q3'),
    );
    state.body.replaceChildren(grid);
  }

  async function loadBadge(badge) {
    const state = badgeStates.get(badge);
    const current = { ...settings };
    state.token += 1;
    const { token } = state;

    state.title.textContent = `Рынок (${current.period} дней)`;
    state.count.textContent = '';
    renderMessage(state, 'Загрузка цен маркета...');

    const result = await getPriceHistory(state.cardId, current);
    // За время запроса карту могли переключить, а настройки — изменить.
    if (state.token === token) renderResult(state, result, current);
  }

  function refreshBadges() {
    document.querySelectorAll('.mbcp-badge').forEach(loadBadge);
  }

  // ---------------------------------------------------------------------------
  // Окно настроек
  // ---------------------------------------------------------------------------

  let closeOpenSettings = null;

  function createSettingsField({ key, label, options }) {
    const field = createElement('label', 'mbcp-field', label);
    const select = createElement('select', 'mbcp-select');
    select.name = key;
    for (const { value, label: optionLabel } of options) {
      const option = createElement('option', '', optionLabel);
      option.value = String(value);
      select.append(option);
    }
    select.value = String(settings[key]);
    field.append(select);
    return field;
  }

  function openSettings(opener = null) {
    if (closeOpenSettings) return;

    const overlay = createElement('div', 'mbcp-overlay');
    const dialog = createElement('form', 'mbcp-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'mbcp-settings-title');

    const heading = createElement('h2', 'mbcp-dialog-title', 'MangaBuff Cards Plus');
    heading.id = 'mbcp-settings-title';

    const cancel = createElement('button', 'mbcp-button', 'Отмена');
    cancel.type = 'button';
    const save = createElement('button', 'mbcp-button mbcp-button--primary', 'Сохранить');
    save.type = 'submit';
    const actions = createElement('div', 'mbcp-actions');
    actions.append(cancel, save);

    dialog.append(heading, ...SETTING_FIELDS.map(createSettingsField), actions);
    overlay.append(dialog);

    const close = () => {
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      closeOpenSettings = null;
      if (opener?.isConnected) opener.focus();
    };

    function onKeydown(event) {
      if (event.key === 'Escape') {
        // Перехват в фазе capture: иначе Esc закроет и модалку сайта под настройками.
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === 'Tab') {
        const focusable = [...dialog.querySelectorAll('select, button')];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    // Клики внутри настроек не должны считаться «кликом мимо» модалки сайта.
    for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart']) {
      overlay.addEventListener(type, (event) => event.stopPropagation());
    }
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    cancel.addEventListener('click', close);
    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      settings = sanitizeSettings(Object.fromEntries(new FormData(dialog)));
      writeStoredSettings(settings);
      clearCache();
      refreshBadges();
      close();
    });
    document.addEventListener('keydown', onKeydown, true);

    closeOpenSettings = close;
    document.body.append(overlay);
    dialog.querySelector('select').focus();
  }

  // ---------------------------------------------------------------------------
  // Встраивание плашек
  // ---------------------------------------------------------------------------

  /** Оставляет одну плашку для cardId и удаляет остальные. Возвращает true, если она уже есть. */
  function reconcileBadges(badges, cardId) {
    let found = false;
    badges.forEach((badge) => {
      if (!found && badge.dataset.cardId === cardId) {
        found = true;
      } else {
        badge.remove();
      }
    });
    return found;
  }

  function syncCardModal(modal) {
    const cardId = extractBaseCardId(modal);
    const badges = modal.querySelectorAll('.mbcp-badge');
    if (reconcileBadges(badges, cardId) || !cardId) return;

    const info = modal.querySelector('.manga-cards__info');
    if (!info) return;

    const controls = modal.querySelector('.manga-cards__controls');
    const badge = createBadge(cardId, modal, 'mbcp-badge--modal');
    // Панель кнопок может лежать вне блока информации, тогда вставляем в начало блока.
    info.insertBefore(badge, controls?.parentElement === info ? controls : info.firstChild);
    loadBadge(badge);
  }

  function syncMarketPage() {
    const cardId = window.location.pathname.match(/\/market\/card\/(\d+)/)?.[1] ?? null;
    const badges = document.querySelectorAll('.mbcp-badge--page');
    if (reconcileBadges(badges, cardId) || !cardId) return;

    const container = document.querySelector('.market-card__info, .market-card, [class*="sellers"]');
    if (!container?.parentNode) return;

    const rankScope = document.querySelector('.market-card') ?? container;
    const badge = createBadge(cardId, rankScope, 'mbcp-badge--page');
    container.parentNode.insertBefore(badge, container);
    loadBadge(badge);
  }

  function sync() {
    document.querySelectorAll('.manga-cards__container').forEach(syncCardModal);
    syncMarketPage();
  }

  let syncTimer = null;

  function scheduleSync() {
    if (syncTimer !== null) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      sync();
    }, SYNC_DELAY_MS);
  }

  // ---------------------------------------------------------------------------
  // Запуск
  // ---------------------------------------------------------------------------

  injectStyles();

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚙ Настройки', () => openSettings());
  }

  new MutationObserver(scheduleSync).observe(document.body, { childList: true, subtree: true });
  sync();
})();
