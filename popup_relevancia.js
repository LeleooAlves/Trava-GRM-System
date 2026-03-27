document.addEventListener('DOMContentLoaded', async () => {
    const statusEl = document.getElementById('status');
    const applyBtn = document.getElementById('apply-btn');
    const kwValueEl = document.getElementById('kw-value');

    // Helper to get active tab
    async function getActiveTab() {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        return tabs[0];
    }

    // Try to connect and get keyword
    try {
        const tab = await getActiveTab();
        if (tab && tab.url && tab.url.includes('shopee.io')) {
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content_relevancia.js']
            }, () => {
                // Check if runtime error
                if (chrome.runtime.lastError) {
                    // Content script might already be there via manifest
                }

                // Now send message
                chrome.tabs.sendMessage(tab.id, { action: "get_keyword" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log("Comm error or content script not ready");
                        kwValueEl.innerText = "Not connected";
                        return;
                    }
                    if (response && response.keyword) {
                        kwValueEl.innerText = response.keyword;
                    } else {
                        kwValueEl.innerText = "Unknown";
                    }
                });
            });
        } else {
            kwValueEl.innerText = "Invalid Tab";
            statusEl.innerText = "Open Shopee Evaluation page first.";
            applyBtn.disabled = true;
        }
    } catch (e) {
        console.error(e);
        kwValueEl.innerText = "Error";
    }

    // Handle Logic for visibility
    const modeSelection = document.getElementById('mode-selection');
    const optionsComplex = document.getElementById('options-complex');
    const optionsSimple = document.getElementById('options-simple');
    const relevanceRadios = document.querySelectorAll('input[name="relevance"]');

    relevanceRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const val = e.target.value;
            // Always show mode selection now
            modeSelection.classList.remove('hidden');

            if (val === 'medium' || val === 'irrelevant') {
                optionsComplex.classList.remove('hidden');
                optionsSimple.classList.add('hidden');
            } else if (val === 'relevant') {
                optionsComplex.classList.add('hidden');
                optionsSimple.classList.remove('hidden');
            }
        });
    });

    // Handle Apply
    applyBtn.addEventListener('click', async () => {
        const selected = document.querySelector('input[name="relevance"]:checked');
        if (!selected) {
            statusEl.innerText = "Please select a relevance option.";
            return;
        }

        const val = selected.value;
        let openReasons = false;
        let skipFilled = false;

        // Determine params based on active mode
        if (val === 'medium' || val === 'irrelevant') {
            const mode = document.querySelector('input[name="mode_complex"]:checked').value;
            if (mode === 'simple') {
                openReasons = false;
                skipFilled = false;
            } else if (mode === 'reasons') {
                openReasons = true;
                skipFilled = false;
            } else if (mode === 'reasons_skip') {
                openReasons = true;
                skipFilled = true;
            }
        } else if (val === 'relevant') {
            const skipCheck = document.getElementById('skip-filled-simple');
            skipFilled = skipCheck ? skipCheck.checked : true;
            openReasons = false; // Never open reasons for Relevant
        }

        statusEl.innerText = "Processing...";
        const tab = await getActiveTab();

        chrome.tabs.sendMessage(tab.id, {
            action: "apply_relevance",
            value: selected.value,
            openReasons: openReasons,
            skipFilled: skipFilled
        }, (response) => {
            if (chrome.runtime.lastError) {
                statusEl.innerText = "Error: " + chrome.runtime.lastError.message;
                return;
            }

            if (response && response.count !== undefined) {
                statusEl.innerText = `Success! Updated ${response.count} items.`;
            } else {
                statusEl.innerText = "Operation complete (no response count).";
            }
        });
    });

    // NEW: Smart Search Logic for Card Background
    const cardSearchInput = document.getElementById('card-search-input');
    const cardSearchClear = document.getElementById('card-search-clear');
    const cardSearchCounter = document.getElementById('card-search-counter');
    const cardSearchNav = document.getElementById('card-search-nav');
    const cardSearchUp = document.getElementById('card-search-up');
    const cardSearchDown = document.getElementById('card-search-down');

    let currentHighlightIndex = -1;
    let totalHighlights = 0;

    // Restore previous search state
    chrome.storage.local.get(['card_search_query'], (res) => {
        if (cardSearchInput && res.card_search_query) {
            cardSearchInput.value = res.card_search_query;
        }
    });

    function makeAccentInsensitiveRegex(word) {
        const map = { a: '[aáàãâä]', e: '[eéèêë]', i: '[iíìîï]', o: '[oóòõôö]', u: '[uúùûü]', c: '[cç]', n: '[nñ]' };
        const norm = word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        return norm.split('').map(c => map[c] || c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
    }

    function scrollHighlightIntoView() {
        const marks = document.querySelectorAll('mark.smart-highlight');
        if (marks.length === 0 || currentHighlightIndex < 0) return;
        
        marks.forEach((m, idx) => {
            if (idx === currentHighlightIndex) {
                m.style.backgroundColor = '#ff9800'; // Orange for active
                m.style.color = '#fff';
                m.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                m.style.backgroundColor = '#ffeb3b'; // Yellow for others
                m.style.color = '#000';
            }
        });
        
        if (cardSearchCounter) {
            cardSearchCounter.innerText = `${currentHighlightIndex + 1}/${totalHighlights}`;
        }
    }

    window.highlightCardText = function(searchText) {
        const container = document.getElementById('preview-content-area');
        if (!container) return;
        
        // Clear old highlights
        const marks = container.querySelectorAll('mark.smart-highlight');
        marks.forEach(mark => {
            const parent = mark.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(mark.textContent), mark);
                parent.normalize();
            }
        });
        
        currentHighlightIndex = -1;
        totalHighlights = 0;
        if (cardSearchCounter) { cardSearchCounter.style.display = 'none'; cardSearchCounter.innerText = '0/0'; }
        if (cardSearchNav) cardSearchNav.style.display = 'none';
        
        if (!searchText) return;
        
        const keywords = searchText.split(/[\s,]+/).map(w => w.trim()).filter(w => w.length > 0);
        if (keywords.length === 0) return;
        
        const walk = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let n;
        while(n = walk.nextNode()) {
            if (n.parentNode && n.parentNode.nodeName !== 'MARK' && n.nodeValue.trim().length > 0) {
                textNodes.push(n);
            }
        }
        
        const regexStr = '(' + keywords.map(kw => makeAccentInsensitiveRegex(kw)).join('|') + ')';
        const regex = new RegExp(regexStr, 'gi');
        
        textNodes.forEach(node => {
            const originalText = node.nodeValue;
            if (regex.test(originalText)) {
                const fragment = document.createDocumentFragment();
                let lastIdx = 0;
                originalText.replace(regex, (match, p1, offset) => {
                    fragment.appendChild(document.createTextNode(originalText.slice(lastIdx, offset)));
                    const mark = document.createElement('mark');
                    mark.className = 'smart-highlight';
                    mark.style.backgroundColor = '#ffeb3b';
                    mark.style.color = '#000';
                    mark.style.padding = '0 2px';
                    mark.style.borderRadius = '2px';
                    mark.style.fontWeight = 'bold';
                    mark.textContent = match;
                    fragment.appendChild(mark);
                    lastIdx = offset + match.length;
                    totalHighlights++;
                    return match;
                });
                fragment.appendChild(document.createTextNode(originalText.slice(lastIdx)));
                node.parentNode.replaceChild(fragment, node);
            }
        });
        
        if (totalHighlights > 0) {
            currentHighlightIndex = 0;
            if (cardSearchCounter) {
                cardSearchCounter.style.display = 'block';
                cardSearchCounter.innerText = `1/${totalHighlights}`;
            }
            if (cardSearchNav) cardSearchNav.style.display = 'flex';
            scrollHighlightIntoView();
        } else {
            if (cardSearchCounter) {
                cardSearchCounter.style.display = 'block';
                cardSearchCounter.innerText = `0/0`;
            }
        }
    };

    if (cardSearchInput && cardSearchClear) {
        cardSearchInput.addEventListener('input', (e) => {
            const query = e.target.value;
            chrome.storage.local.set({ card_search_query: query });
            if (window.highlightCardText) window.highlightCardText(query);
        });

        cardSearchClear.addEventListener('click', () => {
            cardSearchInput.value = '';
            chrome.storage.local.set({ card_search_query: '' });
            if (window.highlightCardText) window.highlightCardText('');
        });
        
        if (cardSearchUp) {
            cardSearchUp.addEventListener('click', () => {
                if (totalHighlights > 0) {
                    currentHighlightIndex = (currentHighlightIndex - 1 + totalHighlights) % totalHighlights;
                    scrollHighlightIntoView();
                }
            });
        }
        
        if (cardSearchDown) {
            cardSearchDown.addEventListener('click', () => {
                if (totalHighlights > 0) {
                    currentHighlightIndex = (currentHighlightIndex + 1) % totalHighlights;
                    scrollHighlightIntoView();
                }
            });
        }
        
        cardSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    if (cardSearchUp) cardSearchUp.click();
                } else {
                    if (cardSearchDown) cardSearchDown.click();
                }
            }
        });
    }
    // Handle Unfilled Checker
    const navUpBtn = document.getElementById('nav-up-btn');
    const navDownBtn = document.getElementById('nav-down-btn');
    const unfilledCountEl = document.getElementById('unfilled-count');

    async function updateUnfilledState(count) {
        if (count === -1) {
            unfilledCountEl.innerText = `Verifying...`;
            unfilledCountEl.classList.remove('has-unfilled');
            navUpBtn.disabled = true;
            navDownBtn.disabled = true;
            return;
        }
        if (count > 0) {
            unfilledCountEl.innerText = `${count} Unfilled`;
            unfilledCountEl.classList.add('has-unfilled');
            navUpBtn.disabled = false;
            navDownBtn.disabled = false;
        } else {
            unfilledCountEl.innerText = `0 Unfilled`;
            unfilledCountEl.classList.remove('has-unfilled');
            navUpBtn.disabled = true;
            navDownBtn.disabled = true;
        }
    }

    // Auto-check on popup open without applying red borders
    async function autoCheckUnfilled() {
        const tab = await getActiveTab();
        if (tab && tab.url && tab.url.includes('shopee.io')) {
            chrome.tabs.sendMessage(tab.id, { action: "check_unfilled", highlight: false }, (response) => {
                if (chrome.runtime.lastError) return;
                if (response && response.count !== undefined) {
                    updateUnfilledState(response.count);
                }
            });
        }
    }

    // Call it immediately after setup
    setTimeout(autoCheckUnfilled, 200);

    async function navigateUnfilled(direction) {
        const tab = await getActiveTab();
        chrome.tabs.sendMessage(tab.id, { action: "nav_unfilled", direction: direction }, (response) => {
            if (chrome.runtime.lastError) return;
            if (response && response.total) {
                unfilledCountEl.innerText = `${response.current} of ${response.total} Unfilled`;
            }
        });
    }

    navUpBtn.addEventListener('click', () => navigateUnfilled('prev'));
    navDownBtn.addEventListener('click', () => navigateUnfilled('next'));

    // --- SIDEBAR TOGGLE ---
    const toggle = document.getElementById('sidebar-toggle');

    // Load initial state
    chrome.storage.local.get(['sidebarEnabled'], (result) => {
        if (toggle) toggle.checked = result.sidebarEnabled || false;
    });

    if (toggle) {
        toggle.addEventListener('change', async (e) => {
            const isEnabled = e.target.checked;

            // Save state
            chrome.storage.local.set({ sidebarEnabled: isEnabled }, () => {
                statusEl.innerText = isEnabled ? "Sidebar ativada!" : "Sidebar desativada!";
                setTimeout(() => { if (statusEl.innerText.includes("Sidebar")) statusEl.innerText = ""; }, 2000);
            });

            // Inform the active tab immediately so it toggles without reload
            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tabs[0] && tabs[0].url && tabs[0].url.includes('shopee.io')) {
                    chrome.tabs.sendMessage(tabs[0].id, { action: "toggle_sidebar", enabled: isEnabled }, () => {
                        if (chrome.runtime.lastError) {
                            // Silent fail, just means content script isn't on the page yet
                        }
                    });
                }
            } catch (err) {
                console.error(err);
            }
        });
    }

    // Listen for live updates from content.js interval
    let currentTabId = null;
    getActiveTab().then(tab => {
        if (tab) currentTabId = tab.id;
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "unfilled_status" && request.count !== undefined) {
            // IGNORE messages from background tabs!
            if (sender && sender.tab && currentTabId && sender.tab.id !== currentTabId) return;

            // Only update if no specific navigation is active to avoid immediately overwriting "1 of 3" with "3 Unfilled"
            if (!unfilledCountEl.innerText.includes("of")) {
                updateUnfilledState(request.count);
            }
        }
        
        // --- FLIP CARD LOGIC ---
        if (request.action === "fetch_status_loading") {
            document.getElementById('flip-container').classList.add('flipped');
            document.getElementById('preview-loading').classList.remove('hidden');
            document.getElementById('preview-content-area').classList.add('hidden');
        }

        if (request.action === "flip_card") {
            document.getElementById('flip-container').classList.add('flipped');
            document.getElementById('preview-loading').classList.add('hidden');
            document.getElementById('preview-content-area').classList.remove('hidden');

            try {
                // 1. Extract pure item data via Regex from the HTML string (Fallback to apiData if background API succeeded)
                let itemData = request.apiData;
                
                if (!itemData) {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(request.html, 'text/html');

                    // Extract Title
                    const titleEl = doc.querySelector('.vR6K3w, h1');
                    const backupTitle = request.html.match(/<title>([^<]+)\|/i) || request.html.match(/<meta property="og:title" content="([^"]+)"/i);
                    let extractedName = titleEl ? titleEl.textContent : (backupTitle ? backupTitle[1] : "Produto sem Título");
                    if (extractedName.includes("Shopee Brasil")) extractedName = "Produto sem Título";

                    // Extract Description
                    const descEl = Array.from(doc.querySelectorAll('.QN2lPu, p')).map(p => p.textContent).join('<br>') || 
                                   (doc.querySelector('.product-detail') ? doc.querySelector('.product-detail').textContent : null);
                    const backupDesc = request.html.match(/<meta property="og:description" content="([^"]+)"/i);
                    let extractedDesc = descEl || (backupDesc ? backupDesc[1] : "Sem descrição");

                    // Extract Images
                    let images = [];
                    const imgEls = doc.querySelectorAll('picture source[type="image/webp"], .TMw1ot img');
                    imgEls.forEach(el => {
                        let src = el.getAttribute('srcset') || el.getAttribute('src');
                        if (src) {
                            src = src.split(' ')[0]; // Remove '1x' if srcset
                            
                            // Remove Shopee thumbnail low-res tags to force HD images
                            src = src.replace(/@resize.*?\.webp/i, '').replace(/@resize.*/i, '');
                            
                            if (!images.includes(src) && src.includes('http')) images.push(src);
                        }
                    });
                    if (images.length === 0) {
                        const backupImg = request.html.match(/<meta property="og:image" content="([^"]+)"/i);
                        if (backupImg) images.push(backupImg[1].replace(/@resize.*?\.webp/i, '').replace(/@resize.*/i, ''));
                    }

                    // Extract Details Panel
                    let detailRows = [];
                    const detailNodes = doc.querySelectorAll('.ybxj32');
                    detailNodes.forEach(node => {
                        const header = node.querySelector('h3');
                        const valueNode = node.querySelector('div, a');
                        if (header && valueNode) {
                            detailRows.push({ name: header.textContent.trim(), value: valueNode.textContent.trim() });
                        }
                    });

                    // Extract Variations
                    let vars = [];
                    const variationSections = doc.querySelectorAll('section.flex.items-center');
                    variationSections.forEach(section => {
                        const h2 = section.querySelector('h2.Dagtcd');
                        if (h2 && h2.textContent !== 'Quantidade') {
                            const options = Array.from(section.querySelectorAll('button span.ZivAAW')).map(s => s.textContent.trim());
                            if (options.length > 0) {
                                vars.push({ name: h2.textContent.trim(), options });
                            }
                        }
                    });

                    itemData = {
                        name: extractedName,
                        description: extractedDesc,
                        images: images,
                        tier_variations: vars,
                        attributes: detailRows
                    };
                }

                // Format Details Block
                let detailsRowsHtml = '';
                if (itemData.attributes) {
                    detailsRowsHtml = itemData.attributes.map(attr => `
                        <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid #f0f0f0;">
                            <span style="color:#666; font-size:12px;">${attr.name || attr.display_name}</span>
                            <span style="font-size:12px; font-weight:500; text-align:right;">${attr.value || attr.value_name || attr}</span>
                        </div>
                    `).join('');
                }

                // 2. Build the requested template mimicking Shopee's React Classes exactly
                // Título
                document.getElementById('preview-title').innerHTML = `
                    <div class="WBVL_7">
                        <h1 class="vR6K3w" style="font-size:16px; font-weight:bold; margin-bottom:8px; line-height: 1.3;">
                            ${itemData.name || "Sem título"}
                        </h1>
                    </div>`;

                // Carrossel
                let imagesHtml = '';
                let navHtml = '';
                if (itemData.images && itemData.images.length > 0) {
                    const mappedImages = itemData.images.map(img => {
                        let url = img.includes('http') ? img : `https://down-br.img.susercontent.com/file/${img}`;
                        return url.replace(/@resize.*?\.webp/i, '').replace(/@resize.*/i, '');
                    });
                    // Ensure unique URLs
                    const uniqueImages = [...new Set(mappedImages)].slice(0, 8); // Max 8 photos
                    
                    const imgSlides = uniqueImages.map((src, i) => `
                        <img class="carousel-slide" src="${src}" data-index="${i}" style="width:100%; height:auto; border-radius:4px; display: ${i === 0 ? 'block' : 'none'};" />
                    `).join('');
                    
                    imagesHtml = `
                    <div class="flex flex-column carousel-container" style="position: relative; margin-bottom: 12px; max-width: 100%;">
                        <div class="TMw1ot" style="position:relative; border-radius:4px; overflow:hidden; background: #fff; border: 1px solid #eee;">
                            ${imgSlides}
                            ${uniqueImages.length > 1 ? `
                                <button class="carousel-prev" style="position: absolute; top:50%; left:0; transform:translateY(-50%); background:rgba(0,0,0,0.4); color:white; border:none; padding:8px 12px; font-size:16px; cursor:pointer;">&#10094;</button>
                                <button class="carousel-next" style="position: absolute; top:50%; right:0; transform:translateY(-50%); background:rgba(0,0,0,0.4); color:white; border:none; padding:8px 12px; font-size:16px; cursor:pointer;">&#10095;</button>
                            ` : ''}
                        </div>
                        ${uniqueImages.length > 1 ? `
                        <div class="carousel-thumbnails" style="display:flex; gap:4px; margin-top:8px; overflow-x:auto;">
                            ${uniqueImages.map((src, i) => `<img src="${src}" class="carousel-thumb" data-index="${i}" style="width:40px; height:40px; border-radius:2px; cursor:pointer; opacity: ${i===0? 1 : 0.6}; object-fit:cover; border: 1px solid ${i===0? 'var(--primary-color)' : '#eee'};">`).join('')}
                        </div>` : ''}
                    </div>`;
                }
                const carouselRoot = document.getElementById('preview-carousel');
                carouselRoot.innerHTML = imagesHtml || '<div style="padding: 20px; text-align: center; color: #888;"><i>Sem fotos</i></div>';

                // Assign Carousel logic safely
                if (itemData.images && itemData.images.length > 1) {
                    const slides = carouselRoot.querySelectorAll('.carousel-slide');
                    const thumbs = carouselRoot.querySelectorAll('.carousel-thumb');
                    let curIdx = 0;
                    const changeSlide = (idx) => {
                        slides.forEach(s => s.style.display = 'none');
                        thumbs.forEach(t => { t.style.opacity = '0.6'; t.style.border = '1px solid #eee'; });
                        slides[idx].style.display = 'block';
                        thumbs[idx].style.opacity = '1';
                        thumbs[idx].style.border = '1px solid var(--primary-color)';
                        curIdx = idx;
                    };
                    const prevBtn = carouselRoot.querySelector('.carousel-prev');
                    if(prevBtn) prevBtn.onclick = () => changeSlide((curIdx - 1 + slides.length) % slides.length);
                    const nextBtn = carouselRoot.querySelector('.carousel-next');
                    if(nextBtn) nextBtn.onclick = () => changeSlide((curIdx + 1) % slides.length);
                    thumbs.forEach((t, idx) => t.onclick = () => changeSlide(idx));
                }

                // Variações
                let varsHtml = '';
                if (itemData.tier_variations && itemData.tier_variations.length > 0) {
                    itemData.tier_variations.forEach(v => {
                        let optsHtml = (v.options || []).map(opt => `
                            <button class="sApkZm selection-box-unselected" style="border:1px solid #ccc; padding:4px 8px; margin:2px; border-radius:2px; cursor:default; background:white; font-size:12px;">
                                <span class="ZivAAW">${opt}</span>
                            </button>
                        `).join('');
                        varsHtml += `
                        <section class="flex items-center" style="margin-bottom: 12px; align-items: baseline;">
                            <h2 class="Dagtcd" style="font-size:13px; font-weight:600; margin-bottom:4px; color:#555;">${v.name}</h2>
                            <div class="flex items-center j7HL5Q" style="display:flex; flex-wrap:wrap;">
                                ${optsHtml}
                            </div>
                        </section>`;
                    });
                }
                document.getElementById('preview-variations').innerHTML = varsHtml;

                // Descrição e Detalhes
                document.getElementById('preview-details').innerHTML = `
                    <div class="product-detail page-product__detail">
                        ${detailsRowsHtml ? `
                        <section class="I_DV_3" style="margin-bottom: 16px;">
                            <h2 class="WjNdTR" style="font-size:14px; font-weight:bold; margin:8px 0; border-bottom:1px solid #eee; padding-bottom:4px;">Detalhes do Produto</h2>
                            <div class="Gf4Ro0">
                                ${detailsRowsHtml}
                            </div>
                        </section>` : ''}
                        <section class="I_DV_3">
                            <h2 class="WjNdTR" style="font-size:14px; font-weight:bold; margin:8px 0; border-bottom:1px solid #eee; padding-bottom:4px;">Descrição do produto</h2>
                            <div class="Gf4Ro0" style="white-space: pre-wrap; font-size:12px; line-height:1.5; color:#444; max-height:400px; overflow-y:auto; background:#fff; padding:8px; border-radius:4px; border:1px solid #f0f0f0;">
                                ${itemData.description || "Nenhuma descrição disponível."}
                            </div>
                        </section>
                    </div>`;
                    
                // Execute highlight if query exists globally
                chrome.storage.local.get(['card_search_query'], (res) => {
                    if (res.card_search_query && window.highlightCardText) {
                        setTimeout(() => window.highlightCardText(res.card_search_query), 50);
                    }
                });

            } catch(e) {
                console.error("Error parsing product HTML/JSON:", e);
                document.getElementById('preview-title').innerText = 'Erro ao construir informações do produto.';
            }
        }

        if (request.action === "unflip_card") {
            document.getElementById('flip-container').classList.remove('flipped');
        }
    });

    const previewBackBtn = document.getElementById('preview-back-btn');
    if (previewBackBtn) {
        previewBackBtn.addEventListener('click', async () => {
            document.getElementById('flip-container').classList.remove('flipped');
            try {
                const tab = await getActiveTab();
                chrome.tabs.sendMessage(tab.id, { action: "clear_image_highlight" });
            } catch(e) {}
        });
    }

});
