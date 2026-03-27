// Shopee Relevance Selector Extension
console.log("[ShopeeRel] Content script loaded");

// Helper to debug
function log(msg) {
    console.log(`[ShopeeExt] ${msg}`);
}

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "get_keyword") {
        const kw = extractKeyword();
        sendResponse({ keyword: kw });
    } else if (request.action === "apply_relevance") {
        const result = applyRelevance(request.value, request.openReasons, request.skipFilled);
        sendResponse(result);
    } else if (request.action === "check_unfilled") {
        const count = checkUnfilled(request.highlight);
        sendResponse({ count: count });
    } else if (request.action === "nav_unfilled") {
        const result = navUnfilled(request.direction);
        sendResponse(result);
    } else if (request.action === "toggle_sidebar") {
        setSidebarState(request.enabled);
        sendResponse({ success: true });
    } else if (request.action === "clear_image_highlight") {
        if (currentlyFlippedImage) {
            currentlyFlippedImage.style.outline = '';
            currentlyFlippedImage = null;
        }
        sendResponse({ success: true });
    }
    return true; // Keep channel open
});

function extractKeyword() {
    try {
        let value = "Not Detected";

        // SKA Flow
        if (window.location.href.includes('label_template')) {
            const breakWordsDiv = document.querySelector('td.ant-table-cell div.break-words');
            if (breakWordsDiv && breakWordsDiv.innerText) {
                value = breakWordsDiv.innerText.trim();
                return value;
            }
        }

        // Look for the "Keyword" text specifically.
        let candidates = getAllElementsWithText('Keyword');

        for (let el of candidates) {
            let tempValue = null;
            if (el.nextElementSibling) {
                tempValue = el.nextElementSibling.innerText.trim();
            }
            else if (el.parentElement && el.parentElement.nextElementSibling) {
                tempValue = el.parentElement.nextElementSibling.innerText.trim();
            }
            else if (el.parentElement && el.parentElement.parentElement && el.parentElement.parentElement.nextElementSibling) {
                tempValue = el.parentElement.parentElement.nextElementSibling.textContent.trim();
            }

            if (tempValue && tempValue.length > 0 && tempValue.length < 100) {
                value = tempValue;
                break;
            }
        }

        // NEW FEATURE: Auto-fill description with keyword if found
        if (value !== "Not Detected") {
            const descInput = document.getElementById('intention_description');

            // Only paste if the input is empty to avoid overwriting user edits
            if (descInput && !descInput.value) {
                // Set value
                // For React 16+, setting value property doesn't always trigger change.
                // We need to set via prototype and dispatch event.
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                nativeInputValueSetter.call(descInput, value);

                descInput.dispatchEvent(new Event('input', { bubbles: true }));
                log(`Copied keyword "${value}" to description.`);
            }
        }

        return value;

    } catch (e) { log(e); }
    return "Not Detected";
}

function applyRelevance(value, openReasons, skipFilled) {
    const processedInputs = new Set();

    // 1. Search for headers
    const headers = getElementsByText('Mark item relevance');
    headers.forEach(header => processGroupFromAnchor(header, value, processedInputs, openReasons, skipFilled));

    // 2. Search for labels (Irrelevant), but be careful.
    // The "Mark title issue" menu also has "Irrelevant keywords".
    // We should ensure the text is EXACTLY "Irrelevant" or "Relevant" or "Medium Relevant"
    // Or just rely on "Mark item relevance" which seems robust.

    // Let's filter labels more strictly to avoid "Irrelevant keywords"
    const labels = getElementsByText('Irrelevant');
    labels.forEach(label => {
        // Extra check: ensure text is exactly "Irrelevant" or just "Irrelevant" with whitespace
        if (label.innerText.trim() === 'Irrelevant') {
            processGroupFromAnchor(label, value, processedInputs, openReasons, skipFilled);
        }
    });

    return { count: processedInputs.size };
}

function processGroupFromAnchor(anchor, value, processedSet, openReasons, skipFilled) {
    let current = anchor;
    // Go up up to 6 levels to find the radio group container
    for (let i = 0; i < 6; i++) {
        if (!current) break;

        const inputs = current.querySelectorAll('input[type="radio"]');

        // STRICT CHECK: The "Mark item relevance" group MUST have exactly 3 options.
        if (inputs.length === 3) {

            // Check Skip Filled Logic
            if (skipFilled) {
                // If ANY input in this group is checked, we skip it entirely
                // We check native .checked AND look for common UI framework "checked" classes on parents
                const isFilled = Array.from(inputs).some(input => {
                    return input.checked ||
                        input.parentElement.classList.contains('ant-radio-checked') ||
                        input.parentElement.classList.contains('checked') ||
                        input.closest('.ant-radio-checked'); // Safe check for AntDesign wrappers
                });

                if (isFilled) return false;
            }

            let index = -1;
            if (value === 'irrelevant') index = 0;
            else if (value === 'medium') index = 1;
            else if (value === 'relevant') index = 2;

            if (index !== -1 && inputs[index]) {
                const groupIdentifier = inputs[0];
                if (!processedSet.has(groupIdentifier)) {
                    inputs[index].click();
                    processedSet.add(groupIdentifier);

                    // NEW FEATURE: Open "Reasons for bad case" if Irrelevant or Medium AND requested
                    if (openReasons && (value === 'irrelevant' || value === 'medium')) {
                        // Attempt to find and click the reasons button in the same card context
                        openReasonsForBadCase(groupIdentifier);
                    }
                }
                return true;
            }
        }
        current = current.parentElement;
    }
    return false;
}

function openReasonsForBadCase(contextNode) {
    const cardRoot = getSingleItemCard(contextNode);
    if (!cardRoot) return;

    const candidates = cardRoot.querySelectorAll('*');
    for (let candidate of candidates) {
        if (candidate.innerText && candidate.innerText.includes("Reasons for bad case") && !candidate.innerText.includes("Mark item")) {
            candidate.click();
            log("Clicked Reasons for bad case");
            break;
        }
    }
}

// Utils
function getSingleItemCard(startNode) {
    let current = startNode;
    let fallback = startNode;

    while (current && current.parentElement) {
        current = current.parentElement;

        // Keep track of the first parent that actually contains the reasons label just in case
        if (fallback === startNode && current.innerText && current.innerText.includes("Reasons for bad case")) {
            fallback = current;
        }

        const txt = current.textContent || "";
        const m = txt.match(/Mark item relevance/gi);

        // Once our parent encompasses MORE than 1 item, we know we hit the outer list wrapper!
        if (m && m.length > 1) {
            let child = startNode;
            while (child.parentElement !== current) {
                child = child.parentElement;
            }
            return child; // This is the exact outer shell for just our item
        }
    }

    // If we only have 1 item on the entire page, return the fallback that we know covers both inputs
    return fallback;
}
function getAllElementsWithText(str) {
    const all = document.querySelectorAll('*');
    const matches = [];
    for (let el of all) {
        if (el.innerText && el.innerText.trim() === str) {
            matches.push(el);
        }
    }
    return matches;
}

function getElementsByText(str) {
    return Array.from(document.querySelectorAll('*'))
        .filter(el => el.innerText && el.innerText.includes(str) && el.children.length === 0);
}

function findElementsWithErrorHandling(fn) {
    try {
        return fn();
    } catch (e) {
        return [];
    }
}

// Check Unfilled Logic
let unfilledElements = [];
let currentUnfilledIndex = -1;
let skaKnownPages = {};

function checkUnfilled(applyHighlight = true) {
    unfilledElements = [];
    if (applyHighlight) {
        currentUnfilledIndex = -1;
    }

    const isSkaSystem = window.location.href.includes("knowledgeadmin.search.shopee.io");
    const isGrmSystem = window.location.href.includes("sqe.search.shopee.io");

    // Remove old highlights ONLY if we are applying new ones entirely
    if (applyHighlight) {
        document.querySelectorAll('.unfilled-highlight').forEach(el => {
            el.classList.remove('unfilled-highlight');
            el.style.border = '';
            el.style.backgroundColor = '';
            el.style.borderRadius = '';
        });
        document.querySelectorAll('.unfilled-page-highlight').forEach(el => {
            el.classList.remove('unfilled-page-highlight');
            el.style.border = '';
            el.style.backgroundColor = '';
        });
    }

    const allElements = document.querySelectorAll('*');
    const headers = [];
    for (let el of allElements) {
        if (el.children.length === 0 && el.innerText) {
            const txt = el.innerText.trim().toLowerCase();
            if (txt === 'mark item relevance') {
                headers.push(el);
            }
        }
    }

    let currentPageUnfilledCount = 0;

    headers.forEach(header => {
        let current = header;
        let cardContainer = null;
        let radioInputs = null;
        let relevanceSelected = false;
        let selectedValue = null;

        for (let i = 0; i < 6; i++) {
            if (!current) break;
            const inputs = current.querySelectorAll('input[type="radio"]');

            if (inputs.length === 3) {
                cardContainer = current;
                radioInputs = inputs;

                Array.from(inputs).forEach(input => {
                    const isChecked = input.checked ||
                        input.closest('.ant-radio-checked') ||
                        input.parentElement.classList.contains('ant-radio-checked') ||
                        input.parentElement.classList.contains('checked');
                    if (isChecked) {
                        relevanceSelected = true;
                        selectedValue = input.value;
                    }
                });
                break;
            }
            current = current.parentElement;
        }

        if (cardContainer) {
            let itemUnfilled = false;

            if (!relevanceSelected) {
                itemUnfilled = true;
                if (applyHighlight) {
                    cardContainer.style.border = '2px solid red';
                    cardContainer.style.backgroundColor = 'rgba(255, 0, 0, 0.05)';
                    cardContainer.style.borderRadius = '5px';
                    cardContainer.classList.add('unfilled-highlight');
                }
                unfilledElements.push(cardContainer);
            } else {
                cardContainer.style.border = '';
                cardContainer.style.backgroundColor = '';
                cardContainer.classList.remove('unfilled-highlight');
            }

            if (isGrmSystem) {
                const root = getSingleItemCard(cardContainer);
                const candidates = root.querySelectorAll('*');
                let reasonBtn = null;
                for (let candidate of candidates) {
                    if (candidate.innerText && candidate.innerText.includes("Reasons for bad case") && !candidate.innerText.toLowerCase().includes("mark item relevance")) {
                        if (candidate.innerText.includes("0")) {
                            reasonBtn = candidate;
                        } else {
                            if (candidate.classList.contains('unfilled-highlight')) {
                                candidate.style.border = '';
                                candidate.style.backgroundColor = '';
                                candidate.classList.remove('unfilled-highlight');
                            }
                        }
                        break;
                    }
                }

                if (reasonBtn && (!relevanceSelected || selectedValue === '0' || selectedValue === '2')) {
                    itemUnfilled = true;
                    if (applyHighlight) {
                        reasonBtn.style.border = '2px solid red';
                        reasonBtn.style.backgroundColor = 'rgba(255, 0, 0, 0.05)';
                        reasonBtn.style.borderRadius = '5px';
                        reasonBtn.classList.add('unfilled-highlight');
                    }
                    unfilledElements.push(reasonBtn);
                } else if (reasonBtn) {
                    reasonBtn.style.border = '';
                    reasonBtn.style.backgroundColor = '';
                    reasonBtn.classList.remove('unfilled-highlight');
                }
            }

            if (itemUnfilled) {
                currentPageUnfilledCount++;
            }
        }
    });

    if (isSkaSystem) {
        const activePageEl = document.querySelector('.ant-pagination-item-active');
        if (activePageEl) {
            const activePageNum = activePageEl.innerText.trim();
            
            // Critical Fix: Do not overwrite the page's known un-filled count to 0 if the page is currently rendering and the items haven't popped into the DOM yet!
            if (headers.length > 0) {
                skaKnownPages[activePageNum] = currentPageUnfilledCount;
            }
        }

        const allPageEls = document.querySelectorAll('.ant-pagination-item');
        for (let pageEl of allPageEls) {
            const pNum = pageEl.innerText.trim();

            const hasErrorIcon = pageEl.querySelector('.anticon-close-circle') !== null || pageEl.querySelector('svg[data-icon="close-circle"]') !== null;
            // Native Shopee SKA often colors the text red natively (class check) or changes border
            const hasErrorClass = pageEl.classList.contains('ant-pagination-item-error') ||
                pageEl.querySelector('.ant-pagination-item-error') !== null;

            // Sync our cache with native findings
            if (hasErrorIcon || hasErrorClass) {
                if (!skaKnownPages[pNum]) skaKnownPages[pNum] = 1; // force at least 1 so it counts as error
            }

            if (hasErrorIcon || hasErrorClass || (skaKnownPages[pNum] !== undefined && skaKnownPages[pNum] > 0)) {
                if (applyHighlight) {
                    pageEl.style.border = '2px solid red';
                    pageEl.style.backgroundColor = 'rgba(255, 0, 0, 0.05)';
                    pageEl.classList.add('unfilled-page-highlight');
                }
            } else {
                pageEl.style.border = '';
                pageEl.style.backgroundColor = '';
                pageEl.classList.remove('unfilled-page-highlight');
            }
        }
    }

    if (isSkaSystem) {
        let totalSkaUnfilled = 0;
        for (let p in skaKnownPages) {
            totalSkaUnfilled += skaKnownPages[p];
        }
        if (headers.length === 0 && totalSkaUnfilled === 0) {
            return -1;
        }
        return totalSkaUnfilled;
    }

    if (headers.length === 0) {
        return -1;
    }

    return unfilledElements.length;
}

// --- FE Link Scraper and Card Flip Logic ---
let currentlyFlippedImage = null;

document.addEventListener('click', (e) => {
    const target = e.target;
    const isImageCheck = target.matches('input[value="mismatchedImage"]') || (target.closest && target.closest('input[value="mismatchedImage"]'));
    
    if (isImageCheck) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); // Block React completely

        const inputEl = target.matches('input[value="mismatchedImage"]') ? target : target.closest('input[value="mismatchedImage"]');

        if (currentlyFlippedImage === inputEl) {
            inputEl.style.outline = '';
            currentlyFlippedImage = null;
            try {
                chrome.runtime.sendMessage({ action: "unflip_card" });
            } catch(e) {}
            return;
        }

        if (currentlyFlippedImage) {
            currentlyFlippedImage.style.outline = '';
        }

        currentlyFlippedImage = inputEl;
        inputEl.style.outline = '4px solid #00ff00';
        inputEl.style.outlineOffset = '-4px';
        inputEl.style.borderRadius = '4px';

        // Find the FE Link in the same scope
        let cardRoot = getSingleItemCard(inputEl);
        if (!cardRoot || cardRoot === document.body) {
            // Fallback to closest reasonable container
            cardRoot = inputEl.closest('.ant-card, tr, .evaluation-item, .ant-table-row') || document.body;
        }

        let feLinkUrl = null;
        if (cardRoot) {
            const links = cardRoot.querySelectorAll('a');
            for (let a of links) {
                if (a.textContent.includes('FE Link') || (a.href && a.href.includes('shopee.com'))) {
                    feLinkUrl = a.href;
                    break;
                }
            }
        }

        if (feLinkUrl) {
            try {
                chrome.runtime.sendMessage({ action: "fetch_status_loading" }); // Tell UI to show loading if needed
                chrome.runtime.sendMessage({ action: "FETCH_FE_LINK", url: feLinkUrl }, (response) => {
                    if (chrome.runtime.lastError) {
                        try { chrome.runtime.sendMessage({ action: "unflip_card" }); } catch(e){}
                        return;
                    }
                    if (response && response.success) {
                        chrome.runtime.sendMessage({ 
                            action: "flip_card", 
                            html: response.html || "",
                            apiData: response.apiData,
                            url: feLinkUrl
                        });
                    } else {
                        try { chrome.runtime.sendMessage({ action: "unflip_card" }); } catch(e){}
                        if (currentlyFlippedImage) {
                            currentlyFlippedImage.style.outline = '4px solid red'; // Indicate failure
                        }
                    }
                });
            } catch(err) {}
        }
    }
}, true); // Capture phase


function goToNextSkaErrorPage() {
    const activePageEl = document.querySelector('.ant-pagination-item-active');
    if (!activePageEl) return 0;
    const activePageNum = parseInt(activePageEl.innerText.trim());

    let errorPages = Object.keys(skaKnownPages).filter(p => skaKnownPages[p] > 0).map(Number).sort((a, b) => a - b);
    let nextPage = errorPages.find(p => p > activePageNum);
    if (!nextPage && errorPages.length > 0) nextPage = errorPages[0];

    if (nextPage && nextPage !== activePageNum) {
        const targetPageEl = document.querySelector(`.ant-pagination-item-${nextPage}`);
        if (targetPageEl) {
            log(`Navigating to error page ${nextPage}`);
            targetPageEl.click();
            setTimeout(() => {
                checkUnfilled(true);
                currentUnfilledIndex = -1;
                navUnfilled('next');
            }, 800);
        }
    }
    return { current: "-", total: "Page Change" };
}

function goToPrevSkaErrorPage() {
    const activePageEl = document.querySelector('.ant-pagination-item-active');
    if (!activePageEl) return 0;
    const activePageNum = parseInt(activePageEl.innerText.trim());

    let errorPages = Object.keys(skaKnownPages).filter(p => skaKnownPages[p] > 0).map(Number).sort((a, b) => b - a);
    let prevPage = errorPages.find(p => p < activePageNum);
    if (!prevPage && errorPages.length > 0) prevPage = errorPages[0];

    if (prevPage && prevPage !== activePageNum) {
        const targetPageEl = document.querySelector(`.ant-pagination-item-${prevPage}`);
        if (targetPageEl) {
            log(`Navigating to error page ${prevPage}`);
            targetPageEl.click();
            setTimeout(() => {
                checkUnfilled(true);
                currentUnfilledIndex = -1;
                navUnfilled('prev');
            }, 800);
        }
    }
    return { current: "-", total: "Page Change" };
}

function navUnfilled(direction) {
    const isSkaSystem = window.location.href.includes("knowledgeadmin.search.shopee.io");

    if (unfilledElements.length > 0) {
        if (direction === 'next') {
            currentUnfilledIndex++;
            if (currentUnfilledIndex >= unfilledElements.length) {
                if (isSkaSystem && Object.keys(skaKnownPages).filter(p => skaKnownPages[p] > 0).length > 1) {
                    return goToNextSkaErrorPage();
                } else {
                    currentUnfilledIndex = 0;
                }
            }
        } else {
            currentUnfilledIndex--;
            if (currentUnfilledIndex < 0) {
                if (isSkaSystem && Object.keys(skaKnownPages).filter(p => skaKnownPages[p] > 0).length > 1) {
                    return goToPrevSkaErrorPage();
                } else {
                    currentUnfilledIndex = unfilledElements.length - 1;
                }
            }
        }

        const target = unfilledElements[currentUnfilledIndex];
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return { current: currentUnfilledIndex + 1, total: unfilledElements.length };
    } else if (isSkaSystem) {
        if (direction === 'next') return goToNextSkaErrorPage();
        else return goToPrevSkaErrorPage();
    }

    return 0;
}


// Auto-click Next when Reject is clicked (SKA), AND scroll to top on Submit/Reject (SKA Only), AND Check unfilled (GRM & SKA)
document.addEventListener('click', function (e) {
    const target = e.target;

    const isSkaSystem = window.location.href.includes("knowledgeadmin.search.shopee.io");
    const isGrmSystem = window.location.href.includes("sqe.search.shopee.io");

    // Check for Submit Button
    let isSubmitBtnClicked = false;

    if (isGrmSystem) {
        const grmSubmit = target.closest('button#submit');
        if (grmSubmit && grmSubmit.innerText.includes('Submit')) {
            isSubmitBtnClicked = true;
        }
    } else if (isSkaSystem) {
        const skaSubmit = target.closest('button.ant-btn.ant-btn-primary');
        if (skaSubmit && skaSubmit.innerText.includes('Submit')) {
            isSubmitBtnClicked = true;
        }
    }

    if (isSubmitBtnClicked) {
        // Slight delay to allow Shopee to visually mark the errors before we scan
        setTimeout(() => {
            const count = checkUnfilled(true);

            // Check if there are ANY unresolved pages in SKA, not just the tracked count.
            let hasAnyErrorPage = false;
            let lowestErrorPage = Infinity;

            if (isSkaSystem) {
                // Also trigger a manual check on the native Shopee red icons instead of just waiting for the interval cache
                const allPageEls = document.querySelectorAll('.ant-pagination-item');
                for (let pageEl of allPageEls) {
                    const hasErrorIcon = pageEl.querySelector('.anticon-close-circle') !== null || pageEl.querySelector('svg[data-icon="close-circle"]') !== null;
                    const hasErrorClass = pageEl.classList.contains('ant-pagination-item-error') || pageEl.querySelector('.ant-pagination-item-error') !== null;

                    if (pageEl.classList.contains('unfilled-page-highlight') || hasErrorIcon || hasErrorClass) {
                        hasAnyErrorPage = true;
                        const pNum = parseInt(pageEl.innerText.trim());
                        if (pNum < lowestErrorPage) lowestErrorPage = pNum;
                    }
                }
            }

            if (count > 0 || hasAnyErrorPage) {
                log(`Found unfilled items or pages after Submit.`);
                if (isSkaSystem) {
                    const activePageEl = document.querySelector('.ant-pagination-item-active');
                    const activePageNum = activePageEl ? parseInt(activePageEl.innerText.trim()) : 1;

                    if (lowestErrorPage !== Infinity && lowestErrorPage !== activePageNum) {
                        const targetPageEl = document.querySelector(`.ant-pagination-item-${lowestErrorPage}`);
                        if (targetPageEl) {
                            targetPageEl.click();
                            log(`Auto-navigating to lowest error page: ${lowestErrorPage}`);
                            setTimeout(() => {
                                checkUnfilled(true);
                                currentUnfilledIndex = -1;
                                navUnfilled('next');
                            }, 1000);
                        }
                    } else {
                        currentUnfilledIndex = -1;
                        navUnfilled('next');
                    }
                } else {
                    currentUnfilledIndex = -1;
                    navUnfilled('next');
                }
            }
        }, 500); // Increased wait time slightly so SKA has time to flag pages
    }

    if (!isSkaSystem) {
        return;
    }

    const rejectBtn = target.closest('button.ant-btn.ant-btn-default.ant-btn-dangerous');
    if (rejectBtn && rejectBtn.innerText.includes('Reject')) {
        log("Reject button clicked (SKA). Attempting to force-click Next...");
        setTimeout(() => {
            const buttons = Array.from(document.querySelectorAll('a.ant-btn'));
            const nextBtn = buttons.find(btn => btn.innerText.includes('Next'));
            if (nextBtn) {
                log("Next button found. Clicking...");
                nextBtn.click();
            }
        }, 100);

        setTimeout(() => {
            window.scrollTo(0, 0);
        }, 800);
    }

    const submitBtnSka = target.closest('button.ant-btn.ant-btn-primary');
    if (submitBtnSka && submitBtnSka.innerText.includes('Submit')) {
        log("Submit button clicked (SKA).");
        setTimeout(() => {
            window.scrollTo(0, 0);
        }, 800);
    }
});

// Auto-run extraction and quiet scans periodically
setInterval(() => {
    extractKeyword();

    if (typeof checkSidebarVisibility === 'function') {
        checkSidebarVisibility();
    }

    if (window.location.href.includes("knowledgeadmin.search.shopee.io") || window.location.href.includes("sqe.search.shopee.io")) {
        const count = checkUnfilled(false);
        try {
            chrome.runtime.sendMessage({ action: "unfilled_status", count: count }, () => {
                if (chrome.runtime.lastError) {
                    // Ignore disconnects (which happen when popup and sidebar are closed)
                }
            });
        } catch (e) {
            // Extension context invalidated
        }
    }
}, 1000);

// NEW FEATURE: Search Variations and Highlight (Multi-Keyword)
function highlightText(element, keywords) {
    if (!keywords || keywords.length === 0) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    const nodesToReplace = [];

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;

        if (parent) {
            const tag = parent.tagName.toUpperCase();
            // Ignore script, style, mark, buttons, and other interactive containers that break if React loses them
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK' || tag === 'BUTTON' || tag === 'LABEL' || tag === 'A') {
                continue;
            }

            // Also ignore Shopee's custom complex components
            if (parent.closest('.ant-btn, .ant-radio-wrapper, .ant-checkbox-wrapper, [role="button"], [role="switch"], .unfilled-highlight')) {
                continue;
            }
            // Explicitly protect the Reasons line
            if (parent.innerText && parent.innerText.includes("Reasons for bad case")) {
                continue;
            }
        }

        // Match ANY of the keywords to highlight them
        const textToLower = node.nodeValue.toLowerCase();
        if (keywords.some(kw => textToLower.includes(kw))) {
            nodesToReplace.push(node);
        }
    }

    // Escape regex characters and join with OR (|)
    const escapedKeywords = keywords.map(kw => kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    const regex = new RegExp(`(${escapedKeywords.join('|')})`, 'gi');

    nodesToReplace.forEach(node => {
        const span = document.createElement('span');
        span.innerHTML = node.nodeValue.replace(regex, '<mark style="background-color: yellow; color: black; font-weight: bold;">$1</mark>');
        if (node.parentNode) {
            node.parentNode.replaceChild(span, node);
        }
    });
}

function searchVariations(searchText) {
    log(`Searching for variation: ${searchText}`);
    if (!searchText) return;

    // Split input by commas or spaces, remove empty items, and convert to lowercase
    const keywords = searchText.split(/[\s,]+/).map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
    if (keywords.length === 0) return;

    // 1. Find and click the Detailed mode switch if it's off
    const switches = document.querySelectorAll('button[role="switch"].ant-switch');
    for (let sw of switches) {
        if (sw.getAttribute('aria-checked') === 'false') {
            sw.click();
            log("Switch clicked to enable detailed mode.");
        }
    }

    // 2. Poll for "Variation Options" divs and open ALL of them first 
    // (Because Variation content is likely lazy rendered only AFTER hover)
    let expandAttempts = 0;
    const expandInterval = setInterval(() => {
        expandAttempts++;
        const elements = document.querySelectorAll('div');

        for (let el of elements) {
            if (el.innerText && el.innerText.trim() === 'Variation Options' && el.children.length === 0) {
                // If not already hovered by this search
                if (!el.hasAttribute('data-searched-for')) {
                    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
                    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
                    el.setAttribute('data-searched-for', 'true');
                }
            }
        }

        if (expandAttempts > 4) { // 2 seconds should be enough to trigger all hovers
            clearInterval(expandInterval);
            log(`Finished triggering hovers.`);
        }
    }, 500);

    // 3. Wait for popovers to render, then search inside them
    let highlightAttempts = 0;
    const highlightInterval = setInterval(() => {
        highlightAttempts++;

        // Find all variation trigger div's again to map them to their popovers if needed, 
        // but easier is just closing popovers that don't match.
        // Ant-design popovers are usually appended to document.body
        const popovers = document.querySelectorAll('.ant-popover, .ant-tooltip');

        popovers.forEach(pop => {
            // Only process newly rendered popovers
            if (!pop.hasAttribute('data-highlighted-for') || pop.getAttribute('data-highlighted-for') !== searchText) {

                // Get the text inside the popover
                const popText = (pop.innerText || pop.textContent || "").toLowerCase();

                // Check if ANY keyword is present
                const anyFound = keywords.some(kw => popText.includes(kw));

                if (anyFound) {
                    // Match found! Highlight it and keep it open
                    highlightText(pop, keywords);
                    pop.setAttribute('data-highlighted-for', searchText);
                    log("Found match in popover!");
                } else {
                    // No match. We need to close this popover.
                    // The easiest hack to hide it without knowing its trigger anchor
                    // is to just set its display to none.
                    pop.style.display = 'none';
                    pop.setAttribute('data-highlighted-for', searchText);
                }
            }
        });

        // Run this for 10 seconds to catch all lazy-loaded popovers
        if (highlightAttempts > 20) {
            clearInterval(highlightInterval);
            log(`Finished searching popovers.`);
        }
    }, 500);
}

// ============== SPLIT-PANE SIDEBAR LOGIC ============== //

let sidebarWidth = 340;
let sidebarIframe = null;
let sidebarResizer = null;
let isResizing = false;
let sidebarEnabledGlobal = false;

// Attempt to load saved width
chrome.storage.local.get(['sidebarWidth'], (result) => {
    if (result.sidebarWidth) {
        sidebarWidth = result.sidebarWidth;
    }
});

function updateSidebarLayout() {
    if (sidebarIframe) {
        sidebarIframe.style.width = `${sidebarWidth}px`;

        // Update main page bodies
        document.body.style.width = `calc(100% - ${sidebarWidth}px)`;
        const rootApp = document.getElementById('app') || document.querySelector('.app-container');
        if (rootApp) {
            rootApp.style.width = `calc(100% - ${sidebarWidth}px)`;
        }
    }
    if (sidebarResizer) {
        sidebarResizer.style.right = `${sidebarWidth}px`;
    }
}

function handleMouseMove(e) {
    if (!isResizing) return;
    // Calculate new width: viewport width - mouse X position
    let newWidth = window.innerWidth - e.clientX;
    // Constraints
    if (newWidth < 250) newWidth = 250;
    if (newWidth > window.innerWidth / 2) newWidth = window.innerWidth / 2;

    sidebarWidth = newWidth;
    updateSidebarLayout();
}

function handleMouseUp(e) {
    if (isResizing) {
        isResizing = false;
        if (sidebarResizer) {
            sidebarResizer.style.backgroundColor = 'transparent';
        }
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        let overlay = document.getElementById('shopee-relevance-drag-overlay');
        if (overlay) overlay.remove();

        // Save new width
        chrome.storage.local.set({ sidebarWidth: sidebarWidth });
    }
}

function checkSidebarVisibility() {
    const url = window.location.href;
    const isItemEvaluation = url.includes('item-evaluation');
    const isKeywordEvaluation = url.includes('keyword-evaluation-details');
    const isLabelTemplate = url.includes('label_template');
    
    // Show if it's ANY of the valid Shopee URLs
    const shouldShow = sidebarEnabledGlobal && (isItemEvaluation || isKeywordEvaluation || isLabelTemplate);

    if (shouldShow) {
        if (!sidebarIframe) {
            // 1. Create the iframe
            sidebarIframe = document.createElement('iframe');
            sidebarIframe.id = 'shopee-relevance-sidebar';
            sidebarIframe.src = chrome.runtime.getURL('sidebar_index.html');

            // 2. Style the iframe to stick to the right
            Object.assign(sidebarIframe.style, {
                position: 'fixed',
                top: '0',
                right: '0',
                width: `${sidebarWidth}px`,
                height: '100vh',
                border: 'none',
                boxShadow: '-2px 0 10px rgba(0,0,0,0.1)',
                zIndex: '999990', // reduced z-index to stay below notifications
                backgroundColor: 'white'
            });

            // 3. Create the Resizer Handle
            sidebarResizer = document.createElement('div');
            sidebarResizer.id = 'shopee-relevance-resizer';
            Object.assign(sidebarResizer.style, {
                position: 'fixed',
                top: '0',
                right: `${sidebarWidth}px`,
                width: '6px',
                height: '100vh',
                cursor: 'col-resize',
                backgroundColor: 'transparent',
                zIndex: '999991',
                transition: 'background-color 0.2s'
            });

            sidebarResizer.addEventListener('mouseenter', () => {
                sidebarResizer.style.backgroundColor = 'rgba(13, 110, 253, 0.4)'; // light blue tint
            });
            sidebarResizer.addEventListener('mouseleave', () => {
                if (!isResizing) sidebarResizer.style.backgroundColor = 'transparent';
            });

            sidebarResizer.addEventListener('mousedown', (e) => {
                isResizing = true;
                e.preventDefault(); // Prevent text selection
                sidebarResizer.style.backgroundColor = 'rgba(13, 110, 253, 0.8)';

                // Add overlay so iframe doesn't swallow mouse events!
                let overlay = document.createElement('div');
                overlay.id = 'shopee-relevance-drag-overlay';
                Object.assign(overlay.style, {
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    zIndex: '999992', cursor: 'col-resize',
                    backgroundColor: 'transparent'
                });
                document.body.appendChild(overlay);

                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
            });

            document.body.appendChild(sidebarResizer);
            document.body.appendChild(sidebarIframe);

            updateSidebarLayout();
            log("Sidebar panel activated!");
        }
    } else {
        if (sidebarIframe) {
            sidebarIframe.remove();
            sidebarIframe = null;
            
            if (sidebarResizer) {
                sidebarResizer.remove();
                sidebarResizer = null;
            }

            document.body.style.width = '100%';
            const rootApp = document.getElementById('app') || document.querySelector('.app-container');
            if (rootApp) {
                rootApp.style.width = '100%';
            }
            log("Sidebar panel deactivated!");
        }
    }
}

function setSidebarState(enabled) {
    sidebarEnabledGlobal = enabled;
    checkSidebarVisibility();
}


// 1. Initial Check on Page Load
chrome.storage.local.get(['sidebarEnabled'], (result) => {
    // We only enable if it was explicitly checked
    if (result.sidebarEnabled) {
        // give page a tiny moment to render the body first
        setTimeout(() => setSidebarState(true), 500);
    }
});
