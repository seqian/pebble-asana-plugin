const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/plugin/core.js');
test('no project and no due date', () => {
 const result=core.taskPayload({title:' Buy milk '},'workspace1',null,'user1');
 assert.deepEqual(result,{data:{name:'Buy milk',workspace:'workspace1',assignee:'user1'}});
});
test('a selected project is assigned',()=>{
 const result=core.taskPayload({title:'Review'},'ws','project1','me');
 assert.deepEqual(result.data.projects,['project1']);
});
test('due instant is converted to UTC',()=>{
 const data=core.taskPayload({title:'Review',due_iso:'2026-11-21T09:00:00-05:00',timezone:'America/Toronto'},'ws',null,'me').data;
 assert.equal(data.due_at,'2026-11-21T14:00:00.000Z');
});
test('invalid dates rejected',()=>{
 assert.equal(core.dueInstant('2026-02-30T12:00:00-05:00'),null);
 assert.equal(core.dueInstant('2026-11-20'),null);
 assert.throws(()=>core.taskPayload({title:'x',due_iso:'2026-11-20T12:00:00Z'},'ws',null,'me'),/timezone/);
});
test('unique project match is case-insensitive',()=>{
 const projects=[{gid:'1',name:'Product Roadmap'},{gid:'2',name:'Operations'}];
 assert.equal(core.resolveProject(projects,' product  ROADMAP ').project.gid,'1');
 assert.match(core.resolveProject(projects,'unknown').error,/No project/);
 assert.match(core.resolveProject([...projects,{gid:'3',name:'PRODUCT ROADMAP'}],'Product Roadmap').error,/More than one/);
});
test('pagination next_page offset',()=>{assert.equal(core.nextPage({next_page:{offset:'a'}}),'a');assert.equal(core.nextPage({next_page:null}),null)});
