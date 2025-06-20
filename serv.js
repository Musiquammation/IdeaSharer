const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const app = express();
const publicPath = path.join(__dirname, 'public');

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
	secret: 'y2X3Wt!-T73n[y',
	resave: false,
	saveUninitialized: false,
}));


app.get('/login', (req, res) => {
  res.sendFile(path.join(publicPath, 'login.html'));
});

app.get('/signin', (req, res) => {
  res.sendFile(path.join(publicPath, 'signin.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.get('/index', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.get('/followedProjects', (req, res) => {
  res.sendFile(path.join(publicPath, 'followedProjects.html'));
});

app.get('/myProjects', (req, res) => {
  res.sendFile(path.join(publicPath, 'myProjects.html'));
});


// Connexion PostgreSQL
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: { rejectUnauthorized: false },
});

// Initialisation base (tables)
async function initDb() {
	const client = await pool.connect();
	try {
		await client.query(`
			CREATE TABLE IF NOT EXISTS users (
				id SERIAL PRIMARY KEY,
				username TEXT UNIQUE NOT NULL,
				email TEXT UNIQUE NOT NULL,
				password_hash TEXT NOT NULL
			);
		`);
		await client.query(`
			CREATE TABLE IF NOT EXISTS projects (
				id SERIAL PRIMARY KEY,
				title TEXT NOT NULL,
				description TEXT NOT NULL,
				owner_id INTEGER REFERENCES users(id),
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				followers_count INTEGER DEFAULT 0
			);
		`);
		await client.query(`
			CREATE TABLE IF NOT EXISTS project_likes (
				user_id INTEGER REFERENCES users(id),
				project_id INTEGER REFERENCES projects(id),
				PRIMARY KEY(user_id, project_id)
			);
		`);
		await client.query(`
			CREATE TABLE IF NOT EXISTS project_members (
				user_id INTEGER REFERENCES users(id),
				project_id INTEGER REFERENCES projects(id),
				PRIMARY KEY(user_id, project_id)
			);
		`);
		await client.query(`
			CREATE TABLE IF NOT EXISTS project_comments (
				id SERIAL PRIMARY KEY,
				project_id INTEGER REFERENCES projects(id) NOT NULL,
				user_id INTEGER REFERENCES users(id) NOT NULL,
				content TEXT NOT NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);
		`);
		await client.query(`
			CREATE TABLE IF NOT EXISTS chat_messages (
				id SERIAL PRIMARY KEY,
				user_id INTEGER,
				username TEXT,
				content TEXT NOT NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);
		`);
		console.log('Tables PostgreSQL prêtes');
	} finally {
		client.release();
	}
}
initDb().catch(console.error);

// Middleware d'authentification
function isAuthenticated(req, res, next) {
	if (req.session.user) return next();
	res.status(401).json({ error: 'Not logged in' });
}

// Signup
app.post('/api/signup', async (req, res) => {
	const { username, email, password } = req.body;
	if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' });

	try {
		const hash = await bcrypt.hash(password, 10);
		const result = await pool.query(
			'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
			[username, email, hash]
		);
		res.json({ success: true, id: result.rows[0].id });
	} catch (err) {
		if (err.code === '23505') { // violation UNIQUE
			return res.status(400).json({ error: 'Username or email already taken' });
		}
		console.error(err);
		res.status(500).json({ error: 'Server error' });
	}
});

// Login
app.post('/api/login', async (req, res) => {
	const { username, password } = req.body;
	if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

	try {
		const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
		const user = result.rows[0];
		if (!user) return res.status(400).json({ error: 'User not found' });

		const valid = await bcrypt.compare(password, user.password_hash);
		if (!valid) return res.status(400).json({ error: 'Incorrect password' });

		req.session.user = { id: user.id, username: user.username };
		res.json({ success: true });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Server error' });
	}
});

// Logout
app.post('/api/logout', (req, res) => {
	req.session.destroy(() => res.json({ success: true }));
});

// Get current user
app.get('/api/whoami', (req, res) => {
	if (req.session.user) res.json(req.session.user);
	else res.status(401).json({ error: 'Not logged in' });
});

// Get projects (exemple avec shuffle simple)
function seededShuffle(array, seed = 42) {
	let m = array.length, t, i;
	while (m) {
		i = Math.floor((Math.sin(seed++) * 10000) % m);
		if (i < 0) i += m;
		m--;
		t = array[m];
		array[m] = array[i];
		array[i] = t;
	}
	return array;
}

app.get('/api/projects', async (req, res) => {
	try {
		const result = await pool.query(`
			SELECT p.*, u.username as owner
			FROM projects p LEFT JOIN users u ON p.owner_id = u.id
		`);
		let rows = result.rows;
		rows = seededShuffle(rows);
		res.json(rows.slice(0, 20));
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Server error' });
	}
});

// Get single project details with comments and likes count
app.get('/api/projects/:id', async (req, res) => {
	const id = parseInt(req.params.id);
	if (isNaN(id)) return res.status(400).json({ error: 'Invalid project ID' });

	try {
		const projectRes = await pool.query(
			`SELECT p.*, u.username as owner FROM projects p LEFT JOIN users u ON p.owner_id = u.id WHERE p.id = $1`,
			[id]
		);
		if (projectRes.rows.length === 0) return res.status(404).json({ error: 'Project not found' });

		const project = projectRes.rows[0];

		const commentsRes = await pool.query(
			`SELECT c.*, u.username FROM project_comments c LEFT JOIN users u ON c.user_id = u.id WHERE c.project_id = $1 ORDER BY c.created_at DESC`,
			[id]
		);

		const likesCountRes = await pool.query(
			`SELECT COUNT(*) FROM project_likes WHERE project_id = $1`,
			[id]
		);

		res.json({
			project,
			comments: commentsRes.rows,
			likesCount: parseInt(likesCountRes.rows[0].count, 10)
		});
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Server error' });
	}
});

// Create new project
app.post('/api/projects', isAuthenticated, async (req, res) => {
	const { title, description } = req.body;
	if (!title || !description) return res.status(400).json({ error: 'Missing fields' });

	try {
		const result = await pool.query(
			`INSERT INTO projects (title, description, owner_id) VALUES ($1, $2, $3) RETURNING id`,
			[title, description, req.session.user.id]
		);
		res.json({ success: true, id: result.rows[0].id });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Server error' });
	}
});

// Like / unlike a project
app.post('/api/projects/:id/like', isAuthenticated, async (req, res) => {
	const projectId = parseInt(req.params.id);
	if (isNaN(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

	const userId = req.session.user.id;
	try {
		const existsRes = await pool.query(
			`SELECT * FROM project_likes WHERE user_id = $1 AND project_id = $2`,
			[userId, projectId]
		);
		if (existsRes.rows.length === 0) {
			// Like
			await pool.query(
				`INSERT INTO project_likes (user_id, project_id) VALUES ($1, $2)`,
				[userId, projectId]
			);
			await pool.query(
				`UPDATE projects SET followers_count = followers_count + 1 WHERE id = $1`,
				[projectId]
			);
			res.json({ liked: true });
		} else {
			// Unlike
			await pool.query(
				`DELETE FROM project_likes WHERE user_id = $1 AND project_id = $2`,
				[userId, projectId]
			);
			await pool.query(
				`UPDATE projects SET followers_count = followers_count - 1 WHERE id = $1 AND followers_count > 0`,
				[projectId]
			);
			res.json({ liked: false });
		}
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Server error' });
	}
});

// Mes projets de l'utilisateur connecté
app.get('/api/my-projects', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.username as owner FROM projects p LEFT JOIN users u ON p.owner_id = u.id WHERE p.owner_id = $1`,
      [req.session.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Supprimer un projet (seulement par le propriétaire)
app.delete('/api/projects/:id', isAuthenticated, async (req, res) => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) return res.status(400).json({ error: 'Invalid project ID' });
  try {
    // Vérifier que l'utilisateur est bien le propriétaire
    const result = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Project not found' });
    if (result.rows[0].owner_id !== req.session.user.id) return res.status(403).json({ error: 'Forbidden' });
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Liste des followers d'un projet
app.get('/api/projects/:id/followers', async (req, res) => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) return res.status(400).json({ error: 'Invalid project ID' });
  try {
    const result = await pool.query(
      `SELECT u.id, u.username FROM project_likes pl JOIN users u ON pl.user_id = u.id WHERE pl.project_id = $1`,
      [projectId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Liste des commentaires d'un projet
app.get('/api/projects/:id/comments', async (req, res) => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) return res.status(400).json({ error: 'Invalid project ID' });
  try {
    const result = await pool.query(
      `SELECT c.*, u.username FROM project_comments c LEFT JOIN users u ON c.user_id = u.id WHERE c.project_id = $1 ORDER BY c.created_at DESC`,
      [projectId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Ajouter un commentaire à un projet (POST)
app.post('/api/projects/:id/comments', isAuthenticated, async (req, res) => {
  const projectId = parseInt(req.params.id);
  const { content } = req.body;
  if (isNaN(projectId) || !content) return res.status(400).json({ error: 'Invalid input' });
  try {
    await pool.query(
      `INSERT INTO project_comments (project_id, user_id, content) VALUES ($1, $2, $3)`,
      [projectId, req.session.user.id, content]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Modifier le nom et la description d'un projet (seulement par le propriétaire)
app.put('/api/projects/:id', isAuthenticated, async (req, res) => {
  const projectId = parseInt(req.params.id);
  const { title, description } = req.body;

  if (isNaN(projectId)) return res.status(400).json({ error: 'Invalid project ID' });
  if (!title || !description) return res.status(400).json({ error: 'Missing fields' });

  try {
    // Vérifier que l'utilisateur est bien le propriétaire
    const result = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Project not found' });
    if (result.rows[0].owner_id !== req.session.user.id) return res.status(403).json({ error: 'Forbidden' });

    // Mettre à jour le projet
    await pool.query(
      `UPDATE projects 
       SET title = $1, description = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3`,
      [title, description, projectId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});


// Projets suivis par l'utilisateur
app.get('/api/followed-projects', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.username as owner FROM project_likes pl JOIN projects p ON pl.project_id = p.id LEFT JOIN users u ON p.owner_id = u.id WHERE pl.user_id = $1`,
      [req.session.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Dislike (retirer le like) d'un projet
app.post('/api/projects/:id/dislike', isAuthenticated, async (req, res) => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) return res.status(400).json({ error: 'Invalid project ID' });
  const userId = req.session.user.id;
  try {
    const existsRes = await pool.query(
      `SELECT * FROM project_likes WHERE user_id = $1 AND project_id = $2`,
      [userId, projectId]
    );
    if (existsRes.rows.length === 0) {
      return res.json({ disliked: false });
    } else {
      await pool.query(
        `DELETE FROM project_likes WHERE user_id = $1 AND project_id = $2`,
        [userId, projectId]
      );
      await pool.query(
        `UPDATE projects SET followers_count = followers_count - 1 WHERE id = $1 AND followers_count > 0`,
        [projectId]
      );
      res.json({ disliked: true });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Chat messages - get last 20
app.get('/api/chat', async (req, res) => {
	try {
		const result = await pool.query(`SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 20`);
		res.json(result.rows.reverse());
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Server error' });
	}
});

// Post chat message
app.post('/api/chat', isAuthenticated, async (req, res) => {
	const { content } = req.body;
	if (!content) return res.status(400).json({ error: 'No message' });

	try {
		await pool.query(
			`INSERT INTO chat_messages (user_id, username, content) VALUES ($1, $2, $3)`,
			[req.session.user.id, req.session.user.username, content]
		);
		res.json({ success: true });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Server error' });
	}
});

// Suivre un projet (ajoute un like si non déjà présent)
app.post('/api/projects/:id/follow', isAuthenticated, async (req, res) => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) return res.status(400).json({ error: 'Invalid project ID' });
  const userId = req.session.user.id;
  try {
    const existsRes = await pool.query(
      `SELECT * FROM project_likes WHERE user_id = $1 AND project_id = $2`,
      [userId, projectId]
    );
    if (existsRes.rows.length === 0) {
      await pool.query(
        `INSERT INTO project_likes (user_id, project_id) VALUES ($1, $2)`,
        [userId, projectId]
      );
      await pool.query(
        `UPDATE projects SET followers_count = followers_count + 1 WHERE id = $1`,
        [projectId]
      );
      res.json({ followed: true });
    } else {
      res.json({ followed: false, message: 'Already following' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});




// Écoute sur le port défini par Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server listening on port ${PORT}`);
});



