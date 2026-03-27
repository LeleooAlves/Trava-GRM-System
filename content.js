// --- Auto-Import Logic ---
const memoryCountedUrls = new Set(); // Fix: Define memory lock set

document.addEventListener('click', (event) => {
  // ... (rest of the file)
  // 1. Identify the button
  // It might be the svg, the path, or the button itself.
  // User provided HTML: <button ...><span ... aria-label="file-search"><svg ...>

  // Look for the specific aria-label "file-search"
  const target = event.target;
  const fileSearchSpan = target.closest('[aria-label="file-search"]');
  const fileSearchBtn = target.closest('button');

  // Check if we hit the file-search span OR a button containing it
  let isImportClick = false;

  if (fileSearchSpan) {
    isImportClick = true;
  } else if (fileSearchBtn) {
    if (fileSearchBtn.querySelector('[aria-label="file-search"]')) {
      isImportClick = true;
    }
  }

  if (!isImportClick) return;

  console.log('Botão de importação detectado (Via Click)! Iniciando scrape...');

  // Prevent default to ensure we handle it? No, might block site functionality. 
  // Just run parallel.

  // 1. Scrape Project Name
  // Structure: <div class="flex justify-start align-middle">GRM Log ... <button>
  const nameContainer = document.querySelector('.flex.justify-start.align-middle');
  let projectName = 'Projeto Importado';

  if (nameContainer) {
    // Clone to safely remove children without affecting DOM
    const clone = nameContainer.cloneNode(true);

    // Remove buttons and spans that are not text
    const trash = clone.querySelectorAll('button, span.anticon, span.ml-5');
    trash.forEach(el => el.remove());

    // Remove "Same item marking disabled" specifically if classes match
    // Or just get text and clean it
    let text = clone.textContent.trim();

    // Clean up common leftovers
    text = text.replace('Same item marking disabled', '').replace(/\s+/g, ' ').trim();

    if (text) {
      projectName = text;
      console.log('Nome do projeto extraído:', projectName);
    }
  } else {
    console.warn('Container do nome não encontrado.');
  }

  // 2. Scrape Table Data
  // <div class="ant-table-content"> ... <tbody class="ant-table-tbody">
  const rows = document.querySelectorAll('.ant-table-tbody .ant-table-row');
  const goalsToUpdate = [];

  rows.forEach(row => {
    const cells = row.querySelectorAll('.ant-table-cell');
    // Keyword Type (0), Total (1), Completed (2), Pending (3), Skipped (4)
    if (cells.length < 5) return;

    const typeRaw = cells[0].textContent.trim(); // "0%-20%"
    const totalRaw = cells[1].textContent.trim(); // "140" - TARGET/TOTAL
    const completedRaw = cells[2].textContent.trim(); // "4"

    // Map type "0%-20%" -> "0-20"
    const typeKey = typeRaw.replace(/%/g, '');

    // Validate if it's a real keyword type (filters out emails, 'Overall', etc.)
    if (!isValidKeywordType(typeRaw)) {
      console.log(`Skipping invalid row type: ${typeRaw}`);
      return;
    }

    const currentAmount = parseInt(completedRaw) || 0;

    console.log(`Found Goal: ${typeKey} = ${currentAmount}`);

    goalsToUpdate.push({
      type_key: typeKey,
      current_amount: currentAmount
    });
  });

  if (goalsToUpdate.length === 0) {
    showNotification('Tabela de dados não encontrada ou vazia.');
    return;
  }

  // 3. Send to Background
  chrome.runtime.sendMessage({
    type: 'IMPORT_PROJECT_DATA',
    projectName: projectName,
    goals: goalsToUpdate
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Erro ao enviar dados:', chrome.runtime.lastError);
      showNotification('Erro interno na extensão.');
      return;
    }
    if (response && response.success) {
      showNotification('Dados importados: ' + projectName);
    } else {
      showNotification('Erro na importação: ' + (response ? response.error : 'Unknown'));
    }
  });

  // ... (import logic above) ...

  // 4. Submit Button Click Logic (Global Delegation)
  // Check if we clicked the submit button (or inside it)
  // Target ANY element that acts as a button
  const submitEl = target.closest('button, .ant-btn-primary, [role="button"], input[type="submit"]');

  if (submitEl) {
    const text = submitEl.textContent.trim().toLowerCase();
    const elId = submitEl.id ? submitEl.id.toLowerCase() : '';
    const elType = submitEl.getAttribute('type');

    // Broaden check for "Submit" actions
    const isSubmitParams =
      elId === 'submit' ||
      text.includes('submit') ||
      text.includes('enviar') ||
      text.includes('confirmar') ||
      text.includes('salvar') ||
      text.includes('avaliar') ||
      text.includes('evaluate') ||
      elType === 'submit' ||
      submitEl.classList.contains('ant-btn-primary') ||
      (submitEl.classList.contains('ant-btn') && text.includes('submit')) ||
      (submitEl.getAttribute('aria-label') && submitEl.getAttribute('aria-label').toLowerCase().includes('submit'));

    if (isSubmitParams) {
      console.log('Submit action DETECTED (Tag: ' + submitEl.tagName + ') Text:', text);

      // Visual feedback to confirm button detection
      showNotification('Processando...');

      // Verify we are on item page (Log if not)
      if (isShopeeItemPage()) {
        console.log('Valid Item Page. Triggering increment...');
        incrementCounter();
      } else {
        console.log('Ignored: Not on Shopee Item Page. URL:', window.location.href);
        // FORCE COUNT if URL contains 'shopee.io' as failsafe for updated systems
        if (window.location.href.includes('shopee.io')) {
          console.log('Force allowing valid shopee domain...');
          incrementCounter();
        }
      }
      return; // Exit after handling submit click
    }
  }

  // 5. Evaluate Button Logic (Task List Page)
  // Logic: <a href="...item-evaluation..."><span>Evaluate</span></a>
  // We need to capture this click to:
  // a) Scrape the Keyword type from the table row
  // b) Check if goal is met -> Block if yes
  // c) If no -> Save type to storage so 'Submit' on next page counts it.

  // 5. Evaluate Button Logic (List Page - Prevent Navigation if Full)
  // Logic: <button ...><span>Evaluate</span></button> OR <a ...>Evaluate</a>
  // We check if the clicked element is an Evaluate button/link

  // Helper to check if it's an "Evaluate" click
  const isEvaluateClick = (t) => {
    // Check direct text
    const txt = t.textContent.trim().toLowerCase();
    if (txt === 'evaluate' || txt === 'avaliar' || txt === 'view') return true;
    // Check valid ancestor
    const btn = t.closest('button, a');
    if (btn) {
      const text = btn.textContent.trim().toLowerCase();
      return text.includes('evaluate') || text.includes('avaliar') || text.includes('view');
    }
    return false;
  };

  if (isEvaluateClick(target)) {
    const btn = target.closest('button, a');
    if (!btn) return;

    console.log('[GRM List] Evaluate clicked. Checking row...');

    // 1. Find Row and Type
    const row = btn.closest('tr');
    if (row) {
      // Find Type in this row (same logic as scraper)
      let foundType = null;
      const typeRegex = /\d+%\s*-\s*\d+%/;

      // Iterate cells to find type
      const cells = row.querySelectorAll('td');
      for (const cell of cells) {
        if (typeRegex.test(cell.innerText)) {
          foundType = cell.innerText.trim();
          break;
        }
      }

      if (foundType) {
        console.log('[GRM List] Row Type detected:', foundType);

        // IMPORTANT: Capture this type for the next page load (Backup mechanism)
        // We persist it so next page knows what type it is immediately
        chrome.storage.local.set({
          lastDetectedKeywordType: foundType,
          lastDetectedTimestamp: Date.now()
        });

        // 2. Async Check - Stop navigation until confirmed

        // STRICT BLOCKING STRATEGY
        // Check flag on the BUTTON element (not the clicked span)
        if (!btn.dataset.grmChecked) {
          console.log('[GRM List] 🛑 Intercepting click for check on:', foundType);
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          chrome.runtime.sendMessage({
            type: 'CHECK_BLOCK_STATUS',
            keywordType: foundType
          }, (response) => {
            if (response && response.blocked) {
              console.log('[GRM List] 🛑 BLOCKED. Goal met.');
              alert(`⚠️ AVISO: A meta para o tipo "${foundType}" já foi atingida.\n\nAção bloqueada.`);
              // Do nothing else, click is dead.
            } else {
              console.log('[GRM List] 🟢 ALLOWED. Re-triggering click...');

              // Mark button as checked
              btn.dataset.grmChecked = 'true';

              // Re-dispatch click
              // NOTE: If the original event was on a 'span', calling btn.click() shifts the target to 'button'.
              // This is usually fine for AntD.
              if (btn.tagName === 'A' && btn.href) {
                window.location.href = btn.href;
              } else {
                btn.click();
              }

              // Clear flag after a short delay
              setTimeout(() => delete btn.dataset.grmChecked, 1000);
            }
          });
        } else {
          console.log('[GRM List] 🟢 Passthrough (already checked).');
        }
      } else {
        console.log('[GRM List] ⚠️ Could not find Type in row. Text content:', row.innerText.substring(0, 50));
      }
    } else {
      console.log('[GRM List] ⚠️ Evaluate clicked but NO ROW parent found.');
    }
  }

}, true); // Capture phase
const notification = document.createElement('div');
notification.className = 'kw-notification';
document.body.appendChild(notification);

// Function to show notification (success/avisos) com tema da extensão
function showNotification(message) {
  notification.textContent = message || 'KW contabilizada com sucesso';
  notification.classList.add('show');
  setTimeout(() => {
    notification.classList.remove('show');
  }, 2000);
}

// Function to check if URL is a valid Shopee item page
// Function to check if URL is a valid Shopee item page to be blocked/counted
function isShopeeItemPage() {
  const url = window.location.href;

  // EXCLUDE List Pages explicitly (STRICTER)
  // If it has 'tab=' it is almost certainly a list/dashboard view.
  if (url.includes('tab=') || url.includes('page=')) {
    // confirm it is NOT an item page
    console.log('[GRM Debug] Excluded by tab=/page=:', url);
    return false;
  }

  // VALID patterns for Item Page
  const isItem = url.includes('/keyword-evaluation-details') ||
    url.includes('/item-evaluation') ||
    (url.includes('evaluation') && !url.includes('tab=')) ||
    (url.includes('shopee.io') && url.includes('task') && !url.includes('tab=')) ||
    // New fallback: if it ends in specific ID format? No.
    false;

  // Debug log to catch why it might be triggering wrongly
  if (isItem) {
    // console.log('[GRM Debug] Detected as Item Page:', url);
  }
  return isItem;
}

function isShopeeListPage() {
  return window.location.href.includes('tab=all-tasks') || window.location.href.includes('tab=my-tasks');
}

// Function to get today's date key
function getTodayKey() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

// Function to check if page was already counted
function hasPageBeenCounted() {
  if (!isShopeeItemPage()) return false;

  const currentUrl = window.location.href;
  const dateKey = getTodayKey();

  chrome.storage.local.get(['countedUrls'], (result) => {
    const countedUrls = result.countedUrls || {};
    if (!countedUrls[dateKey]) {
      countedUrls[dateKey] = [];
    }
    return countedUrls[dateKey].includes(currentUrl);
  });
}

// Function to mark page as counted
function markPageAsCounted() {
  if (!isShopeeItemPage()) return;

  const currentUrl = window.location.href;
  const dateKey = getTodayKey();

  chrome.storage.local.get(['countedUrls'], (result) => {
    const countedUrls = result.countedUrls || {};
    if (!countedUrls[dateKey]) {
      countedUrls[dateKey] = [];
    }
    if (!countedUrls[dateKey].includes(currentUrl)) {
      countedUrls[dateKey].push(currentUrl);
      chrome.storage.local.set({ countedUrls: countedUrls });
    }
  });
}

// Function to clean up old counted URLs and keyword types
function cleanupOldCountedUrls() {
  chrome.storage.local.get(['countedUrls', 'keywordTypes'], (result) => {
    const countedUrls = result.countedUrls || {};
    // Não apagar keywordTypes para manter histórico permanente
    chrome.storage.local.set({ countedUrls: countedUrls });
  });
}

// Função para normalizar types (mesma lógica do popup.js)
function normalizeKeywordTypeInContent(type) {
  if (!type) return null;

  // Remove espaços e converte para minúsculo
  const cleanType = type.trim().toLowerCase();

  // Extrai números do type
  const numbers = cleanType.match(/\d+/g);
  if (!numbers || numbers.length < 2) return type;

  const firstNum = parseInt(numbers[0]);
  const secondNum = parseInt(numbers[1]);

  // Retorna no formato padrão "X-Y" (sem %) para bater com o sistema
  return `${firstNum}-${secondNum}`;
}

// Função para encontrar type existente que corresponde ao detectado
function findMatchingTypeInContent(selectedType, existingTypes) {
  const normalizedSelected = normalizeKeywordTypeInContent(selectedType);

  // Procura por types existentes que correspondem
  for (const existingType of Object.keys(existingTypes)) {
    const normalizedExisting = normalizeKeywordTypeInContent(existingType);
    if (normalizedSelected === normalizedExisting) {
      return existingType; // Retorna o type original existente
    }
  }

  return null; // Não encontrou correspondência
}

// Function to increment counter
function incrementCounter() {
  console.log('incrementCounter Called!');

  let validPage = isShopeeItemPage();
  const keywordTypeInitial = detectKeywordType(); // Detect early to help with validation

  if (!validPage) {
    if ((window.location.href.includes('shopee.io') || window.location.href.includes('shopee.com'))) {
      // Allow based on domain match as fallback
      validPage = true;
    } else {
      console.log('Not a Shopee item page - skipping count');
      return;
    }
  }

  if (!isExtensionValid()) return;

  const currentUrl = window.location.href;

  // 1. Synchronous check (Fast Lock)
  // Check if we already processed this URL in this session
  if (memoryCountedUrls.has(currentUrl)) {
    console.log('Blocked by memory lock: URL already counted in this session');
    showNotification('Já contabilizado!'); // Feedback for user
    return; // Silently ignore subsequent clicks
  }

  // OPTIMISTIC LOCK: Lock immediately to prevent race conditions from rapid clicks
  memoryCountedUrls.add(currentUrl);

  const localKeywordType = detectKeywordType(); // Detect HERE, not later
  console.log('[GRM Count] Local detection result:', localKeywordType);

  // Wrapper to allow async fallback check
  chrome.storage.local.get(['lastDetectedKeywordType', 'lastDetectedTimestamp'], (result) => {
    let keywordType = localKeywordType;
    console.log('[GRM Count] Storage Dump:', result);

    // Fallback: If local detection failed, try storage (valid for 5 minutes?)
    // Or just valid generally for this session.
    if (!keywordType && result.lastDetectedKeywordType) {
      console.log('[GRM Count] Using fallback keyword type from storage:', result.lastDetectedKeywordType);
      keywordType = result.lastDetectedKeywordType;
    }

    if (!keywordType) {
      console.log('[GRM Count] ❌ No keyword type detected (and no fallback)');
      memoryCountedUrls.delete(currentUrl); // Unlock if invalid
      showNotification('Tipo de keyword não detectado!');
      return;
    }

    // 2. Delegate to Background (Centralized Validation: Url Uniqueness + Limit)
    chrome.runtime.sendMessage({
      type: 'VALIDATE_AND_INCREMENT',
      keywordType: keywordType,
      url: currentUrl
    }, (response) => {
      // ... (response handling remains inside this block)
      if (chrome.runtime.lastError) {
        console.error('Error sending message:', chrome.runtime.lastError);
        memoryCountedUrls.delete(currentUrl); // Unlock on transport error
        showNotification('Erro ao conectar com extensão.');
        return;
      }

      if (response) {
        if (response.success) {
          showNotification('KW contabilizada: ' + keywordType);
          console.log(`Contabilizado: ${keywordType} | URL: ${currentUrl}`);
        } else {
          // Handle rejection (limit reached OR double click detected by background)
          if (response.blocked) {
            // Limit reached
            showNotification('Erro: ' + response.error);
            alert('Limite atingido para ' + keywordType);
            chrome.runtime.sendMessage({ type: 'CLOSE_CURRENT_TAB' });
          } else {
            // Double click or other error
            // If double click, we don't allow retry, so keep memory lock.
            if (response.error.includes('URL already processed')) {
              console.log('Server rejected: URL already processed');
              showNotification('⚠️ URL já contabilizada neste projeto!'); // NOW VISIBLE
            } else {
              // Other error -> Unlock?
              showNotification('Erro: ' + response.error);
              memoryCountedUrls.delete(currentUrl);
            }
          }
        }
      }
    });
  }); // End of chrome.storage.local.get wrapper
}

function enforceTypeGoalOnLoad(attempt = 0) {
  if (!isShopeeItemPage()) return;

  const MAX_ATTEMPTS = 10;
  const RETRY_DELAY = 500;

  // Check via standard detection (Type visible on page)
  const detectedType = detectKeywordType();

  if (detectedType) {
    console.log('Type detected on page:', detectedType);
    chrome.runtime.sendMessage({
      type: 'CHECK_BLOCK_STATUS',
      keywordType: detectedType
    }, (response) => {
      if (response && response.blocked) {
        alert('A meta para o type ' + detectedType + ' já foi atingida. Este link será fechado.');
        chrome.runtime.sendMessage({ type: 'CLOSE_CURRENT_TAB' });
      }
    });
    return; // Success, no need for fallback
  }

  // Fallback: Check via Keyword Name Mapping
  console.log('Direct type detection failed. Trying Keyword Name Lookup...');
  checkGoalByKeywordName(attempt);
}

// --- NEW FUNCTIONALITY: Keyword Mapping ---

// 1. Scrape List Page (Keyword -> Type)
function scrapeAndCacheKeywords() {
  if (!isShopeeListPage()) return;

  const rows = document.querySelectorAll('.ant-table-row');
  const cacheUpdates = {};
  let foundCount = 0;

  rows.forEach(row => {
    // 1. Find Keyword
    // The keyword is typically in the sticky left column or one of the first text columns
    // Based on user HTML, it's in 'ant-table-cell-fix-left-last'
    const keywordCell = row.querySelector('.ant-table-cell-fix-left-last') || row.cells[1]; // Fallback to index 1
    if (!keywordCell) return;

    const keyword = keywordCell.innerText.trim();
    if (!keyword) return;

    // 2. Find Type
    // Scan all cells in the row for a pattern like "50%-80%"
    let type = null;
    const cells = row.querySelectorAll('td.ant-table-cell');

    // Regex for type (X%-Y%) with capture groups
    const typeRegex = /(\d+)%\s*-\s*(\d+)%/;

    for (const cell of cells) {
      const match = cell.innerText.match(typeRegex);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = parseInt(match[2], 10);

        // Strict Whitelist of valid project types
        // The user confirmed these are the only valid ones: 0-20, 20-50, 50-80, 80-100
        const validRangeKey = `${start}-${end}`;
        const allowedRanges = ['0-20', '20-50', '50-80', '80-100'];

        if (allowedRanges.includes(validRangeKey) && start < end) {
          type = cell.innerText.trim();
          break;
        }
      }
    }

    if (keyword && type) {
      cacheUpdates[keyword] = type;
      foundCount++;
    }
  });

  if (foundCount > 0) {
    // Only log if something actually changed to avoid spamming
    chrome.storage.local.get(['keywordTypeMap'], (result) => {
      const currentMap = result.keywordTypeMap || {};
      const newMap = { ...currentMap, ...cacheUpdates };

      // Check if size changed
      if (Object.keys(newMap).length > Object.keys(currentMap).length) {
        chrome.storage.local.set({ keywordTypeMap: newMap }, () => {
          console.log(`[GRM Mapping] ✅ Updated cache. Total: ${Object.keys(newMap).length}`);
        });
      } else {
        // Silent update if needed, or just skip log
        // We still save to ensure consistency but no log
        chrome.storage.local.set({ keywordTypeMap: newMap });
      }
    });
  }
}

// 2. Enforce on Item Page (Keyword Lookup)
function checkGoalByKeywordName(attempt = 0) {
  const MAX_ATTEMPTS = 15;
  const RETRY_DELAY = 800; // Increased delay for React render

  // Selector provided by user: <td class="ant-descriptions-item-content"> ... <div>KEYWORD</div>
  const contentCells = document.querySelectorAll('.ant-descriptions-item-content');
  let foundKeyword = null;

  contentCells.forEach(cell => {
    const div = cell.querySelector('div');
    if (div && div.innerText) {
      const text = div.innerText.trim();
      // Simple heuristic: Take the first non-empty div in valid description cells
      if (!foundKeyword && text.length > 2) foundKeyword = text;
    }
  });

  if (foundKeyword) {
    console.log('[GRM Mapping] 🔍 Item Page Keyword:', foundKeyword);
    chrome.storage.local.get(['keywordTypeMap'], (result) => {
      const map = result.keywordTypeMap || {};
      const mappedType = map[foundKeyword];

      if (mappedType) {
        console.log(`[GRM Mapping] ✅ Cache Hit! Type is: ${mappedType}`);

        // IMPORTANT: Save this type so incrementCounter() can use it later!
        chrome.storage.local.set({
          lastDetectedKeywordType: mappedType,
          lastDetectedTimestamp: Date.now()
        });

        // Reuse existing check logic
        chrome.runtime.sendMessage({
          type: 'CHECK_BLOCK_STATUS',
          keywordType: mappedType
        }, (response) => {
          if (response && response.blocked) {
            console.log('[GRM Mapping] 🛑 GOAL MET. Blocking page...');
            alert(`A meta para o type ${mappedType} (detectado via nome) já foi atingida. Bloqueando...`);
            chrome.runtime.sendMessage({ type: 'CLOSE_CURRENT_TAB' });
          } else {
            console.log('[GRM Mapping] 🟢 Goal not yet met. Allowed.');
          }
        });
      } else {
        console.log('[GRM Mapping] ⚠️ Keyword not found in cache. Visit the List Page to update cache.');
        console.log('Current Cache Keys (first 10):', Object.keys(map).slice(0, 10));
      }
    });
  } else {
    // Retry Indefinitely
    // Silent retry to avoid spam
    // console.log(`[GRM Mapping] ⏳ Keyword element not found yet. Keep looking... (Attempt ${attempt + 1})`);
    setTimeout(() => checkGoalByKeywordName(attempt + 1), RETRY_DELAY);
  }
}

// Listen for global blocking broadcast
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SHOW_NOTIFICATION') {
    showNotification(message.message);
    return;
  }

  if (message.type === 'BLOCK_TYPE') {
    // SECURITY CHECK: Only close if it is an item page!
    // Prevents closing the project list page which also mentions types.
    if (!isShopeeItemPage()) return;

    const detectedType = detectKeywordType();
    if (detectedType === message.typeKey) {
      alert('Meta atingida para ' + message.typeKey + '. Bloqueando...');
      chrome.runtime.sendMessage({ type: 'CLOSE_CURRENT_TAB' });
    }
  }
  if (message.type === 'SHOW_NOTIFICATION') {
    incrementCounter();
  }
});

// Function to add click listener to submit button
function addSubmitButtonListener(button) {
  // Assim que o botão de envio estiver disponível, verificamos se a meta
  // daquele type já foi batida. Se sim, a aba é fechada imediatamente.
  enforceTypeGoalOnLoad();

  button.addEventListener('click', () => {
    console.log('Submit button clicked - checking if URL was already counted today');
    incrementCounter();
  });
}

// Function to find and setup submit button
function setupSubmitButton() {
  // Try to find the submit button
  const submitButton = document.querySelector('button#submit.ant-btn.ant-btn-primary');
  if (submitButton) {
    console.log('Found submit button, adding listener');
    addSubmitButtonListener(submitButton);
  }
}

// Helper to safely check if extension is valid
function isExtensionValid() {
  return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
}

function detectProjectName() {
  if (!isExtensionValid()) return;
  // Seleciona o elemento do nome do projeto
  const projectDiv = document.querySelector('div.flex.justify-start.align-middle');
  if (projectDiv) {
    // Pega todos os nós de texto diretos (ignora botões e spans)
    let projectName = '';
    projectDiv.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text && !text.includes('Same item marking disabled')) {
          projectName += text;
        }
      }
    });
    if (projectName) {
      try {
        chrome.storage.local.set({ detectedProjectName: projectName });
      } catch (e) {
        // Ignore context invalidated errors
      }
    }
  }
}

// Function to detect keyword type from the page
function detectKeywordType() {
  console.log('Starting keyword type detection...');

  // Padrões mais abrangentes para tipos de keywords
  // Padrões mais abrangentes para tipos de keywords
  const typePatterns = [
    /(\d+\s*-\s*\d+%)/g,           // Padrão como "0-20%", "0 - 20%"
    /(\d+%\s*-\s*\d+%)/g,          // Padrão alternativo com % nos dois
    /(\d+\s*-\s*\d+%?)/g,          // Sem % no final
    /(\d+%?\s*-\s*\d+%?)/g         // Genérico com espaços
  ];

  let keywordType = null;

  // Primeiro, procura em toda a página por padrões de tipos de keywords
  const bodyText = document.body.textContent || document.body.innerText || '';
  console.log('Searching in page text for keyword types...');

  for (const pattern of typePatterns) {
    const matches = bodyText.match(pattern);
    if (matches && matches.length > 0) {
      console.log('Found potential matches:', matches);
      // Pega o primeiro match que parece ser um tipo de keyword válido
      for (const match of matches) {
        if (isValidKeywordType(match)) {
          keywordType = match;
          console.log('Valid keyword type found:', keywordType);
          break;
        }
      }
      if (keywordType) break;
    }
  }

  // Se não encontrou na busca geral, tenta buscar em elementos específicos
  if (!keywordType) {
    console.log('No keyword type found in general search, trying specific elements...');

    // Busca em todos os elementos que podem conter texto
    const allElements = document.querySelectorAll('*');
    for (const element of allElements) {
      const text = element.textContent || element.innerText || '';
      if (text && text.length < 100) { // Limita a elementos com texto curto
        for (const pattern of typePatterns) {
          const match = text.match(pattern);
          if (match) {
            const matchedText = match[0];
            if (isValidKeywordType(matchedText)) {
              keywordType = matchedText;
              console.log('Keyword type found in element:', element.tagName, element.className, keywordType);
              break;
            }
          }
        }
        if (keywordType) break;
      }
    }
  }

  // Se ainda não encontrou, tenta uma busca mais agressiva
  if (!keywordType) {
    console.log('Trying aggressive search for keyword types...');
    keywordType = aggressiveKeywordTypeSearch();
  }

  // Normaliza o tipo de keyword para um formato padrão
  if (keywordType) {
    // Remove espaços extras e normaliza
    keywordType = keywordType.trim();
    // Remove % para padronizar com o sistema (ex: "50-80")
    keywordType = keywordType.replace(/%/g, '');
    console.log('Final keyword type detected:', keywordType);

    // PERSIST DETECTED TYPE for other contexts (frames)
    chrome.storage.local.set({
      lastDetectedKeywordType: keywordType,
      lastDetectedTimestamp: Date.now()
    });
  } else {
    console.log('No keyword type detected - checking page content...');
    // Log para debug - mostra parte do conteúdo da página
    const bodyText = document.body.textContent || '';
    console.log('Page text sample:', bodyText.substring(0, 500));
  }

  return keywordType;
}

// Função de busca agressiva para tipos de keywords
function aggressiveKeywordTypeSearch() {
  console.log('Starting aggressive keyword type search...');

  const allText = document.body.innerText || document.body.textContent || '';

  // Reuse patterns with spaces
  const typePatterns = [
    /(\d+\s*-\s*\d+%)/g,
    /(\d+%\s*-\s*\d+%)/g,
    /(\d+\s*-\s*\d+%?)/g,
    /(\d+%?\s*-\s*\d+%?)/g
  ];

  for (const pattern of typePatterns) {
    const matches = allText.match(pattern);
    if (matches) {
      for (const match of matches) {
        if (isValidKeywordType(match)) {
          console.log('Valid keyword type found in aggressive search:', match);
          return match;
        }
      }
    }
  }

  // Busca em atributos de elementos
  const allElements = document.querySelectorAll('*');
  for (const element of allElements) {
    // Verifica atributos como title, data-*, etc.
    const attributes = ['title', 'data-type', 'data-value', 'data-keyword-type'];
    for (const attr of attributes) {
      const value = element.getAttribute(attr);
      if (value && value.includes('-') && /\d/.test(value)) {
        console.log('Found potential keyword type in attribute:', attr, value);
        if (isValidKeywordType(value)) {
          console.log('Valid keyword type found in attribute:', value);
          return value;
        }
      }
    }
  }

  return null;
}

// Function to validate if a detected text is a valid keyword type
function isValidKeywordType(text) {
  if (!text || typeof text !== 'string') return false;

  console.log('Validating keyword type:', text);

  // Remove espaços e converte para minúsculo para análise
  const cleanText = text.trim().toLowerCase();

  // Verifica se contém números e hífen
  if (!/\d/.test(cleanText) || !cleanText.includes('-')) {
    return false;
  }

  // REJECT LEADING ZEROS (e.g., "03-10") unless it is just "0"
  // Regex to find numbers with leading zero (e.g. 05) but not 0 itself.
  if (/\b0\d+/.test(cleanText)) {
    console.log('Invalid: leading zeros detected');
    return false;
  }

  // Verifica se é um dos padrões conhecidos de tipos de keywords (WHITELIST STRICT)
  // O usuário confirmou que APENAS estes são válidos.
  const knownPatterns = [
    '0-20', '20-50', '50-80', '80-100'
  ];

  // Helper to strip % for comparison
  const rawText = cleanText.replace(/%/g, '').replace(/\s/g, '');

  for (const pattern of knownPatterns) {
    if (rawText === pattern) {
      console.log('Valid: matches strict whitelist', pattern);
      return true;
    }
  }

  // Remove generic fallbacks to ensure SAFETY.
  console.log('Invalid: does not match whitelist (0-20, 20-50, 50-80, 80-100)');
  return false;
}

// Helper: Debounce function to limit execution frequency
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Optimized MutationObserver (Unifies project detection and button detection)
const debouncedDetectProjectName = debounce(detectProjectName, 2000);

// --- AGGRESSIVE BLOCKING LOGIC ---
let hasCheckedGoalThisSession = false;

// Overlay helper
function showBlockingOverlay() {
  if (document.getElementById('grm-blocking-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'grm-blocking-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'rgba(0,0,0,0.9)'; // Dark opaque
  overlay.style.zIndex = '999999';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.color = 'white';
  overlay.style.fontSize = '24px';
  overlay.style.fontWeight = 'bold';
  overlay.innerHTML = '<div>🔒 Verificando Limites...<br><span style="font-size:16px">Carregando dados do projeto</span></div>';
  document.body.appendChild(overlay);
  // Prevent scrolling
  document.body.style.overflow = 'hidden';
}

function removeBlockingOverlay() {
  const overlay = document.getElementById('grm-blocking-overlay');
  if (overlay) {
    overlay.remove();
    document.body.style.overflow = '';
  }
}

const observer = new MutationObserver((mutations) => {
  // 1. Debounced Project Detection
  debouncedDetectProjectName();

  // 2. Button and Aggressive Type Detection
  if (isShopeeItemPage() && !hasCheckedGoalThisSession) {

    // Check text content of added nodes for Whitelisted Types
    let foundType = null;

    for (const mutation of mutations) {
      // Check added nodes text
      mutation.addedNodes.forEach(node => {
        if (node.textContent && node.textContent.length < 100) { // optimization
          const txt = node.textContent;
          // Quick check for patterns
          if (/\d+-\d+/.test(txt)) {
            // If potential match, run strict validator
            const match = txt.match(/(\d+\s*-\s*\d+)/);
            if (match && isValidKeywordType(match[0])) {
              foundType = match[0].replace(/\s/g, ''); // standardize
            }
          }
        }
      });
      if (foundType) break;
    }

    if (foundType) {
      console.log('⚡ Fast detection via Observer:', foundType);
      hasCheckedGoalThisSession = true; // prevent spamming message
      showBlockingOverlay(); // BLOCK INTERACTION IMMEDIATELY

      chrome.runtime.sendMessage({
        type: 'CHECK_BLOCK_STATUS',
        keywordType: foundType
      }, (response) => {
        if (response && response.blocked) {
          console.log('🛑 BLOCKED via Aggressive Observer.');
          alert(`🚫 Limite atingido para: ${foundType}\n\nFechando aba...`);
          chrome.runtime.sendMessage({ type: 'CLOSE_CURRENT_TAB' });
        } else {
          console.log('🟢 Allowed via Aggressive Observer.');
          removeBlockingOverlay();
          // Save valid detection for counter later
          chrome.storage.local.set({
            lastDetectedKeywordType: foundType,
            lastDetectedTimestamp: Date.now()
          });
        }
      });
    }
  }

  // 3. Button Detection (Standard)
  let shouldScanButtons = false;
  if (mutations.some(m => m.addedNodes.length > 0)) shouldScanButtons = true;

  if (shouldScanButtons) {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches && node.matches('button#submit.ant-btn.ant-btn-primary')) {
            addSubmitButtonListener(node);
          } else if (node.querySelector) {
            const btn = node.querySelector('button#submit.ant-btn.ant-btn-primary');
            if (btn) addSubmitButtonListener(btn);
          }
        }
      });
    });
  }
});

// Start observing
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Initial detection
detectProjectName();
setupSubmitButton();

// List Page: Scrape continuously
if (isShopeeListPage()) {
  setInterval(scrapeAndCacheKeywords, 2000);
}

// Item Page: Enforce goal (Backup to Observer)
enforceTypeGoalOnLoad();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SHOW_NOTIFICATION') {
    incrementCounter();
    return true;
  }
  // Allow manual block trigger from background
  if (message.type === 'BLOCK_TYPE') {
    alert(`🚫 Limite atingido para: ${message.typeKey}\n\nFechando aba...`);
    chrome.runtime.sendMessage({ type: 'CLOSE_CURRENT_TAB' });
  }

  // Receive signal that data changed in background -> Reload list if relevant
  if (message.type === 'PROJECT_UPDATED') {
    if (isShopeeListPage() && isExtensionValid()) {
      console.log('[GRM] Project updated signal received. Re-scraping...');
      scrapeAndCacheKeywords();
    }
  }
});

// Clean up old entries periodically (keep only last 7 days)
cleanupOldCountedUrls();
setInterval(cleanupOldCountedUrls, 24 * 60 * 60 * 1000);
