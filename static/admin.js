(function() {
    $(window).on('action:ajaxify.contentLoaded', function(ev, data) {
        if (!data || !data.url) return;
        if (data.url.indexOf('/admin/plugins/google-chat-email') !== -1) {
            initPanel();
        }
    });

    function initPanel() {
        var $spaceId = $('#google-chat-space-id');
        var $apiKey = $('#google-chat-api-key');
        var $notifyCheckbox = $('#notify-on-admin-post');
        loadSettings($spaceId, $apiKey, $notifyCheckbox);

        $(document).off('click.save-google-chat-email-settings').on('click.save-google-chat-email-settings', '#save-google-chat-email-settings', function() {
            var spaceId = $spaceId.val().trim();
            var apiKey = $apiKey.val().trim();
            var notifyOnAdminPost = $notifyCheckbox.is(':checked');
            
            if (spaceId && apiKey) {
                saveSettings(spaceId, apiKey, notifyOnAdminPost);
            } else {
                alert('Please enter both Space ID and API Key.');
            }
        });
    }

    function loadSettings($spaceId, $apiKey, $notifyCheckbox) {
        fetch('/api/plugin/google-chat-email/settings')
            .then(function(response) { return response.json(); })
            .then(function(data) {
                if ($spaceId && data.spaceId) $spaceId.val(data.spaceId);
                if ($apiKey && data.apiKey) $apiKey.val(data.apiKey);
                if ($notifyCheckbox && data.notifyOnAdminPost) $notifyCheckbox.prop('checked', data.notifyOnAdminPost);
            })
            .catch(function(error) {
                console.error('Error loading settings:', error);
            });
    }

    function saveSettings(spaceId, apiKey, notifyOnAdminPost) {
        fetch('/api/plugin/google-chat-email/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                spaceId: spaceId,
                apiKey: apiKey,
                notifyOnAdminPost: notifyOnAdminPost
            })
        })
        .then(function(response) {
            if (response.ok) {
                alert('Settings saved successfully!');
            } else {
                alert('Error saving settings. Please try again.');
            }
        })
        .catch(function(error) {
            console.error('Error saving settings:', error);
        });
    }

})();
