const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const https = require('https');
const http = require('http');
const fs = require('fs');



const app = express();




app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Simple session middleware (basic login memo)
app.use(session({
	secret: 'y2X3Wt!-T73n[y',
	resave: false,
	saveUninitialized: false,
}));

const db = new sqlite3.Database('./database.db');

// DB table initialization
const initSql = `
CREATE TABLE IF NOT EXISTS users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	username TEXT UNIQUE NOT NULL,
	email TEXT UNIQUE NOT NULL,
	password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	title TEXT NOT NULL,
	description TEXT NOT NULL,
	owner_id INTEGER,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	followers_count INTEGER DEFAULT 0,
	FOREIGN KEY(owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_likes (
	user_id INTEGER,
	project_id INTEGER,
	PRIMARY KEY(user_id, project_id),
	FOREIGN KEY(user_id) REFERENCES users(id),
	FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS project_members (
	user_id INTEGER,
	project_id INTEGER,
	PRIMARY KEY(user_id, project_id),
	FOREIGN KEY(user_id) REFERENCES users(id),
	FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS project_comments (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	content TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY(project_id) REFERENCES projects(id),
	FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER,
	username TEXT,
	content TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;
db.exec(initSql, err => {
	if (err) {
		console.error(err);
	}
});

// --- Helpers ---

function isAuthenticated(req, res, next) {
	if (req.session.user) return next();
	res.status(401).json({ error: 'Not logged in' });
}

// --- Auth Routes ---

app.post('/api/signup', (req, res) => {
	const { username, password, email } = req.body;
	if (!username || !password || !email) return res.status(400).json({ error: 'Username, email and password required' });

	bcrypt.hash(password, 10, (err, hash) => {
		if (err) return res.status(500).json({ error: 'Server error' });

		db.run('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email, hash], function(err) {
			if (err) {
				if (err.message.includes('UNIQUE')) {
					return res.status(400).json({ error: 'Username or email already taken' });
				}
				return res.status(500).json({ error: 'Server error' });
			}
			res.json({ success: true });
		});
	});
});

app.post('/api/login', (req, res) => {
	const { username, password } = req.body;
	if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

	db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
		if (err) return res.status(500).json({ error: 'Server error' });
		if (!user) return res.status(400).json({ error: 'User not found' });

		bcrypt.compare(password, user.password_hash, (err, valid) => {
			if (err) return res.status(500).json({ error: 'Server error' });
			if (!valid) return res.status(400).json({ error: 'Incorrect password' });

			req.session.user = { id: user.id, username: user.username };
			res.json({ success: true });
		});
	});
});

app.post('/api/logout', (req, res) => {
	req.session.destroy();
	res.json({ success: true });
});

app.get('/api/whoami', (req, res) => {
	if (req.session.user) res.json(req.session.user);
	else res.json(null);
});

// --- Project Routes ---

// Display projects (public)
app.get('/api/projects', (req, res) => {
	db.all('SELECT p.*, u.username as owner, p.followers_count FROM projects p LEFT JOIN users u ON p.owner_id = u.id', [], (err, rows) => {
		if (err) return res.status(500).json({ error: err.message });

		// Seed based on hour + day
		const now = new Date();
		const seed = now.getFullYear()*10000 + (now.getMonth()+1)*100 + now.getDate() + now.getHours();

		function seededShuffle(arr, seed) {
			let currentIndex = arr.length, randomIndex;
			let pseudo = seed;
			while (currentIndex != 0) {
				pseudo = (pseudo * 9301 + 49297) % 233280;
				let rand = pseudo / 233280;
				randomIndex = Math.floor(rand * currentIndex);
				currentIndex--;
				[arr[currentIndex], arr[randomIndex]] = [arr[randomIndex], arr[currentIndex]];
			}
			return arr;
		}

		const shuffled = seededShuffle(rows, seed);
		res.json(shuffled.slice(0, 10));
	});
});

app.post('/api/projects', isAuthenticated, (req, res) => {
	const { title, description } = req.body;
	if (!title || !description) return res.status(400).json({ error: 'Title and description required' });

	db.run('INSERT INTO projects (title, description, owner_id) VALUES (?, ?, ?)', [title, description, req.session.user.id], function(err) {
		if (err) return res.status(500).json({ error: err.message });
		res.json({ id: this.lastID });
	});
});

app.put('/api/projects/:id', isAuthenticated, (req, res) => {
	const id = req.params.id;
	const { title, description } = req.body;
	if (!title || !description) return res.status(400).json({ error: 'Title and description required' });

	// Check owner
	db.get('SELECT * FROM projects WHERE id = ?', [id], (err, project) => {
		if (err) return res.status(500).json({ error: err.message });
		if (!project) return res.status(404).json({ error: 'Project not found' });
		if (project.owner_id !== req.session.user.id) return res.status(403).json({ error: 'Unauthorized' });

		db.run('UPDATE projects SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [title, description, id], err2 => {
			if (err2) return res.status(500).json({ error: err2.message });
			res.json({ success: true });
		});
	});
});

app.post('/api/projects/:id/like', isAuthenticated, (req, res) => {
	const projectId = req.params.id;
	db.run('INSERT OR IGNORE INTO project_likes (user_id, project_id) VALUES (?, ?)', [req.session.user.id, projectId], err => {
		if (err) return res.status(500).json({ error: err.message });
		res.json({ success: true });
	});
});

app.post('/api/projects/:id/join', isAuthenticated, (req, res) => {
	const projectId = req.params.id;
	db.run('INSERT OR IGNORE INTO project_members (user_id, project_id) VALUES (?, ?)', [req.session.user.id, projectId], err => {
		if (err) return res.status(500).json({ error: err.message });
		res.json({ success: true });
	});
});

// Get project comments (public)
app.get('/api/projects/:id/comments', (req, res) => {
	const projectId = req.params.id;
	db.all(`SELECT pc.id, pc.content, pc.created_at, u.username FROM project_comments pc
			JOIN users u ON pc.user_id = u.id
			WHERE pc.project_id = ? ORDER BY pc.created_at ASC`, [projectId], (err, rows) => {
		if (err) return res.status(500).json({ error: err.message });
		res.json(rows);
	});
});

app.post('/api/projects/:id/comments', isAuthenticated, (req, res) => {
	const projectId = req.params.id;
	const { content } = req.body;
	if (!content) return res.status(400).json({ error: 'Content required' });

	db.run('INSERT INTO project_comments (project_id, user_id, content) VALUES (?, ?, ?)', [projectId, req.session.user.id, content], function(err) {
		if (err) return res.status(500).json({ error: err.message });
		res.json({ id: this.lastID });
	});
});

// Get user’s own projects
app.get('/api/my-projects', isAuthenticated, (req, res) => {
	db.all('SELECT p.* FROM projects p WHERE p.owner_id = ?', [req.session.user.id], (err, rows) => {
		if (err) return res.status(500).json({ error: err.message });
		res.json(rows);
	});
});

// --- Chat ---

app.get('/api/chat/messages', isAuthenticated, (req, res) => {
	db.all('SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 50', [], (err, rows) => {
		if (err) return res.status(500).json({ error: err.message });
		res.json(rows.reverse());
	});
});

app.post('/api/chat/messages', isAuthenticated, (req, res) => {
	const content = req.body.content;
	if (!content) return res.status(400).json({ error: 'Empty message' });

	db.run('INSERT INTO chat_messages (user_id, username, content) VALUES (?, ?, ?)', [req.session.user.id, req.session.user.username, content], function(err) {
		if (err) return res.status(500).json({ error: err.message });
		res.json({ id: this.lastID });
	});
});

// Redirects for /login and /signin without .html
app.get('/login', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/signin', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'signin.html'));
});
app.get('/myProjects', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'myProjects.html'));
});
app.get('/followedProjects', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'followedProjects.html'));
});

// --- Follow/Unfollow Projects ---

// Follow a project
app.post('/api/projects/:id/follow', isAuthenticated, (req, res) => {
    const projectId = req.params.id;
    db.run('INSERT OR IGNORE INTO project_likes (user_id, project_id) VALUES (?, ?)', [req.session.user.id, projectId], err => {
        if (err) return res.status(500).json({ error: err.message });
        // Incrémente followers_count
        db.run('UPDATE projects SET followers_count = followers_count + 1 WHERE id = ?', [projectId]);
        res.json({ success: true });
    });
});

// Unfollow a project
app.post('/api/projects/:id/unfollow', isAuthenticated, (req, res) => {
    const projectId = req.params.id;
    db.run('DELETE FROM project_likes WHERE user_id = ? AND project_id = ?', [req.session.user.id, projectId], err => {
        if (err) return res.status(500).json({ error: err.message });
        // Décrémente followers_count (mais jamais < 0)
        db.run('UPDATE projects SET followers_count = MAX(followers_count - 1, 0) WHERE id = ?', [projectId]);
        res.json({ success: true });
    });
});

// Get followed projects for current user
app.get('/api/followed-projects', isAuthenticated, (req, res) => {
    db.all(`SELECT p.* FROM projects p
            JOIN project_likes pl ON p.id = pl.project_id
            WHERE pl.user_id = ?`, [req.session.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get followers count and list for a project
app.get('/api/projects/:id/followers', isAuthenticated, (req, res) => {
    const projectId = req.params.id;
    db.all(`SELECT u.id, u.username FROM project_likes pl
            JOIN users u ON pl.user_id = u.id
            WHERE pl.project_id = ?`, [projectId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ count: rows.length, followers: rows });
    });
});

// Supprimer un projet et ses dépendances
app.delete('/api/projects/:id', isAuthenticated, (req, res) => {
    const id = req.params.id;
    // Vérifie que l'utilisateur est bien le propriétaire
    db.get('SELECT * FROM projects WHERE id = ?', [id], (err, project) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (project.owner_id !== req.session.user.id) return res.status(403).json({ error: 'Unauthorized' });
        // Supprime les commentaires, les likes, les membres, puis le projet
        db.run('DELETE FROM project_comments WHERE project_id = ?', [id], err1 => {
            if (err1) return res.status(500).json({ error: err1.message });
            db.run('DELETE FROM project_likes WHERE project_id = ?', [id], err2 => {
                if (err2) return res.status(500).json({ error: err2.message });
                db.run('DELETE FROM project_members WHERE project_id = ?', [id], err3 => {
                    if (err3) return res.status(500).json({ error: err3.message });
						db.run('DELETE FROM projects WHERE id = ?', [id], err4 => {
						if (err4) return res.status(500).json({ error: err4.message });
						res.json({ success: true });
					});
				});
			});
		});
	});
});






const credentials = {
	key: fs.readFileSync('/etc/letsencrypt/live/villager-studio.online/privkey.pem', 'utf8'),
	cert: fs.readFileSync('/etc/letsencrypt/live/villager-studio.online/cert.pem', 'utf8'),
	ca: fs.readFileSync('/etc/letsencrypt/live/villager-studio.online/chain.pem', 'utf8')
};

const httpsServ = https.createServer(credentials, app);
httpsServ.listen(443, () => {
	console.log('HTTPS server listening on https://villager-studio.online:443');
});


const httpServ = http.createServer(app);
httpServ.listen(80, () => {
	console.log('HTTP server listening on http://villager-studio.online:80');
});