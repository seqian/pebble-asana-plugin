// Pebble native plugin. OAuth's client secret is held by Pebble's App Store broker.
var API = 'https://app.asana.com/api/1.0';
var KEY_TOKEN = 'asana.access';
var KEY_REFRESH = 'asana.broker_refresh';
var KEY_EXPIRY = 'asana.expires_at';
var KEY_WORKSPACE = 'asana.workspace';
var KEY_USER = 'asana.user';
var SOURCES = ['reminders/configured', 'reminders/list'];
// Bundles use a single entrypoint; this core is inlined by scripts/build-plugin.mjs.
// BEGIN CORE
/* __ASANA_CORE__ */
// END CORE

async function item(key) { return String(await Pebble.secureStorage.getItem(key) || '').trim(); }
async function saveAuth(bundle) {
  if (!bundle || !bundle.access_token) throw new Error('Asana provided no access token.');
  await Pebble.secureStorage.setItem(KEY_TOKEN, String(bundle.access_token));
  if (bundle.broker_refresh) await Pebble.secureStorage.setItem(KEY_REFRESH, String(bundle.broker_refresh));
  else await Pebble.secureStorage.removeItem(KEY_REFRESH);
  var expires = Number(bundle.expires_in || 0);
  if (expires > 0) localStorage.setItem(KEY_EXPIRY, String(Date.now() + expires * 1000));
  else localStorage.removeItem(KEY_EXPIRY);
}
async function clearAuth() {
  await Pebble.secureStorage.removeItem(KEY_TOKEN);
  await Pebble.secureStorage.removeItem(KEY_REFRESH);
  localStorage.removeItem(KEY_EXPIRY);
  localStorage.removeItem(KEY_WORKSPACE);
  localStorage.removeItem(KEY_USER);
}
async function token() {
  var existing = await item(KEY_TOKEN);
  var expires = Number(localStorage.getItem(KEY_EXPIRY) || 0);
  if (existing && (!expires || Date.now() < expires - 60000)) return existing;
  var refresh = await item(KEY_REFRESH);
  if (!refresh) return expires ? '' : existing;
  var next;
  try { next = await Pebble.oauth.refresh('asana', refresh); }
  catch (error) {
    if (error && error.code === 'REFRESH_REVOKED') {
      if (await item(KEY_REFRESH) === refresh) await clearAuth();
      return '';
    }
    throw error;
  }
  // Do not overwrite tokens produced by a concurrent login/refresh.
  if (await item(KEY_REFRESH) !== refresh) return item(KEY_TOKEN);
  await saveAuth(next);
  return item(KEY_TOKEN);
}
async function api(method, path, body, override) {
  var bearer = override || await token();
  if (!bearer) return { ok: false, status: 401 };
  var headers = { Authorization: 'Bearer ' + bearer, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  try {
    var response = await fetch(API + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
    var json = null;
    try { json = await response.json(); } catch (ignored) {}
    return { ok: response.ok, status: response.status, json: json };
  } catch (error) { return { ok: false, status: 0, error: error }; }
}
function fail(result, respond, fallback) {
  if (result.status === 401 || result.status === 403) return respond.error('AUTH_REQUIRED', 'Reconnect Asana or check account permissions.');
  if (result.status === 429) return respond.error('RATE_LIMITED', 'Asana rate limit reached. Please try later.');
  if (result.status === 0) return respond.error('PLUGIN_UNAVAILABLE', result.error && result.error.name === 'NotAllowedError' ?
    'Allow access to app.asana.com in the plugin permissions.' : 'Unable to reach Asana; creation outcome may be unknown. Do not retry blindly.');
  var detail = result.json && result.json.errors && result.json.errors[0] && result.json.errors[0].message;
  respond.error('PLUGIN_UNAVAILABLE', detail || fallback || ('Asana request failed (HTTP ' + result.status + ').'));
}
async function paginated(path, override) {
  var all = [], offset = null, seen = {};
  for (var page = 0; page < 30; page++) {
    var separator = path.indexOf('?') === -1 ? '?' : '&';
    var url = path + separator + 'limit=100' + (offset ? '&offset=' + encodeURIComponent(offset) : '');
    var result = await api('GET', url, null, override);
    if (!result.ok) return result;
    if (!result.json || !Array.isArray(result.json.data)) return { ok: false, status: 502 };
    all = all.concat(result.json.data);
    offset = AsanaCore.nextPage(result.json);
    if (!offset) return { ok: true, data: all };
    if (seen[offset]) break;
    seen[offset] = true;
  }
  return { ok: false, status: 502 };
}
async function workspaces(access) { return paginated('/workspaces?opt_fields=gid,name', access); }
async function projects(workspace) {
  return paginated('/workspaces/' + encodeURIComponent(workspace) + '/projects?opt_fields=gid,name,archived');
}
async function me(access) { return api('GET', '/users/me?opt_fields=gid,name', null, access); }
function configured() { return !!(localStorage.getItem(KEY_WORKSPACE) && localStorage.getItem(KEY_USER)); }
function reading(text) { return { shortText: { text: String(text) } }; }
Pebble.registerSourceHandler(async function (request, respond) {
  if (request.category !== 'reminders') return respond.error('INVALID_REQUEST');
  if (request.item === 'configured') {
    var ready = !!(await item(KEY_TOKEN)) && configured();
    return respond.data({ validUntilMs: Date.now() + 60000, instances: [{
      instanceId: 'asana', properties: { name: reading('Asana'),
        configured: { boolean: { value: ready }, shortText: { text: ready ? 'Connected' : 'Not connected' } } }
    }] });
  }
  if (request.item !== 'list') return respond.error('INVALID_REQUEST');
  if (!configured() || !(await item(KEY_TOKEN))) return respond.error('AUTH_REQUIRED', 'Connect Asana and choose a workspace in Settings.');
  var workspace = localStorage.getItem(KEY_WORKSPACE);
  var result = await projects(workspace);
  if (!result.ok) return fail(result, respond, 'Unable to load Asana projects.');
  var instances = [{ instanceId: 'workspace', properties: {
    name: reading('My Tasks (no project)'), destination: reading('Asana workspace'), url: { longText: { text: 'https://app.asana.com/' } }
  } }];
  result.data.filter(function (p) { return p && p.gid && p.name && p.archived !== true; }).forEach(function (p) {
    instances.push({ instanceId: String(p.gid), properties: {
      name: reading(p.name), destination: reading('Asana project'),
      url: { longText: { text: 'https://app.asana.com/0/' + encodeURIComponent(p.gid) } }
    } });
  });
  respond.data({ validUntilMs: Date.now() + 900000, instances: instances });
});
Pebble.registerActionHandler(async function (request, respond) {
  if (request.action !== 'create_reminder') return respond.error('INVALID_REQUEST');
  var args = request.args || {};
  if (!configured()) return respond.error('AUTH_REQUIRED', 'Choose a default Asana workspace in the plugin settings.');
  if (!(await item(KEY_TOKEN))) return respond.error('AUTH_REQUIRED', 'Sign in to Asana from plugin settings.');
  if (args.instanceId && args.project_name) return respond.error('INVALID_ARGS', 'Specify a project ID or project name, not both.');
  var gid = null, workspace = localStorage.getItem(KEY_WORKSPACE);
  if (args.instanceId && args.instanceId !== 'workspace') {
    if (typeof args.instanceId !== 'string') return respond.error('INVALID_ARGS', 'Invalid project ID.');
    gid = args.instanceId;
  }
  if (args.project_name || gid) {
    var loaded = await projects(workspace);
    if (!loaded.ok) return fail(loaded, respond, 'Unable to validate project destination.');
    if (args.project_name) {
      var found = AsanaCore.resolveProject(loaded.data.filter(function (p) { return p.archived !== true; }), args.project_name);
      if (found.error) return respond.error('INVALID_ARGS', found.error);
      gid = found.project.gid;
    } else if (!loaded.data.some(function (p) { return p.gid === gid && p.archived !== true; })) {
      return respond.error('INVALID_ARGS', 'That project is not accessible in the selected workspace.');
    }
  }
  var payload;
  try { payload = AsanaCore.taskPayload(args, workspace, gid, localStorage.getItem(KEY_USER)); }
  catch (error) { return respond.error('INVALID_ARGS', error.message); }
  var created = await api('POST', '/tasks', payload);
  if (!created.ok) return fail(created, respond, 'Asana could not create the task.');
  var task = created.json && created.json.data;
  if (!task || !task.gid) return respond.error('PLUGIN_UNAVAILABLE', 'Asana did not return a task ID. Check Asana before attempting again.');
  respond.ok({ text: 'Created “' + payload.data.name + '” in Asana' + (gid ? ' project.' : ' My Tasks (no project).'),
    url: task.permalink_url || 'https://app.asana.com/0/0/' + encodeURIComponent(task.gid) });
});
Pebble.registerConfigHandler(async function (message, respond) {
  try {
    switch (message && message.type) {
      case 'status': {
        var signed = !!(await item(KEY_TOKEN));
        return respond({ connected: signed, workspace: localStorage.getItem(KEY_WORKSPACE) || '',
          user: localStorage.getItem(KEY_USER) || '', ready: signed && configured() });
      }
      case 'connect': {
        var bundle = await Pebble.oauth.authorize('asana');
        var profile = await me(bundle.access_token);
        if (!profile.ok || !profile.json || !profile.json.data || !profile.json.data.gid) {
          return respond({ error: 'Asana sign-in succeeded, but profile validation failed.' });
        }
        var all = await workspaces(bundle.access_token);
        if (!all.ok) return respond({ error: 'Asana sign-in succeeded, but workspace retrieval failed.' });
        await saveAuth(bundle);
        localStorage.setItem(KEY_USER, String(profile.json.data.gid));
        localStorage.removeItem(KEY_WORKSPACE);
        Pebble.refreshSources(SOURCES);
        return respond({ connected: true, ready: false, workspaces: all.data });
      }
      case 'workspaces': {
        var ws = await workspaces();
        if (!ws.ok) return fail(ws, { error: function (code, message) { respond({ error: message }); } }, 'Unable to load workspaces.');
        return respond({ workspaces: ws.data, selected: localStorage.getItem(KEY_WORKSPACE) || '' });
      }
      case 'select_workspace': {
        var requested = String(message.gid || '');
        var list = await workspaces();
        if (!list.ok) return respond({ error: 'Cannot validate workspace.' });
        if (!list.data.some(function (w) { return String(w.gid) === requested; })) return respond({ error: 'Workspace not accessible.' });
        localStorage.setItem(KEY_WORKSPACE, requested);
        Pebble.refreshSources(SOURCES);
        return respond({ ready: true, workspace: requested });
      }
      case 'disconnect':
        await clearAuth();
        Pebble.refreshSources(SOURCES);
        return respond({ connected: false, ready: false });
      default: return respond({ error: 'Unsupported settings request.' });
    }
  } catch (error) { respond({ error: error && error.message || 'Unexpected Asana error.' }); }
});
