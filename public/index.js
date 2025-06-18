// Check if connected, otherwise redirect
(async () => {
	document.getElementById("my-projects-btn").addEventListener("click", () => {
		window.location.href = '/myProjects';
	});
	document.getElementById("followed-projects-btn").addEventListener("click", () => {
		window.location.href = '/followedProjects';
	});

	let whoami = null;
	try {
		whoami = await fetch('/api/whoami').then(r => r.ok ? r.json() : null);
	} catch {}

	if (whoami && whoami.username) {
		let txt = 'Connected as';
		const lang = document.documentElement.lang || 'en';
		if (window.translationsCache && window.translationsCache[lang] && window.translationsCache[lang]['connected_as']) {
			txt = window.translationsCache[lang]['connected_as'];
		}
		document.getElementById('user-info').textContent = `${txt} ${whoami.username}`;
		document.getElementById('logout-btn').style.display = '';
		document.getElementById('logout-btn').onclick = async () => {
			await fetch('/api/logout', { method: 'POST' });
			window.location.href = 'login';
		};
	} else {
		document.getElementById('user-info').textContent = '';
		document.getElementById('logout-btn').style.display = 'none';
	}

	// Load projects
	const projectsList = document.getElementById('projects-list');
	let followedIds = [];
	if (whoami && whoami.username) {
		try {
			const followed = await fetch('/api/followed-projects').then(r => r.ok ? r.json() : []);
			followedIds = followed.map(p => p.id);
		} catch {}
	}

	async function loadProjects() {
		const res = await fetch('/api/projects');
		const projects = await res.json();
		projectsList.innerHTML = '';
		projects.forEach(p => {
			const el = document.createElement('div');
			el.className = 'project';
			/// TODO: likes
			el.innerHTML = `
				<h3>${p.title} <small data-i18n="by">by</small> ${p.owner || 'anonymous'}</h3>
				<p>${p.description}</p>
				<div class="project-actions">
					<span>${p.followers_count || 0} follower(s)</span>
					<button class="view-followers-btn">View followers</button>
					<button class="show-comments-btn" data-i18n="show_comments">Show comments</button>
					<button class="follow-btn"></button>
					${/*whoami && whoami.username ? '<button class="like-btn" title="Like">👍</button>\n<button class="dislike-btn" title="Dislike">👎</button>' :*/ ''}
				</div>
				<div class="followers-list" style="display:none;"></div>
				<div class="comments-list" style="display:none;"></div>
				<div class="comment-form" style="display:none;"></div>
			`;

			const actionsDiv = el.querySelector('.project-actions');
			const followersSpan = actionsDiv.querySelector('span');
			const viewBtn = actionsDiv.querySelector('.view-followers-btn');
			const showCommentsBtn = actionsDiv.querySelector('.show-comments-btn');
			const followBtn = actionsDiv.querySelector('.follow-btn');
			const followersListDiv = el.querySelector('.followers-list');
			const commentsListDiv = el.querySelector('.comments-list');
			const commentFormDiv = el.querySelector('.comment-form');

			// View followers
			viewBtn.onclick = async () => {
				if (followersListDiv.style.display === 'none') {
					const resp = await fetch(`/api/projects/${p.id}/followers`);
					if (resp.ok) {
						const data = await resp.json();
						followersListDiv.innerHTML = data.length ? data.map(u => `<div>${u.username}</div>`).join('') : '<em>No followers</em>';
						followersListDiv.style.display = '';
						viewBtn.textContent = 'Hide followers';
					}
				} else {
					followersListDiv.style.display = 'none';
					viewBtn.textContent = 'View followers';
				}
			};

			// Follow/Unfollow
			if (whoami && whoami.username) {
				let isFollowed = followedIds.includes(p.id);
				followBtn.textContent = isFollowed ? 'Unfollow' : 'Follow';
				followBtn.onclick = async () => {
					const url = `/api/projects/${p.id}/${isFollowed ? 'unfollow' : 'follow'}`;
					const resp = await fetch(url, { method: 'POST' });
					if (resp.ok) {
						isFollowed = !isFollowed;
						followBtn.textContent = isFollowed ? 'Unfollow' : 'Follow';
						followedIds = isFollowed ? [...followedIds, p.id] : followedIds.filter(id => id !== p.id);
						const count = parseInt(followersSpan.textContent) + (isFollowed ? 1 : -1);
						followersSpan.textContent = `${count} follower(s)`;
					}
				};
			} else {
				followBtn.style.display = 'none';
			}

			// Show comments
			showCommentsBtn.onclick = async () => {
				if (commentsListDiv.style.display === 'none') {
					const resp = await fetch(`/api/projects/${p.id}/comments`);
					const comments = await resp.json();
					commentsListDiv.innerHTML = comments.length ?
						comments.map(c => `
							<div class='comment'>
								<div><b>${c.username}</b> <span class="comment-date" data-i18n-date="${c.created_at}" style="color:gray;font-size:0.9em">${new Date(c.created_at).toLocaleString(document.documentElement.lang || 'en-US', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
								<div>${c.content}</div>
							</div>
						`).join('') :
						'<em data-i18n="no_comments">No comments</em>';
					commentsListDiv.style.display = '';

					if (whoami && whoami.username) {
						commentFormDiv.innerHTML = `
							<form class="add-comment-form">
								<input type="text" name="content" placeholder="Your comment..." required style="width:70%" data-i18n-placeholder="comment_placeholder" />
								<button type="submit" data-i18n="send">Send</button>
							</form>
						`;
						const addForm = commentFormDiv.querySelector('.add-comment-form');
						addForm.onsubmit = async e => {
							e.preventDefault();
							const content = addForm.content.value.trim();
							if (!content) return;
							const res = await fetch(`/api/projects/${p.id}/comments`, {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ content })
							});
							if (res.ok) {
								addForm.reset();
								const resp2 = await fetch(`/api/projects/${p.id}/comments`);
								const comments2 = await resp2.json();
								commentsListDiv.innerHTML = comments2.length ?
									comments2.map(c => `
										<div class='comment'>
											<div><b>${c.username}</b> <span class="comment-date" data-i18n-date="${c.created_at}" style="color:gray;font-size:0.9em">${new Date(c.created_at).toLocaleString(document.documentElement.lang || 'en-US', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
											<div>${c.content}</div>
										</div>
									`).join('') :
									'<em data-i18n="no_comments">No comments</em>';
							} else {
								alert('Error while sending the comment');
							}
						};
					} else {
						commentFormDiv.innerHTML = '<em>Please log in to comment.</em>';
					}
					commentFormDiv.style.display = '';
					showCommentsBtn.textContent = 'Hide comments';
				} else {
					commentsListDiv.style.display = 'none';
					commentFormDiv.style.display = 'none';
					showCommentsBtn.textContent = 'Show comments';
				}
			};

			// Gestion des likes/dislikes (affichage simple, pas de compteur)
			/// TODO: likes
			/*
			if (whoami && whoami.username) {
				const likeBtn = el.querySelector('.like-btn');
				const dislikeBtn = el.querySelector('.dislike-btn');
				likeBtn.onclick = async () => {
					await fetch(`/api/projects/${p.id}/like`, { method: 'POST' });
					likeBtn.disabled = true;
					dislikeBtn.disabled = false;
				};
				dislikeBtn.onclick = async () => {
					await fetch(`/api/projects/${p.id}/dislike`, { method: 'POST' });
					dislikeBtn.disabled = true;
					likeBtn.disabled = false;
				};
			}*/

			projectsList.appendChild(el);
		});
	}

	loadProjects();
})();
