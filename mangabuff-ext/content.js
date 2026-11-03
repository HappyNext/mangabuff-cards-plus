(function() {
  'use strict';

  // --- 1. Настройки через chrome.storage ---
  const DEFAULT_CONFIG = {
    period: 30,
    source: 'all',
    format: 'ranks',
    showMinMax: true
  };

  // Порядок важен: от старшего ранга к младшему, по нему идёт автоподбор.
  const RANK_WEIGHTS = Object.freeze({ X: 256, S: 128, A: 16, B: 8, C: 4, D: 2, E: 1 });

  // Разметка рангов не сверена с сайтом: селекторы взяты из userscript-версии.
  const RANK_ELEMENTS_SELECTOR = '[data-rank], [data-card-rank], [class*="rank"]';
  const RANK_CLASS_PATTERN = /(?:^|[\s_-])rank[-_]+([a-z0-9]+)(?=\s|$)/gi;
  const RANK_TEXT_PATTERN = /ранг\s*[:—-]?\s*([a-z])\b/i;

  const OBSERVER_DELAY_MS = 100;

  let currentConfig = { ...DEFAULT_CONFIG };

  function getConfig() {
    return currentConfig;
  }

  function saveConfig(values) {
    const next = { ...currentConfig, ...values };
    chrome.storage.local.set({ mb_config: next });
    applyConfig(next);
  }

  // Вызывается и при сохранении, и из onChanged, который срабатывает также в этой же вкладке.
  // Сравнение не даёт перерисовать бейдж и повторить запрос дважды.
  function applyConfig(values) {
    const next = { ...DEFAULT_CONFIG, ...values };
    if (JSON.stringify(next) === JSON.stringify(currentConfig)) return;
    currentConfig = next;
    CACHE.clear();
    document.querySelectorAll('.mb-stats-badge').forEach((badge) => badge.remove());
    handleModal();
  }

  // --- 2. Кэширование ---
  const CACHE = new Map();
  const CACHE_LIMIT = 200;

  // --- 3. Стили ---
  const style = document.createElement('style');
  style.textContent = `
    .mb-stats-badge {
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: rgba(24, 24, 27, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 10px;
      padding: 10px 14px;
      margin: 12px 0;
      color: #e4e4e7;
      font-size: 13px;
      backdrop-filter: blur(10px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      position: relative;
    }
    .mb-stats-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .mb-stats-title {
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #a1a1aa;
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .mb-settings-btn {
      background: transparent;
      border: none;
      cursor: pointer;
      color: #71717a;
      padding: 2px;
      display: flex;
      align-items: center;
      transition: color 0.15s ease;
    }
    .mb-settings-btn:hover {
      color: #38bdf8;
    }
    .mb-stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 2px;
    }
    .mb-stat-item {
      display: flex;
      flex-direction: column;
    }
    .mb-stat-label {
      font-size: 11px;
      color: #71717a;
    }
    .mb-stat-val {
      font-weight: 700;
      font-size: 15px;
      color: #38bdf8;
    }
    .mb-stat-val.q1 { color: #34d399; }
    .mb-stat-val.q3 { color: #f43f5e; }

    /* Окно настроек */
    .mb-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
    }
    .mb-modal-box {
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 14px;
      width: 360px;
      padding: 20px;
      color: #f4f4f5;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
      font-family: inherit;
    }
    .mb-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .mb-modal-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
    .mb-modal-close {
      background: none;
      border: none;
      color: #a1a1aa;
      font-size: 18px;
      cursor: pointer;
    }
    .mb-modal-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 14px;
    }
    .mb-modal-row label {
      font-size: 12px;
      color: #a1a1aa;
      font-weight: 500;
    }
    .mb-modal-row select {
      background: #27272a;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 8px 10px;
      color: #fafafa;
      font-size: 13px;
      outline: none;
    }
    .mb-modal-row select:focus {
      border-color: #38bdf8;
    }
    .mb-modal-check {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
      font-size: 12px;
      color: #a1a1aa;
      font-weight: 500;
      cursor: pointer;
    }
    .mb-save-btn {
      background: #8b5cf6;
      border: none;
      border-radius: 8px;
      color: #fff;
      padding: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      margin-top: 8px;
    }
    .mb-save-btn:hover { background: #7c3aed; }
  `;
  document.head.appendChild(style);

  // --- 4. Логика скрипта ---
  // Number() превращает null, '' и [] в 0, поэтому такие значения отсекаем заранее:
  // пропавшая цена должна показываться как «—», а не как бесплатная карта.
  function toFiniteNumber(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatNumber(value) {
    return String(Number(value.toFixed(2)));
  }

  function pickAutoRank(points) {
    const match = Object.entries(RANK_WEIGHTS).find(([, weight]) => points / weight >= 1);
    return match ? match[0] : null;
  }

  function formatPoints(rawPoints, targetRank = null) {
    const points = toFiniteNumber(rawPoints);
    if (points === null) return '—';
    if (getConfig().format === 'points') return `${formatNumber(points)} pts`;

    const rank = targetRank && points / RANK_WEIGHTS[targetRank] >= 0.01
      ? targetRank
      : pickAutoRank(points);
    if (!rank) return `${formatNumber(points)} pts`;
    return `${formatNumber(points / RANK_WEIGHTS[rank])} ${rank}`;
  }

  function detectCardRank(modal) {
    const candidates = [];
    for (const element of [modal, ...modal.querySelectorAll(RANK_ELEMENTS_SELECTOR)]) {
      candidates.push(element.getAttribute('data-rank'), element.getAttribute('data-card-rank'));
      const className = element.getAttribute('class') ?? '';
      for (const [, token] of className.matchAll(RANK_CLASS_PATTERN)) candidates.push(token);
    }
    candidates.push(modal.textContent.match(RANK_TEXT_PATTERN)?.[1]);

    // Проверка по таблице весов не даёт принять класс вроде «rank-up» за ранг.
    for (const candidate of candidates) {
      const rank = String(candidate ?? '').trim().toUpperCase();
      if (rank && Object.hasOwn(RANK_WEIGHTS, rank)) return rank;
    }
    return null;
  }

  async function requestCardStats(cardId, period, source) {
    try {
      // ИСПРАВЛЕНИЕ: Добавлен window.location.origin для расширений
      const url = `${window.location.origin}/market/cards/${cardId}/price-history?days=${period}&source=${source}`;
      const options = {
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      };
      const res = await fetch(url, options);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('[MangaBuff Plus] Ошибка API:', e);
      return null;
    }
  }

  function fetchCardStats(cardId) {
    const cfg = getConfig();
    const cacheKey = `${cardId}_${cfg.period}_${cfg.source}`;
    if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

    if (CACHE.size >= CACHE_LIMIT) CACHE.delete(CACHE.keys().next().value);

    const promise = requestCardStats(cardId, cfg.period, cfg.source).then((data) => {
      // Пока шёл запрос, кэш могли очистить и записать под этим ключом новый промис.
      if (data === null && CACHE.get(cacheKey) === promise) CACHE.delete(cacheKey);
      return data;
    });
    CACHE.set(cacheKey, promise);
    return promise;
  }

  function openSettingsModal() {
    if (document.querySelector('.mb-modal-overlay')) return;
    const cfg = getConfig();
    const overlay = document.createElement('div');
    overlay.className = 'mb-modal-overlay';
    overlay.innerHTML = `
      <div class="mb-modal-box">
        <div class="mb-modal-header">
          <h3>Настройки аналитики</h3>
          <button class="mb-modal-close">✕</button>
        </div>
        <div class="mb-modal-row">
          <label>Период аналитики:</label>
          <select id="mb-set-period">
            <option value="7" ${cfg.period == 7 ? 'selected' : ''}>7 дней</option>
            <option value="30" ${cfg.period == 30 ? 'selected' : ''}>30 дней</option>
            <option value="60" ${cfg.period == 60 ? 'selected' : ''}>60 дней</option>
          </select>
        </div>
        <div class="mb-modal-row">
          <label>Отображение цен:</label>
          <select id="mb-set-format">
            <option value="ranks" ${cfg.format === 'ranks' ? 'selected' : ''}>В рангах (2 S)</option>
            <option value="points" ${cfg.format === 'points' ? 'selected' : ''}>В очках (256 pts)</option>
          </select>
        </div>
        <div class="mb-modal-row">
          <label>Фильтр сделок:</label>
          <select id="mb-set-source">
            <option value="all" ${cfg.source === 'all' ? 'selected' : ''}>Все сделки</option>
            <option value="market" ${cfg.source === 'market' ? 'selected' : ''}>Только маркет</option>
            <option value="requests" ${cfg.source === 'requests' ? 'selected' : ''}>Только заявки</option>
          </select>
        </div>
        <label class="mb-modal-check">
          <input type="checkbox" id="mb-set-minmax" ${cfg.showMinMax ? 'checked' : ''}>
          Показывать квартили (Q1 и Q3)
        </label>
        <button class="mb-save-btn">Сохранить</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // Иначе сайт примет клик по настройкам за клик мимо своей модалки и закроет её.
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'click']) {
      overlay.addEventListener(type, (e) => e.stopPropagation(), { passive: type.startsWith('touch') });
    }

    const closeOverlay = () => {
      window.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
    };

    function onKeydown(e) {
      if (e.key !== 'Escape') return;
      // Перехват в фазе capture: иначе Esc закроет и модалку сайта под настройками.
      e.preventDefault();
      e.stopImmediatePropagation();
      closeOverlay();
    }

    window.addEventListener('keydown', onKeydown, true);

    overlay.querySelector('.mb-modal-close').onclick = closeOverlay;
    overlay.onclick = (e) => { if (e.target === overlay) closeOverlay(); };

    overlay.querySelector('.mb-save-btn').onclick = () => {
      const values = {
        period: parseInt(overlay.querySelector('#mb-set-period').value, 10),
        format: overlay.querySelector('#mb-set-format').value,
        source: overlay.querySelector('#mb-set-source').value,
        showMinMax: overlay.querySelector('#mb-set-minmax').checked
      };
      closeOverlay();
      saveConfig(values);
    };
  }

  function createBadgeHtml(data, rank = null) {
    const cfg = getConfig();
    const period = toFiniteNumber(cfg.period) ?? '—';
    const count = toFiniteNumber(data?.count);
    if (!data || !data.stats || count === 0) {
      return `
        <div class="mb-stats-header">
          <span class="mb-stats-title">Рынок (${period} дн.)</span>
          <button class="mb-settings-btn" title="Настройки">⚙</button>
        </div>
        <span style="color: #71717a; margin-top: 4px;">Нет данных</span>
      `;
    }
    const s = data.stats;
    const quartiles = cfg.showMinMax ? `
        <div class="mb-stat-item"><span class="mb-stat-label">Нижн. (Q1)</span><span class="mb-stat-val q1">${formatPoints(s.q1_points, rank)}</span></div>
        <div class="mb-stat-item"><span class="mb-stat-label">Верхн. (Q3)</span><span class="mb-stat-val q3">${formatPoints(s.q3_points, rank)}</span></div>
    ` : '';
    return `
      <div class="mb-stats-header">
        <span class="mb-stats-title">Рынок (${period} дн.) • Сделок: ${count ?? '—'}</span>
        <button class="mb-settings-btn" title="Настройки">⚙</button>
      </div>
      <div class="mb-stats-grid">
        <div class="mb-stat-item"><span class="mb-stat-label">Медиана</span><span class="mb-stat-val">${formatPoints(s.median_points, rank)}</span></div>
        ${quartiles}
      </div>
    `;
  }

  function extractBaseCardId(modal) {
    const requestLink = modal.querySelector('a[href*="/market/requests/create?card_id="]');
    if (requestLink) {
      const match = requestLink.href.match(/card_id=(\d+)/);
      if (match) return match[1];
    }
    const usersLink = modal.querySelector('a[href*="/cards/"][href*="/users"]');
    if (usersLink) {
      const match = usersLink.href.match(/\/cards\/(\d+)\/users/);
      if (match) return match[1];
    }
    return null;
  }

  // У элемента с position: fixed offsetParent равен null даже когда он виден,
  // поэтому для такого случая дополнительно смотрим на getClientRects.
  function isVisible(element) {
    return element.offsetParent !== null || element.getClientRects().length > 0;
  }

  async function handleModal() {
    const modal = [...document.querySelectorAll('.manga-cards__container')].find(isVisible);
    if (!modal) return;

    const cardId = extractBaseCardId(modal);
    if (!cardId) return;

    const existingBadge = modal.querySelector('.mb-stats-badge');
    if (existingBadge) {
      if (existingBadge.dataset.cardId === cardId) return;
      existingBadge.remove();
    }

    const targetContainer = modal.querySelector('.manga-cards__info');
    if (!targetContainer) return;

    const badge = document.createElement('div');
    badge.className = 'mb-stats-badge';
    badge.dataset.cardId = cardId;
    badge.innerHTML = `<span style="color: #a1a1aa;"> Загрузка...</span>`;
    
    const insertBeforeEl = targetContainer.querySelector(':scope > .manga-cards__controls') || targetContainer.firstChild;
    targetContainer.insertBefore(badge, insertBeforeEl);

    const data = await fetchCardStats(cardId);
    // Пока шёл запрос, бейдж могли удалить: карту переключили или изменили настройки.
    if (!badge.isConnected) return;
    badge.innerHTML = createBadgeHtml(data, detectCardRank(modal));

    const gearBtn = badge.querySelector('.mb-settings-btn');
    if (gearBtn) gearBtn.onclick = (e) => { e.stopPropagation(); openSettingsModal(); };
  }

  // --- 5. Инициализация расширения ---
  let observerTimer = null;

  // Таймер не сбрасывается новыми мутациями: иначе постоянно меняющаяся страница
  // откладывала бы вызов бесконечно.
  function scheduleHandleModal() {
    if (observerTimer !== null) return;
    observerTimer = setTimeout(() => {
      observerTimer = null;
      handleModal();
    }, OBSERVER_DELAY_MS);
  }

  function initExtension() {
    const observer = new MutationObserver(scheduleHandleModal);
    // class и style нужны для п.10: скрытая модалка может показаться без изменения дерева.
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.mb_config) applyConfig(changes.mb_config.newValue);
    });

    // Проверка сразу при старте (если модалка уже была открыта)
    handleModal();
  }

  // Старт после загрузки настроек из хранилища браузера
  chrome.storage.local.get(['mb_config'], (result) => {
    if (result.mb_config) {
      Object.assign(currentConfig, result.mb_config);
    }
    initExtension();
  });

})();