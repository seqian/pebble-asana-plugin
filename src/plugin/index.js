// Pebble native plugin. OAuth's client secret is held by Pebble's App Store broker.
var API = 'https://app.asana.com/api/1.0';
var KEY_TOKEN = 'asana.access';
var KEY_REFRESH = 'asana.broker_refresh';
var KEY_EXPIRY = 'asana.expires_at';
var KEY_WORKSPACE = 'asana.workspace';
var KEY_PROJECT = 'asana.project';
var KEY_USER = 'asana.user';
var SOURCES = ['reminders/configured', 'reminders/list'];
// Bundles use a single entrypoint; this core is inlined by scripts/build-plugin.mjs.
// BEGIN CORE
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AsanaCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function normalizedName(value) { return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }
  function resolveProject(projects, name) {
    var normalized = normalizedName(name);
    if (!normalized) return { error: 'Project name must not be empty.' };
    var matches = projects.filter(function (project) {
      return project && normalizedName(project.name) === normalized;
    });
    if (matches.length === 0) return { error: 'No project named "' + name + '" is accessible in this workspace.' };
    if (matches.length > 1) return { error: 'More than one project is named "' + name + '". Choose a specific project destination.' };
    return { project: matches[0] };
  }
  function dueInstant(value) {
    if (typeof value !== 'string') return null;
    var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/i.exec(value);
    if (!match) return null;
    var yr = Number(match[1]), mo = Number(match[2]), day = Number(match[3]);
    var hour = Number(match[4]), min = Number(match[5]), sec = Number(match[6]);
    var leap = yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (mo < 1 || mo > 12 || day < 1 || day > days[mo - 1] || hour > 23 || min > 59 || sec > 59 ||
        (match[8] && (Number(match[8]) > 23 || Number(match[9]) > 59))) return null;
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }
  function taskPayload(args, workspace, projectGid, userGid) {
    var title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) throw new Error('Task title must not be empty.');
    if (!workspace || !userGid) throw new Error('Configure an Asana workspace and reconnect your account.');
    var data = { name: title, workspace: String(workspace), assignee: String(userGid) };
    if (projectGid) data.projects = [String(projectGid)];
    if (Object.prototype.hasOwnProperty.call(args, 'due_iso')) {
      var instant = dueInstant(args.due_iso);
      if (!instant) throw new Error('due_iso must be a valid RFC3339 date-time with an offset.');
      if (typeof args.timezone !== 'string' || !args.timezone.trim()) throw new Error('timezone is required with due_iso.');
      data.due_at = instant;
    }
    return { data: data };
  }
  function nextPage(body) {
    return body && body.next_page && typeof body.next_page.offset === 'string' ? body.next_page.offset : null;
  }
  return { normalizedName: normalizedName, resolveProject: resolveProject, dueInstant: dueInstant, taskPayload: taskPayload, nextPage: nextPage };
}));

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
  localStorage.removeItem(KEY_PROJECT);
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
  var result = await paginated('/workspaces/' + encodeURIComponent(workspace) + '/projects?opt_fields=gid,name,archived');
  if (result.ok) result.data = result.data.filter(function (p) { return p && p.gid && p.name && p.archived !== true; });
  return result;
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
  result.data.forEach(function (p) {
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
  var workspace = localStorage.getItem(KEY_WORKSPACE), user = localStorage.getItem(KEY_USER);
  if (!workspace || !user) return respond.error('AUTH_REQUIRED', 'Choose a default Asana workspace in the plugin settings.');
  var gid = null;
  var defaultProject = !args.instanceId && !args.project_name && localStorage.getItem(KEY_PROJECT);
  if (args.instanceId && args.instanceId !== 'workspace') {
    if (typeof args.instanceId !== 'string') return respond.error('INVALID_ARGS', 'Invalid project ID.');
    gid = args.instanceId;
  }
  if (defaultProject) gid = defaultProject;
  if (args.project_name || gid) {
    var loaded = await projects(workspace);
    if (!loaded.ok) return fail(loaded, respond, 'Unable to validate project destination.');
    if (args.project_name) {
      var found = AsanaCore.resolveProject(loaded.data, args.project_name);
      if (found.error) return respond.error('INVALID_ARGS', found.error);
      gid = found.project.gid;
    } else if (!loaded.data.some(function (p) { return String(p.gid) === gid; })) {
      return respond.error('INVALID_ARGS', defaultProject ?
        'The default project is no longer available. Choose another project or clear the default in Settings.' :
        'That project is not accessible in the selected workspace.');
    }
  }
  if (localStorage.getItem(KEY_WORKSPACE) !== workspace || localStorage.getItem(KEY_USER) !== user) {
    return respond.error('INVALID_ARGS', 'Asana settings changed. Please try again.');
  }
  var payload;
  try { payload = AsanaCore.taskPayload(args, workspace, gid, user); }
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
        localStorage.removeItem(KEY_PROJECT);
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
        if (localStorage.getItem(KEY_WORKSPACE) !== requested) localStorage.removeItem(KEY_PROJECT);
        localStorage.setItem(KEY_WORKSPACE, requested);
        Pebble.refreshSources(SOURCES);
        return respond({ ready: true, workspace: requested });
      }
      case 'projects':
      case 'select_project': {
        var workspace = localStorage.getItem(KEY_WORKSPACE), user = localStorage.getItem(KEY_USER);
        if (!workspace || !user || workspace !== message.workspace) return respond({ error: 'Select a workspace first.' });
        var selecting = message.type === 'select_project';
        if (selecting && message.gid === '') {
          localStorage.removeItem(KEY_PROJECT);
          return respond({ selected: '' });
        }
        var available = await projects(workspace);
        if (workspace !== localStorage.getItem(KEY_WORKSPACE) || user !== localStorage.getItem(KEY_USER)) {
          return respond({ error: 'Asana settings changed. Reopen settings to continue.' });
        }
        var selected = localStorage.getItem(KEY_PROJECT) || '';
        if (!available.ok) return respond({ selected: selected, error: 'Unable to load Asana projects.' });
        if (!selecting) return respond({ projects: available.data, selected: selected });
        if (!available.data.some(function (p) { return String(p.gid) === message.gid; })) {
          return respond({ error: 'That project is not accessible in the selected workspace.' });
        }
        localStorage.setItem(KEY_PROJECT, message.gid);
        return respond({ selected: message.gid });
      }
      case 'disconnect':
        await clearAuth();
        Pebble.refreshSources(SOURCES);
        return respond({ connected: false, ready: false });
      default: return respond({ error: 'Unsupported settings request.' });
    }
  } catch (error) { respond({ error: error && error.message || 'Unexpected Asana error.' }); }
});
