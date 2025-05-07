// content.js

// ===== POCZĄTEK: Zmienne globalne dla skryptu =====
let tooltip = null;
let currentHoveredEmailRow = null;
let debounceTimer = null;
let apiRequestAbortController = null;
// ===== KONIEC: Zmienne globalne dla skryptu =====


// ===== POCZĄTEK: Definicje funkcji pomocniczych =====
function createTooltip() {
    if (!document.getElementById('github-tooltip')) {
        tooltip = document.createElement('div');
        tooltip.id = 'github-tooltip';
        document.body.appendChild(tooltip);

        tooltip.addEventListener('mouseenter', () => { clearTimeout(debounceTimer); });
        tooltip.addEventListener('mouseleave', (event) => {
            const relatedTarget = event.relatedTarget;
            if (relatedTarget && !relatedTarget.closest('tr[jsmodel]') && relatedTarget !== currentHoveredEmailRow) {
                hideTooltip();
                currentHoveredEmailRow = null;
            }
        });
    } else {
        tooltip = document.getElementById('github-tooltip');
    }
}

function showTooltip(x, y, contentHtml) {
    if (!tooltip) createTooltip();
    tooltip.innerHTML = contentHtml;
    tooltip.style.width = 'auto';
    tooltip.style.height = 'auto';
    tooltip.classList.add('visible');
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = x + 15;
    let top = y + 15;
    if (left + tooltipRect.width > window.innerWidth - 10) { left = x - tooltipRect.width - 15; if (left < 10) left = 10; }
    if (top + tooltipRect.height > window.innerHeight - 10) { top = y - tooltipRect.height - 15; if (top < 10) top = 10; }
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

function hideTooltip() {
    if (tooltip) { tooltip.classList.remove('visible'); tooltip.innerHTML = ''; }
    if (apiRequestAbortController) { apiRequestAbortController.abort(); apiRequestAbortController = null; }
}

function simpleMarkdownToHtml(markdownText) {
    if (!markdownText) return '';
    let html = String(markdownText);
    html = html.replace(/\*\*(.*?)\*\*|__(.*?)__/g, '<strong>$1$2</strong>');
    html = html.replace(/\*(.*?)\*|_(.*?)_/g, '<em>$1$2</em>');
    html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');
    if (html.match(/^[*+-]\s/m) && !html.trim().startsWith('<ul>') && !html.trim().startsWith('<ol>')) {
        let listContent = html.split('\n').map(line => {
            const itemMatch = line.match(/^[*+-]\s+(.*)/);
            return itemMatch ? `<li>${itemMatch[1]}</li>` : line;
        }).join('');
        if (listContent.includes('<li>') && !listContent.match(/<\/?ul>|<\/?ol>/i)) {
            html = `<ul>${listContent}</ul>`;
        } else {
            html = listContent;
        }
    }
    return html;
}

function extractRepoAndTagFromSubject(subject) {
    let repoFullName = null;
    let tagName = null;
    const repoRegex = /^\[([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\]/;
    const repoMatch = subject.match(repoRegex);
    if (repoMatch && repoMatch[1]) { repoFullName = repoMatch[1]; }

    const tagRegexes = [
        /(?:Release\s+version)\s+(v?[0-9]+(?:\.[0-9]+)*(?:[-a-zA-Z0-9_.]*))/i,
        /\]\s+(v?[0-9]+(?:\.[0-9]+)*(?:[-a-zA-Z0-9_.]*))/i,
        /([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\s+(v?[0-9]+(?:\.[0-9]+)*(?:[-a-zA-Z0-9_.]*))/i
    ];
    for (const regex of tagRegexes) {
        const tagMatch = subject.match(regex);
        if (tagMatch) {
            if (tagMatch[1] && !tagMatch[1].includes('/') && regex.source.includes('Release\s+version')) tagName = tagMatch[1];
            else if (tagMatch[1] && regex.source.includes('\]\s+')) tagName = tagMatch[1];
            else if (tagMatch[2] && regex.source.includes('[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\s+')) tagName = tagMatch[2];
            if (tagName) break;
        }
    }
    if (!repoFullName) {
        const repoInSubjectMatch = subject.match(/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\s+(?:release\s+v[0-9])/i);
        if (repoInSubjectMatch && repoInSubjectMatch[1]) { repoFullName = repoInSubjectMatch[1]; }
    }
    if (tagName && tagName.includes('/')) { tagName = null; }
    if (tagName) {
        const versionPartMatch = tagName.match(/^(v?[0-9]+(?:\.[0-9]+)*(?:[-a-zA-Z0-9_.]*))/);
        tagName = (versionPartMatch && versionPartMatch[1]) ? versionPartMatch[1] : null;
    }
    return { repoFullName, tagName };
}

function isReleaseNotification(subject) {
    const lowerSubject = subject.toLowerCase();
    const releaseKeywords = ['release', 'new version', 'published', 'tag'];
    const exclusionKeywords = ['issue', 'pull request', 'discussion', 'comment on', 'review', 'workflow', 'sponsor', 'merged', 'closed', 'action', 'ci'];
    if (exclusionKeywords.some(keyword => lowerSubject.includes(keyword))) {
        if (releaseKeywords.some(rk => lowerSubject.includes(rk)) && !lowerSubject.match(/\b(comment on|discussion on|review on|workflow|ci)\s+(release|tag)\b/i)) {
            if(lowerSubject.includes('action') && (lowerSubject.includes('release') || lowerSubject.includes('tag'))) return false;
            return true;
        }
        return false;
    }
    return releaseKeywords.some(keyword => lowerSubject.includes(keyword));
}

function getEmailRowAndSubject(target) {
    const emailRow = target.closest('tr[jsmodel]');
    if (!emailRow) return null;
    const subjectSelectors = ['.bog span', '.y6 span[id]', 'td.xY span.y2', 'div[role=\'link\'] span[data-thread-id]'];
    let subjectSpan = null;
    for (const selector of subjectSelectors) {
        const spans = emailRow.querySelectorAll(selector);
        for (const span of spans) {
            if (span.offsetHeight > 0 && span.offsetWidth > 0 && span.textContent.trim() !== '') { subjectSpan = span; break; }
        }
        if (subjectSpan) break;
    }
    if (!subjectSpan) {
        const potentialSubjects = Array.from(emailRow.querySelectorAll('span[title]'));
        subjectSpan = potentialSubjects.find(s => s.offsetHeight > 0 && s.offsetWidth > 0 && s.textContent.length > 5);
    }
    const senderSpan = emailRow.querySelector('span[email=\'notifications@github.com\']');
    return (senderSpan && subjectSpan) ? { emailRow, subjectText: subjectSpan.textContent.trim() } : null;
}
// ===== KONIEC: Definicje funkcji pomocniczych =====


// ===== POCZĄTEK: Główne funkcje obsługi zdarzeń =====
function handleMouseOver(event) {
    const emailData = getEmailRowAndSubject(event.target);
    if (!emailData) {
        if (tooltip && tooltip.contains(event.target)) return;
        if (currentHoveredEmailRow && !currentHoveredEmailRow.contains(event.target) && (!tooltip || !tooltip.contains(event.target))) {
            hideTooltip(); currentHoveredEmailRow = null;
        }
        return;
    }
    const { emailRow, subjectText } = emailData;
    if (emailRow === currentHoveredEmailRow) return;
    if (apiRequestAbortController) { apiRequestAbortController.abort(); apiRequestAbortController = null; }
    hideTooltip(); currentHoveredEmailRow = emailRow;
    clearTimeout(debounceTimer);

    if (isReleaseNotification(subjectText)) {
        const extractedData = extractRepoAndTagFromSubject(subjectText);
        const repoFullName = extractedData.repoFullName;
        const tagName = extractedData.tagName;

        if (repoFullName) {
            debounceTimer = setTimeout(() => {
                if (emailRow !== currentHoveredEmailRow) return;

                const initialTooltipContent = `
                    <h4>${repoFullName}</h4>
                    <p>Pobieranie informacji z GitHub...</p>
                    <div class='ai-loading-indicator'>Ładowanie danych AI...</div>`;
				showTooltip(event.clientX, event.clientY, initialTooltipContent);

                apiRequestAbortController = new AbortController();
                const signal = apiRequestAbortController.signal;

                chrome.runtime.sendMessage({ action: 'fetchRepoAndReleaseInfo', repoFullName: repoFullName, tagName: tagName }, (response) => {
                    if (chrome.runtime.lastError) {
                        if (chrome.runtime.lastError.message !== 'Extension context invalidated.') {
                            console.error('Message passing error:', chrome.runtime.lastError.message);
                        }
                        return; 
                    }
                    if (signal.aborted) { 
                        console.log('Request aborted for', repoFullName); 
                        return; 
                    } 
                    if (!currentHoveredEmailRow || !document.body.contains(currentHoveredEmailRow) || !tooltip || !document.body.contains(tooltip) || !tooltip.classList.contains('visible')) {
                        return;
                    }

                    if (response && currentHoveredEmailRow === emailRow) {
                        if (response.error) {
                            showTooltip(event.clientX, event.clientY, `<h4>${repoFullName}</h4><p>Błąd: ${response.error}</p>`);
                        } else if (response.repoInfo && response.repoInfo.name) {
                            const repo = response.repoInfo;
                            const release = response.releaseInfo;
                            const ai = response.aiInfo;

                            let description = repo.description || 'Brak opisu repozytorium.';
                            if (description.length > 150) description = description.substring(0, 147) + '...';

                            // ===== POCZĄTEK: Generowanie stringu środowisk/technologii (inline) =====
                            let inlineEnvTagsString = "";
                            const displayedEnvs = new Set();

                            if (repo.language) {
                                displayedEnvs.add(repo.language);
                            }

                            const envIndicativeTopics = [
                                'docker', 'kubernetes', 'linux', 'windows', 'macos', 'android', 'ios', 
                                'web', 'browser', 'electron', 'aws', 'azure', 'gcp', 'serverless',
                                'nodejs', 'deno', 'jvm', '.net', 'unity', 'unrealengine', 'qt', 'gtk',
                                'raspberry-pi', 'arduino'
                            ];
                            const commonLanguages = ['python', 'java', 'javascript', 'typescript', 'c#', 'c++', 'go', 'ruby', 'php', 'swift', 'kotlin', 'rust', 'perl', 'lua', 'scala', 'haskell'];

                            if (repo.topics && repo.topics.length > 0) {
                                repo.topics.forEach(topic => {
                                    const lowerTopic = topic.toLowerCase().replace(/-/g, '');
                                    
                                    if (envIndicativeTopics.includes(lowerTopic) || commonLanguages.includes(lowerTopic)) {
                                        let displayTopic = topic;
                                        if (lowerTopic === 'nodejs') displayTopic = 'Node.js';
                                        else if (lowerTopic === 'csharp' || lowerTopic === 'c#') displayTopic = 'C#';
                                        else if (lowerTopic === 'cplusplus' || lowerTopic === 'c++') displayTopic = 'C++';
                                        else if (lowerTopic.length > 3 && !['aws', 'gcp', 'jvm', 'qt', 'gtk', 'ios'].includes(lowerTopic)) {
                                             displayTopic = topic.charAt(0).toUpperCase() + topic.slice(1);
                                        }
                                        displayedEnvs.add(displayTopic);
                                    }
                                });
                            }
                            
                            if (displayedEnvs.size > 0) {
                                inlineEnvTagsString = Array.from(displayedEnvs).map(env => `<span class='env-tag'>${env.replace(/-/g, ' ')}</span>`).join(' ');
                            }
                            // ===== KONIEC: Generowanie stringu środowisk/technologii (inline) =====


                            let repoDetailsHtml = `<div class='repo-details'>`;
                            if (repo.owner && repo.owner.avatar_url) {
                                repoDetailsHtml += `<img src='${repo.owner.avatar_url}' alt='${repo.owner.login}' class='author-avatar' title='Właściciel: ${repo.owner.login}'> `;
                            }
                            repoDetailsHtml += `Repo: <a href='${repo.url}' target='_blank'>${repoFullName}</a>`;
                            if (typeof repo.open_issues_count !== 'undefined') {
                                repoDetailsHtml += ` | Otwarte Issues/PR: ${repo.open_issues_count}`;
                            }
                            repoDetailsHtml += `</div>`;


                            let aiInfoHtml = '<hr>';
                            if (ai) {
                                if (ai.error) {
                                    aiInfoHtml += `<p style='font-size:0.85em; color: #bf616a;'>AI: ${ai.error}</p>`;
                                } else {
                                    let contentGeneratedByAI = false;
                                    if (ai.opis_pl_rozszerzony) {
                                        aiInfoHtml += `<p style='font-size:0.9em; margin-bottom: 8px;'><strong>Rozszerzony Opis PL (AI):</strong></p>
                                        <div class='markdown-content' style='font-size:0.85em; line-height:1.4; margin-bottom: 10px; max-height: 120px; overflow-y: auto; padding-right: 5px;'>${simpleMarkdownToHtml(ai.opis_pl_rozszerzony)}</div>`;
                                        contentGeneratedByAI = true;
                                    }
                                    if (ai.przykłady_użycia_pl && ai.przykłady_użycia_pl.length > 0) {
                                        aiInfoHtml += `<p style='font-size:0.9em; margin-bottom: 5px; margin-top: ${contentGeneratedByAI ? '10px' : '0'};'><strong>Przykłady Użycia/Zastosowania PL (AI):</strong></p>
                                        <div class='markdown-content' style='font-size:0.85em; max-height: 100px; overflow-y: auto; padding-right: 5px;'><ul style='margin:0 0 5px 0; padding-left: 20px; list-style-type: disc;'>`;
                                        ai.przykłady_użycia_pl.forEach(item => {
                                            aiInfoHtml += `<li style='margin-bottom: 3px;'>${simpleMarkdownToHtml(item)}</li>`;
                                        });
                                        aiInfoHtml += `</ul></div>`;
                                        contentGeneratedByAI = true;
                                    }
                                    if (ai.kluczowe_zmiany_pl && ai.kluczowe_zmiany_pl.length > 0) {
                                        aiInfoHtml += `<p style='font-size:0.9em; margin-bottom: 5px; margin-top: ${contentGeneratedByAI ? '10px' : '0'};'><strong>Kluczowe Zmiany w Tej Wersji (AI):</strong></p>
                                        <div class='markdown-content' style='font-size:0.85em; max-height: 100px; overflow-y: auto; padding-right: 5px;'><ul style='margin:0 0 5px 0; padding-left: 20px; list-style-type: disc;'>`;
                                        ai.kluczowe_zmiany_pl.forEach(item => {
                                            aiInfoHtml += `<li style='margin-bottom: 3px;'>${simpleMarkdownToHtml(item)}</li>`;
                                        });
                                        aiInfoHtml += `</ul></div>`;
                                        contentGeneratedByAI = true;
                                    }
                                    if (!contentGeneratedByAI) {
                                        aiInfoHtml += `<p style='font-size:0.85em; opacity:0.8;'>AI nie wygenerowało dodatkowych informacji.</p>`;
                                    }
                                }
                            } else {
                                aiInfoHtml += `<div class='ai-loading-indicator'>Oczekiwanie na dane AI...</div>`;
                            }

                            let releaseNotesHtml = '';
                            if (release && !release.error) {
                                releaseNotesHtml += '<hr>';
                                if (release.author) {
                                    releaseNotesHtml += `<p class='release-author'>Wydane przez: <img src='${release.author.avatar_url}' alt='${release.author.login}'> <a href='${release.author.html_url}' target='_blank'>${release.author.login}</a></p>`;
                                }
                                if (release.body) {
                                    let notes = release.body;
                                    notes = notes.replace(/#{1,6}\s*(.*)/g, '<strong>$1</strong> ');
                                    notes = notes.replace(/(\r\n|\n|\r)/gm, ' ').replace(/\s\s+/g, ' ');
                                    notes = notes.replace(/\[(.*?)\]\((.*?)\)/g, '$1').replace(/[*_`~]|---|===/g, '').replace(/<[^>]*>/g, '');
                                    if (notes.length > 200) notes = notes.substring(0, 197) + '...';
                                    let releaseNameText = release.name || (release.tag_name ? `Release ${release.tag_name}` : 'Szczegóły wydania');
                                    releaseNotesHtml += `<p style='font-size:0.85em; opacity:0.8; margin-bottom: 2px;'><strong>${releaseNameText} (oryginalne):</strong></p>
                                    <div style='font-size:0.8em; max-height: 70px; overflow-y: auto; padding-right: 5px; line-height:1.3; opacity: 0.7; word-break: break-word;'>
                                    ${notes || 'Brak oryginalnego opisu wydania.'}
                                    </div>`;
                                }
                            }

                            let actionsHtml = `<div class='tooltip-actions'>`;
                            actionsHtml += `<a href='${repo.url}' target='_blank' class='action-button action-open-repo'>Otwórz Repo</a>`;
                            if (release && !release.error && release.html_url) {
                                actionsHtml += `<a href='${release.html_url}' target='_blank' class='action-button action-view-release'>Zobacz Wydanie</a>`;
                            }
                            actionsHtml += `<button class='action-copy-name' data-repo-name='${repo.name}'>Kopiuj Nazwę</button>`;
                            if (ai && ai.opis_pl_rozszerzony) {
                                const aiDescToCopy = ai.opis_pl_rozszerzony.replace(/\"/g, '\"');
                                actionsHtml += `<button class='action-copy-ai-desc' data-ai-desc-markdown='${aiDescToCopy}'>Kopiuj Opis AI</button>`;
                            }
                            actionsHtml += `</div>`;

                            const descriptionAndEnvs = `<p>${description}${inlineEnvTagsString ? ` <span class='inline-env-bracket'>[</span>${inlineEnvTagsString}<span class='inline-env-bracket'>]</span>` : ''}</p>`;

                            const tooltipContent = `
                                <h4><a href='${repo.url}' target='_blank'>${repo.name}</a> (<a href='${repo.url}/stargazers' target='_blank' style='color: #ebcb8b;'>${repo.stars}★</a>)</h4>
                                ${descriptionAndEnvs} 
                                ${repoDetailsHtml}
                                ${aiInfoHtml} 
                                ${releaseNotesHtml}
                                ${actionsHtml}
                            `;
                            showTooltip(event.clientX, event.clientY, tooltipContent);
                        }
                    }
                });
            }, 500);
        }
    }
}

function handleMouseOut(event) {
    clearTimeout(debounceTimer);
    const relatedTarget = event.relatedTarget; const toElement = event.toElement;
    if (tooltip && tooltip.contains(relatedTarget || toElement)) return;
    if (currentHoveredEmailRow && currentHoveredEmailRow.contains(relatedTarget || toElement)) return;
    if (currentHoveredEmailRow && (!relatedTarget || !currentHoveredEmailRow.contains(relatedTarget)) && (!tooltip || !tooltip.contains(relatedTarget))) {
        hideTooltip(); currentHoveredEmailRow = null;
    }
}
// ===== KONIEC: Główne funkcje obsługi zdarzeń =====


// ===== POCZĄTEK: Obsługa kliknięć dla przycisków akcji (delegacja) =====
document.addEventListener('click', function(event) {
    if (!tooltip || !tooltip.classList.contains('visible') || !tooltip.contains(event.target)) {
        return;
    }

    const targetButton = event.target.closest('button.action-copy-name, button.action-copy-ai-desc');
    if (!targetButton) return;

    let copyStatusSpan = targetButton.querySelector('.copy-status');
    if (!copyStatusSpan) {
        copyStatusSpan = document.createElement('span');
        copyStatusSpan.className = 'copy-status';
        targetButton.insertBefore(copyStatusSpan, targetButton.firstChild);
    }
    
    function showCopyStatus(text, success = true) {
        copyStatusSpan.textContent = text;
        copyStatusSpan.style.color = success ? '#a3be8c' : '#bf616a';
        setTimeout(() => {
            if (copyStatusSpan) copyStatusSpan.textContent = '';
        }, 1500);
    }

    if (targetButton.classList.contains('action-copy-name')) {
        const repoName = targetButton.dataset.repoName;
        navigator.clipboard.writeText(repoName).then(() => {
            showCopyStatus(' Skopiowano!');
        }).catch(err => {
            showCopyStatus(' Błąd!', false);
            console.error('Błąd kopiowania nazwy repo:', err);
        });
    } else if (targetButton.classList.contains('action-copy-ai-desc')) {
        const aiDescMarkdown = targetButton.dataset.aiDescMarkdown;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = simpleMarkdownToHtml(aiDescMarkdown);
        const textToCopy = tempDiv.textContent || tempDiv.innerText || '';
        
        navigator.clipboard.writeText(textToCopy).then(() => {
            showCopyStatus(' Skopiowano!');
        }).catch(err => {
            showCopyStatus(' Błąd!', false);
            console.error('Błąd kopiowania opisu AI:', err);
        });
    }
    event.stopPropagation();
});
// ===== KONIEC: Obsługa kliknięć dla przycisków akcji =====


// ===== POCZĄTEK: Funkcja inicjalizująca i jej wywołanie =====
function init() {
    console.log('GitHub Release Info (AI Advanced): Initializing content script.');
    createTooltip();
    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
// ===== KONIEC: Funkcja inicjalizująca i jej wywołanie =====