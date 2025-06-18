(async () => {

	// Check if user is connected
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

	// Prevent newline in project title
	function preventNewlineOnTitle(titleElem) {
		titleElem.addEventListener('keydown', function(e) {
			if (e.key === 'Enter') {
				e.preventDefault();
			}
		});
		
		titleElem.addEventListener('paste', function(e) {
			e.preventDefault();
			const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\n/g, ' ');
			document.execCommand('insertText', false, text);
		});
	}

	// Load user's projects
	const myProjectsList = document.getElementById('my-projects-list');
	async function loadMyProjects() {
		const res = await fetch('/api/my-projects');
		const projects = await res.json();
		myProjectsList.innerHTML = '';
		projects.forEach(async p => {
			const el = document.createElement('div');
			el.className = 'project';
			el.innerHTML = `
				<h3 contenteditable="true" class="editable-title">${p.title}</h3>
				<textarea class="editable-desc">${p.description}</textarea>
				<button class="save-btn">Save</button>
				<button class="delete-btn">Delete</button>
				<div class="followers-info"></div>
			`;
			const titleElem = el.querySelector('.editable-title');
			preventNewlineOnTitle(titleElem);
			// Save modifications
			el.querySelector('.save-btn').onclick = async () => {
				const newTitle = titleElem.textContent.replace(/\n/g, ' ').trim();
				const newDesc = el.querySelector('.editable-desc').value.trim();
				const resp = await fetch(`/api/projects/${p.id}`, {
					method: 'PUT',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({ title: newTitle, description: newDesc })
				});

				if (!resp.ok) {
					alert('Error while updating the project');
				}
			};
			// Delete project
			el.querySelector('.delete-btn').onclick = async () => {
				if (confirm('Delete this project? This action is irreversible.')) {
					const resp = await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
					if (resp.ok) {
						el.remove();
					} else {
						alert('Error while deleting the project');
					}
				}
			};
			// Display followers
			const followersDiv = el.querySelector('.followers-info');
			const resp = await fetch(`/api/projects/${p.id}/followers`);
			if (resp.ok) {
				const data = await resp.json();
				followersDiv.innerHTML = `<span>${data.length} follower(s)</span> <button class="show-followers-btn">Show list</button>`;
				const showBtn = followersDiv.querySelector('.show-followers-btn');
				showBtn.onclick = () => {
					if (followersDiv.querySelector('.followers-list')) {
						followersDiv.querySelector('.followers-list').remove();
						showBtn.textContent = 'Show list';
					} else {
						const list = document.createElement('div');
						list.className = 'followers-list';
						list.innerHTML = data.length ? data.map(u => `<div>${u.username}</div>`).join('') : '<em>No followers</em>';
						followersDiv.appendChild(list);
						showBtn.textContent = 'Hide list';
					}
				};
			}
			myProjectsList.appendChild(el);
		});
	}
	loadMyProjects();

	// Project creation
	const addForm = document.getElementById('add-project-form');
	addForm.onsubmit = async e => {
		e.preventDefault();
		const data = {
			title: addForm.title.value.replace(/\n/g, ' ').trim(),
			description: addForm.description.value.trim()
		};
		const res = await fetch('/api/projects', {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify(data)
		});
		const json = await res.json();
		addForm.reset();
		loadMyProjects();
	};
})();
