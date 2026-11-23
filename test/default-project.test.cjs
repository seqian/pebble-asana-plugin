const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const bundle = readFileSync(join(__dirname, '../src/plugin/index.js'), 'utf8');

function plugin() {
  const settings = new Map([['asana.workspace', 'w1'], ['asana.user', 'me']]);
  const credentials = new Map([['asana.access', 'token']]);
  const workspaces = [{ gid: 'w1' }, { gid: 'w2' }];
  const projects = [
    { gid: 'p1', name: 'Planning' },
    { gid: 'p2', name: 'Operations' },
    { gid: 'p3', name: 'Archived', archived: true },
  ];
  const tasks = [];
  const handlers = {};
  let projectsAvailable = true;
  const storage = (items) => ({
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: (key) => items.delete(key),
  });

  runInNewContext(bundle, {
    localStorage: storage(settings),
    Pebble: {
      secureStorage: storage(credentials),
      registerActionHandler: (handler) => { handlers.action = handler; },
      registerConfigHandler: (handler) => { handlers.config = handler; },
      registerSourceHandler: () => {},
      refreshSources: () => {},
    },
    fetch: async (url, options) => {
      const path = new URL(url).pathname;
      let data;
      if (path.endsWith('/workspaces')) data = workspaces;
      else if (path.endsWith('/projects')) {
        if (!projectsAvailable) return { ok: false, status: 503, json: async () => ({}) };
        data = path.endsWith('/w1/projects') ? projects : [];
      } else if (path.endsWith('/tasks')) {
        tasks.push(JSON.parse(options.body).data);
        data = { gid: 'task' };
      } else throw new Error('Unexpected request: ' + path);
      return { ok: true, status: 200, json: async () => ({ data }) };
    },
  });

  return {
    config: (message) => new Promise((resolve) => handlers.config(message, resolve)),
    create: (args) => new Promise((resolve) => handlers.action(
      { action: 'create_reminder', args: { title: 'Review', ...args } },
      { ok: () => resolve(tasks.at(-1)), error: (_, message) => resolve({ error: message }) },
    )),
    projects,
    tasks,
    stopProjectRequests: () => { projectsAvailable = false; },
  };
}

test('a default project can be selected, overridden, and cleared', async () => {
  const { config, create } = plugin();
  const listed = await config({ type: 'projects', workspace: 'w1' });
  assert.equal(listed.selected, '');
  assert.equal(Array.from(listed.projects, (project) => project.gid).join(','), 'p1,p2');
  assert.equal((await config({ type: 'select_project', workspace: 'w1', gid: 'p1' })).selected, 'p1');
  assert.equal((await config({ type: 'projects', workspace: 'w1' })).selected, 'p1');
  assert.deepEqual(await create(), { name: 'Review', workspace: 'w1', assignee: 'me', projects: ['p1'] });
  assert.deepEqual((await create({ project_name: 'Operations' })).projects, ['p2']);
  assert.deepEqual((await create({ instanceId: 'p2' })).projects, ['p2']);
  assert.equal((await create({ instanceId: 'workspace' })).projects, undefined);
  assert.equal((await config({ type: 'select_project', workspace: 'w1', gid: '' })).selected, '');
  assert.deepEqual(await create(), { name: 'Review', workspace: 'w1', assignee: 'me' });
});

test('switching workspaces clears the default and rejects selections from the previous workspace', async () => {
  const { config, create } = plugin();
  await config({ type: 'select_project', workspace: 'w1', gid: 'p1' });
  await config({ type: 'select_workspace', gid: 'w1' });
  assert.equal((await config({ type: 'projects', workspace: 'w1' })).selected, 'p1');
  await config({ type: 'select_workspace', gid: 'w2' });
  assert.match((await config({ type: 'select_project', workspace: 'w1', gid: 'p2' })).error, /workspace/);
  assert.equal((await config({ type: 'projects', workspace: 'w2' })).selected, '');
  assert.deepEqual(await create(), { name: 'Review', workspace: 'w2', assignee: 'me' });
});

test('an unavailable default can be cleared even if project retrieval fails', async () => {
  const { config, create, projects, tasks, stopProjectRequests } = plugin();
  assert.match((await config({ type: 'select_project', workspace: 'w1', gid: 'p3' })).error, /not accessible/);
  await config({ type: 'select_project', workspace: 'w1', gid: 'p1' });
  projects[0].archived = true;
  assert.match((await create()).error, /default project is no longer available/);
  assert.equal(tasks.length, 0);
  stopProjectRequests();
  const response = await config({ type: 'projects', workspace: 'w1' });
  assert.match(response.error, /Unable to load/);
  assert.equal(response.selected, 'p1');
  await config({ type: 'select_project', workspace: 'w1', gid: '' });
  assert.equal((await create()).projects, undefined);
});
