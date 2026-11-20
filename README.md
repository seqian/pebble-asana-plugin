# Pebble–Asana

Native Pebble plugin for Index voice-to-task capture. **Early development preview; not yet device-tested or published.**

## Features

- OAuth 2.0 through Pebble App Store's hosted OAuth broker: no client secret in this repository or the PBW.
- A connected user chooses a default Asana workspace.
- Tasks are assigned to the connected user and have **no project** unless a project is explicitly selected.
- Exposes accessible, unarchived projects through `reminders/list`. Index may pass the project's `instanceId` to `create_reminder`; the action also accepts `project_name` and rejects missing or duplicate project names.
- Due times are optional. When `due_iso` is supplied it must contain an actual RFC3339 UTC offset plus a `timezone`. Asana receives `due_at` normalized to UTC.
- No notification is guaranteed by assigning a due date.

## Development

Prerequisites: Pebble SDK and Node.js (for tests / build regeneration).

```sh
npm test
npm run build
pebble build
```

`src/plugin/template.js` + `src/plugin/core.js` are bundled into the committed `src/plugin/index.js` by `npm run build`. The package manifest references the generated script directly, so `pebble build` can package it. The `wscript` bundles no watch binary.

## OAuth app setup — action required

1. Register an OAuth app in the [Asana developer console](https://app.asana.com/0/developer-console).
2. Set redirect URI to `https://appstore-api.repebble.com/api/oauth/broker/callback`.
3. In Pebble Developer Dashboard / `pebble oauth-connector set --slug asana`, configure Asana authorization URL `https://app.asana.com/-/oauth_authorize` and token URL `https://app.asana.com/-/oauth_token`, current supported least-privilege scopes, Asana client ID and secret. **Never commit these credentials.**
4. Verify Asana scope requirements in the current developer console for users/workspaces/projects read and tasks write. Exact accepted scope names must be confirmed before release.
5. Install a preview PBW and connect Asana from the plugin settings page. Select the workspace.

## Testing / limitations

Core mapping and project-selection tests are in `test/core.test.cjs`. This implementation has not yet been validated in Pebble's plugin runtime. Test OAuth/refresh, workspace and project discovery, user permissions, and end-to-end Index utterances on a real phone. In particular, verify whether Index actually supplies custom `project_name` vs only `instanceId`.

Asana API errors after an uncertain network failure must not automatically trigger a retry, as the task might have been created.

See [Pebble plugin documentation](https://developer.repebble.com/guides/plugins/preview/) and [Publishing Plugins](https://developer.repebble.com/guides/plugins/publishing-plugins/).
