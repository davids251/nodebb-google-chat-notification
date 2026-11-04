'use strict';

/* global $, config */
(function () {
let choices = null;

function load(cb) {
if (choices) {
return cb(choices);
}
$.get(config.relative_path + '/api/plugin/google-chat-email/choices')
.done(function (d) { choices = d; cb(d); })
.fail(function () { cb(null); });
}

$(window).on('action:composer.loaded', function (ev, data) {
const el = $('.composer[data-uuid="' + data.post_uuid + '"]');
if (!el.length || !el.find('.title').length || data.pid) {
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
sel.append('<option value="">Google Chat: default (by scope)</option>');
d.webhooks.forEach(function (w) {
sel.append($('<option></option>').attr('value', w.id).text('Google Chat: ' + w.name));
});
el.find('.title').closest('div').after($('<div class="mb-2"></div>').append(sel));
});
});

$(window).on('action:composer.topic.new', function () {});

require(['hooks'], function (hooks) {
hooks.on('filter:composer.submit', function (data) {
const v = data.composerEl.find('.gchat-picker').val();
if (v && data.composerData) {
data.composerData.gchatWebhook = v;
}
return data;
});
});
}());
