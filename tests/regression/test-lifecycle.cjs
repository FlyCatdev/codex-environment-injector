const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = process.env.INJECTOR_PATH || require('node:path').resolve(__dirname, '../../dist/codex-environment-injector.js');
function harness() {
  let source=fs.readFileSync(path,'utf8').split('/* Codex++ Environment Studio')[0];
  source=source.replace(/  const ENVIRONMENT_BUNDLE = .*;\r?\n/, '  const ENVIRONMENT_BUNDLE = '+JSON.stringify({
    profiles:[{id:'a',name:'A',developerInstructions:'Rule A',baseInstructions:''},{id:'b',name:'B',developerInstructions:'Rule B'}]
  })+';\n');
  source=source.replace('    const testApi = {','    const testApi = { publicStatus, recordThreadProof, observePendingProfileForTurn, handleThreadStarted,');
  const storage=new Map();
  const ctx={AbortController,TextEncoder,crypto:crypto.webcrypto,URL,Element:class {},Node:class {},
    document:{querySelector:()=>null},location:{href:'app://-/index.html'},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    setTimeout,clearTimeout,CustomEvent:class {},console,
  };
  ctx.window={__CODEX_ENVIRONMENT_INJECTOR_TEST__:true,dispatchEvent(){},clearTimeout,clearInterval};
  vm.createContext(ctx);
  vm.runInContext(source,ctx);
  vm.runInContext(`
    class Client {
      async sendRequest(method,params,...rest) { return this.enqueueRequest(method,params,...rest); }
      async prewarmThreadStart(params,...rest) { return this.enqueueRequest("prewarm",params,...rest); }
      enqueueRequest(method,params,...rest) {
        this.calls.push({receiver:this,method,params,rest});
        return this.answer(method,params,...rest);
      }
      constructor() { this.calls=[]; this.answer=()=>({thread:{id:"test-thread"}}); }
    }
    globalThis.Client=Client;
  `,ctx);
  const api=ctx.window.__codexEnvironmentInjectorTest;
  const client=new ctx.Client();
  const controller={requestClient:client,threadCreation:{},prewarmedThreadManager:{discardAllPrewarmedThreads(){controller.discards++;}},discards:0};
  return {api,client,controller,Client:ctx.Client,storage};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
test('empty prompt fields inherit existing instructions rather than erase them',()=>{
  const h=harness();
  const next=h.api.applyProfileToParams({baseInstructions:'Platform base',developerInstructions:'Host developer'},{id:'a',developerInstructions:' ',baseInstructions:''});
  assert.equal(next.baseInstructions,'Platform base');
  assert.equal(next.developerInstructions,'Host developer');
});
test('all controllers sharing a patched prototype remain registered for prewarm invalidation',()=>{
  const h=harness(); h.api.patchClient(h.controller);
  const c2={requestClient:new h.Client(),threadCreation:{},prewarmedThreadManager:{discardAllPrewarmedThreads(){c2.discards++;}},discards:0};
  h.api.patchClient(c2);h.api.setPendingProfile('a');
  assert.equal(c2.discards,1);
  assert.equal(h.api.patchedClientCount(),2);
});
test('unload restores descriptors and late completion cannot persist bindings',async()=>{
  const h=harness(),d=deferred();
  const before=Object.getOwnPropertyDescriptors(h.Client.prototype);
  h.client.answer=()=>d.promise;h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  const pending=h.client.sendRequest('thread/start',{},'extra');
  assert.equal(Object.hasOwn(h.client,'sendRequest'),false);
  h.api.destroy(); const state=h.storage.get('codexpp.environmentInjector.v2');
  d.resolve({thread:{id:'test-thread'}}); await pending;
  assert.deepEqual(Object.getOwnPropertyDescriptors(h.Client.prototype),before);
  assert.equal(h.storage.get('codexpp.environmentInjector.v2'),state);
});
test('fork acknowledgment must reference the new child, never use parent as fallback',async()=>{
  const h=harness();h.api.patchClient(h.controller);h.api.bindThreadProfile('parent','a',{applied:false});
  h.client.answer=()=>({});await h.client.sendRequest('thread/fork',{threadId:'parent'});
  assert.equal(h.api.environmentStore().proofByThread.parent,undefined);
  assert.equal(h.api.threadProfileEntry('parent').applied,false);
});
test('nested prewarm->start forwards one environment and one proof',async()=>{
  const h=harness();h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  h.client.answer=(m,p)=>m==='prewarm'?h.client.sendRequest('thread/start',p):({thread:{id:'test-thread'}});
  await h.client.prewarmThreadStart({});
  const stages=h.api.publicStatus().requestTrace.map(t=>t.stage);
  assert.equal(stages.filter(s=>s.includes('acknowledged')).length,1);
});
test('a failed resume invalidates old success without logging raw error contents',async()=>{
  const h=harness();h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  await h.client.sendRequest('thread/start',{});
  h.client.answer=()=>Promise.reject(Error('PRIVATE_TEST_PAYLOAD'));
  await assert.rejects(h.client.sendRequest('thread/resume',{threadId:'test-thread'}));
  const s=h.api.environmentStore();
  assert.equal(s.proofByThread['test-thread'].status,'failed');
  assert.equal(s.bindingsByThread['test-thread'].applied,false);
  assert.equal(JSON.stringify(h.api.publicStatus()).includes('PRIVATE_TEST_PAYLOAD'),false);
});
test('proof revision reflects dispatch, not edits while awaiting the response',async()=>{
  const h=harness(),d=deferred();h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  const revision=h.api.environmentStore().revision;h.client.answer=()=>d.promise;
  const pending=h.client.sendRequest('thread/start',{});
  h.api.setPendingProfile('b');d.resolve({thread:{id:'test-thread'}});await pending;
  assert.equal(h.api.environmentStore().proofByThread['test-thread'].profileRevision,revision);
  assert.equal(h.api.publicStatus().pendingProfileId,'b');
});
test('first actual turn consumes an acknowledged prewarm selection without modifying the turn',async()=>{
  const h=harness();h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  await h.client.prewarmThreadStart({});
  assert.equal(h.api.publicStatus().pendingProfileId,'a');
  const params={threadId:'test-thread',model:'user-selected'};
  await h.client.sendRequest('turn/start',params);
  assert.equal(h.api.publicStatus().pendingProfileId,'');
  assert.equal(h.client.calls.at(-1).params,params);
});
test('a late older resume cannot overwrite a newer failed resume',async()=>{
  const h=harness(),d=deferred();h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  await h.client.sendRequest('thread/start',{});
  h.client.answer=()=>d.promise;const older=h.client.sendRequest('thread/resume',{threadId:'test-thread'});
  h.client.answer=()=>Promise.reject(Error('request failed'));
  await assert.rejects(h.client.sendRequest('thread/resume',{threadId:'test-thread'}));
  d.resolve({thread:{id:'test-thread'}});await older;
  assert.equal(h.api.environmentStore().proofByThread['test-thread'].status,'failed');
});
test('receiver, remaining arguments, turn selection and unified permissions are preserved',async()=>{
  const h=harness();h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  const options={priority:'critical'},extra={x:1};
  await h.client.sendRequest('thread/start',{permissions:{profile:'workspace'}},options,extra);
  assert.equal(h.client.calls[0].receiver,h.client);
  assert.equal(h.client.calls[0].rest[0],options);
  assert.equal(h.client.calls[0].rest[1],extra);
  const p=h.api.applyProfileToParams({permissions:{profile:'workspace'}},{id:'a',sandbox:'danger-full-access',approvalPolicy:'never'});
  assert.equal(p.sandbox,undefined);assert.equal(p.approvalPolicy,undefined);
  const plain={threadId:'test-thread',model:'manual-choice'};
  await h.client.sendRequest('turn/start',plain);assert.equal(h.client.calls.at(-1).params,plain);
});
test('resume in flight is dispatched, not the old acknowledged state',async()=>{
  const h=harness(),d=deferred();h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  await h.client.sendRequest('thread/start',{});
  h.client.answer=()=>d.promise;
  const pending=h.client.sendRequest('thread/resume',{threadId:'test-thread'});
  const during=h.api.environmentStore().proofByThread['test-thread'].status;
  d.resolve({thread:{id:'test-thread'}});await pending;
  assert.equal(during,'dispatched');
  assert.equal(h.api.environmentStore().proofByThread['test-thread'].status,'acknowledged');
});
test('prewarm preserves arguments beyond options',async()=>{
  const h=harness();h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  const options={},extra={argument:'three'};
  await h.client.prewarmThreadStart({},options,extra);
  assert.equal(h.client.calls[0].rest[1],extra);
});
test('a mismatched resume response cannot bind another conversation',async()=>{
  const h=harness();h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  await h.client.sendRequest('thread/start',{});
  h.client.answer=()=>({thread:{id:'unrelated'}});
  await h.client.sendRequest('thread/resume',{threadId:'test-thread'});
  assert.equal(h.api.threadProfileEntry('unrelated'),null);
  assert.notEqual(h.api.environmentStore().proofByThread['test-thread'].status,'acknowledged');
});
test('dispatcher notification alone must never be promoted to confirmed injection',()=>{
  const h=harness();let listener;
  const dispatcher={
    __codexServiceTierOriginalDispatchMessage(){},
    dispatchMessage(){},
    subscribe(_type,callback){listener=callback;return ()=>{};},
  };
  h.api.patchClient(dispatcher);h.api.setPendingProfile('a');
  dispatcher.dispatchMessage('thread/start',{});
  listener({thread:{id:'some-notification'}});
  assert.notEqual(h.api.threadProfileEntry('some-notification')?.applied,true);
});
