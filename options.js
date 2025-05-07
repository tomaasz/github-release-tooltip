// options.js
function saveOptions() {
    const apiKeyInput = document.getElementById('openai_api_key');
    const apiKey = apiKeyInput.value;
    const status = document.getElementById('status');

    if (!apiKey.trim()) {
        status.textContent = 'Klucz API nie może być pusty.';
        status.className = 'status error';
        status.style.display = 'block';
        apiKeyInput.focus();
        return;
    }
    
    // Prosta walidacja formatu klucza (np. zaczyna się od "sk-")
    if (!apiKey.startsWith('sk-')) {
         status.textContent = 'Niepoprawny format klucza API. Powinien zaczynać się od "sk-".';
         status.className = 'status error';
         status.style.display = 'block';
         apiKeyInput.focus();
         return;
    }


    chrome.storage.sync.set({
        openaiApiKey: apiKey
    }, () => {
        status.textContent = 'Klucz API został pomyślnie zapisany.';
        status.className = 'status success';
        status.style.display = 'block';
        setTimeout(() => {
            status.style.display = 'none';
            status.textContent = '';
        }, 3000);
    });
}

function restoreOptions() {
    chrome.storage.sync.get({
        openaiApiKey: ''
    }, (items) => {
        if (items.openaiApiKey) {
            document.getElementById('openai_api_key').value = items.openaiApiKey;
        }
    });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);