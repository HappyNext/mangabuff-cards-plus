(function() {
  'use strict';

  // 1. Блок работы с настройками (вместо GM_getValue)
  const DEFAULT_CONFIG = {
    period: 30,
    source: 'all',
    format: 'ranks',
    showMinMax: true
  };
  let currentConfig = { ...DEFAULT_CONFIG };

  function getConfig() {
    return currentConfig;
  }

  function setConfigValue(key, value) {
    currentConfig[key] = value;
    chrome.storage.local.set({ mb_config: currentConfig });
  }

  // 2. Все ваши переменные и функции оставляем как есть:
  const CACHE = new Map();
  
  const style = document.createElement('style');
  style.textContent = `... ваш CSS ...`;
  document.head.appendChild(style);

  function formatPoints(points, targetRank = 'S') { /* ... */ }
  function detectCardRank(modal) { /* ... */ }
  async function fetchCardStats(cardId) { /* ... */ }
  function openSettingsModal() { /* ... */ }
  function createBadgeHtml(data, rank = 'S') { /* ... */ }
  function extractBaseCardId(modal) { /* ... */ }
  async function handleModal() { /* ... */ }

  // 3. Вот сюда вставляем initExtension и инициализацию хранилища
  function initExtension() {
    const observer = new MutationObserver(() => {
      handleModal();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Если нужно обработать модалку сразу при загрузке (если она уже открыта)
    handleModal();
  }

  // 4. Самый последний блок кода: загрузка настроек и старт скрипта
  chrome.storage.local.get(['mb_config'], (result) => {
    if (result.mb_config) {
      Object.assign(currentConfig, result.mb_config);
    }
    // Как только настройки загружены — запускаем основную логику
    initExtension();
  });

})();