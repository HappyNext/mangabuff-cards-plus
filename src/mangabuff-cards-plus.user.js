// ==UserScript==
// @name         MangaBuff Cards Plus
// @namespace    https://github.com/HappyNext/mangabuff-cards-plus
// @version      0.4.0
// @description  Расширенная аналитика, медианные цены и статистика карточек на MangaBuff
// @author       HappyNext
// @match        https://mangabuff.ru/*
// @icon         https://mangabuff.ru/favicon.ico
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  const CACHE = new Map();

  // Добавление стилей плашки статистики
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
    }
    .mb-stats-title {
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #a1a1aa;
      display: flex;
      justify-content: space-between;
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
  `;
  document.head.appendChild(style);

  // Запрос цен с кэшированием (эндпоинт /market/cards/:id/price-history)
  async function fetchCardStats(cardId) {
    if (CACHE.has(cardId)) return CACHE.get(cardId);

    try {
      const res = await fetch(`/market/cards/${cardId}/price-history?days=30&source=all`);
      if (!res.ok) return null;
      const data = await res.json();
      CACHE.set(cardId, data);
      return data;
    } catch (e) {
      console.error('[MangaBuff Plus] Ошибка запроса цен:', e);
      return null;
    }
  }

  function createBadgeHtml(data) {
    if (!data || !data.stats || !data.count) {
      return `<span style="color: #71717a;">Нет истории сделок за 30 дней</span>`;
    }
    const s = data.stats;
    return `
      <div class="mb-stats-title">
        <span>Рынок (30 дней)</span>
        <span>Сделок: ${data.count}</span>
      </div>
      <div class="mb-stats-grid">
        <div class="mb-stat-item">
          <span class="mb-stat-label">Медиана</span>
          <span class="mb-stat-val">${s.median_points ?? '—'}</span>
        </div>
        <div class="mb-stat-item">
          <span class="mb-stat-label">Мин (Q1)</span>
          <span class="mb-stat-val q1">${s.q1_points ?? '—'}</span>
        </div>
        <div class="mb-stat-item">
          <span class="mb-stat-label">Макс (Q3)</span>
          <span class="mb-stat-val q3">${s.q3_points ?? '—'}</span>
        </div>
      </div>
    `;
  }

  // Извлечение реального ID базовой карты каталога
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

    const replaceLink = modal.querySelector('a[href*="replace_id="]');
    if (replaceLink) {
      const match = replaceLink.href.match(/replace_id=(\d+)/);
      if (match) return match[1];
    }

    return null;
  }

  // Обработка модалки в инвентаре
  async function handleModal() {
    const modal = document.querySelector('.manga-cards__container');
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
    badge.innerHTML = `<span style="color: #a1a1aa;"> Загрузка цен маркета...</span>`;

    const insertBeforeEl = modal.querySelector('.manga-cards__controls') || targetContainer.firstChild;
    targetContainer.insertBefore(badge, insertBeforeEl);

    const data = await fetchCardStats(cardId);
    badge.innerHTML = createBadgeHtml(data);
  }

  // Обработка прямой страницы карты на рынке (/market/card/:id)
  async function handleMarketPage() {
    const match = window.location.pathname.match(/\/market\/card\/(\d+)/);
    if (!match) return;
    const cardId = match[1];

    if (document.querySelector('.mb-stats-badge-page')) return;

    const container = document.querySelector('.market-card__info, .market-card, [class*="sellers"]');
    if (!container) return;

    const badge = document.createElement('div');
    badge.className = 'mb-stats-badge mb-stats-badge-page';
    badge.innerHTML = `<span style="color: #a1a1aa;"> Загрузка цен маркета...</span>`;

    container.parentNode.insertBefore(badge, container);

    const data = await fetchCardStats(cardId);
    badge.innerHTML = createBadgeHtml(data);
  }

  const observer = new MutationObserver(() => {
    handleModal();
    if (window.location.pathname.includes('/market/card/')) {
      handleMarketPage();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  if (window.location.pathname.includes('/market/card/')) {
    handleMarketPage();
  }
})();