(async () => {
    // Vérifie connexion
    const whoami = await fetch('/api/whoami').then(r => r.ok ? r.json() : null);
    if (!whoami || !whoami.username) {
        window.location.href = '/login';
        return;
    }
    const userInfo = document.getElementById('user-info');
    function setConnectedText() {
        const lang = document.documentElement.lang || 'en';
        let txt = 'Connected as';
        if (window.translationsCache && window.translationsCache[lang] && window.translationsCache[lang]['connected_as']) {
            txt = window.translationsCache[lang]['connected_as'];
        }
        userInfo.textContent = `${txt} ${whoami.username}`;
    }
    setConnectedText();
    document.getElementById('logout-btn').onclick = async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/';
    };

    // Charge les projets suivis
    const followedList = document.getElementById('followed-projects-list');
    async function loadFollowedProjects() {
        const res = await fetch('/api/followed-projects');
        const projects = await res.json();
        followedList.innerHTML = '';
        projects.forEach(p => {
            const el = document.createElement('div');
            el.className = 'project';
            el.innerHTML = `
                <h3>${p.title} <small data-i18n="by">by</small> ${p.owner || 'anonymous'}</h3>
                <p>${p.description}</p>
            `;
            followedList.appendChild(el);
        });
    }
    loadFollowedProjects();
})();
