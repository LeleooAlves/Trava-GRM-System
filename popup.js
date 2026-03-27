
// Access Supabase from global scope (injected by bundle)
const supabase = (window.supabase || window.SupabaseClient?.supabase);

if (!supabase) {
  console.error('Supabase client not found!');
  document.body.innerHTML = '<div style="color:red;padding:20px;">Erro: Supabase não carregado.</div>';
}

let currentProjectId = null;
let projectGoals = [];

function showTypesConfigModal() {
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) {
    existingModal.remove();
  }

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';

  const modalContent = document.createElement('div');
  modalContent.className = 'modal-content';

  const modalHeader = document.createElement('div');
  modalHeader.className = 'modal-header';

  const modalTitle = document.createElement('h3');
  modalTitle.className = 'modal-title';
  modalTitle.textContent = 'Acompanhamento Geral';

  const modalClose = document.createElement('button');
  modalClose.className = 'modal-close';
  modalClose.innerHTML = '×';
  modalClose.addEventListener('click', () => {
    modalOverlay.remove();
  });

  modalHeader.appendChild(modalTitle);
  modalHeader.appendChild(modalClose);

  const modalBody = document.createElement('div');
  modalBody.className = 'modal-body';

  // Use the global projectGoals fetched from Supabase
  if (!projectGoals || projectGoals.length === 0) {
    modalBody.innerHTML = '<div class="no-data">Nenhum dado disponível para este projeto.</div>';
  } else {
    // Consolidate goals by normalized key
    const consolidatedGoals = {};

    projectGoals.forEach(goal => {
      // Normalize key: remove whitespace only. 
      // STRICT FIX: Do NOT remove '%' here. We want '0%-20%' to be treated DIFFERENTLY from '0-20'.
      if (!goal.type_key) return;
      const key = goal.type_key.trim();
      if (!key || key === 'undefined' || key === 'null') return;

      // Filter out emails and "Overall" which might have been scraped by mistake
      if (key.includes('@') || key.toLowerCase() === 'overall') return;

      if (!consolidatedGoals[key]) {
        consolidatedGoals[key] = {
          type_key: key,
          target_amount: 0,
          current_amount: 0
        };
      }

      // We take the MAX target found (assuming duplicates might have 0 or disparate targets, usually target is consistent)
      // Or just take the first non-zero? Let's take max to be safe.
      consolidatedGoals[key].target_amount = Math.max(consolidatedGoals[key].target_amount, goal.target_amount);

      // Sum current amounts
      consolidatedGoals[key].current_amount += goal.current_amount;
    });

    // Convert back to array
    const sortedGoals = Object.values(consolidatedGoals);

    // Sort
    sortedGoals.sort((a, b) => {
      const numA = parseInt(a.type_key) || 0;
      const numB = parseInt(b.type_key) || 0;
      return numA - numB;
    });

    // STRICT VISUAL FILTER: Only show the 4 official types
    // This hides historical "garbage" (like 3-10, 8----100) from the user verify view
    const allowedDisplayTypes = ['0-20', '20-50', '50-80', '80-100'];

    sortedGoals.forEach(goal => {
      // Skip if not in whitelist
      if (!allowedDisplayTypes.includes(goal.type_key)) return;

      const row = document.createElement('div');
      row.className = 'type-limit-row'; // Reuse class for styling

      const isDone = goal.target_amount > 0 && goal.current_amount >= goal.target_amount;
      const statusStyle = isDone ? 'color: green; font-weight: bold;' : '';
      const statusText = isDone ? '✅' : '';

      const pending = Math.max(0, goal.target_amount - goal.current_amount);

      row.innerHTML = `
          <span class="type-limit-label" style="flex: 1; ${statusStyle}">${goal.type_key}</span>
          <div style="text-align: right;">
            <div style="font-weight: bold; ${statusStyle}">
                ${goal.current_amount} / ${goal.target_amount} ${statusText}
            </div>
            <div style="font-size: 0.85em; color: #666;">
                Pendente: ${pending}
            </div>
          </div>
        `;
      modalBody.appendChild(row);
    });

    // NOTE: This visual merge doesn't clean the DB, but provides the unified view requested.
  }

  modalContent.appendChild(modalHeader);
  modalContent.appendChild(modalBody);
  modalOverlay.appendChild(modalContent);
  document.body.appendChild(modalOverlay);

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.remove();
    }
  });
}

// DOM Elements
const projectSelect = document.getElementById('projectSelect') || createProjectSelect(); // We might need to inject this if not in HTML
const counterDisplay = document.getElementById('counter');
const historyList = document.getElementById('todayHistory'); // Reusing for stats
const keywordTypeStats = document.getElementById('keywordTypeStats');

function updateConnectionStatus(isOnline) {
  const statusEl = document.getElementById('connectionStatus');
  const textEl = document.getElementById('connectionText');
  if (!statusEl) return;

  if (isOnline) {
    statusEl.classList.remove('offline');
    statusEl.classList.add('online');
    if (textEl) textEl.textContent = 'Sincronizado';
  } else {
    statusEl.classList.remove('online');
    statusEl.classList.add('offline');
    if (textEl) textEl.textContent = 'Desconectado';
  }
}

async function init() {
  await setupEmailInput(); // Initialize email logic first and wait for it
  await loadProjects();

  // Check connection
  const { error: connError } = await supabase.from('projects').select('id').limit(1);
  updateConnectionStatus(!connError);

  // Restore selection
  chrome.storage.local.get(['currentProjectId'], (result) => {
    if (result.currentProjectId) {
      projectSelect.value = result.currentProjectId;
      loadProjectData(result.currentProjectId);
    }
  });

  setupRealtime();

  const toggleGoalsBtn = document.getElementById('toggleGoals');
  if (toggleGoalsBtn) {
    toggleGoalsBtn.addEventListener('click', showTypesConfigModal);
  }
}

function createProjectSelect() {
  // If input exists, replace it
  const input = document.getElementById('projectName');
  if (input) {
    const select = document.createElement('select');
    select.id = 'projectSelect';
    select.style.width = '100%';
    select.style.padding = '8px';
    select.style.marginBottom = '10px';
    input.parentNode.replaceChild(select, input);

    select.addEventListener('change', (e) => {
      loadProjectData(e.target.value);
    });

    return select;
  }
  return null;
}

// Email Persistence
function setupEmailInput() {
  return new Promise((resolve) => {
    const emailInput = document.getElementById('userEmail');
    if (!emailInput) {
      resolve();
      return;
    }

    // Load saved email
    chrome.storage.local.get(['userEmail'], (result) => {
      if (result.userEmail) {
        emailInput.value = result.userEmail;
        // Don't call loadProjects() here to avoid race condition with init()
      }
      resolve();
    });

    // Save on change
    emailInput.addEventListener('input', (e) => {
      const email = e.target.value.trim();
      chrome.storage.local.set({ userEmail: email }, () => {
        loadProjects(); // Reload list on change
      });
    });
  });
}

async function loadProjects() {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading projects:', JSON.stringify(error, null, 2));
    // Also try to alert user if critical
    const debugEl = document.getElementById('debug-info-line');
    if (debugEl) debugEl.textContent = 'Erro DB: ' + (error.message || 'Unknown');
    return;
  }

  // Filter based on email
  let userEmail = '';
  // Sync get for filtering (since we are inside async func, we can't await storage.get well without wrapper, 
  // but we executed loadProjects FROM the storage callback or input event mostly. 
  // Let's re-fetch from storage to be safe or read from input value.)
  const emailInput = document.getElementById('userEmail');
  if (emailInput) userEmail = emailInput.value.trim().toLowerCase();

  const currentVal = projectSelect ? projectSelect.value : null;

  if (projectSelect) {
    projectSelect.innerHTML = '<option value="">Selecione um projeto...</option>';

    let debugCount = 0;

    projects.forEach(p => {
      // Access Control Logic
      let isAllowed = false;

      const allowedRaw = p.allowed_emails || '';

      if (!allowedRaw.trim()) {
        // Project with no emails is restricted to EVERYONE (including agents)
        // This prevents unassigned projects from leaking to the wrong team.
        isAllowed = false;
      } else {
        // Limited project
        if (userEmail) {
          // Robust split: comma, newline, semicolon
          const allowedList = allowedRaw.split(/[\n,;]+/).map(e => e.trim().toLowerCase()).filter(e => e.length > 0);

          if (allowedList.includes(userEmail)) {
            isAllowed = true;
          }
        }
      }

      if (isAllowed) {
        debugCount++;
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        projectSelect.appendChild(opt);
      }
    });

    // Optional: Inject debug info
    let debugEl = document.getElementById('debug-info-line');
    if (!debugEl) {
      debugEl = document.createElement('div');
      debugEl.id = 'debug-info-line';
      debugEl.style.fontSize = '10px';
      debugEl.style.color = '#ccc';
      debugEl.style.textAlign = 'center';
      debugEl.style.marginTop = '4px';
      projectSelect.parentNode.appendChild(debugEl);
    }
    // Updated to show Detected Type as requested
    chrome.storage.local.get(['lastDetectedKeywordType'], (r) => {
      const detected = r.lastDetectedKeywordType ? r.lastDetectedKeywordType : '---';
      debugEl.textContent = `Total: ${projects.length} | Visíveis: ${debugCount} | Type: ${detected}`;
      debugEl.style.color = r.lastDetectedKeywordType ? '#4caf50' : '#ccc'; // Green if detected
      debugEl.style.fontWeight = r.lastDetectedKeywordType ? 'bold' : 'normal';
    });

    if (projectSelect.options.length <= 1 && userEmail) {
      // Optional: Message if no projects found
    }
  }
}

async function loadProjectData(projectId) {
  if (!projectId) {
    currentProjectId = null;
    chrome.storage.local.remove('currentProjectId');
    renderStats([]);
    return;
  }

  currentProjectId = projectId;
  chrome.storage.local.set({ currentProjectId: projectId });

  const { data: goals, error } = await supabase
    .from('project_goals')
    .select('*')
    .eq('project_id', projectId);

  // Fetch Project details for ETA
  const { data: project, error: projError } = await supabase
    .from('projects')
    .select('eta')
    .eq('id', projectId)
    .single();

  if (project && project.eta) {
    const etaDiv = document.getElementById('etaDisplay');
    if (etaDiv) {
      // Format date DD/MM/YYYY
      const parts = project.eta.split('-');
      if (parts.length === 3) {
        etaDiv.textContent = `ETA: ${parts[2]}/${parts[1]}/${parts[0]}`;
      } else {
        etaDiv.textContent = `ETA: ${project.eta}`;
      }
    }
  } else {
    const etaDiv = document.getElementById('etaDisplay');
    if (etaDiv) etaDiv.textContent = 'ETA: --/--/----';
  }

  if (error) {
    console.error('Error loading goals:', error);
    return;
  }

  projectGoals = goals;
  renderStats();
}

function renderStats() {
  if (!currentProjectId) {
    if (counterDisplay) counterDisplay.textContent = '0';
    // If no project selected, we might still want to show global daily stats? 
    // User said "Na soma total vai ser o que o usuário fez naquele projeto... o valor deve ser trocado".
    // If no project, total is 0. 
    // But for "Quantidade feita no dia", it should logically be visible even without project?
    // Let's assume yes, or we'll get "Nenhum projeto selecionado" which hides daily stats.
    // Let's proceed to render global stats even if currentProjectId is null, 
    // BUT the request implies project context. Let's keep it safe: 
    // The top counter depends on project. The bottom list depends on Global.
  }

  // Render Main Counter (Local per Project)
  chrome.storage.local.get(['projectWork'], (result) => {
    const projectWork = result.projectWork || {};

    const myData = (currentProjectId && projectWork[currentProjectId]) ? projectWork[currentProjectId] : { total: 0, types: {} };

    // 1. Top Counter: Project Specific
    if (currentProjectId) {
      if (counterDisplay) counterDisplay.textContent = myData.total;
    } else {
      if (counterDisplay) counterDisplay.textContent = '0';
    }

    // 2. Bottom List: Project-Specific LIFETIME Stats
    if (keywordTypeStats) {
      keywordTypeStats.innerHTML = '';

      const lifetimeTypes = {};

      if (myData.types) {
        // Iterate over all dates (keys in myData.types are dates)
        Object.values(myData.types).forEach(dayData => {
          if (dayData) {
            Object.entries(dayData).forEach(([type, count]) => {
              lifetimeTypes[type] = (lifetimeTypes[type] || 0) + count;
            });
          }
        });
      }

      const entries = Object.entries(lifetimeTypes);

      if (entries.length === 0) {
        keywordTypeStats.innerHTML = '<div class="no-data">Pendente de início neste projeto</div>';
        return;
      }

      // Sort
      entries.sort((a, b) => {
        const numA = parseInt(a[0]) || 0;
        const numB = parseInt(b[0]) || 0;
        return numA - numB;
      });

      entries.forEach(([type, count]) => {
        const item = document.createElement('div');
        item.className = 'keyword-type-item';

        item.innerHTML = `
            <span class="type-name">${type}</span>
            <span class="type-count">${count}kw</span>
        `;
        keywordTypeStats.appendChild(item);
      });
    }
  });
}

// Reset Local Progress for current project only
async function resetLocalProgress() {
  if (!currentProjectId) return;

  if (!confirm('Deseja zerar sua contagem local DESTE projeto? (Isso não afeta o dashboard geral)')) return;

  chrome.storage.local.get(['projectWork', 'count'], (result) => {
    const projectWork = result.projectWork || {};

    if (projectWork[currentProjectId]) {
      const projectCount = projectWork[currentProjectId].total || 0;

      // Reset this project
      projectWork[currentProjectId] = {
        total: 0,
        types: {}
      };

      // Also adjust global badge count if needed (optional)
      const newGlobalCount = Math.max(0, (result.count || 0) - projectCount);

      chrome.storage.local.set({
        projectWork: projectWork,
        count: newGlobalCount
      }, () => {
        renderStats();
        // Optional: notification
      });
    }
  });
}

// Helper to show modal for manual increment
function showManualIncrementModal() {
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay'; // Reuse class

  const modalContent = document.createElement('div');
  modalContent.className = 'modal-content';

  const modalHeader = document.createElement('div');
  modalHeader.className = 'modal-header';
  const modalTitle = document.createElement('h3');
  modalTitle.textContent = 'Selecionar Tipo';
  const modalClose = document.createElement('button');
  modalClose.className = 'modal-close';
  modalClose.innerHTML = '×';
  modalClose.onclick = () => modalOverlay.remove();

  modalHeader.appendChild(modalTitle);
  modalHeader.appendChild(modalClose);

  const modalBody = document.createElement('div');
  modalBody.className = 'modal-body';
  modalBody.style.display = 'grid';
  modalBody.style.gridTemplateColumns = '1fr 1fr';
  modalBody.style.gap = '10px';

  // Available types
  const standardTypes = ['0-20', '20-50', '50-80', '80-100'];
  // Merge with keys from projectGoals if they exist
  const availableTypes = new Set(standardTypes);
  if (projectGoals && Array.isArray(projectGoals)) {
    projectGoals.forEach(g => availableTypes.add(g.type_key.replace(/%/g, '').trim()));
  }

  const sortedTypes = Array.from(availableTypes).sort((a, b) => parseInt(a) - parseInt(b));

  sortedTypes.forEach(typeKey => {
    const btn = document.createElement('button');
    btn.textContent = typeKey;
    btn.className = 'counter-btn'; // Reuse btn style
    btn.style.width = '100%';
    btn.style.margin = '0';
    btn.style.fontSize = '14px';
    btn.style.padding = '8px';
    btn.style.borderRadius = '4px';

    btn.onclick = () => {
      performManualIncrement(typeKey);
      modalOverlay.remove();
    };
    modalBody.appendChild(btn);
  });

  modalContent.appendChild(modalHeader);
  modalContent.appendChild(modalBody);
  modalOverlay.appendChild(modalContent);
  document.body.appendChild(modalOverlay);

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.remove();
    }
  });
}

function performManualIncrement(keywordType) {
  if (!currentProjectId) {
    alert('Selecione um projeto primeiro.');
    return;
  }

  // Send to background
  chrome.runtime.sendMessage({
    type: 'INCREMENT_COUNT',
    keywordType: keywordType
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      alert('Erro ao comunicar com a extensão.');
      return;
    }

    if (response && response.success) {
      // Local progress updated via storage listener
    } else if (response && response.error) {
      alert('Erro: ' + response.error);
    }
  });
}

function showManualDecrementModal() {
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';

  const modalContent = document.createElement('div');
  modalContent.className = 'modal-content';

  const modalHeader = document.createElement('div');
  modalHeader.className = 'modal-header';
  const modalTitle = document.createElement('h3');
  modalTitle.textContent = 'Remover KW (Decremento)';
  const modalClose = document.createElement('button');
  modalClose.className = 'modal-close';
  modalClose.innerHTML = '×';
  modalClose.onclick = () => modalOverlay.remove();

  modalHeader.appendChild(modalTitle);
  modalHeader.appendChild(modalClose);

  const modalBody = document.createElement('div');
  modalBody.className = 'modal-body';
  modalBody.style.display = 'grid';
  modalBody.style.gridTemplateColumns = '1fr 1fr';
  modalBody.style.gap = '10px';

  // Filter types based on LOCAL PROGRESS (what the user actually did today)
  chrome.storage.local.get(['projectWork'], (result) => {
    const projectWork = result.projectWork || {};
    const myData = projectWork[currentProjectId];

    let activeTypes = [];

    if (myData && myData.types) {
      // Calculate lifetime counts per type for THIS project
      const lifetimeMap = {};
      Object.values(myData.types).forEach(dayData => {
        if (dayData) {
          Object.entries(dayData).forEach(([type, count]) => {
            lifetimeMap[type] = (lifetimeMap[type] || 0) + count;
          });
        }
      });

      // Get types with total count > 0
      activeTypes = Object.entries(lifetimeMap)
        .filter(([key, count]) => count > 0)
        .map(([key]) => key);
    }

    if (activeTypes.length === 0) {
      const msg = document.createElement('div');
      msg.textContent = 'Você ainda não contabilizou nenhum KW hoje neste projeto.';
      msg.style.gridColumn = '1 / -1';
      msg.style.textAlign = 'center';
      msg.style.color = '#666';
      modalBody.appendChild(msg);
    } else {
      // Sort
      activeTypes.sort((a, b) => parseInt(a) - parseInt(b));

      activeTypes.forEach(typeKey => {
        const btn = document.createElement('button');
        btn.textContent = typeKey;
        btn.className = 'counter-btn';
        btn.style.width = '100%';
        btn.style.margin = '0';
        btn.style.fontSize = '14px';
        btn.style.padding = '8px';
        btn.style.borderRadius = '4px';
        btn.style.backgroundColor = '#ff4d4f'; // Red for danger/remove
        btn.style.color = 'white';
        btn.style.border = 'none';

        btn.onclick = () => {
          performManualDecrement(typeKey);
          modalOverlay.remove();
        };
        modalBody.appendChild(btn);
      });
    }
  });

  modalContent.appendChild(modalHeader);
  modalContent.appendChild(modalBody);
  modalOverlay.appendChild(modalContent);
  document.body.appendChild(modalOverlay);

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) modalOverlay.remove();
  });
}

function performManualDecrement(keywordType) {
  if (!currentProjectId) {
    alert('Selecione um projeto primeiro.');
    return;
  }

  chrome.runtime.sendMessage({
    type: 'DECREMENT_COUNT',
    keywordType: keywordType
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      alert('Erro ao comunicar com a extensão.');
      return;
    }

    if (response && response.success) {
      // Success
    } else if (response && response.error) {
      alert('Erro: ' + response.error);
    }
  });
}

function setupRealtime() {
  supabase
    .channel('public:project_goals_popup')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_goals' }, payload => {
      if (currentProjectId && payload.new && payload.new.project_id === currentProjectId) {
        loadProjectData(currentProjectId);
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, payload => {
      if (currentProjectId && payload.new && payload.new.id === currentProjectId) {
        loadProjectData(currentProjectId);
      }
    })
    .subscribe((status) => {
      // REALTIME STATUS UPDATE
      if (status === 'SUBSCRIBED') {
        updateConnectionStatus(true);
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        updateConnectionStatus(false);
      }
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  init();

  const incrementBtn = document.getElementById('incrementBtn');
  if (incrementBtn) {
    incrementBtn.addEventListener('click', showManualIncrementModal);
  }

  const finishProjectBtn = document.getElementById('finishProject');
  if (finishProjectBtn) {
    finishProjectBtn.addEventListener('click', resetLocalProgress);
  }

  const decrementBtn = document.getElementById('decrementBtn');
  if (decrementBtn) {
    decrementBtn.addEventListener('click', showManualDecrementModal);
  }

  // Listen for local updates (from background script via storage)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.projectWork) {
      renderStats(); // Re-render local stats based on new schema
    }
  });
});