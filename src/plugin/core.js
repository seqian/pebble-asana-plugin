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
