'use strict';

const axios = require('axios');
const Plugin = {};

const SETTINGS_KEY = 'nodebb-plugin-google-chat-email';
const WEBHOOK_PREFIX = 'https://chat.googleapis.com/';
const VALID_SCOPES = ['admins', 'selected', 'all'];
const MAX_WEBHOOKS = 20;

Plugin.init = function (params, callback) {
	const router = params.router;
	const middleware = params.middleware;

	console.log('[nodebb-plugin-google-chat-email] Plugin.init called');

	// Admin page (browser) and admin API (ajax)
	router.get('/admin/plugins/google-chat-email', middleware.admin.buildHeader, renderAdmin);
	router.get('/api/admin/plugins/google-chat-email', renderAdmin);

	// Settings API routes
	router.get('/api/plugin/google-chat-email/ping', Plugin.ping);
	router.get('/api/plugin/google-chat-email/settings', Plugin.getSettings);
	router.post('/api/plugin/google-chat-email/settings', Plugin.postSettings);

	console.log('[nodebb-plugin-google-chat-email] Plugin.init completed successfully');
	callback();
};

Plugin.ping = function (req, res) {
	res.json({ ok: true, plugin: 'nodebb-plugin-google-chat-email' });
};

function parseUserList(str) {
	return String(str || '')
		.split(',')
		.map(function (n) { return n.trim().toLowerCase(); })
		.filter(Boolean);
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
			console.error('[nodebb-plugin-google-chat-email] Could not parse saved webhooks:', e.message);
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
		return {
			name: String((w && w.name) || '').trim().substring(0, 100),
			url: String((w && w.url) || '').trim(),
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
		console.error('[nodebb-plugin-google-chat-email] Error loading settings:', e.message);
		res.status(500).json({ error: 'Error loading settings' });
	}
};

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
				url: url,
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
		console.log('[nodebb-plugin-google-chat-email] Settings saved,', webhooks.length, 'webhook(s)');
		res.json({ success: true, count: webhooks.length });
	} catch (e) {
		console.error('[nodebb-plugin-google-chat-email] Error saving settings:', e.message);
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
		console.log('[nodebb-plugin-google-chat-email] Posted to "' + (hook.name || 'unnamed') + '", status:', response.status);
	} catch (e) {
		console.error('[nodebb-plugin-google-chat-email] Error posting to "' + (hook.name || 'unnamed') + '":', e.message);
		if (e.response) {
			console.error('[nodebb-plugin-google-chat-email] Response:', e.response.status, JSON.stringify(e.response.data));
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
		await Promise.all(settings.webhooks.map(async function (hook) {
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
		console.error('[nodebb-plugin-google-chat-email] Error in onPostSave:', e.message);
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
		await Promise.all(settings.webhooks.map(async function (hook) {
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
		console.error('[nodebb-plugin-google-chat-email] Error in onPostDelete:', e.message);
	}
};

Plugin.addAdminNavigation = function (header, callback) {
	header = header || {};
	header.plugins = header.plugins || [];
	header.plugins.push({
		route: '/plugins/google-chat-email',
		icon: 'fa-comments',
		name: 'Google Chat Email',
	});
	callback(null, header);
};

function renderAdmin(req, res) {
	res.render('admin/plugins/google-chat-email', {});
}

module.exports = Plugin;
