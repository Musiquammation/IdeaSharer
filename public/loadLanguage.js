let translationsCache = {};

async function loadLanguage(lang) {
    if (!translationsCache[lang]) {
        const res = await fetch(`/lang/${lang}.json`);
        translationsCache[lang] = await res.json();
    }
    const translations = translationsCache[lang];

    // Text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[key]) {
            el.textContent = translations[key];
        }
    });
    // Placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (translations[key]) {
            el.placeholder = translations[key];
        }
    });
    // Dates
    document.querySelectorAll('[data-i18n-date]').forEach(el => {
        const dateStr = el.getAttribute('data-i18n-date');
        if (dateStr) {
            const date = new Date(dateStr);
            el.textContent = date.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });
        }
    });
    document.documentElement.lang = lang;
}

const languageSwitcher = document.getElementById('language-switcher');
if (languageSwitcher) {
    languageSwitcher.addEventListener('change', (e) => {
        const selectedLang = e.target.value;
        loadLanguage(selectedLang);
    });
}

loadLanguage(document.documentElement.lang || 'en');
