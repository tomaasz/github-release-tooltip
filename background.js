// background.js

const backgroundJsCache = {};

async function getOpenAIDescription(repoName, repoDescription, repoLanguage, repoTopics, releaseNotes, apiKey) {
    if (!apiKey) {
        return { error: "Brak klucza API OpenAI. Skonfiguruj w opcjach rozszerzenia." };
    }

    const maxReleaseNotesLength = 2500;
    const truncatedReleaseNotes = releaseNotes && releaseNotes.length > maxReleaseNotesLength
        ? releaseNotes.substring(0, maxReleaseNotesLength) + "..."
        : releaseNotes || "";

    const prompt = `
Jesteś ekspertem AI, który tworzy szczegółowe i przystępne podsumowania projektów open source dla programistów.
Na podstawie poniższych informacji o repozytorium GitHub i jego wydaniu:

Nazwa Repozytorium: ${repoName}
Główny Język Programowania: ${repoLanguage || "Nieokreślony"}
Tematy/Technologie (tagi repozytorium): ${repoTopics && repoTopics.length > 0 ? repoTopics.join(', ') : "Brak"}
Opis Repozytorium (angielski): ${repoDescription || "Brak opisu."}
Notatki do Wydania (angielski, fragment):
---
${truncatedReleaseNotes || "Brak szczegółowych notatek do wydania."}
---

Zadania (odpowiedz w języku polskim, używając prostego Markdown dla list i pogrubień):
1.  **Rozszerzony Opis Projektu (PL):** Stwórz bardziej szczegółowy opis projektu (2-4 zdania), wyjaśniając jego główne cele, kluczowe funkcjonalności i dla kogo jest przeznaczony. Uwzględnij główny język i technologie, jeśli to istotne.
2.  **Przykłady Użycia/Zastosowania (PL):** Opisz 2-3 typowe lub interesujące przykłady użycia tego projektu. Jeśli notatki do wydania zawierają konkretne scenariusze, wykorzystaj je. W przeciwnym razie, bazuj na ogólnym opisie projektu, języku i technologiach.
3.  **Kluczowe Zmiany w Tej Wersji (PL):** Na podstawie notatek do wydania, wymień 2-3 najważniejsze zmiany, nowe funkcje lub poprawki błędów wprowadzone w tej konkretnej wersji. Jeśli notatki są skąpe, wspomnij o tym.

Odpowiedz wyłącznie jako obiekt JSON z kluczami "opis_pl_rozszerzony" (string, Markdown), "przykłady_użycia_pl" (tablica stringów, każdy string to jeden przykład, Markdown) oraz "kluczowe_zmiany_pl" (tablica stringów, każda zmiana to jeden string, Markdown).
Przykład:
{
  "opis_pl_rozszerzony": "To jest **ważny** projekt napisany w Pythonie, który ułatwia zarządzanie zadaniami...",
  "przykłady_użycia_pl": [
    "Automatyzacja codziennych raportów przy użyciu skryptów.",
    "Monitorowanie wydajności aplikacji webowych (Node.js) w czasie rzeczywistym.",
    "Generowanie dokumentacji technicznej na podstawie kodu źródłowego Java."
  ],
  "kluczowe_zmiany_pl": [
    "Dodano **nową funkcjonalność** X integrującą się z systemem Y.",
    "Poprawiono błąd związany z obsługą dużych plików.",
    "Zoptymalizowano algorytm sortowania, co przyspiesza działanie o 20%."
  ]
}
JSON:`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.4,
                max_tokens: 600 // Increased slightly for potentially more detailed context from topics/language
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: `HTTP error ${response.status}` } }));
            console.error("OpenAI API error response:", errorData);
            return { error: `Błąd API OpenAI: ${errorData.error?.message || response.statusText}` };
        }
        const data = await response.json();
        if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
            try {
                let jsonString = data.choices[0].message.content;
                const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
                if (jsonMatch && jsonMatch[1]) jsonString = jsonMatch[1];
                jsonString = jsonString.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
                return JSON.parse(jsonString);
            } catch (e) { 
                console.error("Błąd parsowania JSON od OpenAI:", e, "\nOtrzymany string:", data.choices[0].message.content);
                return { error: "Błąd przetwarzania odpowiedzi od AI (niepoprawny JSON)." }; 
            }
        } else { 
            console.error("Niekompletna odpowiedź od OpenAI:", data);
            return { error: "Niekompletna odpowiedź od AI." }; 
        }
    } catch (error) { 
        console.error("Błąd sieci podczas komunikacji z OpenAI:", error);
        return { error: "Błąd sieci podczas komunikacji z AI." }; 
    }
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchRepoAndReleaseInfo") {
    const { repoFullName, tagName } = request;

    if (!repoFullName) {
      sendResponse({ error: "Repo name not provided" });
      return true;
    }

    const baseCacheKey = tagName ? `data_${repoFullName}_tag_${tagName}` : `data_${repoFullName}_latest`;
    const aiCacheKey = `ai_${baseCacheKey}_v3`; // Incremented AI cache key due to prompt change
    const cacheDuration = 30 * 60 * 1000; 

    const cachedData = backgroundJsCache[baseCacheKey];
    const cachedAiData = backgroundJsCache[aiCacheKey];

    if (cachedData && cachedAiData &&
        (Date.now() - cachedData.timestamp < cacheDuration) &&
        (Date.now() - cachedAiData.timestamp < cacheDuration)) {
      console.log("Serving ALL from cache:", baseCacheKey, aiCacheKey);
      sendResponse({ ...cachedData.data, aiInfo: cachedAiData.data });
      return false;
    }

    const repoPromise = fetch(`https://api.github.com/repos/${repoFullName}`)
      .then(res => res.ok ? res.json() : Promise.reject(new Error(`Repo API error: ${res.status}`)));

    let releasePromise;
    if (tagName) {
      releasePromise = fetch(`https://api.github.com/repos/${repoFullName}/releases/tags/${tagName}`)
        .then(res => res.ok ? res.json() : ({ error: `Release tag '${tagName}' not found.`, status: 404 }));
    } else {
      releasePromise = fetch(`https://api.github.com/repos/${repoFullName}/releases/latest`)
        .then(res => res.ok ? res.json() : ({ error: `No latest release found.`, status: 404 }));
    }

    Promise.all([repoPromise, releasePromise])
      .then(async ([repoData, releaseData]) => {
        const combinedData = {
          repoInfo: {
            name: repoData.name,
            description: repoData.description,
            stars: repoData.stargazers_count,
            url: repoData.html_url,
            open_issues_count: repoData.open_issues_count,
            language: repoData.language, // Added language
            topics: repoData.topics || [], // Added topics, ensure it's an array
            owner: {
                login: repoData.owner.login,
                avatar_url: repoData.owner.avatar_url,
                html_url: repoData.owner.html_url
            }
          },
          releaseInfo: releaseData.error ? releaseData : {
            name: releaseData.name,
            tag_name: releaseData.tag_name,
            body: releaseData.body || "",
            html_url: releaseData.html_url,
            published_at: releaseData.published_at,
            author: releaseData.author ? {
                login: releaseData.author.login,
                avatar_url: releaseData.author.avatar_url,
                html_url: releaseData.author.html_url
            } : null
          }
        };
        backgroundJsCache[baseCacheKey] = { data: combinedData, timestamp: Date.now() };

        let aiGeneratedInfo = null;
        const { openaiApiKey } = await chrome.storage.sync.get('openaiApiKey');
        
        if (cachedAiData && (Date.now() - cachedAiData.timestamp < cacheDuration)) {
            aiGeneratedInfo = cachedAiData.data;
            console.log("Serving AI from cache (data was re-fetched or new):", aiCacheKey);
        } else if (openaiApiKey && combinedData.repoInfo.name && !combinedData.releaseInfo.error) {
            console.log("Fetching AI description for:", repoFullName);
            aiGeneratedInfo = await getOpenAIDescription(
                combinedData.repoInfo.name,
                combinedData.repoInfo.description,
                combinedData.repoInfo.language,
                combinedData.repoInfo.topics,
                combinedData.releaseInfo.body,
                openaiApiKey
            );
            backgroundJsCache[aiCacheKey] = { data: aiGeneratedInfo, timestamp: Date.now() };
        } else if (!openaiApiKey) {
            aiGeneratedInfo = { error: "Klucz API OpenAI nie jest skonfigurowany w opcjach." };
        } else if (combinedData.releaseInfo.error) {
            aiGeneratedInfo = { error: "Nie można wygenerować opisu AI (błąd danych wydania)." };
        }

        sendResponse({ ...combinedData, aiInfo: aiGeneratedInfo });
      })
      .catch(error => {
        console.error("Błąd główny (GitHub API lub AI):", error);
        sendResponse({ error: `Błąd: ${error.message}` });
      });
    return true;
  }
});