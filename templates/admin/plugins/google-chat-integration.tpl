<style>
  .gchat-box { border: 1px solid #d0d7de; border-radius: 6px; background: #fff; }
  .gchat-box-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #f6f8fa; border-bottom: 1px solid #d0d7de; border-radius: 6px 6px 0 0; font-weight: 600; }
  .gchat-item { display: flex; align-items: flex-start; gap: 16px; padding: 16px; border-bottom: 1px solid #d0d7de; }
  .gchat-item:last-child { border-bottom: 0; border-radius: 0 0 6px 6px; }
  .gchat-item-icon { font-size: 28px; color: #57606a; width: 32px; text-align: center; padding-top: 2px; }
  .gchat-item-body { flex: 1; min-width: 0; }
  .gchat-item-name { font-weight: 600; font-size: 15px; }
  .gchat-item-meta { color: #57606a; font-size: 12px; margin-top: 2px; word-break: break-all; }
  .gchat-item-actions { display: flex; gap: 8px; }
  .gchat-empty { padding: 32px 16px; text-align: center; color: #57606a; }
  .gchat-form { padding: 16px; border-bottom: 1px solid #d0d7de; background: #fafbfc; }
  .gchat-form:last-child { border-bottom: 0; border-radius: 0 0 6px 6px; }
  .gchat-form .form-group { margin-bottom: 12px; }
  .gchat-form-title { font-weight: 600; margin-bottom: 12px; }
  .gchat-form-actions { display: flex; gap: 8px; }
  .gchat-badge { display: inline-block; padding: 0 7px; margin-left: 8px; font-size: 12px; font-weight: 500; line-height: 18px; border: 1px solid #d0d7de; border-radius: 2em; color: #57606a; vertical-align: middle; }
  .gchat-footer { margin-top: 16px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
</style>

<div class="panel">
  <div class="panel-heading">Google Chat Integration</div>
  <div class="panel-body">
    <p class="text-muted">
      In Google Chat open a space, then <strong>Apps &amp; integrations → Webhooks → Add webhook</strong>, and paste the URL when you add a webhook below.
      This plugin sends a message to each webhook whose rule covers the person who posted.
    </p>

    <div class="gchat-box" id="gchat-box">
      <div class="gchat-box-header">
        <span>Webhooks <span class="gchat-badge" id="gchat-count">0</span></span>
        <button type="button" id="gchat-add" class="btn btn-success btn-sm">New webhook</button>
      </div>
      <div id="gchat-list"></div>
    </div>

    <div class="gchat-footer">
      <label class="mb-0">
        <input type="checkbox" id="notify-on-admin-post" /> Enable notifications (new and deleted posts)
      </label>
      <span class="text-muted" id="gchat-dirty" style="display:none;"></span>
    </div>
  </div>
</div>

<script>
function initGoogleChatAdmin() {
    var $list = document.getElementById('gchat-list');
    var $count = document.getElementById('gchat-count');
    var $add = document.getElementById('gchat-add');
    var $notify = document.getElementById('notify-on-admin-post');
    var $dirty = document.getElementById('gchat-dirty');

    if (!$list || !$add) {
        return;
    }

    var csrf = (window.config && config.csrf_token) || '';
    var MAX = 20;
    var hooks = [];      // [{ name, url, scope, users }]
    var editing = -1;    // index being edited, or -2 for a new entry, -1 for none
    var SCOPE_LABELS = { admins: 'Admins only', selected: 'Admins + selected users', all: 'All users' };

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === 'className') { node.className = attrs[k]; }
            else if (k === 'text') { node.textContent = attrs[k]; }
            else { node.setAttribute(k, attrs[k]); }
        });
        (children || []).forEach(function (c) { node.appendChild(c); });
        return node;
    }

    // Saves immediately after every change (add, update, delete, enable toggle)
    function markDirty() {
        $dirty.style.display = '';
        $dirty.textContent = 'Saving...';
        fetch('/api/plugin/google-chat-integration/settings', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
            body: JSON.stringify({ webhooks: hooks, notifyOnAdminPost: $notify.checked })
        })
        .then(function (r) {
            if (!r.ok) { throw new Error('HTTP ' + r.status); }
            $dirty.textContent = 'Saved.';
            setTimeout(function () { $dirty.style.display = 'none'; }, 2000);
        })
        .catch(function (err) {
            $dirty.textContent = '';
            alert('Error saving settings: ' + err.message);
        });
    }

    // Show only the end of the URL so it can be told apart without exposing the key
    function fingerprint(url) {
        var m = url.match(/spaces\/([^\/?]+)/);
        return m ? 'spaces/' + m[1] : 'Google Chat webhook';
    }

    function buildForm(data, index) {
        data = data || { name: '', url: '', scope: 'admins', users: '' };

        var name = el('input', { type: 'text', className: 'form-control', maxlength: '100', placeholder: 'e.g. Team Alerts' });
        name.value = data.name;
        var url = el('input', { type: 'password', className: 'form-control', autocomplete: 'off', placeholder: 'https://chat.googleapis.com/v1/spaces/...' });
        url.value = data.url;
        var scope = el('select', { className: 'form-control' }, [
            el('option', { value: 'admins', text: 'Admins only' }),
            el('option', { value: 'selected', text: 'Admins + selected users' }),
            el('option', { value: 'all', text: 'All users' })
        ]);
        scope.value = data.scope;
        var users = el('input', { type: 'text', className: 'form-control', placeholder: 'alice, bob, carol' });
        users.value = data.users;

        var usersGroup = el('div', { className: 'form-group' }, [
            el('label', { text: 'Selected usernames' }), users,
            el('small', { className: 'text-muted', text: 'Comma-separated NodeBB usernames.' })
        ]);
        function toggleUsers() { usersGroup.style.display = scope.value === 'selected' ? '' : 'none'; }
        scope.onchange = toggleUsers;
        toggleUsers();

        var ok = el('button', { type: 'button', className: 'btn btn-success btn-sm', text: index === -2 ? 'Add webhook' : 'Update webhook' });
        var cancel = el('button', { type: 'button', className: 'btn btn-default btn-sm', text: 'Cancel' });

        ok.onclick = function () {
            var u = url.value.trim();
            if (!u) { alert('Enter the webhook URL.'); return; }
            if (u.indexOf('https://chat.googleapis.com/') !== 0) {
                alert('That does not look like a Google Chat webhook URL. It should start with https://chat.googleapis.com/');
                return;
            }
            var entry = { name: name.value.trim(), url: u, scope: scope.value, users: users.value.trim() };
            if (index === -2) { hooks.push(entry); } else { hooks[index] = entry; }
            editing = -1;
            markDirty();
            render();
        };
        cancel.onclick = function () { editing = -1; render(); };

        return el('div', { className: 'gchat-form' }, [
            el('div', { className: 'gchat-form-title', text: index === -2 ? 'Add a webhook' : 'Edit webhook' }),
            el('div', { className: 'form-group' }, [
                el('label', { text: 'Chat name (optional)' }), name,
                el('small', { className: 'text-muted', text: 'Shown in messages as [Chat name]. Google does not expose the space name through a webhook, so type it here.' })
            ]),
            el('div', { className: 'form-group' }, [
                el('label', { text: 'Webhook URL' }), url,
                el('small', { className: 'text-muted', text: 'Treat this URL like a password: anyone with it can post to the space.' })
            ]),
            el('div', { className: 'form-group' }, [el('label', { text: 'Whose posts to send to this chat' }), scope]),
            usersGroup,
            el('div', { className: 'gchat-form-actions' }, [ok, cancel])
        ]);
    }

    function buildItem(h, i) {
        var title = h.name || 'Unnamed chat';
        var meta = fingerprint(h.url) + ' \u00b7 ' + SCOPE_LABELS[h.scope] +
            (h.scope === 'selected' && h.users ? ' (' + h.users + ')' : '');

        var edit = el('button', { type: 'button', className: 'btn btn-default btn-sm', text: 'Edit' });
        var del = el('button', { type: 'button', className: 'btn btn-danger btn-sm', text: 'Delete' });
        edit.onclick = function () { editing = i; render(); };
        del.onclick = function () {
            if (confirm('Delete the webhook "' + title + '"?')) {
                hooks.splice(i, 1);
                editing = -1;
                markDirty();
                render();
            }
        };

        return el('div', { className: 'gchat-item' }, [
            el('div', { className: 'gchat-item-icon' }, [el('i', { className: 'fa fa-comments' })]),
            el('div', { className: 'gchat-item-body' }, [
                el('div', { className: 'gchat-item-name', text: title }),
                el('div', { className: 'gchat-item-meta', text: meta })
            ]),
            el('div', { className: 'gchat-item-actions' }, [edit, del])
        ]);
    }

    function render() {
        $list.innerHTML = '';
        $count.textContent = String(hooks.length);
        $add.disabled = editing !== -1;

        if (!hooks.length && editing !== -2) {
            $list.appendChild(el('div', { className: 'gchat-empty', text: 'No webhooks yet. Click "New webhook" to add one.' }));
        }
        hooks.forEach(function (h, i) {
            $list.appendChild(editing === i ? buildForm(h, i) : buildItem(h, i));
        });
        if (editing === -2) {
            $list.appendChild(buildForm(null, -2));
        }
    }

    $add.onclick = function () {
        if (hooks.length >= MAX) { alert('You can add up to ' + MAX + ' webhooks.'); return; }
        editing = -2;
        render();
    };
    $notify.onchange = markDirty;

    fetch('/api/plugin/google-chat-integration/settings', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            $notify.checked = !!data.notifyOnAdminPost;
            hooks = (data.webhooks || []).filter(function (h) { return h && h.url; });
            render();
        })
        .catch(function (e) { console.error('[Google Chat] Error loading settings:', e); render(); });

}

initGoogleChatAdmin();
$(window).off('action:ajaxify.contentLoaded.gchat').on('action:ajaxify.contentLoaded.gchat', initGoogleChatAdmin);
</script>
