import { createClient } from '@supabase/supabase-js';

// Supabase Configuration
const SUPABASE_URL = 'https://qgffvxpikbabtxkqhmxk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnZmZ2eHBpa2JhYnR4a3FobXhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4MjI2MDEsImV4cCI6MjA4MTM5ODYwMX0.alpb3S9w75U2Ue_wH7Sn1V1U5i77buaoqLXGF-BoWL0';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// State
let currentProjectId = null;
let projectGoals = {}; // { '0-20': { target: 0, current: 0, id: ... } }

// DOM Elements
const projectSelect = document.getElementById('projectSelect');
const createProjectBtn = document.getElementById('createProjectBtn');
const newProjectModal = document.getElementById('newProjectModal');
const closeModalSpan = document.getElementsByClassName('close')[0];
const confirmCreateProjectBtn = document.getElementById('confirmCreateProject');
const newProjectNameInput = document.getElementById('newProjectName');
const newProjectLinkInput = document.getElementById('newProjectLink');
const newProjectETAInput = document.getElementById('newProjectETA');
const saveGoalsBtn = document.getElementById('saveGoalsBtn');
const cardsContainer = document.getElementById('goalsCardsContainer');

// New Aggregate Stats Elements
const totalKeywordsDoneEl = document.getElementById('totalKeywordsDone');
const totalProjectsAddedEl_fixed = document.getElementById('totalProjectsAdded');
const totalProjectsFinishedEl = document.getElementById('totalProjectsFinished');

// Notification Elements
const toastEl = document.getElementById('toast');
const confirmModalEl = document.getElementById('confirmModal');
const confirmTitleEl = document.getElementById('confirmTitle');
const confirmMessageEl = document.getElementById('confirmMessage');
const confirmOkBtn = document.getElementById('confirmOk');
const confirmCancelBtn = document.getElementById('confirmCancel');

// --- Initialization ---

async function init() {
    if (!supabase) return;
    await loadProjects();
    await updateAggregateStats();
    setupEventListeners();
    setupRealtime();
    initNavSlider();
    setupExtensionListener();
}

// Listen for messages from the extension background
function setupExtensionListener() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === 'PROJECT_UPDATED') {
                console.log('Update signal received from background!');
                if (currentProjectId) loadProjectData(currentProjectId);
                updateAggregateStats();
            }
        });
    }
}

// --- Supabase Interaction ---

async function loadProjects() {
    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading projects:', error);
        return;
    }

    const currentVal = projectSelect.value;
    projectSelect.innerHTML = '<option value="">Selecione um projeto...</option>';

    data.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        projectSelect.appendChild(option);
    });

    if (currentVal) {
        projectSelect.value = currentVal;
    }
}

async function createProject(name) {
    if (!name.trim()) return;

    // Check for existing project
    const { data: existing } = await supabase
        .from('projects')
        .select('id')
        .eq('name', name)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (existing) {
        showToast('Projeto já existe!');
        return;
    }

    const typeSelect = document.getElementById('newProjectType');
    const isDiferenciado = typeSelect && typeSelect.value === 'diferenciado';

    const emailsInput = document.getElementById('projectEmails');
    const emails = emailsInput
        ? emailsInput.value.split(/[\n,;]+/).map(e => e.trim().toLowerCase()).filter(e => e).join(',')
        : '';

    const projectETA = newProjectETAInput ? newProjectETAInput.value : null;

    const insertData = { name: name, allowed_emails: emails };
    if (projectETA) insertData.eta = projectETA;

    const { data, error } = await supabase
        .from('projects')
        .insert([insertData])
        .select()
        .single();

    if (error) {
        showToast('Erro ao criar projeto: ' + error.message);
    } else {
        const projectLink = newProjectLinkInput ? newProjectLinkInput.value.trim() : '';
        const etaText = projectETA ? projectETA.split('-').reverse().join('/') : 'Nenhum ETA fornecido';

        // Webhook do Discord
        const webhookUrl = 'https://discord.com/api/webhooks/1481401126111674502/KU-WtqO5OjlJnFeONMd28i-4KTH3pWm9SqO38uf3_kTl2TsQjajoe7OnJ4Aa3XK4qrOr';
        const payload = {
            content: `@here\nprojeto novo:\n\nnome: ${name}\nlink: ${projectLink || 'Nenhum link fornecido'}\nETA: ${etaText}\n\nO projeto ja está configurado na extensão, não se esqueçam de selecionar o projeto correto na extensão e recarregar a página do sistema de SQE para que a extensão funcione corretamente.`
        };

        try {
            fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            console.error('Erro ao enviar webhook:', e);
        }

        const initialTypes = isDiferenciado ? ['0-100%'] : ['0-20', '20-50', '50-80', '80-100'];
        const goalsToInsert = initialTypes.map(t => ({
            project_id: data.id,
            type_key: t.replace(/%/g, '').trim(),
            target_amount: 0,
            current_amount: 0
        }));
        await supabase.from('project_goals').insert(goalsToInsert);

        newProjectModal.style.display = 'none';
        newProjectNameInput.value = '';
        if (newProjectLinkInput) newProjectLinkInput.value = '';
        if (newProjectETAInput) newProjectETAInput.value = '';
        if (typeSelect) typeSelect.value = 'normal';
        if (emailsInput) emailsInput.value = ''; // Reset emails
        await loadProjects();
        await updateAggregateStats();
        projectSelect.value = data.id;
        loadProjectData(data.id);
        showToast('Projeto criado com sucesso!');
    }
}

async function loadProjectData(projectId) {
    if (!projectId) {
        resetUI();
        return;
    }
    currentProjectId = projectId;

    // Load Goals
    const { data: goals, error: goalsError } = await supabase
        .from('project_goals')
        .select('*')
        .eq('project_id', projectId);

    if (goalsError) {
        alert('Erro ao carregar metas: ' + goalsError.message);
        return;
    }

    // Load Project Details
    const { data: project, error: projError } = await supabase
        .from('projects')
        .select('eta, team_size')
        .eq('id', projectId)
        .single();

    if (project) {
        const etaInput = document.getElementById('eta-input');
        if (etaInput) etaInput.value = project.eta || '';

        const peopleInput = document.getElementById('peopleInput');
        if (peopleInput) peopleInput.value = project.team_size || 1;
    }

    projectGoals = {};

    if (goals && goals.length > 0) {
        goals.forEach(g => {
            // Normalize key when loading from DB (Safety)
            const cleanKey = g.type_key.toString().replace(/%/g, '').trim();
            projectGoals[cleanKey] = g;
        });
    } else {
        const defaultTypes = ['0-20', '20-50', '50-80', '80-100'];
        // Ensure all default types exist in the object
        defaultTypes.forEach(type => {
            projectGoals[type] = { target_amount: 0, current_amount: 0, type_key: type };
        });
    }

    updateUI();
}

async function updateETA(newDate) {
    if (!currentProjectId) return;

    const { error } = await supabase
        .from('projects')
        .update({ eta: newDate })
        .eq('id', currentProjectId);

    if (error) {
        console.error('Error updating ETA:', error);
    }
}

async function finishProject() {
    if (!currentProjectId) {
        showToast('Selecione um projeto para finalizar.');
        return;
    }

    showConfirm(
        'Finalizar Projeto',
        'Tem certeza que deseja finalizar este projeto? Ele será movido para a aba "Finalizados".',
        async () => {
            const { error } = await supabase
                .from('projects')
                .update({ status: 'completed' })
                .eq('id', currentProjectId);

            if (error) {
                showToast('Erro ao finalizar projeto: ' + error.message);
            } else {
                showToast('Projeto finalizado!');
                await loadProjects();
                await updateAggregateStats();
                projectSelect.value = '';
                loadProjectData(null);
            }
        }
    );
}

async function saveGoals() {
    if (!currentProjectId) {
        showToast('Selecione um projeto primeiro.');
        return;
    }

    const updates = [];
    const cards = cardsContainer.querySelectorAll('.keyword-card');

    cards.forEach(card => {
        const typeKeyRaw = card.getAttribute('data-type');
        const cleanType = typeKeyRaw.replace(/%/g, '').trim();
        const targetInput = card.querySelector('.goal-input');
        const doneInput = card.querySelector('.done-input');

        const targetAmount = parseInt(targetInput.value) || 0;
        const currentAmount = parseInt(doneInput.value) || 0;

        const existing = projectGoals[cleanType];
        if (existing && existing.id) {
            updates.push({
                id: existing.id,
                project_id: currentProjectId,
                type_key: cleanType,
                target_amount: targetAmount,
                current_amount: currentAmount
            });
        } else {
            updates.push({
                project_id: currentProjectId,
                type_key: cleanType,
                target_amount: targetAmount,
                current_amount: currentAmount
            });
        }
    });

    const { error } = await supabase
        .from('project_goals')
        .upsert(updates);

    if (error) {
        showToast('Erro ao salvar: ' + error.message);
    } else {
        showToast('Salvo com sucesso!');
        loadProjectData(currentProjectId);
        await updateAggregateStats();
    }
}

// --- Real-time Logic ---

function setupRealtime() {
    const syncText = document.getElementById('connectionText');
    const syncDot = document.getElementById('connectionStatus');

    const setStatus = (online) => {
        if (!syncText || !syncDot) return;
        if (online) {
            syncText.textContent = 'Sincronizado';
            syncDot.className = 'status-indicator online';
        } else {
            syncText.textContent = 'Desconectado';
            syncDot.className = 'status-indicator offline';
        }
    };

    // Single Channel for Goal Updates
    const goalsChannel = supabase
        .channel('public:project_goals')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'project_goals' }, payload => {
            console.log('Realtime update received:', payload);
            setStatus(true);

            // 1. Update Aggregate Stats (Always)
            updateAggregateStats();

            // 2. Update Current Project UI (If relevant)
            if (currentProjectId && payload.new && payload.new.project_id === currentProjectId) {
                const goal = payload.new;
                const cleanKey = goal.type_key.toString().replace(/%/g, '').trim();
                projectGoals[cleanKey] = goal;
                updateUI();
            }
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') setStatus(true);
            if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setStatus(false);
        });

    // Channel for Project Status Changes (e.g. Completed)
    const projectsChannel = supabase
        .channel('public:projects')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
            // Refresh stats when projects are added or finished
            updateAggregateStats();
            // Maybe refresh list if on project selection screen?
            if (!currentProjectId) loadProjects();
        })
        .subscribe();
}

// --- UI Logic ---

function resetUI() {
    currentProjectId = null;
    projectGoals = {};
    cardsContainer.innerHTML = '<div class="no-project-selected">Nenhum projeto selecionado.</div>';

    const dailyGoalLabel = document.getElementById('dailyGoal');
    if (dailyGoalLabel) dailyGoalLabel.textContent = '0';
}

function updateUI() {
    if (!currentProjectId) {
        resetUI();
        return;
    }

    cardsContainer.innerHTML = '';
    let totalPending = 0;

    // Use sorted types based on db state
    const types = Object.keys(projectGoals).sort((a, b) => (parseInt(a.split('-')[0]) || 0) - (parseInt(b.split('-')[0]) || 0));

    types.forEach(type => {
        const goal = projectGoals[type] || { target_amount: 0, current_amount: 0, type_key: type };
        const pending = goal.target_amount - goal.current_amount;
        const progress = goal.target_amount > 0 ? (goal.current_amount / goal.target_amount) * 100 : 0;

        totalPending += pending;

        const isCompleted = Number(goal.target_amount) > 0 && Number(goal.current_amount) >= Number(goal.target_amount);

        const card = document.createElement('div');
        card.className = `keyword-card ${isCompleted ? 'completed' : ''}`;
        card.setAttribute('data-type', type);

        const displayType = type === '0-100' ? '0-100%' : type;

        card.innerHTML = `
            <div class="card-header">${displayType}</div>
            <div class="card-body">
                <div class="progress-container">
                    <div class="progress-bar" style="width: ${Math.min(100, progress)}%"></div>
                </div>
                <span class="card-percentage">${goal.current_amount}/${goal.target_amount} (${Math.round(progress)}%)</span>
                
                <div class="card-stats">
                    <div class="stat-item">
                        <span class="stat-value">${goal.target_amount}</span>
                        <span class="stat-label">Total</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value" style="color: #4caf50">${goal.current_amount}</span>
                        <span class="stat-label">Feitos</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value" style="color: #f44336">${pending}</span>
                        <span class="stat-label">Pendente</span>
                    </div>
                </div>

                <div class="card-inputs">
                    <div class="card-input-group">
                        <label>Meta</label>
                        <input type="number" class="goal-input" value="${goal.target_amount}" min="0">
                    </div>
                    <div class="card-input-group">
                        <label>Feito</label>
                        <input type="number" class="done-input" value="${goal.current_amount}" min="0">
                    </div>
                </div>
            </div>
        `;
        cardsContainer.appendChild(card);
    });

    const dailyGoalLabel = document.getElementById('dailyGoal');
    const totalPendingLabel = document.getElementById('totalPendingDisplay');
    const peopleInput = document.getElementById('peopleInput');
    const peopleCount = peopleInput ? Math.max(1, parseInt(peopleInput.value) || 1) : 1;

    // 1. Update Raw Total Pending (Top Badge)
    if (totalPendingLabel) {
        totalPendingLabel.textContent = totalPending;
    }

    // 2. Update Per-Person Goal (Footer)
    if (dailyGoalLabel) {
        const perPersonGoal = Math.ceil(totalPending / peopleCount);
        dailyGoalLabel.textContent = `${perPersonGoal}`;
        dailyGoalLabel.title = `Total: ${totalPending} / ${peopleCount} pessoas`;
    }
}

// Helper to recalculate without re-rendering everything
function recalculateTotal() {
    let total = 0;
    const cards = cardsContainer.querySelectorAll('.keyword-card');
    cards.forEach(card => {
        const target = parseInt(card.querySelector('.goal-input').value) || 0;
        const done = parseInt(card.querySelector('.done-input').value) || 0;
        const pending = target - done;

        // Toggle completed class immediately
        if (target > 0 && done >= target) {
            card.classList.add('completed');
        } else {
            card.classList.remove('completed');
        }

        // Update stats in place
        card.querySelector('.stat-item:nth-child(1) .stat-value').textContent = target;
        card.querySelector('.stat-item:nth-child(2) .stat-value').textContent = done;
        card.querySelector('.stat-item:nth-child(3) .stat-value').textContent = pending;

        const progress = target > 0 ? (done / target) * 100 : 0;
        card.querySelector('.progress-bar').style.width = `${Math.min(100, progress)}%`;
        card.querySelector('.card-percentage').textContent = `${done}/${target} (${Math.round(progress)}%)`;

        total += pending;
    });

    const dailyGoalLabel = document.getElementById('dailyGoal');
    const totalPendingLabel = document.getElementById('totalPendingDisplay');
    const peopleInput = document.getElementById('peopleInput');
    const peopleCount = peopleInput ? Math.max(1, parseInt(peopleInput.value) || 1) : 1;

    if (totalPendingLabel) {
        totalPendingLabel.textContent = total;
    }

    if (dailyGoalLabel) {
        const perPersonGoal = Math.ceil(total / peopleCount);
        dailyGoalLabel.textContent = `${perPersonGoal}`;
        dailyGoalLabel.title = `Total: ${total} / ${peopleCount} pessoas`;
    }
}

function updateSummary(totalPending) {
    // Legacy support, updateUI already handles this
}

// --- Tab Logic ---

window.openTab = function (evt, tabName) {
    const tabContent = document.getElementsByClassName("tab-content");
    for (let i = 0; i < tabContent.length; i++) {
        tabContent[i].classList.remove("active");
    }

    const navItems = document.getElementsByClassName("nav-item");
    for (let i = 0; i < navItems.length; i++) {
        navItems[i].classList.remove("active");
    }

    const target = evt.currentTarget;
    document.getElementById(tabName).classList.add("active");
    target.classList.add("active");

    // Update Sliding Pill
    const slider = document.querySelector('.nav-slider');
    if (slider && target) {
        slider.style.left = target.offsetLeft + 'px';
        slider.style.width = target.offsetWidth + 'px';
    }

    if (tabName === 'tab-completed') {
        loadCompletedProjects();
    }
    if (tabName === 'tab-dashboard') {
        updateAggregateStats();
    }
};

// Internal function to init slider position
function initNavSlider() {
    const activeBtn = document.querySelector('.nav-item.active');
    const slider = document.querySelector('.nav-slider');
    if (activeBtn && slider) {
        slider.style.left = activeBtn.offsetLeft + 'px';
        slider.style.width = activeBtn.offsetWidth + 'px';
    }
}

// --- Completed Projects Logic ---

async function loadCompletedProjects(searchTerm = '') {
    const listContainer = document.getElementById('completedProjectsContainer') || document.getElementById('completedListContainer');
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="loading-state">Buscando projetos...</div>';

    let query = supabase
        .from('projects')
        .select('*')
        .eq('status', 'completed')
        .order('created_at', { ascending: false });

    if (searchTerm) {
        query = query.ilike('name', `%${searchTerm}%`);
    }

    const { data: projects, error } = await query;

    if (error) {
        listContainer.innerHTML = '<p>Erro ao carregar projetos.</p>';
        console.error(error);
        return;
    }

    if (!projects || projects.length === 0) {
        listContainer.innerHTML = '<p class="no-results">Nenhum projeto finalizado encontrado.</p>';
        return;
    }

    // Fetch goals for these projects to show details
    const projectIds = projects.map(p => p.id);
    const { data: allGoals, error: goalsError } = await supabase
        .from('project_goals')
        .select('*')
        .in('project_id', projectIds);

    listContainer.innerHTML = '';
    projects.forEach(project => {
        const projectGoals = allGoals ? allGoals.filter(g => g.project_id === project.id) : [];

        const card = document.createElement('div');
        card.className = 'completed-card-modern';

        // Header with Name and Delete
        const header = document.createElement('div');
        header.className = 'card-header-modern';

        const title = document.createElement('h4');
        title.textContent = project.name;

        const delBtn = document.createElement('button');
        delBtn.className = 'trash-btn-modern';
        delBtn.innerHTML = '🗑️'; // Can be SVG or icon font
        delBtn.title = 'Excluir registro';
        delBtn.onclick = () => deleteProject(project.id);

        header.appendChild(title);
        header.appendChild(delBtn);

        // Details Section (Mini-stats)
        const details = document.createElement('div');
        details.className = 'card-details-modern';

        // Dynamically get types from the project's goals
        let types = projectGoals.map(g => g.type_key.toString().replace(/%/g, '').trim());
        if (types.length === 0) types = ['0-20', '20-50', '50-80', '80-100'];
        types = [...new Set(types)].sort((a, b) => (parseInt(a.split('-')[0]) || 0) - (parseInt(b.split('-')[0]) || 0));

        types.forEach(type => {
            const goal = projectGoals.find(g => g.type_key.toString().replace(/%/g, '').trim() === type) || { current_amount: 0 };
            const displayType = type === '0-100' ? '0-100%' : type;
            const detailItem = document.createElement('div');
            detailItem.className = 'detail-badge';
            detailItem.innerHTML = `
                <span class="type-label">${displayType}:</span>
                <span class="type-value">${goal.current_amount}</span>
            `;
            details.appendChild(detailItem);
        });

        card.appendChild(header);
        card.appendChild(details);
        listContainer.appendChild(card);
    });
}

async function deleteProject(projectId) {
    showConfirm(
        'Apagar Projeto',
        'Tem certeza? Isso apagará o projeto e todas as metas permanentemente.',
        async () => {
            const { error: goalsError } = await supabase
                .from('project_goals')
                .delete()
                .eq('project_id', projectId);

            if (goalsError) {
                showToast('Erro ao apagar metas: ' + goalsError.message);
                return;
            }

            const { error: projectError } = await supabase
                .from('projects')
                .delete()
                .eq('id', projectId);

            if (projectError) {
                showToast('Erro ao apagar projeto: ' + projectError.message);
            } else {
                showToast('Projeto apagado!');

                if (projectId === currentProjectId) {
                    projectSelect.value = '';
                    loadProjectData(null);
                    loadProjects();
                }

                const searchEl = document.getElementById('completedSearch');
                if (searchEl) {
                    loadCompletedProjects(searchEl.value);
                }
                await updateAggregateStats();
            }
        }
    );
}

// --- New Utility Logic ---

let confirmCallback = null;

function showConfirm(title, message, onOk) {
    confirmTitleEl.textContent = title;
    confirmMessageEl.textContent = message;
    confirmModalEl.style.display = 'block';
    confirmCallback = onOk;
}

confirmOkBtn.addEventListener('click', async () => {
    confirmModalEl.style.display = 'none';
    if (confirmCallback) {
        await confirmCallback();
        confirmCallback = null;
    }
});

confirmCancelBtn.addEventListener('click', () => {
    confirmModalEl.style.display = 'none';
    confirmCallback = null;
});

function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    setTimeout(() => {
        toastEl.classList.remove('show');
    }, 3000);
}

// --- Manage Access Logic ---

const accessControlModal = document.getElementById('accessControlModal');
const closeAccessSpan = document.getElementsByClassName('close-access')[0];
const saveAccessBtn = document.getElementById('saveAccessBtn');
const editProjectEmails = document.getElementById('editProjectEmails');

// --- Edit Type Logic ---
const editTypeModal = document.getElementById('editTypeModal');
const closeEditTypeSpan = document.getElementsByClassName('close-edit-type')[0];
const saveEditTypeBtn = document.getElementById('saveEditTypeBtn');
const editProjectTypeSelect = document.getElementById('editProjectType');

function openEditTypeModal() {
    if (!currentProjectId) {
        showToast('Selecione um projeto primeiro.');
        return;
    }

    // Determine current type by interrogating projectGoals keys
    const types = Object.keys(projectGoals);
    const isDiferenciado = types.some(t => t === '0-100' || t === '0-100%');

    editProjectTypeSelect.value = isDiferenciado ? 'diferenciado' : 'normal';
    editTypeModal.style.display = 'block';
}

async function saveEditType() {
    if (!currentProjectId) return;

    const isDiferenciado = editProjectTypeSelect.value === 'diferenciado';
    const initialTypes = isDiferenciado ? ['0-100%'] : ['0-20', '20-50', '50-80', '80-100'];

    // 1. Delete existing goals for this project
    const { error: deleteError } = await supabase
        .from('project_goals')
        .delete()
        .eq('project_id', currentProjectId);

    if (deleteError) {
        showToast('Erro ao remover metas antigas: ' + deleteError.message);
        return;
    }

    // 2. Insert new goals
    const goalsToInsert = initialTypes.map(t => ({
        project_id: currentProjectId,
        type_key: t.replace(/%/g, '').trim(),
        target_amount: 0,
        current_amount: 0
    }));

    const { error: insertError } = await supabase
        .from('project_goals')
        .insert(goalsToInsert);

    if (insertError) {
        showToast('Erro ao criar novas metas: ' + insertError.message);
    } else {
        showToast('Tipo de projeto alterado com sucesso!');
        editTypeModal.style.display = 'none';
        // Reload project data
        loadProjectData(currentProjectId);
        await updateAggregateStats();
    }
}

async function openAccessModal() {
    if (!currentProjectId) {
        showToast('Selecione um projeto primeiro.');
        return;
    }

    // Fetch current emails
    const { data, error } = await supabase
        .from('projects')
        .select('allowed_emails')
        .eq('id', currentProjectId)
        .single();

    if (error) {
        showToast('Erro ao carregar dados: ' + error.message);
        return;
    }

    // Populate textarea
    editProjectEmails.value = data.allowed_emails || '';
    accessControlModal.style.display = 'block';
}

async function saveAccess() {
    if (!currentProjectId) return;

    // Split by comma, newline, semicolon, or pip. Filter empty.
    const rawValue = editProjectEmails.value;
    const emails = rawValue
        .split(/[\n,;]+/)                 // Split by separators
        .map(e => e.trim().toLowerCase()) // Clean
        .filter(e => e.length > 0)        // Remove empty
        .join(',');                       // Join back with simple comma

    const { error } = await supabase
        .from('projects')
        .update({ allowed_emails: emails })
        .eq('id', currentProjectId);

    if (error) {
        showToast('Erro ao salvar: ' + error.message);
    } else {
        showToast('Acesso atualizado!');
        accessControlModal.style.display = 'none';
    }
}

// Reuse existing updateAggregateStats code...
async function updateAggregateStats() {
    // 1. Total Keywords (current_amount summed across all goals)
    const { data: goals, error: ge } = await supabase.from('project_goals').select('current_amount');
    const totalKW = goals ? goals.reduce((acc, g) => acc + (g.current_amount || 0), 0) : 0;

    // 2. Projects Adicionados (Total count of active + completed projects)
    const { count: totalAdded, error: ae } = await supabase.from('projects').select('*', { count: 'exact', head: true });

    // 3. Projects Finalizados (count of 'completed')
    const { count: totalFinished, error: fe } = await supabase.from('projects').select('*', { count: 'exact', head: true }).eq('status', 'completed');

    if (totalKeywordsDoneEl) totalKeywordsDoneEl.textContent = totalKW.toLocaleString();
    if (document.getElementById('totalProjectsAdded')) document.getElementById('totalProjectsAdded').textContent = `${totalAdded || 0} adicionados`;
    if (document.getElementById('totalProjectsFinished')) document.getElementById('totalProjectsFinished').textContent = `${totalFinished || 0} feitos`;
}


// --- Event Listeners ---

function setupEventListeners() {
    projectSelect.addEventListener('change', (e) => loadProjectData(e.target.value));

    createProjectBtn.addEventListener('click', () => newProjectModal.style.display = 'block');
    closeModalSpan.addEventListener('click', () => newProjectModal.style.display = 'none');
    const manageAccessBtn = document.getElementById('manageAccessBtn');
    if (manageAccessBtn) manageAccessBtn.addEventListener('click', openAccessModal);

    const editTypeBtn = document.getElementById('editTypeBtn');
    if (editTypeBtn) editTypeBtn.addEventListener('click', openEditTypeModal);
    if (closeEditTypeSpan) closeEditTypeSpan.addEventListener('click', () => editTypeModal.style.display = 'none');
    if (saveEditTypeBtn) saveEditTypeBtn.addEventListener('click', saveEditType);

    if (closeAccessSpan) closeAccessSpan.addEventListener('click', () => accessControlModal.style.display = 'none');
    if (saveAccessBtn) saveAccessBtn.addEventListener('click', saveAccess);

    window.addEventListener('click', (e) => {
        if (e.target == newProjectModal) newProjectModal.style.display = 'none';
        if (e.target == accessControlModal) accessControlModal.style.display = 'none';
        if (e.target == editTypeModal) editTypeModal.style.display = 'none';
    });

    confirmCreateProjectBtn.addEventListener('click', () => createProject(newProjectNameInput.value));

    const finishBtn = document.getElementById('finishProjectBtn');
    if (finishBtn) {
        finishBtn.addEventListener('click', finishProject);
    }

    const deleteActiveBtn = document.getElementById('deleteActiveProjectBtn');
    if (deleteActiveBtn) {
        deleteActiveBtn.addEventListener('click', () => {
            if (currentProjectId) {
                deleteProject(currentProjectId);
            } else {
                showToast('Selecione um projeto para apagar.');
            }
        });
    }

    saveGoalsBtn.addEventListener('click', saveGoals);

    const etaInput = document.getElementById('eta-input');
    if (etaInput) {
        etaInput.addEventListener('change', (e) => updateETA(e.target.value));
    }

    // Add listeners for dynamic calculation on card inputs
    cardsContainer.addEventListener('input', (e) => {
        if (e.target.classList.contains('goal-input') || e.target.classList.contains('done-input')) {
            recalculateTotal();
        }
    });

    // Completed Search
    const searchInput = document.getElementById('completedSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => loadCompletedProjects(e.target.value));
    }

    // Workload Copy
    const copyBtn = document.getElementById('copyWorkloadBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', calculateAndCopyWorkload);
    }

    async function updateTeamSize(size) {
        if (!currentProjectId) return;
        const teamSize = parseInt(size) || 1;

        const { error } = await supabase
            .from('projects')
            .update({ team_size: teamSize })
            .eq('id', currentProjectId);

        if (error) {
            console.error('Error updating team size:', error);
            showToast('Erro ao salvar tamanho da equipe.');
        } else {
            // showToast('Equipe atualizada!'); // Optional: feedback
        }
    }



    // Recalculate daily goal when people count changes
    const peopleInput = document.getElementById('peopleInput');
    if (peopleInput) {
        peopleInput.addEventListener('input', updateUI);
        peopleInput.addEventListener('change', (e) => updateTeamSize(e.target.value));
    }

    // Report Generation Click Listener
    const pendingBadge = document.querySelector('.daily-goal-badge');
    if (pendingBadge) {
        pendingBadge.addEventListener('click', generateAndCopyReport);
    }
}

// Image Generation Logic
function generateAndCopyReport() {
    try {
        if (!currentProjectId) {
            showToast('Selecione um projeto para gerar relatório.');
            return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Configuration
        const CARD_W = 280;
        const CARD_H = 180;
        const GAP = 20;
        const MARGIN = 20;
        const HEADER_H = 60; // Space for Project Name
        const types = Object.keys(projectGoals).sort((a, b) => (parseInt(a.split('-')[0]) || 0) - (parseInt(b.split('-')[0]) || 0));
        const numCards = types.length || 1;

        // Canvas Size
        canvas.width = MARGIN * 2 + (CARD_W * numCards) + (GAP * Math.max(0, numCards - 1));
        canvas.height = MARGIN * 2 + CARD_H + HEADER_H;

        // Background
        ctx.fillStyle = '#f0f2f5'; // Light gray background
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Fonts
        const fontMain = 'bold 24px "Segoe UI", sans-serif';
        const fontLabel = '12px "Segoe UI", sans-serif';
        const fontHeader = 'bold 20px "Segoe UI", sans-serif';
        const fontProgress = '14px "Segoe UI", sans-serif';
        const fontTitle = 'bold 32px "Segoe UI", sans-serif';

        // Draw Project Name
        let projectName = 'Projeto';
        const projSelect = document.getElementById('projectSelect');
        if (projSelect && projSelect.selectedOptions && projSelect.selectedOptions.length > 0) {
            projectName = projSelect.selectedOptions[0].textContent;
            if (projectName === 'Selecione um projeto...') projectName = 'Projeto';
        }

        ctx.fillStyle = '#333333';
        ctx.font = fontTitle;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(projectName, canvas.width / 2, MARGIN);

        // Draw Cards
        types.forEach((type, index) => {
            const goal = projectGoals[type] || { target_amount: 0, current_amount: 0 };
            const target = Number(goal.target_amount);
            const current = Number(goal.current_amount);
            const pending = target - current;
            const percent = target > 0 ? Math.round((current / target) * 100) : 0;
            const isCompleted = target > 0 && current >= target;

            const x = MARGIN + index * (CARD_W + GAP);
            const y = MARGIN + HEADER_H; // Shift down

            // Card Container
            // Completed = Gray, Active = White
            ctx.fillStyle = isCompleted ? '#f0f0f0' : '#ffffff';

            // Draw Rounded Rect for Card
            ctx.beginPath();
            ctx.roundRect(x, y, CARD_W, CARD_H, 8);
            ctx.fill();

            // Header (Blue) - Rounded Top
            ctx.fillStyle = '#2196f3';
            ctx.beginPath();
            ctx.roundRect(x, y, CARD_W, 45, [8, 8, 0, 0]);
            ctx.fill();

            const displayType = type === '0-100' ? '0-100%' : type;

            // Header Text
            ctx.fillStyle = '#ffffff';
            ctx.font = fontHeader;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(displayType, x + CARD_W / 2, y + 22.5);

            // Progress Bar Track
            const barY = y + 70;
            const barH = 10;
            const barMargin = 20;
            const barW = CARD_W - (barMargin * 2);

            ctx.fillStyle = '#e0e0e0';
            ctx.beginPath();
            ctx.roundRect(x + barMargin, barY, barW, barH, 5);
            ctx.fill();

            // Progress Bar Fill
            const fillW = (percent / 100) * barW;
            ctx.fillStyle = '#2196f3';
            ctx.beginPath();
            ctx.roundRect(x + barMargin, barY, fillW, barH, 5);
            ctx.fill();

            // Progress Text
            ctx.fillStyle = '#666666';
            ctx.font = fontProgress;
            ctx.fillText(`${current}/${target} (${percent}%)`, x + CARD_W / 2, barY + 25);

            // Stats Row
            const statsY = y + 130;

            // Helper for Stat Item
            function drawStat(label, value, color, posX) {
                // Value
                ctx.fillStyle = color;
                ctx.font = fontMain;
                ctx.textAlign = 'center'; // Ensure alignment
                ctx.fillText(value, posX, statsY);
                // Label
                ctx.fillStyle = '#888888';
                ctx.font = fontLabel;
                ctx.fillText(label, posX, statsY + 20);
            }

            const colW = CARD_W / 3;
            // Total
            drawStat('Total', target, '#333333', x + colW * 0.5);
            // Feitos
            drawStat('Feitos', current, '#4caf50', x + colW * 1.5);
            // Pendente
            drawStat('Pendente', pending, '#f44336', x + colW * 2.5);

            // Overlay for Completed
            if (isCompleted) {
                // Semi-transparent Overlay
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.beginPath();
                ctx.roundRect(x, y, CARD_W, CARD_H, 8);
                ctx.fill();

                // Large X
                ctx.strokeStyle = 'rgba(76, 224, 137, 0.8)'; // Green
                ctx.lineWidth = 15;
                ctx.lineCap = 'round';
                ctx.beginPath();
                const p = 40; // padding
                ctx.moveTo(x + p, y + p + 20); // Adjust Y for header
                ctx.lineTo(x + CARD_W - p, y + CARD_H - p);
                ctx.moveTo(x + CARD_W - p, y + p + 20);
                ctx.lineTo(x + p, y + CARD_H - p);
                ctx.stroke();
            }
        });

        // Copy to Clipboard
        canvas.toBlob(blob => {
            if (!blob) {
                showToast('Erro ao gerar imagem.');
                return;
            }

            try {
                const item = new ClipboardItem({ 'image/png': blob });
                navigator.clipboard.write([item]).then(() => {
                    showToast('Relatório copiado (Imagem)! 📋');
                }).catch(err => {
                    console.error('Clipboard write failed:', err);
                    showToast('Erro ao copiar imagem (Permissão?).');
                });
            } catch (e) {
                console.error(e);
                showToast('Navegador não suporta copy de imagem.');
            }
        });

    } catch (err) {
        console.error('Error generating report:', err);
        showToast('Erro no relatório: ' + err.message);
    }
}

function calculateAndCopyWorkload() {
    const peopleCount = parseInt(document.getElementById('peopleInput').value) || 1;
    if (peopleCount < 1) return;

    const cards = cardsContainer.querySelectorAll('.keyword-card');
    let text = `total para: ${peopleCount} pessoas\n`;

    cards.forEach(card => {
        const typeKey = card.getAttribute('data-type');
        const target = parseInt(card.querySelector('.goal-input').value) || 0;
        const done = parseInt(card.querySelector('.done-input').value) || 0;
        const pending = Math.max(0, target - done);

        const share = Math.ceil(pending / peopleCount);
        const typeLabel = typeKey.includes('%') ? typeKey : typeKey + '%';

        text += `${typeLabel} = ${share}\n`;
    });

    navigator.clipboard.writeText(text).then(() => {
        showToast('Copiado para a área de transferência!');
    }).catch(err => {
        console.error('Erro ao copiar', err);
        showToast('Erro ao copiar texto.');
    });
}

// Run
init();
