// --- Auto-Import Logic ---
const memoryCountedUrls = new Set(); // Fix: Define memory lock set

const isSKA = window.location.hostname.includes('knowledgeadmin.search.shopee.io') || window.location.href.includes('label_template');

document.addEventListener('click', (event) => {
  if (isSKA) return;

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

  if (isImportClick) {
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
  } // End if(isImportClick)

  // ... (import logic above) ...

  // 4. Submit Button Click Logic (Global Delegation)
  // STRICT CHECK: Only match the exact submit button for the task:
  // <button id="submit" type="button" class="ant-btn ant-btn-primary"><span>Submit</span></button>
  const mainSubmitBtn = target.closest('button#submit');

  if (mainSubmitBtn) {
    const text = mainSubmitBtn.textContent.trim().toLowerCase();
    if (text.includes('submit') || text.includes('enviar') || text.includes('salvar')) {
      console.log('Main Submit action DETECTED!', mainSubmitBtn);

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

  // 5. Evaluate Button Logic removed from primary 'click' listener.
  // We handle it via 'mouseup' globally below to correctly support Middle Clicks (Scroll) 
  // and Ctrl+Clicks without getting swallowed by React routers.
}, true); // Capture phase (End of main click listener)

// FALLBACK & MIDDLE CLICK SUPPORT: React Synthetic Event Bypass
// We capture 'click' and 'auxclick' to prevent React transitions or new tabs synchronously
let isManuallyClicking = false;

function handleEvaluateClick(event) {
  if (isSKA || isShopeeItemPage() || isManuallyClicking) return; // Only run on GRM list page
  
  // event.button: 0 = Left Click, 1 = Middle Click (Scroll wheel), 2 = Right Click
  if (event.button !== 0 && event.button !== 1 && event.button !== 2 && event.type !== 'contextmenu') return; 

  const target = event.target;
  const btn = target.closest('a, button');
  if (btn) {
    const btnText = btn.textContent.toLowerCase();
    const isEvalText = btnText.includes('evaluate') || btnText.includes('avaliar') || btnText.includes('view');
    const isEvalLink = (btn.getAttribute('href') && btn.getAttribute('href').includes('item-evaluation')) ||
      (btn.getAttribute('to') && btn.getAttribute('to').includes('item-evaluation'));

    if (isEvalLink || isEvalText) {
      console.log(`[GRM List] Evaluate Action (Button ${event.button}/Type: ${event.type}) disparado!`);
      const row = btn.closest('tr, .ant-table-row, [data-row-key]');
      if (row) {
        let foundType = null;
        const typeRegex = /\d+%?\s*-\s*\d+%?/;
        const cells = row.querySelectorAll('td, .ant-table-cell, div');
        for (const cell of cells) {
          if (typeRegex.test(cell.innerText)) {
            foundType = cell.innerText.trim();
            break;
          }
        }
        if (foundType) {
          const cleanType = foundType.replace(/%/g, '').replace(/\s/g, '').trim();
          console.log('[GRM List] Evaluate TYPE SALVO:', cleanType);
          
          chrome.storage.local.set({
            lastDetectedKeywordType: cleanType,
            lastDetectedTimestamp: Date.now()
          });

          showNotification('Type resgatado: ' + cleanType);

          // Se for botão direito (2) ou contextmenu, apenas salvamos o Type na memória e saímos
          // para permitir que o Menu de Contexto NATIVO do navegador abra livremente!
          // (A validação de bloqueio será feita pela nova avaliação na nova guia)
          if (event.button === 2 || event.type === 'contextmenu') {
            return;
          }

          // INÍCIO DA TRAVA DE AÇÃO NATIVA
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          showBlockingOverlay(); // Oculta/Trava a tela

          chrome.runtime.sendMessage({
            type: 'CHECK_BLOCK_STATUS',
            keywordType: cleanType
          }, (response) => {
            removeBlockingOverlay();

            if (response && response.blocked) {
              // BARRADO! Usa o alerta nativo exigindo o 'Ok' e mantém o usuário na página.
              alert(`🚫 Meta atingida para o type: ${cleanType}\n\nVocê já alcançou o limite definido e não precisa mais avaliar esse tipo.`);
            } else {
              // PERMITIDO! Retomamos o click exato.
              isManuallyClicking = true;
              
              // Dispara o click novamente permitindo passagem pelo react/browser
              if (event.type === 'auxclick' || event.button === 1 || event.ctrlKey || event.metaKey) {
                 // Middle click fallback
                 const href = btn.getAttribute('href');
                 if (href) window.open(href, '_blank');
              } else {
                 target.click(); // Standard click relay
              }
              
              isManuallyClicking = false;
            }
          });
        } else {
           console.log('[GRM List] ⚠️ Type Regex não achou nada na linha.');
        }
      } else {
         console.log('[GRM List] ⚠️ Linha Pai (tr) não encontrada no clique.');
      }
    }
  }
}

// Intercept both left clicks and middle/right clicks during capture phase
document.addEventListener('click', handleEvaluateClick, true);
document.addEventListener('auxclick', handleEvaluateClick, true);
document.addEventListener('contextmenu', handleEvaluateClick, true);

const notification = document.createElement('div');
notification.className = 'kw-notification';

let notificationTimeout;

// Function to show notification (success/avisos) com tema da extensão
function showNotification(message) {
  if (!document.body.contains(notification)) {
    document.body.appendChild(notification);
  }
  
  notification.textContent = message || 'KW contabilizada com sucesso';
  notification.classList.add('show');
  
  clearTimeout(notificationTimeout);
  notificationTimeout = setTimeout(() => {
    notification.classList.remove('show');
  }, 3000);
}

// Function to check if URL is a valid Shopee item page
// Function to check if URL is a valid Shopee item page to be blocked/counted
function isShopeeItemPage() {
  if (isSKA) return false;
  const url = window.location.href;
  const domain = window.location.hostname;

  // STRICT DOMAIN PROTECTION
  if (!domain.includes('shopee.io') && !domain.includes('shopee.com')) {
    return false;
  }

  // EXCLUDE List Pages explicitly (STRICTER)
  // If it has 'tab=' it is almost certainly a list/dashboard view.
  // Also check for project_ dashboard pattern (e.g., project_id= and month=)
  if (url.includes('tab=') || url.includes('page=') || (url.includes('project_id=') && url.includes('month='))) {
    // confirm it is NOT an item page
    return false;
  }

  // VALID patterns for Item Page
  const isItem = url.includes('/keyword-evaluation-details') ||
    url.includes('/item-evaluation') ||
    (url.includes('evaluation') && !url.includes('tab=')) ||
    (url.includes('shopee.io') && url.includes('task') && !url.includes('tab=')) ||
    // New fallback: if it ends in specific ID format? No.
    false;

  return isItem;
}

function isShopeeListPage() {
  const url = window.location.href;
  return url.includes('tab=all-tasks') ||
    url.includes('tab=my-tasks') ||
    (url.includes('project_id=') && url.includes('month=') && url.includes('region='));
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
async function incrementCounter() {
  console.log('incrementCounter Called!');

  let validPage = isShopeeItemPage();

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

  // 1. Synchronous check & Fast Lock (PREVENTS RACING)
  if (memoryCountedUrls.has(currentUrl)) {
    console.log('Blocked by memory lock: URL already counted in this session');
    return; // Silently ignore subsequent clicks
  }
  
  // IMMEDIATELY LOCK before any await!
  memoryCountedUrls.add(currentUrl);

  // Fetch the definitive keyword type exclusively from storage (captured at 'Evaluate' click)
  const keywordType = await getStoredDetectedType();

  if (!keywordType) {
    console.log('[GRM Count] ❌ No keyword type detected in storage.');
    showNotification('Tipo de keyword não detectado! Inicie pela aba de tarefas.');
    memoryCountedUrls.delete(currentUrl); // Unlock because it failed validation
    return;
  }

  console.log('[GRM Count] Proceeding with keyword type from storage:', keywordType);

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
        showNotification('KW contabilizada com sucesso: ' + keywordType);
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
}

let hasCheckedGoalThisSession = false; // To prevent re-checking on SPA navigation

// Function to enforce goal before allowing page stay
async function enforceTypeGoalOnLoad() {
  if (isSKA || !isShopeeItemPage() || hasCheckedGoalThisSession) return;

  // 1. Get detected type
  let detectedType = await getStoredDetectedType();

  if (!detectedType) {
    console.log('[GRM] No type detected yet in storage.');
    return;
  }

  // Normalize (Safety)
  const cleanType = normalizeKeywordTypeInContent(detectedType);
  if (!cleanType) {
    console.log('[GRM] Failed to normalize detected type:', detectedType);
    return;
  }

  // 2. Check status
  chrome.runtime.sendMessage({
    type: 'CHECK_BLOCK_STATUS',
    keywordType: cleanType
  }, (response) => {
    if (response && response.blocked) {
      console.log('[GRM] Proactive Block: Goal met for', cleanType);
      
      // Bloqueio visual nativo da extensão ao invés de alert travado.
      showBlockingOverlay();
      showNotification(`🚫 Limite atingido para: ${cleanType}`);
      
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'CLOSE_CURRENT_TAB' });
      }, 1500); // Dá tempo da pessoa ler a notificação antes da aba evaporar
    }
  });
  hasCheckedGoalThisSession = true; // Mark as checked for this session
}

// Helper to get stored detected type (Simplified to User's request of 1-by-1)
async function getStoredDetectedType() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['lastDetectedKeywordType'], (result) => {
      console.log(`[GRM] Recuperando Type do Storage da Extensão:`, result.lastDetectedKeywordType);
      resolve(result.lastDetectedKeywordType);
    });
  });
}

// REMOVED LEGACY METHODS to prevent false positives on new Shopee system
// - checkGoalByKeywordName
// - detectKeywordType
// - aggressiveKeywordTypeSearch
// All types are now strictly captured on the list page via `taskTypes` map.

// Listen for global blocking broadcast
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SHOW_NOTIFICATION') {
    showNotification(message.message);
    return;
  }

  if (message.type === 'BLOCK_TYPE') {
    // SECURITY CHECK: Only close if it is an item page!
    // Prevents closing the project list page which also mentions types.
    if (!isShopeeItemPage()) {
      console.log('[GRM] Blocking signal ignored: Not a Shopee item page.');
      return;
    }

    getStoredDetectedType().then(detectedType => {
      if (detectedType === message.typeKey) {
        console.log('[GRM] Tab closure triggered for type:', message.typeKey);
        alert('Meta atingida para ' + message.typeKey + '. Bloqueando...');
        chrome.runtime.sendMessage({ type: 'CLOSE_CURRENT_TAB' });
      }
    });
  }
  if (message.type === 'SHOW_NOTIFICATION') {
    incrementCounter();
  }
});

// Duplicate submit button listener block removed to prevent double execution race conditions!
// Only the global document.addEventListener('click') will trigger incrementCounter() now.

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

// LEGACY: Old screen-scraping logic removed (detectKeywordType / aggressiveKeywordTypeSearch)
// The Shopee updated their layout and removed the keyword type from the item page. 
// We now strictly use getStoredDetectedType() which uses the evaluationId map.
function detectKeywordType() {
  return null;
}

// Helper to normalize types consistently (strips % and whitespace)
function normalizeKeywordTypeInContent(text) {
  if (!text) return null;
  return text.replace(/%/g, '').replace(/\s/g, '').trim();
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
  if (/\b0\d+/.test(cleanText)) {
    console.log('Invalid: leading zeros detected');
    return false;
  }

  // WHITELIST STRICT
  const knownPatterns = ['0-20', '20-50', '50-80', '80-100'];
  const rawText = normalizeKeywordTypeInContent(cleanText);

  for (const pattern of knownPatterns) {
    if (rawText === pattern) {
      console.log('Valid: matches strict whitelist', pattern);
      return true;
    }
  }

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
// hasCheckedGoalThisSession is already declared above.

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
  // Aggressive DOM scanning removed to prevent false positives and block-loops.
  // We rely entirely on the Evaluate click to store the valid type.

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

// Item Page: Enforce goal
enforceTypeGoalOnLoad();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isSKA) return;
  if (message.type === 'SHOW_NOTIFICATION') {
    incrementCounter();
    return true;
  }
  // Allow manual block trigger from background
  if (message.type === 'BLOCK_TYPE') {
    // SECURITY CHECK: Only close if it is an item page!
    if (!isShopeeItemPage()) {
      console.log('[GRM] Blocking signal ignored: Not a Shopee item page.');
      return;
    }
    showNotification(`🚫 Limite atingido para: ${message.typeKey}`);
    showBlockingOverlay();
    
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'CLOSE_CURRENT_TAB' });
    }, 1500);
  }
});

// Clean up old entries periodically (keep only last 7 days)
cleanupOldCountedUrls();
setInterval(cleanupOldCountedUrls, 24 * 60 * 60 * 1000);
