document.addEventListener('DOMContentLoaded', function() {
    const emailInput = document.getElementById('google-chat-email');
    const saveButton = document.getElementById('save-google-chat-email');

    // Load existing email settings
    loadEmailSettings();

    saveButton.addEventListener('click', function() {
        const email = emailInput.value.trim();
        if (validateEmail(email)) {
            saveEmailSettings(email);
        } else {
            alert('Please enter a valid email address.');
        }
    });

    function loadEmailSettings() {
        // Fetch existing email settings from the server
        fetch('/api/plugin/google-chat/email-settings')
            .then(response => response.json())
            .then(data => {
                if (data.email) {
                    emailInput.value = data.email;
                }
            })
            .catch(error => {
                console.error('Error loading email settings:', error);
            });
    }

    function saveEmailSettings(email) {
        // Save email settings to the server
        fetch('/api/plugin/google-chat/email-settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        })
        .then(response => {
            if (response.ok) {
                alert('Email settings saved successfully!');
            } else {
                alert('Error saving email settings. Please try again.');
            }
        })
        .catch(error => {
            console.error('Error saving email settings:', error);
        });
    }

    function validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }
});
