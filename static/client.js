'use strict';

/* global $, config */
(function () {
let choices = null;

function load(cb) {
if (choices) {
return cb(choices);
}
$.get(config.relative_path + '/api/plugin/google-chat-integration/choices')
.done(function (d) { choices = d; cb(d); })
.fail(function () { cb(null); });
}

// Topic page: the topic starter (or an admin) sees the linked chat as a badge plus a
// cog button. The button opens a menu to change the webhook (saved immediately).
function showTopicControl(tid) {
const titleEl = $('[component="topic/title"]').first();
if (!tid || !titleEl.length || titleEl.find('.gchat-wrap').length) {
return;
}
$.get(config.relative_path + '/api/plugin/google-chat-integration/topic-chat', { tid: tid }, function (d) {
if (!d || !d.canChange || titleEl.find('.gchat-wrap').length) {
return;
}
let current = d.current || '';
const options = [{ id: '', name: 'None' }].concat(d.webhooks);

const badge = $('<span class="gchat-badge badge align-middle" style="font-size:.7em;"></span>');
const cog = $('<button type="button" class="gchat-cog btn btn-sm btn-outline-secondary ms-2 align-middle py-0 px-2" title="Change Google Chat webhook" aria-label="Change Google Chat webhook" aria-haspopup="true" aria-expanded="false"><i class="fa fa-cog"></i></button>');
const menu = $('<div class="gchat-menu list-group shadow" role="menu" style="display:none;position:absolute;z-index:1060;min-width:200px;font-size:14px;font-weight:normal;"></div>');
const wrap = $('<span class="gchat-wrap ms-2" style="position:relative;display:inline-block;"></span>').append(badge, cog, menu);

function paint() {
const found = options.find(function (o) { return o.id === current; });
badge.empty().append('<i class="fa fa-comments me-1"></i>')
.append(document.createTextNode('Google Chat: ' + (current && found ? found.name : 'none')));
badge.toggleClass('text-bg-success', !!current).toggleClass('text-bg-secondary', !current);
menu.empty();
options.forEach(function (o) {
const item = $('<button type="button" class="list-group-item list-group-item-action py-1" role="menuitem"></button>')
.append('<i class="fa fa-check me-2" style="visibility:' + (o.id === current ? 'visible' : 'hidden') + ';"></i>')
.append(document.createTextNode(o.name));
item.on('click', function (e) {
e.stopPropagation();
closeMenu();
if (o.id === current) {
return;
}
save(o.id);
});
menu.append(item);
});
}
function closeMenu() {
menu.hide();
cog.attr('aria-expanded', 'false');
$(document).off('click.gchatmenu');
}
function openMenu() {
menu.show();
cog.attr('aria-expanded', 'true');
setTimeout(function () {
$(document).on('click.gchatmenu', function (e) {
if (!$(e.target).closest('.gchat-wrap').length) {
closeMenu();
}
});
}, 0);
}
function save(id) {
cog.prop('disabled', true);
$.ajax({
url: config.relative_path + '/api/plugin/google-chat-integration/topic-chat',
method: 'POST',
headers: { 'x-csrf-token': config.csrf_token },
contentType: 'application/json',
data: JSON.stringify({ tid: tid, webhook: id }),
}).done(function () {
current = id;
paint();
app.alertSuccess('Google Chat webhook updated');
}).fail(function () {
app.alertError('Could not change Google Chat webhook');
}).always(function () {
cog.prop('disabled', false);
});
}

cog.on('click', function (e) {
e.preventDefault();
e.stopPropagation();
if (menu.is(':visible')) { closeMenu(); } else { openMenu(); }
});

paint();
titleEl.append(wrap);
});
}

$(window).on('action:composer.loaded', function (ev, data) {
const el = $('.composer[data-uuid="' + data.post_uuid + '"]');
const cd = data.composerData || {};
if (!el.length) {
return;
}
// Only a brand-new topic gets the picker here; replies/edits use the topic page control.
if (cd.action !== 'topics.post') {
return;
}
if (el.find('.gchat-picker').length) {
return;
}
load(function (d) {
if (!d || !d.enabled || !d.webhooks.length) {
return;
}
const sel = $('<select class="form-select form-select-sm gchat-picker" style="max-width:260px"></select>');
sel.append('<option value="">Google Chat: none</option>');
d.webhooks.forEach(function (w) {
sel.append($('<option></option>').attr('value', w.id).text('Google Chat: ' + w.name));
});
el.find('.title').closest('div').after($('<div class="mb-2"></div>').append(sel));
});
});

// Show the linked Google Chat as a badge next to topic titles (admins and the topic starter)
function addBadge(titleEl, name) {
	if (!titleEl.length || titleEl.find('.gchat-badge').length) {
		return;
	}
	$('<span class="gchat-badge badge text-bg-success ms-2" style="font-size:.7em;vertical-align:middle;"></span>')
		.append('<i class="fa fa-comments me-1"></i>')
		.append(document.createTextNode(name))
		.attr('title', 'Notifications for this topic go to Google Chat: ' + name)
		.appendTo(titleEl);
}

$(window).on('action:ajaxify.end', function () {
	if (!app.user || !app.user.uid) {
		return;
	}
	const tids = {};
	if (ajaxify.data && ajaxify.data.tid && $('[component="topic/title"]').length) {
		showTopicControl(ajaxify.data.tid);
		return;
	}
	$('[component="category/topic"][data-tid]').each(function () {
		tids[$(this).attr('data-tid')] = true;
	});
	const list = Object.keys(tids);
	if (!list.length) {
		return;
	}
	$.get(config.relative_path + '/api/plugin/google-chat-integration/topic-chats', { tids: list.join(',') }, function (map) {
		Object.keys(map || {}).forEach(function (tid) {
			if (ajaxify.data && String(ajaxify.data.tid) === tid) {
				addBadge($('[component="topic/title"]').first(), map[tid]);
			}
			$('[component="category/topic"][data-tid="' + tid + '"] [component="topic/title"], [component="category/topic"][data-tid="' + tid + '"] h3 a').first().each(function () {
				addBadge($(this).parent(), map[tid]);
			});
		});
	});
});

require(['hooks'], function (hooks) {
hooks.on('filter:composer.submit', function (data) {
const v = data.composerEl.find('.gchat-picker').val();
if (v && data.composerData && data.action === 'topics.post') {
data.composerData.gchatWebhook = v;
}
return data;
});
});
}());
