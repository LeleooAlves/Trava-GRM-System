import './supabase-bundle.js';
// Access Supabase from global scope (attached by the bundle)
const supabase = (self.supabase || self.SupabaseClient?.supabase);

let isEnabled = true;

// Initial badge update
chrome.storage.local.get(['projectWork', 'currentProjectId'], (result) => {
  const currentProjectId = result.currentProjectId;
  if (currentProjectId && result.projectWork && result.projectWork[currentProjectId]) {
    const count = result.projectWork[currentProjectId].total || 0;
    chrome.action.setBadgeText({ text: count > 0 ? count.toString() : "" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
  chrome.action.setBadgeBackgroundColor({ color: '#ee4d2d' });
});

// Listen for storage changes to update badge AND global context
chrome.storage.onChanged.addListener((changes) => {
  if (changes.projectWork || changes.currentProjectId) {
    chrome.storage.local.get(['projectWork', 'currentProjectId'], (result) => {
      // CRITICAL FIX: Update global variable so ensureProjectId() sees the change!
      if (result.currentProjectId) {
        currentProjectId = result.currentProjectId;
        console.log('Background: Context switched to Project', currentProjectId);
      }

      const pid = result.currentProjectId;
      if (pid && result.projectWork && result.projectWork[pid]) {
        const count = result.projectWork[pid].total || 0;
        chrome.action.setBadgeText({ text: count > 0 ? count.toString() : "" });
      } else {
        chrome.action.setBadgeText({ text: "" });
      }
      chrome.action.setBadgeBackgroundColor({ color: '#ee4d2d' });
    });
  }
});

// Broadcast blocking to all tabs
function broadcastBlocking(typeKey) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'BLOCK_TYPE', typeKey: typeKey }).catch(() => { });
    });
  });
}

// Broadcast general update to all tabs (Refreshes Sistema and Popup)
function broadcastUpdate() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'PROJECT_UPDATED' }).catch(() => { });
    });
  });
}

// Real-time Listener
supabase
  .channel('public:project_goals')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'project_goals' }, payload => {
    const goal = payload.new;
    // Check if goal met
    if (goal.target_amount > 0 && goal.current_amount >= goal.target_amount) {
      // Get current project context from storage to verify relevance
      chrome.storage.local.get(['currentProjectId', 'projectWork'], (result) => {
        if (result.currentProjectId && result.currentProjectId === goal.project_id) {

          // Send message to active tabs to show "toast" notification (same style as 'KW Contabilizada')
          /* 
          chrome.tabs.query({}, (tabs) => {
            const messageText = `Meta Concluída! 🎉 O tipo ${goal.type_key} foi finalizado.`;
            tabs.forEach(tab => {
              chrome.tabs.sendMessage(tab.id, {
                type: 'SHOW_NOTIFICATION',
                message: messageText
              }).catch(() => {
                // Tab might not have content script injected (e.g., chrome:// settings)
              });
            });
          });
          */

          broadcastBlocking(goal.type_key);
        }
      });
    }
  })
  .subscribe();

// HANDLE PROJECT COMPLETION / RESET
// Listen for project status changes to 'completed'
supabase
  .channel('public:projects_status')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects' }, payload => {
    if (payload.new.status === 'completed') {
      const completedProjectId = payload.new.id;
      console.log('Project marked as completed:', completedProjectId);

      // Reset local progress for this project (like clicking the "Finalizar" button)
      chrome.storage.local.get(['projectWork', 'currentProjectId'], (result) => {
        const projectWork = result.projectWork || {};

        if (projectWork[completedProjectId]) {
          console.log(`Resetting local progress for project ${completedProjectId}`);

          // Clear the data
          projectWork[completedProjectId] = {
            total: 0,
            types: {},
            countedUrls: [] // Reset counted URLs for this project
          };

          chrome.storage.local.set({ projectWork: projectWork });

          // If this was the active project, maybe we should notify or reload?
          if (result.currentProjectId === completedProjectId) {
            broadcastBlocking('PROJECT_COMPLETED_RESET'); // Optional signal
          }
        }
      });
    }
  })
  .subscribe();


// Cache for goals to avoid hammering DB on every pixel scroll/click if multiple tabs open
let lastFetchTime = 0;
const CACHE_DURATION_MS = 5000; // 5 seconds cache
let currentProjectId = null; // Global variable to cache current project ID
let projectGoals = []; // Global variable to cache project goals
let cachedGoalsProjectId = null; // NEW: Track which project the goals belong to

// USER REQUIREMENT: Store Keyword Type in the Extension Layout Memory (instead of storage)
let currentActiveKeywordTypeLayout = null;

// Helper to ensure we have the Project ID
async function ensureProjectId() {
  if (currentProjectId) return currentProjectId;
  return new Promise((resolve) => {
    chrome.storage.local.get(['currentProjectId'], (result) => {
      if (result.currentProjectId) {
        currentProjectId = result.currentProjectId;
        resolve(currentProjectId);
      } else {
        resolve(null);
      }
    });
  });
}

// Function to fetch goals with caching
async function getFreshGoals(projectId) {
  const now = Date.now();
  // BUG FIX: Check if cached goals match the requested projectId
  if (projectGoals.length > 0 && (now - lastFetchTime < CACHE_DURATION_MS) && cachedGoalsProjectId === projectId) {
    return projectGoals;
  }

  const { data, error } = await supabase
    .from('project_goals')
    .select('*')
    .eq('project_id', projectId);

  if (!error && data) {
    projectGoals = data;
    cachedGoalsProjectId = projectId; // Update cache key
    lastFetchTime = now;
    console.log('Background: Goals refreshed from DB.');
  }
  return projectGoals;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'VALIDATE_AND_INCREMENT') {
    // Combined check: URL uniqueness + Goal check + Increment
    handleValidateAndIncrement(message.keywordType, message.url, sendResponse);
    return true;
  }

  if (message.type === 'CHECK_BLOCK_STATUS') {
    (async () => {
      const projectId = await ensureProjectId();
      if (!projectId) {
        sendResponse({ blocked: false, details: 'No project selected' });
        return;
      }

      const goals = await getFreshGoals(projectId);

      // Normalize key from content script (e.g. "0-20")
      const requestedKey = message.keywordType.toString().replace(/%/g, '').trim();

      // Find matching goal
      const goal = goals.find(g => g.type_key.replace(/%/g, '').trim() === requestedKey);

      if (goal) {
        const isFull = goal.target_amount > 0 && goal.current_amount >= goal.target_amount;
        if (isFull) {
          console.log(`BLOCKING: ${requestedKey} is full (${goal.current_amount}/${goal.target_amount})`);
          sendResponse({ blocked: true, typeKey: requestedKey });
          return;
        }
      }

      sendResponse({ blocked: false });
    })();
    return true; // Keep channel open for async response
  }

  if (message.type === 'INCREMENT_COUNT') {
    handleIncrement(message.keywordType, sendResponse);
    return true;
  }

  if (message.type === 'DECREMENT_COUNT') {
    handleDecrement(message.keywordType, sendResponse);
    return true;
  }

  if (message.type === 'IMPORT_PROJECT_DATA') {
    handleImportProject(message.projectName, message.goals, sendResponse);
    return true;
  }

  if (message.type === 'CLOSE_CURRENT_TAB') {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id);
    }
    return true;
  }

  if (message.action === 'FETCH_FE_LINK') {
    // Ultimate reliable path: Ghost Tab reading window state to bypass AF-Bot
    chrome.tabs.create({ url: message.url, active: false }, (newTab) => {
        let attempts = 0;
        const checkInterval = setInterval(() => {
            attempts++;
            if (attempts > 30) { // 15 seconds max (500ms x 30)
                clearInterval(checkInterval);
                chrome.tabs.remove(newTab.id).catch(()=>{});
                sendResponse({ success: true, apiData: null, html: "" }); // Will fallback to Sem Título safely
                return;
            }

            chrome.scripting.executeScript({
                target: { tabId: newTab.id },
                world: "MAIN",
                func: (currentAttempt) => {
                    // Try to grab from Shopee Nuxt State first
                    try {
                        let item = null;
                        if (window.__META_APP_DETAILS__) {
                           const appData = window.__META_APP_DETAILS__;
                           if (appData.data && appData.data.item) {
                               item = appData.data.item;
                           } else if (appData.item) {
                               item = appData.item;
                           }
                        }
                        
                        if (!item && window.__INITIAL_STATE__ && window.__INITIAL_STATE__.product && window.__INITIAL_STATE__.product.item) {
                            item = window.__INITIAL_STATE__.product.item;
                        }

                        if (item) return { found: true, data: item, html: "" };

                        // If state objects failed after 3 seconds, try to scrape DOM directly!
                        if (currentAttempt > 6 && (document.querySelector('.vR6K3w') || document.querySelector('.product-detail'))) {
                            return { found: true, data: null, html: document.documentElement.outerHTML };
                        }
                    } catch(e) {}
                    return { found: false, data: null, html: "" };
                },
                args: [attempts]
            }, (results) => {
                if (chrome.runtime.lastError) return; // Tab might be dead or navigating
                if (results && results[0] && results[0].result && results[0].result.found) {
                    clearInterval(checkInterval);
                    chrome.tabs.remove(newTab.id).catch(()=>{});
                    sendResponse({ 
                        success: true, 
                        apiData: results[0].result.data,
                        html: results[0].result.html 
                    });
                }
            });
        }, 500);
    });

    return true; // Keep channel open
  }
});

// Helper for other tasks
async function handleImportProject(projectName, goals, sendResponse) {
  try {
    // 1. Find or Create Project
    let projectId = null;

    // Check if exists
    const { data: existingProject, error: findError } = await supabase
      .from('projects')
      .select('id')
      .eq('name', projectName)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingProject) {
      projectId = existingProject.id;
    } else {
      // Create
      const { data: newProject, error: createError } = await supabase
        .from('projects')
        .insert([{ name: projectName, status: 'active' }])
        .select()
        .single();

      if (createError) throw createError;
      projectId = newProject.id;
    }

    // 2. Upsert Goals (Update current_amount)
    // We need to fetch existing IDs to update properly or rely on unique constraint
    // Database schema has UNIQUE(project_id, type_key), so upsert works fine.

    for (const goal of goals) {
      // We can assume we just want to update current_amount.
      // Normalize KEY: remove %
      const cleanKey = goal.type_key.replace(/%/g, '').trim();

      // First check if it exists to preserve target_amount
      const { data: existingGoal } = await supabase
        .from('project_goals')
        .select('*')
        .eq('project_id', projectId)
        .eq('type_key', cleanKey)
        .single();

      // Logic:
      // 1. Target Amount: DO NOT CHANGE. User said this is manual only.
      // 2. Current Amount: Sync with site "Completed". 
      //    Safety: Use Math.max(existing, scraped) to prevent overwriting global progress 
      //    with a lower local value (concurrency protection).

      const updateData = {
        project_id: projectId,
        type_key: cleanKey,
        current_amount: goal.current_amount // Placeholder
      };

      console.log('Processing Goal Import:', cleanKey, 'Scraped Current:', goal.current_amount);

      if (existingGoal) {
        updateData.id = existingGoal.id;
        // Ensure we take the HIGHER value to avoid data loss
        updateData.current_amount = Math.max(existingGoal.current_amount || 0, goal.current_amount || 0);
        // Do NOT set target_amount (preserve existing)
      } else {
        // New goal: Set initial values
        updateData.current_amount = goal.current_amount || 0;
        updateData.target_amount = 0; // Default to 0, manager sets it later
      }

      const { error: upsertError } = await supabase
        .from('project_goals')
        .upsert(updateData);

      if (upsertError) console.error('Error syncing goal:', upsertError);
    }

    // 3. Set as Active Project in Extension? 
    // User said: "logo as informações que sejam desse projeto ... devem ser refletidas na aba de 'feitos'"
    // Typically this implies selecting it.
    // 3. Set as Active Project in Extension? 
    // User said: "logo as informações que sejam desse projeto ... devem ser refletidas na aba de 'feitos'"
    // Typically this implies selecting it.
    await chrome.storage.local.set({ currentProjectId: projectId });

    // Check completion after import (in case import fills the last needed goals)
    checkAndCompleteProject(projectId);

    sendResponse({ success: true });

  } catch (err) {
    console.error('Import failed:', err);
    sendResponse({ success: false, error: err.message });
  }
}

async function handleIncrement(keywordType, sendResponse) {
  try {
    const { currentProjectId } = await chrome.storage.local.get('currentProjectId');
    if (!currentProjectId) {
      console.log('No project selected');
      sendResponse({ success: false, error: 'Nenhum projeto selecionado' });
      return;
    }

    // Normalize key (CRITICAL FIX)
    const cleanType = keywordType.toString().replace(/%/g, '').trim();

    // 1. Get current goal data
    let { data: goal, error: fetchError } = await supabase
      .from('project_goals')
      .select('*')
      .eq('project_id', currentProjectId)
      .eq('type_key', cleanType)
      .single();

    // FALLBACK: If not found, check for LEGACY key (with %)
    // This handles the case where DB has "80-100%" but we are sending "80-100".
    // We find the old one, and when we save, we will migrate it to the new key.
    if (!goal) {
      const legacyKey = keywordType + '%'; // Approximate reconstruction
      // Or regex? "80-100" -> "80-100%" or "80%-100%"?
      // content.js normalize strips all %. The common legacy types were "X-Y%".
      // Let's try appending % to the last digit? No, safer to just try appending %.
      // Actually, let's try a few variations if we want to be robust, 
      // but "50-80%" seems to be the one causing issues.

      const { data: legacyGoal } = await supabase
        .from('project_goals')
        .select('*')
        .eq('project_id', currentProjectId)
        .eq('type_key', legacyKey)
        .single();

      if (legacyGoal) {
        console.log('Found legacy goal to migrate:', legacyKey);
        goal = legacyGoal;
        // We will use this goal's ID, but update with the new CLEAN key.
      }
    }

    if (fetchError && fetchError.code !== 'PGRST116') { // Ignora se não existir, cria novo
      console.error('Error fetching goal:', fetchError);
    }

    let currentAmount = goal ? goal.current_amount : 0;
    const targetAmount = goal ? goal.target_amount : 0;
    const goalId = goal ? goal.id : null;

    // Check if limit reached
    if (targetAmount > 0 && currentAmount >= targetAmount) {
      sendResponse({ success: false, error: 'Meta atingida!', blocked: true });
      broadcastBlocking(cleanType);
      return;
    }

    // 2. Increment
    // We should use an RPC for atomic increment, but for simplicity:
    const newAmount = currentAmount + 1;

    // PREPARE UPDATE
    let updateError = null;

    if (goalId) {
      // It exists -> UPDATE
      const { error: err } = await supabase
        .from('project_goals')
        .update({ current_amount: newAmount })
        .eq('id', goalId);
      updateError = err;
    } else {
      // It does NOT exist -> INSERT
      const { error: err } = await supabase
        .from('project_goals')
        .insert([{
          project_id: currentProjectId,
          type_key: cleanType,
          current_amount: newAmount,
          target_amount: 0
        }]);
      updateError = err;
    }

    if (updateError) throw updateError;

    lastFetchTime = 0; // Invalidate cache after modification

    // Notify all tabs of the update
    broadcastUpdate();

    sendResponse({ success: true, newCount: newAmount });

    // Check for project completion asynchronously
    checkAndCompleteProject(currentProjectId);

    // --- NEW: PROJECT-SPECIFIC LOCAL STORAGE UPDATE ---
    updateLocalProgress(currentProjectId, keywordType);

  } catch (err) {
    console.error('Increment failed:', err);
    sendResponse({ success: false, error: err.message });
  }
}

async function handleDecrement(keywordType, sendResponse) {
  console.log('handleDecrement called for:', keywordType);
  try {
    // WRAP storage get in promise manually to be safe or use await if known working
    const storageResult = await chrome.storage.local.get('currentProjectId');
    const currentProjectId = storageResult.currentProjectId;

    console.log('Current Project ID:', currentProjectId);

    if (!currentProjectId) {
      console.log('No project id found');
      sendResponse({ success: false, error: 'Nenhum projeto selecionado' });
      return;
    }

    // Normalize key
    const cleanType = keywordType.toString().replace(/%/g, '').trim();

    // 1. Get current goal data
    console.log('Fetching goal from Supabase...');
    let { data: goal, error: fetchError } = await supabase
      .from('project_goals')
      .select('*')
      .eq('project_id', currentProjectId)
      .eq('type_key', cleanType)
      .single();

    if (fetchError) {
      console.error('Error fetching goal:', fetchError);
      // Don't result yet, just log
    }

    let currentAmount = goal ? goal.current_amount : 0;
    console.log('Current Amount:', currentAmount);

    // Prevent negative
    if (currentAmount <= 0) {
      console.log('Count is already 0');
      sendResponse({ success: false, error: 'A contagem já está em zero.' });
      return;
    }

    // 2. Decrement
    const newAmount = currentAmount - 1;
    console.log('New Amount will be:', newAmount);

    let updateError = null;

    if (goal) {
      const { error: err } = await supabase
        .from('project_goals')
        .update({ current_amount: newAmount })
        .eq('id', goal.id);
      updateError = err;
    } else {
      const { error: err } = await supabase
        .from('project_goals')
        .insert([{
          project_id: currentProjectId,
          type_key: cleanType,
          current_amount: newAmount,
          target_amount: 0
        }]);
      updateError = err;
    }

    if (updateError) {
      console.error('Update error:', updateError);
      throw updateError;
    }

    lastFetchTime = 0; // Invalidate cache after modification

    console.log('Update success, sending response.');
    // sendResponse({ success: true, newCount: newAmount }); // Moved after broadcastUpdate

    // --- PROJECT-SPECIFIC LOCAL STORAGE UPDATE ---
    await updateLocalProgressDecrement(currentProjectId, keywordType);

    // Notify all tabs of the update
    broadcastUpdate();

    sendResponse({ success: true, newCount: newAmount });

  } catch (err) {
    console.error('Decrement exception:', err);
    sendResponse({ success: false, error: err.message || 'Unknown error in decrement' });
  }
}

/**
 * Updates local progress tracking (Decrement)
 */
async function updateLocalProgressDecrement(projectId, keywordType) {
  const result = await chrome.storage.local.get(['projectWork']);
  const projectWork = result.projectWork || {};
  const dateKey = new Date().toISOString().split('T')[0];
  const cleanKey = keywordType.replace(/%/g, '').trim();

  if (projectWork[projectId]) {
    // 1. Decrement Project Total
    if (projectWork[projectId].total > 0) projectWork[projectId].total--;

    // 2. Decrement Lifetime Totals
    if (projectWork[projectId].totals && projectWork[projectId].totals[cleanKey]) {
      if (projectWork[projectId].totals[cleanKey] > 0) {
        projectWork[projectId].totals[cleanKey]--;
      }
    }

    // 3. Decrement Daily Breakdown (If exists for today)
    if (projectWork[projectId].types && projectWork[projectId].types[dateKey]) {
      if (projectWork[projectId].types[dateKey][cleanKey] > 0) {
        projectWork[projectId].types[dateKey][cleanKey]--;
      }
    }

    await chrome.storage.local.set({ projectWork: projectWork });
  }
}

/**
 * Updates local progress tracking in project-specific way
 */
async function updateLocalProgress(projectId, keywordType) {
  const dateKey = new Date().toISOString().split('T')[0];
  const cleanKey = keywordType.replace(/%/g, '').trim();

  const result = await chrome.storage.local.get(['projectWork']);
  const projectWork = result.projectWork || {};

  if (!projectWork[projectId]) {
    projectWork[projectId] = {
      total: 0,
      types: {}, // Mapping of date -> { type: count }
      totals: {}, // Cumulative totals per type
      countedUrls: []
    };
  }

  if (!projectWork[projectId].types) projectWork[projectId].types = {};
  if (!projectWork[projectId].totals) projectWork[projectId].totals = {};

  if (!projectWork[projectId].types[dateKey]) {
    projectWork[projectId].types[dateKey] = {};
  }

  if (!projectWork[projectId].types[dateKey][cleanKey]) {
    projectWork[projectId].types[dateKey][cleanKey] = 0;
  }

  if (!projectWork[projectId].totals[cleanKey]) {
    projectWork[projectId].totals[cleanKey] = 0;
  }

  projectWork[projectId].total++;
  projectWork[projectId].types[dateKey][cleanKey]++;
  projectWork[projectId].totals[cleanKey]++;

  await chrome.storage.local.set({
    projectWork: projectWork
  });
}

async function checkBlockStatus(keywordType, sendResponse) {
  try {
    const { currentProjectId } = await chrome.storage.local.get('currentProjectId');
    if (!currentProjectId) {
      sendResponse({ blocked: false });
      return;
    }

    const cleanKey = keywordType.toString().replace(/%/g, '').trim();

    const { data: goal } = await supabase
      .from('project_goals')
      .select('target_amount, current_amount')
      .eq('project_id', currentProjectId)
      .eq('type_key', cleanKey)
      .single();

    if (goal && goal.target_amount > 0 && goal.current_amount >= goal.target_amount) {
      sendResponse({ blocked: true });
    } else {
      sendResponse({ blocked: false });
    }
  } catch (e) {
    sendResponse({ blocked: false });
  }
}

// Check if all goals are met and mark project as completed
async function checkAndCompleteProject(projectId) {
  if (!projectId) return;

  const { data: goals, error } = await supabase
    .from('project_goals')
    .select('*')
    .eq('project_id', projectId);

  if (error || !goals || goals.length === 0) return;

  // Filter only goals that have a target set
  const activeGoals = goals.filter(g => g.target_amount > 0);

  if (activeGoals.length === 0) return; // No targets set yet

  const allMet = activeGoals.every(g => g.current_amount >= g.target_amount);

  if (allMet) {
    console.log('All goals met! Marking project as completed:', projectId);
    const { error: updateError } = await supabase
      .from('projects')
      .update({ status: 'completed' })
      .eq('id', projectId);

    if (!updateError) {
      // Broadcast to let popup know (optional, but good for UX)
      // Actually, standard realtime listener in popup will pick up project update (if implemented)
      // or at least checking status.
      // We can send a notification.
    }
  }
}

// Logic to handle VALIDATE_AND_INCREMENT (Double Click + Limit + Increment)
async function handleValidateAndIncrement(keywordType, currentUrl, sendResponse) {
  try {
    const projectId = await ensureProjectId();
    if (!projectId) {
      sendResponse({ success: false, error: 'Select a project first' });
      return;
    }

    // 1. Check if URL is already counted for this PROJECT (Local Logic)
    // We fetch EVERYTHING to be safe and ensure atomicity as reasonably possible in async JS
    const result = await chrome.storage.local.get(['projectWork']);
    let projectWork = result.projectWork || {};

    // Initialize structure if missing
    if (!projectWork[projectId]) {
      projectWork[projectId] = { total: 0, types: {}, countedUrls: [] };
    }
    if (!projectWork[projectId].countedUrls) {
      projectWork[projectId].countedUrls = [];
    }

    // Check URL
    if (projectWork[projectId].countedUrls.includes(currentUrl)) {
      console.log('BLOCKING: URL already counted for this project:', currentUrl);
      sendResponse({ success: false, error: 'URL already processed for this project', blocked: false });
      return;
    }

    // 2. Check Goal Limit (Server Logic)
    const goals = await getFreshGoals(projectId);
    const requestedKey = keywordType.toString().replace(/%/g, '').trim();
    const goal = goals.find(g => g.type_key.replace(/%/g, '').trim() === requestedKey);

    if (goal && goal.target_amount > 0 && goal.current_amount >= goal.target_amount) {
      console.log('BLOCKING: Goal limit reached during increment check.');
      sendResponse({ success: false, error: 'Meta atingida!', blocked: true, typeKey: requestedKey });
      broadcastBlocking(requestedKey);
      return;
    }

    // 3. Mark URL as counted LOCALLY first (Optimistic Lock)
    projectWork[projectId].countedUrls.push(currentUrl);
    await chrome.storage.local.set({ projectWork: projectWork });

    // 4. Fetch absolute latest data from DB to prevent Stale Cache overwrites (extremely important for rapid clicks)
    let finalGoalId = null;
    let currentAmount = 0;
    
    let { data: currentGoal } = await supabase
      .from('project_goals')
      .select('*')
      .eq('project_id', projectId)
      .eq('type_key', requestedKey)
      .maybeSingle();

    if (!currentGoal) {
      // Try legacy format with %
      const legacyKey = requestedKey.replace(/(\d+)-(\d+)/, '$1%-$2%');
      const { data: legacyGoal } = await supabase
        .from('project_goals')
        .select('*')
        .eq('project_id', projectId)
        .eq('type_key', legacyKey)
        .maybeSingle();
      if (legacyGoal) currentGoal = legacyGoal;
    }

    if (currentGoal) {
      finalGoalId = currentGoal.id;
      currentAmount = currentGoal.current_amount;
    }

    // VERY IMPORTANT: Use the exact original key format from DB if we found it, to safely respect Vercel's legacy systems (which might include %).
    // If not found, enforce Vercel's expected % format for new creations (e.g. 50%-80%)
    let targetDbKey = currentGoal ? currentGoal.type_key : requestedKey.replace(/(\d+)-(\d+)/, '$1%-$2%');

    const newAmount = currentAmount + 1;
    let updateError = null;

    if (finalGoalId) {
      // It exists -> UPDATE
      const { error: err } = await supabase
        .from('project_goals')
        .update({ current_amount: newAmount })
        .eq('id', finalGoalId);
      updateError = err;
    } else {
      // It does NOT exist -> INSERT
      const { error: err } = await supabase
        .from('project_goals')
        .insert([{
          project_id: projectId,
          type_key: targetDbKey,
          current_amount: newAmount,
          target_amount: 0
        }]);
      updateError = err;
    }

    if (updateError) {
      console.error('DB Increment failed, reverting URL lock', updateError);
      // Re-read storage to avoid overwriting parallel changes
      const latestResult = await chrome.storage.local.get(['projectWork']);
      const latestWork = latestResult.projectWork || {};
      if (latestWork[projectId] && latestWork[projectId].countedUrls) {
        latestWork[projectId].countedUrls = latestWork[projectId].countedUrls.filter(u => u !== currentUrl);
        await chrome.storage.local.set({ projectWork: latestWork });
      }
      throw updateError;
    }

    lastFetchTime = 0; // Force fresh goal fetch for next click to prevent stale limits

    // 5. Update Local Stats
    await updateLocalProgress(projectId, keywordType);

    // 6. Check global completion
    checkAndCompleteProject(projectId);

    // Notify all tabs
    broadcastUpdate();

    sendResponse({ success: true, newCount: newAmount });

  } catch (err) {
    console.error('ValidateAndIncrement failed:', err);
    sendResponse({ success: false, error: err.message });
  }
}