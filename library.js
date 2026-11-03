'use strict';

const axios = require('axios');
const Plugin = {};

Plugin.init = function(params, callback) {
    const router = params.router;
    const middleware = params.middleware;
    const hooks = params.middleware.hookSystem;

    console.log('[nodebb-plugin-google-chat-email] Plugin.init called');

    // Admin page (browser)
    router.get('/admin/plugins/google-chat-email', middleware.admin.buildHeader, renderAdmin);
    // Admin API (ajax)
    router.get('/api/admin/plugins/google-chat-email', renderAdmin);
    
    // Settings API routes
    router.get('/api/plugin/google-chat-email/ping', Plugin.ping);
    router.get('/api/plugin/google-chat-email/settings', Plugin.getSettings);
    router.post('/api/plugin/google-chat-email/settings', Plugin.postSettings);

    // Hook on post save - send notification to Google Chat if admin posts
    // This is now handled by plugin.json hooks
    console.log('[nodebb-plugin-google-chat-email] Plugin.init completed successfully');

    callback();
};

Plugin.ping = function(req, res) {
    res.json({ ok: true, plugin: 'nodebb-plugin-google-chat-email' });
};

const SETTINGS_KEY = 'nodebb-plugin-google-chat-email';
const WEBHOOK_PREFIX = 'https://chat.googleapis.com/';
const VALID_SCOPES = ['admins', 'selected', 'all'];

function parseUserList(str) {
    return String(str || '')
        .split(',')
        .map(function (n) { return n.trim().toLowerCase(); })
        .filter(Boolean);
}

// Returns { tracked, isAdmin, name } for a uid based on the saved scope setting
async function getTracking(uid, settings) {
    const user = require.main.require('./src/user');
    if (!uid) {
        return { tracked: false, isAdmin: false, name: 'Unknown' };
    }
    const isAdmin = await user.isAdministrator(uid);
    const name = await user.getUserField(uid, 'username');
    const scope = VALID_SCOPES.includes(settings.notifyScope) ? settings.notifyScope : 'admins';
    let tracked = isAdmin || scope === 'all';
    if (!tracked && scope === 'selected') {
        tracked = parseUserList(settings.notifyUsers).includes(String(name).toLowerCase());
    }
    return { tracked: tracked, isAdmin: isAdmin, name: name };
}

Plugin.getSettings = async function(req, res) {
    try {
        const user = require.main.require('./src/user');
        const meta = require.main.require('./src/meta');
        if (!req.uid || !(await user.isAdministrator(req.uid))) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const settings = (await meta.settings.get(SETTINGS_KEY)) || {};
        res.json({
            webhookUrl: settings.webhookUrl || '',
            notifyScope: VALID_SCOPES.includes(settings.notifyScope) ? settings.notifyScope : 'admins',
            notifyUsers: settings.notifyUsers || '',
            notifyOnAdminPost: settings.notifyOnAdminPost === true || settings.notifyOnAdminPost === 'true'
        });
    } catch (e) {
        console.error('[nodebb-plugin-google-chat-email] Error loading settings:', e.message);
        res.status(500).json({ error: 'Error loading settings' });
    }
};

Plugin.postSettings = async function(req, res) {
    try {
        const user = require.main.require('./src/user');
        const meta = require.main.require('./src/meta');
        if (!req.uid || !(await user.isAdministrator(req.uid))) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const webhookUrl = ((req.body && req.body.webhookUrl) || '').trim();
        if (webhookUrl && !webhookUrl.startsWith(WEBHOOK_PREFIX)) {
            return res.status(400).json({ error: 'Invalid Google Chat webhook URL' });
        }
        await meta.settings.set(SETTINGS_KEY, {
            webhookUrl: webhookUrl,
            notifyScope: VALID_SCOPES.includes(req.body && req.body.notifyScope) ? req.body.notifyScope : 'admins',
            notifyUsers: String((req.body && req.body.notifyUsers) || '').substring(0, 2000),
            notifyOnAdminPost: !!(req.body && req.body.notifyOnAdminPost),
            // clear leftovers from earlier approaches
            apiKey: '',
            spaceId: '',
            notifyEmail: ''
        });
        console.log('[nodebb-plugin-google-chat-email] Settings saved');
        res.json({ success: true });
    } catch (e) {
        console.error('[nodebb-plugin-google-chat-email] Error saving settings:', e.message);
        res.status(500).json({ error: 'Error saving settings' });
    }
};

Plugin.onPostSave = async function(data) {
    try {
        const meta = require.main.require('./src/meta');
        const user = require.main.require('./src/user');
        const posts = require.main.require('./src/posts');
        const topics = require.main.require('./src/topics');
        const nconf = require.main.require('nconf');

        const settings = (await meta.settings.get(SETTINGS_KEY)) || {};
        const enabled = settings.notifyOnAdminPost === true || settings.notifyOnAdminPost === 'true';
        if (!enabled || !settings.webhookUrl) {
            return;
        }

        const post = (data && data.post) || data || {};
        const uid = parseInt(post.uid, 10);
        const who = await getTracking(uid, settings);
        if (!who.tracked) {
            return;
        }

        const username = who.name;
        const content = post.content || (post.pid ? await posts.getPostField(post.pid, 'content') : '') || '';
        const title = post.tid ? await topics.getTopicField(post.tid, 'title') : '';
        const link = post.pid ? `${nconf.get('url')}/post/${post.pid}` : nconf.get('url');
        const snippet = content.length > 200 ? content.substring(0, 200) + '...' : content;

        const text = `*${who.isAdmin ? 'Admin ' : ''}${username} posted*${title ? ` in "${title}"` : ''}\n${snippet}\n${link}`;

        const response = await axios.post(settings.webhookUrl, { text: text }, {
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            timeout: 10000
        });
        console.log('[nodebb-plugin-google-chat-email] Posted to Google Chat, status:', response.status);
    } catch (e) {
        console.error('[nodebb-plugin-google-chat-email] Error posting to Google Chat:', e.message);
        if (e.response) {
            console.error('[nodebb-plugin-google-chat-email] Response:', e.response.status, JSON.stringify(e.response.data));
        }
    }
};

Plugin.onPostDelete = async function(data) {
    try {
        const meta = require.main.require('./src/meta');
        const user = require.main.require('./src/user');
        const topics = require.main.require('./src/topics');
        const nconf = require.main.require('nconf');

        const settings = (await meta.settings.get(SETTINGS_KEY)) || {};
        const enabled = settings.notifyOnAdminPost === true || settings.notifyOnAdminPost === 'true';
        if (!enabled || !settings.webhookUrl) {
            return;
        }

        const post = (data && data.post) || {};
        const deleterUid = parseInt(data && data.uid, 10);
        const authorUid = parseInt(post.uid, 10);

        const deleterInfo = await getTracking(deleterUid, settings);
        const authorInfo = await getTracking(authorUid, settings);
        if (!deleterInfo.tracked && !authorInfo.tracked) {
            return;
        }

        const deleter = deleterInfo.isAdmin ? `Admin ${deleterInfo.name}` : deleterInfo.name;
        const author = authorInfo.isAdmin ? `admin ${authorInfo.name}` : authorInfo.name;
        const title = post.tid ? await topics.getTopicField(post.tid, 'title') : '';
        const content = post.content || '';
        const snippet = content.length > 200 ? content.substring(0, 200) + '...' : content;
        const link = post.pid ? `${nconf.get('url')}/post/${post.pid}` : nconf.get('url');

        const text = `*${deleter} deleted a post* by ${author}${title ? ` in "${title}"` : ''}\n${snippet}\n${link}`;

        const response = await axios.post(settings.webhookUrl, { text: text }, {
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            timeout: 10000
        });
        console.log('[nodebb-plugin-google-chat-email] Posted delete notice to Google Chat, status:', response.status);
    } catch (e) {
        console.error('[nodebb-plugin-google-chat-email] Error posting delete notice:', e.message);
        if (e.response) {
            console.error('[nodebb-plugin-google-chat-email] Response:', e.response.status, JSON.stringify(e.response.data));
        }
    }
};

Plugin.addAdminNavigation = function(header, callback) {
    console.log('[nodebb-plugin-google-chat-email] addAdminNavigation called, header:', header);
    
    if (!header || !header.plugins) {
        console.log('[nodebb-plugin-google-chat-email] header.plugins not initialized, initializing...');
        header = header || {};
        header.plugins = [];
    }
    
    header.plugins.push({
        route: '/plugins/google-chat-email',
        icon: 'fa-comments',
        name: 'Google Chat Email'
    });
    
    console.log('[nodebb-plugin-google-chat-email] addAdminNavigation done, plugins:', header.plugins);
    callback(null, header);
};

function renderAdmin(req, res) {
    console.log('[nodebb-plugin-google-chat-email] renderAdmin called for', req.path, 'user:', (req.user && req.user.uid) || 'anonymous');
    res.render('admin/plugins/google-chat-email', {});
}

module.exports = Plugin;
