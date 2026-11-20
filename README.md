# Pebble–Asana

Native Pebble plugin for Index voice-to-task capture. **Development preview; not yet tested on a device or published.**

## Behavior

- OAuth through Pebble's App Store broker (no Asana client secret in the PBW).
- User selects a default Asana workspace on the plugin settings page.
- By default, a task is assigned to the connected user and has **no project membership**.
- If Index chooses a project from `reminders/list` (passing its `instanceId`), or supplies `project_name`, a uniquely matching accessible project receives the task.
- `due_iso` is optional. If present, provide a genuine absolute ISO time and IANA `timezone`; Asana receives `due_at` in UTC.
- Does not create Asana push notifications or reminders. It creates tasks with optional due times.

## Required OAuth setup

1. Create an Asana application at https://app.asana.com/0/developer-console.
2. Register redirect URI: `https://appstore-api.repebble.com/api/oauth/broker/callback`
3. Enable the necessary Asana OAuth scopes for profile/workspaces/project listing/task creation. Check current mappings, suggested `users:read`, `workspaces:read`, `projects:read`, `tasks:write`; grant only supported scopes.
4. Publish or configure the connector in Pebble Developer Dashboard with slug `asana`:
   - Authorization URL: `https://app.asana.com/-/oauth_authorize`
   - Token URL: `https://app.asana.com/-/oauth_token`
   - Client ID and secret entered **only in Pebble's OAuth connector**, not committed here.
5. Install the plugin, connect Asana, select a workspace.

See https://developer.repebble.com/guides/plugins/publishing-plugins/ for the latest broker procedure.

## Build and test

```sh
npm test
node scripts/build-plugin.mjs
```

**Packaging is not yet wired**: the Pebble manifest points to `src/plugin/index.js` which contains an inline-build marker; before building the PBW, change it to `build-src/plugin.js` (or use the build script integration). The Pebble plugins SDK's `pebble build` / plugin packager is needed to generate a PBW. This is an early source scaffold, not a release build.

## Known follow-up validation

- Confirm Index passes project selection via `instanceId` (and whether it ever sends `project_name`).
- Confirm exact Asana OAuth scopes accepted in the Asana developer console and the broker refresh lifecycle.
- Test workspace picker, task creation, pagination, expired tokens, device permissions and time-zone behavior on Android and iOS.
- Confirm whether Index can request a due date without a clock time; current `due_iso` mapping creates a timed task.
- Review manifest packaging and App Store submission requirements.

No private user data or credentials are committed.
