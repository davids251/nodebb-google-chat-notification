# NodeBB Google Chat Notifier

A NodeBB plugin that posts a message to a Google Chat space (through an incoming webhook) when:

- a post is created, and
- a post is deleted.

An admin chooses whose posts are reported: admins only, admins plus selected users, or all users.

## Requirements

- NodeBB v3 or newer (developed against v4.x)
- Node.js 18 or newer
- A Google Chat space where you can add a webhook

## Install

These steps assume your NodeBB lives at `/path/to/NodeBB` and this plugin is at `/path/to/nodebb-plugin-google-chat-integration`.

1. Install the plugin's dependencies:
   ```bash
   cd /path/to/nodebb-plugin-google-chat-integration
   npm install
   ```
2. Link the plugin into NodeBB:
   ```bash
   cd /path/to/nodebb-plugin-google-chat-integration
   npm link
   cd /path/to/NodeBB
   npm link nodebb-plugin-google-chat-integration
   ```
   Alternatively, install straight from the folder: `cd /path/to/NodeBB && npm install /path/to/nodebb-plugin-google-chat-integration`
3. Activate and rebuild:
   ```bash
   cd /path/to/NodeBB
   ./nodebb activate nodebb-plugin-google-chat-integration
   ./nodebb build
   ./nodebb restart
   ```
   You can also activate it in **Admin → Extend → Plugins** (search for "Google Chat"), then click **Rebuild & Restart**.
4. Check it loaded: open `http://localhost:4567/api/plugin/google-chat-integration/ping`. It should return `{"ok":true,"plugin":"nodebb-plugin-google-chat-integration"}`.

## Create the Google Chat webhook

1. Open Google Chat and go to your space.
2. Click the space name, then **Apps & integrations**, then **Webhooks**, then **Add webhook**.
3. Name it (for example "NodeBB") and copy the webhook URL. It starts with `https://chat.googleapis.com/`.

If **Add webhook** is missing or greyed out, a Google Workspace admin must allow incoming webhooks in the Admin console under **Apps → Google Workspace → Google Chat**.

## Configure

1. In NodeBB go to **Admin → Plugins → Google Chat Email**.
2. Paste the webhook URL.
3. Pick **Whose posts to send to Google Chat**:
   - **Admins only** (default)
   - **Admins + selected users** (enter comma-separated usernames)
   - **All users**
4. Tick **Enable notifications (new and deleted posts)** and click **Save Settings**.
5. Create a post to test it.

Treat the webhook URL like a password. Anyone with it can post to your space.

## Troubleshooting

- Check the NodeBB log (`logs/output.log`) for lines starting with `[nodebb-plugin-google-chat-integration]`. A successful send logs `Posted to Google Chat, status: 200`.
- Nothing is posted: confirm the checkbox is ticked, the webhook URL is saved, and the poster is covered by the selected option.
- Message links use NodeBB's configured `url`. Set it to a public address so others can open them.
- Delete notifications fire on a normal delete, not on a permanent purge.

## Development

- Template: `templates/admin/plugins/google-chat-integration.tpl`
- Settings API (admins only): `GET/POST /api/plugin/google-chat-integration/settings`
- `npm run bump` bumps the version in `package.json` and `plugin.json`

## License

MIT
