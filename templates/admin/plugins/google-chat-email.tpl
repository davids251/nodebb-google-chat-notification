<div class="panel">
  <div class="panel-heading">Google Chat Integration</div>
  <div class="panel-body">
    <div class="alert alert-info">
      In Google Chat open your space, then <strong>Apps &amp; integrations → Webhooks → Add webhook</strong>, and paste the webhook URL below.
    </div>
    <div class="form-group">
      <label for="google-chat-webhook-url">Webhook URL</label>
      <input id="google-chat-webhook-url" class="form-control" type="password" autocomplete="off" placeholder="https://chat.googleapis.com/v1/spaces/..." />
      <small>Treat this URL like a password: anyone with it can post to your space.</small>
    </div>
    <div class="form-group">
      <label for="google-chat-scope">Whose posts to send to Google Chat</label>
      <select id="google-chat-scope" class="form-control">
        <option value="admins">Admins only</option>
        <option value="selected">Admins + selected users</option>
        <option value="all">All users</option>
      </select>
    </div>
    <div class="form-group" id="google-chat-users-group" style="display:none;">
      <label for="google-chat-users">Selected usernames</label>
      <input id="google-chat-users" class="form-control" type="text" placeholder="alice, bob, carol" />
      <small>Comma-separated NodeBB usernames.</small>
    </div>
    <div class="form-group">
      <label for="notify-on-admin-post">
        <input type="checkbox" id="notify-on-admin-post" /> Enable notifications (new and deleted posts)
      </label>
    </div>
    <button id="save-google-chat-email-settings" class="btn btn-primary">Save Settings</button>
  </div>
</div>

<script>
function initGoogleChatAdmin() {
    var $url = document.getElementById('google-chat-webhook-url');
    var $notify = document.getElementById('notify-on-admin-post');
    var $save = document.getElementById('save-google-chat-email-settings');
    var $scope = document.getElementById('google-chat-scope');
    var $users = document.getElementById('google-chat-users');
    var $usersGroup = document.getElementById('google-chat-users-group');

    if (!$url || !$save) {
        return;
    }

    function toggleUsers() {
        $usersGroup.style.display = $scope.value === 'selected' ? '' : 'none';
    }
    $scope.onchange = toggleUsers;

    var csrf = (window.config && config.csrf_token) || '';

    fetch('/api/plugin/google-chat-email/settings', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            $url.value = data.webhookUrl || '';
            $notify.checked = !!data.notifyOnAdminPost;
            $scope.value = data.notifyScope || 'admins';
            $users.value = data.notifyUsers || '';
            toggleUsers();
        })
        .catch(function (e) { console.error('[Google Chat] Error loading settings:', e); });

    $save.onclick = function (e) {
        e.preventDefault();
        var webhookUrl = $url.value.trim();

        if (webhookUrl && webhookUrl.indexOf('https://chat.googleapis.com/') !== 0) {
            alert('That does not look like a Google Chat webhook URL. It should start with https://chat.googleapis.com/');
            return;
        }

        fetch('/api/plugin/google-chat-email/settings', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
            body: JSON.stringify({ webhookUrl: webhookUrl, notifyOnAdminPost: $notify.checked, notifyScope: $scope.value, notifyUsers: $users.value })
        })
        .then(function (r) {
            if (!r.ok) { throw new Error('HTTP ' + r.status); }
            alert('Settings saved.');
        })
        .catch(function (err) { alert('Error saving settings: ' + err.message); });
    };
}

initGoogleChatAdmin();
$(window).off('action:ajaxify.contentLoaded.gchat').on('action:ajaxify.contentLoaded.gchat', initGoogleChatAdmin);
</script>
