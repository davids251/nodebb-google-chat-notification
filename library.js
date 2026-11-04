'use strict';

const axios = require('axios');
const crypto = require('crypto');
const Plugin = {};

const SETTINGS_KEY = 'nodebb-plugin-google-chat-integration';
const WEBHOOK_PREFIX = 'https://chat.googleapis.com/';
const VALID_SCOPES = ['admins', 'selected', 'all'];
const MAX_WEBHOOKS = 20;

Plugin.init = function (params, callback) {
	const router = params.router;
	const middleware = params.middleware;

	console.log('[nodebb-plugin-google-chat-integration] Plugin.init called');

	// Admin page (browser) and admin API (ajax)
	router.get('/admin/plugins/google-chat-integration', middleware.admin.buildHeader, renderAdmin);
	router.get('/api/admin/plugins/google-chat-integration', renderAdmin);

	// Settings API routes
	router.get('/api/plugin/google-chat-integration/ping', Plugin.ping);
	router.get('/api/plugin/google-chat-integration/settings', Plugin.getSettings);
	router.post('/api/plugin/google-chat-integration/settings', Plugin.postSettings);
	router.get('/api/plugin/google-chat-integration/choices', Plugin.getChoices);
	router.get('/api/plugin/google-chat-integration/topic-chats', Plugin.getTopicChats);
	router.get('/api/plugin/google-chat-integration/topic-chat', Plugin.getTopicChat);
	router.post('/api/plugin/google-chat-integration/topic-chat', Plugin.setTopicChat);

	console.log('[nodebb-plugin-google-chat-integration] Plugin.init completed successfully');
	callback();
};

Plugin.ping = function (req, res) {
	res.json({ ok: true, plugin: 'nodebb-plugin-google-chat-integration' });
};

function parseUserList(str) {
	return String(str || '')
		.split(',')
		.map(function (n) { return n.trim().toLowerCase(); })
		.filter(Boolean);
}

function hookId(url) {
return crypto.createHash('sha1').update(String(url || '')).digest('hex').substring(0, 10);
}

// Optional encryption of webhook URLs at rest (AES-256-GCM).
// Enabled when the GCHAT_SECRET environment variable is set.
const ENC_PREFIX = 'enc:v1:';
let warnedNoKey = false;

function getKey() {
	const secret = process.env.GCHAT_SECRET;
	if (!secret) {
		return null;
	}
	return crypto.createHash('sha256').update(secret).digest();
}

function encryptUrl(url) {
	const key = getKey();
	if (!key) {
		if (!warnedNoKey) {
			warnedNoKey = true;
			console.warn('[nodebb-plugin-google-chat-integration] GCHAT_SECRET is not set; webhook URLs are stored in plain text.');
		}
		return url;
	}
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const enc = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
	return ENC_PREFIX + [iv, cipher.getAuthTag(), enc].map(function (b) { return b.toString('base64'); }).join(':');
}

// Plain (legacy) values pass through unchanged; undecryptable values become ''.
function decryptUrl(value) {
	const str = String(value || '');
	if (!str.startsWith(ENC_PREFIX)) {
		return str;
	}
	const key = getKey();
	if (!key) {
		console.error('[nodebb-plugin-google-chat-integration] Webhook is encrypted but GCHAT_SECRET is not set.');
		return '';
	}
	try {
		const parts = str.substring(ENC_PREFIX.length).split(':').map(function (s) { return Buffer.from(s, 'base64'); });
		const decipher = crypto.createDecipheriv('aes-256-gcm', key, parts[0]);
		decipher.setAuthTag(parts[1]);
		return Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString('utf8');
	} catch (e) {
		console.error('[nodebb-plugin-google-chat-integration] Could not decrypt a webhook (wrong GCHAT_SECRET?):', e.message);
		return '';
	}
}

function toBool(v) {
	return v === true || v === 'true';
}

function cleanScope(scope) {
	return VALID_SCOPES.includes(scope) ? scope : 'admins';
}

// Reads saved settings and returns { enabled, webhooks: [...] }.
// Migrates the older single-webhook format on the fly.
async function loadSettings() {
	const meta = require.main.require('./src/meta');
	const raw = (await meta.settings.get(SETTINGS_KEY)) || {};

	let webhooks = [];
	if (raw.webhooks) {
		try {
			const parsed = typeof raw.webhooks === 'string' ? JSON.parse(raw.webhooks) : raw.webhooks;
			if (Array.isArray(parsed)) {
				webhooks = parsed;
			}
		} catch (e) {
			console.error('[nodebb-plugin-google-chat-integration] Could not parse saved webhooks:', e.message);
		}
	} else if (raw.webhookUrl) {
		webhooks = [{
			name: raw.chatName || '',
			url: raw.webhookUrl,
			scope: cleanScope(raw.notifyScope),
			users: raw.notifyUsers || '',
		}];
	}

	webhooks = webhooks.map(function (w) {
		const url = decryptUrl(w && w.url).trim();
		return {
			id: hookId(url),
			name: String((w && w.name) || '').trim().substring(0, 100),
			url: url,
			scope: cleanScope(w && w.scope),
			users: String((w && w.users) || '').substring(0, 2000),
		};
	});

	return { enabled: toBool(raw.notifyOnAdminPost), webhooks: webhooks };
}

async function isAdminRequest(req) {
	const user = require.main.require('./src/user');
	return !!req.uid && !!(await user.isAdministrator(req.uid));
}

Plugin.getSettings = async function (req, res) {
	try {
		if (!(await isAdminRequest(req))) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const settings = await loadSettings();
		res.json({ notifyOnAdminPost: settings.enabled, webhooks: settings.webhooks });
	} catch (e) {
		console.error('[nodebb-plugin-google-chat-integration] Error loading settings:', e.message);
		res.status(500).json({ error: 'Error loading settings' });
	}
};

// Names only (never URLs) so the composer can offer a choice.
Plugin.getChoices = async function (req, res) {
try {
if (!req.uid) {
return res.status(403).json({ error: 'Forbidden' });
}
const settings = await loadSettings();
res.json({
enabled: settings.enabled,
webhooks: settings.webhooks.map(function (w, i) {
return { id: w.id, name: w.name || 'Webhook ' + (i + 1) };
}),
});
} catch (e) {
res.status(500).json({ error: 'Error loading choices' });
}
};

// Maps tid -> chat name for topics tied to a webhook.
// Admins see all; other users only see topics they started.
Plugin.getTopicChats = async function (req, res) {
	try {
		if (!req.uid) {
			return res.json({});
		}
		const isAdmin = await isAdminRequest(req);
		const tids = String(req.query.tids || '').split(',')
			.map(function (t) { return parseInt(t, 10); })
			.filter(function (t) { return t > 0; })
			.slice(0, 200);
		if (!tids.length) {
			return res.json({});
		}
		const topics = require.main.require('./src/topics');
		const settings = await loadSettings();
		const fields = await topics.getTopicsFields(tids, ['tid', 'uid', 'gchatWebhook']);
		const out = {};
		fields.forEach(function (f, i) {
			if (!f || !f.gchatWebhook) {
				return;
			}
			if (!isAdmin && parseInt(f.uid, 10) !== parseInt(req.uid, 10)) {
				return;
			}
			const idx = settings.webhooks.findIndex(function (w) { return w.id === f.gchatWebhook; });
			out[tids[i]] = idx === -1 ? '(removed webhook)' : (settings.webhooks[idx].name || 'Webhook ' + (idx + 1));
		});
		res.json(out);
	} catch (e) {
		res.json({});
	}
};

async function canChangeTopicChat(req, tid) {
	const topics = require.main.require('./src/topics');
	if (!req.uid || !tid) {
		return false;
	}
	const ownerUid = await topics.getTopicField(tid, 'uid');
	return parseInt(ownerUid, 10) === parseInt(req.uid, 10) || await isAdminRequest(req);
}

// Current webhook for a topic + whether the caller may change it.
Plugin.getTopicChat = async function (req, res) {
	try {
		const tid = parseInt(req.query.tid, 10);
		if (!(await canChangeTopicChat(req, tid))) {
			return res.json({ canChange: false });
		}
		const topics = require.main.require('./src/topics');
		const settings = await loadSettings();
		res.json({
			canChange: settings.enabled,
			current: (await topics.getTopicField(tid, 'gchatWebhook')) || '',
			webhooks: settings.webhooks.map(function (w, i) {
				return { id: w.id, name: w.name || 'Webhook ' + (i + 1) };
			}),
		});
	} catch (e) {
		res.json({ canChange: false });
	}
};

// Topic starter (or an admin) changes the topic's webhook; '' means none.
Plugin.setTopicChat = async function (req, res) {
	try {
		const body = req.body || {};
		const tid = parseInt(body.tid, 10);
		if (!(await canChangeTopicChat(req, tid))) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const id = String(body.webhook || '');
		if (id) {
			const settings = await loadSettings();
			if (!settings.webhooks.some(function (w) { return w.id === id; })) {
				return res.status(400).json({ error: 'Unknown webhook' });
			}
		}
		const topics = require.main.require('./src/topics');
		await topics.setTopicField(tid, 'gchatWebhook', id);
		res.json({ success: true });
	} catch (e) {
		console.error('[nodebb-plugin-google-chat-integration] Error changing topic webhook:', e.message);
		res.status(500).json({ error: 'Error saving' });
	}
};

// Store the chosen webhook id on the new topic.
// Only runs when a topic is created, so the choice is locked afterwards:
// replies and edits never touch this field.
Plugin.onTopicCreate = async function (result) {
	const id = result && result.data && result.data.gchatWebhook;
	if (result && result.topic && id) {
		const settings = await loadSettings();
		const valid = settings.webhooks.some(function (w) { return w.id === String(id); });
		if (valid) {
			result.topic.gchatWebhook = String(id);
		}
	}
	return result;
};

// Webhooks that should receive events for a topic.
async function hooksForTopic(settings, tid) {
if (tid) {
const topics = require.main.require('./src/topics');
const chosen = await topics.getTopicField(tid, 'gchatWebhook');
if (chosen) {
return settings.webhooks.filter(function (w) { return w.id === chosen; }).map(function (w) {
return Object.assign({}, w, { scope: 'all' });
});
}
}
// No webhook chosen for this topic: send nothing
return [];
}

Plugin.postSettings = async function (req, res) {
	try {
		if (!(await isAdminRequest(req))) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const meta = require.main.require('./src/meta');
		const body = req.body || {};

		const incoming = Array.isArray(body.webhooks) ? body.webhooks.slice(0, MAX_WEBHOOKS) : [];
		const webhooks = [];
		for (let i = 0; i < incoming.length; i++) {
			const w = incoming[i] || {};
			const url = String(w.url || '').trim();
			if (!url) {
				continue;
			}
			if (!url.startsWith(WEBHOOK_PREFIX)) {
				return res.status(400).json({ error: 'Webhook #' + (i + 1) + ' is not a Google Chat webhook URL' });
			}
			webhooks.push({
				name: String(w.name || '').trim().substring(0, 100),
				url: encryptUrl(url),
				scope: cleanScope(w.scope),
				users: String(w.users || '').substring(0, 2000),
			});
		}

		await meta.settings.set(SETTINGS_KEY, {
			notifyOnAdminPost: !!body.notifyOnAdminPost,
			webhooks: JSON.stringify(webhooks),
			// clear leftovers from earlier versions
			webhookUrl: '',
			chatName: '',
			notifyScope: '',
			notifyUsers: '',
			apiKey: '',
			spaceId: '',
			notifyEmail: '',
		});
		console.log('[nodebb-plugin-google-chat-integration] Settings saved,', webhooks.length, 'webhook(s)');
		res.json({ success: true, count: webhooks.length });
	} catch (e) {
		console.error('[nodebb-plugin-google-chat-integration] Error saving settings:', e.message);
		res.status(500).json({ error: 'Error saving settings' });
	}
};

// Returns { tracked, isAdmin, name } for a uid under one webhook's scope.
async function getTracking(uid, hook, cache) {
	const user = require.main.require('./src/user');
	if (!uid) {
		return { tracked: false, isAdmin: false, name: 'Unknown' };
	}
	if (!cache[uid]) {
		cache[uid] = {
			isAdmin: await user.isAdministrator(uid),
			name: await user.getUserField(uid, 'username'),
		};
	}
	const info = cache[uid];
	let tracked = info.isAdmin || hook.scope === 'all';
	if (!tracked && hook.scope === 'selected') {
		tracked = parseUserList(hook.users).includes(String(info.name).toLowerCase());
	}
	return { tracked: tracked, isAdmin: info.isAdmin, name: info.name };
}

function chatTag(hook) {
	return hook.name ? '[' + hook.name + '] ' : '';
}

async function sendToWebhook(hook, text) {
	try {
		const response = await axios.post(hook.url, { text: text }, {
			headers: { 'Content-Type': 'application/json; charset=UTF-8' },
			timeout: 10000,
		});
		console.log('[nodebb-plugin-google-chat-integration] Posted to "' + (hook.name || 'unnamed') + '", status:', response.status);
	} catch (e) {
		console.error('[nodebb-plugin-google-chat-integration] Error posting to "' + (hook.name || 'unnamed') + '":', e.message);
		if (e.response) {
			console.error('[nodebb-plugin-google-chat-integration] Response:', e.response.status, JSON.stringify(e.response.data));
		}
	}
}

Plugin.onPostSave = async function (data) {
	try {
		const topics = require.main.require('./src/topics');
		const nconf = require.main.require('nconf');

		const settings = await loadSettings();
		if (!settings.enabled || !settings.webhooks.length) {
			return;
		}

		const post = (data && data.post) || data || {};
		const uid = parseInt(post.uid, 10);
		const title = post.tid ? await topics.getTopicField(post.tid, 'title') : '';
		const link = post.pid ? nconf.get('url') + '/post/' + post.pid : nconf.get('url');

		const cache = {};
		await Promise.all((await hooksForTopic(settings, post.tid)).map(async function (hook) {
			if (!hook.url) {
				return;
			}
			const who = await getTracking(uid, hook, cache);
			if (!who.tracked) {
				return;
			}
			const text = chatTag(hook) + '*' + (who.isAdmin ? 'Admin ' : '') + who.name + ' posted*' +
				(title ? ' in "' + title + '"' : '') + '\n' + link;
			await sendToWebhook(hook, text);
		}));
	} catch (e) {
		console.error('[nodebb-plugin-google-chat-integration] Error in onPostSave:', e.message);
	}
};

Plugin.onPostDelete = async function (data) {
	try {
		const topics = require.main.require('./src/topics');
		const nconf = require.main.require('nconf');

		const settings = await loadSettings();
		if (!settings.enabled || !settings.webhooks.length) {
			return;
		}

		const post = (data && data.post) || {};
		const deleterUid = parseInt(data && data.uid, 10);
		const authorUid = parseInt(post.uid, 10);
		const title = post.tid ? await topics.getTopicField(post.tid, 'title') : '';
		const link = post.pid ? nconf.get('url') + '/post/' + post.pid : nconf.get('url');

		const cache = {};
		await Promise.all((await hooksForTopic(settings, post.tid)).map(async function (hook) {
			if (!hook.url) {
				return;
			}
			const deleterInfo = await getTracking(deleterUid, hook, cache);
			const authorInfo = await getTracking(authorUid, hook, cache);
			if (!deleterInfo.tracked && !authorInfo.tracked) {
				return;
			}
			const deleter = deleterInfo.isAdmin ? 'Admin ' + deleterInfo.name : deleterInfo.name;
			const author = authorInfo.isAdmin ? 'admin ' + authorInfo.name : authorInfo.name;
			const text = chatTag(hook) + '*' + deleter + ' deleted a post* by ' + author +
				(title ? ' in "' + title + '"' : '') + '\n' + link;
			await sendToWebhook(hook, text);
		}));
	} catch (e) {
		console.error('[nodebb-plugin-google-chat-integration] Error in onPostDelete:', e.message);
	}
};

Plugin.addAdminNavigation = function (header, callback) {
	header = header || {};
	header.plugins = header.plugins || [];
	header.plugins.push({
		route: '/plugins/google-chat-integration',
		icon: 'fa-comments',
		name: 'Google Chat Integration',
	});
	callback(null, header);
};

function renderAdmin(req, res) {
	res.render('admin/plugins/google-chat-integration', {});
}

module.exports = Plugin;
