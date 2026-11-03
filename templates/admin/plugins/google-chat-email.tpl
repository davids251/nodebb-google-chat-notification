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
      <label for="notify-on-admin-post">
        <input type="checkbox" id="notify-on-admin-post" /> Notify on admin posts
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

    if (!$url || !$save) {
        return;
    }

    var csrf = (window.config && config.csrf_token) || '';

    fetch('/api/plugin/google-chat-email/settings', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            $url.value = data.webhookUrl || '';
            $notify.checked = !!data.notifyOnAdminPost;
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
            body: JSON.stringify({ webhookUrl: webhookUrl, notifyOnAdminPost: $notify.checked })
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
