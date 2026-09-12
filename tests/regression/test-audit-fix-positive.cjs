const test=require('node:test');
const assert=require('node:assert/strict');
const {coreHarness,studioHarness,agentsHarness}=require('./audit-harness.cjs');
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('core refuses duplicate create, allows intended update, and rejects stale revision',()=>{
  const h=coreHarness(),p={id:'custom',developerInstructions:'Hello',config:{}};
  h.api.saveEnvironmentProfile(p);
  assert.throws(()=>h.api.saveEnvironmentProfile({...p,developerInstructions:'Overwrite'}));
  const rev=h.api.environmentStore().revision;
  h.api.saveEnvironmentProfile({...p,developerInstructions:'Update'},{previousKey:'custom',expectedRevision:rev});
  assert.equal(h.api.environmentStore().profiles.custom.developerInstructions,'Update');
  assert.throws(()=>h.api.saveEnvironmentProfile(p,{previousKey:'custom',expectedRevision:rev}));
});
test('core rejects nested sensitive keys, accepts environment-variable references',()=>{
  const h=coreHarness();
  assert.throws(()=>h.api.saveEnvironmentProfile({id:'secret-test',config:{provider:{api_key:'AUDIT_NOT_A_CREDENTIAL'}}}));
  h.api.saveEnvironmentProfile({id:'safe',config:{model_providers:{safe:{env_key:'MY_PROVIDER_KEY'}},max_output_tokens:1024}});
});
test('storage rejection rolls back memory, not just the on-disk copy',()=>{
  const h=coreHarness();h.api.setPendingProfile('a');const before=h.api.environmentStore();
  h.ctx.localStorage.setItem=()=>{throw Error('quota')};
  assert.throws(()=>h.api.setPendingProfile('base'));
  assert.deepEqual(h.api.environmentStore(),before);
});
test('proof-storage failure must not turn an accepted thread request into a network failure',async()=>{
  const h=coreHarness();h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  h.ctx.localStorage.setItem=()=>{throw Error('quota')};
  const result=await h.client.sendRequest('thread/start',{});
  assert.equal(result.thread.id,'t');
  assert.notEqual(h.api.threadProfileEntry('t')?.applied,true);
});
test('selection-storage failure must not reject an accepted turn',async()=>{
  const h=coreHarness();h.api.patchClient(h.controller);h.api.setPendingProfile('a');await h.client.prewarmThreadStart({});
  h.ctx.localStorage.setItem=()=>{throw Error('quota')};
  const result=await h.client.sendRequest('turn/start',{threadId:'t'});
  assert.equal(result.thread.id,'t');
});
test('new safe React profile reaches core save successfully',()=>{
  const c={profiles:[],environmentStore:{revision:1,profiles:{}}},s=studioHarness(c);
  s.h.values[2]={...s.view.form,id:'new',developerInstructions:'Hello'};
  s.render().save();
  assert.equal(s.saved.length,1);
  assert.equal(s.saved[0].profile.id,'new');
});
test('a previewed unchanged draft can commit with its source hash',async()=>{
  const c={environmentStore:{ui:{}},environmentSnapshot:{},status:{capabilities:{diskWrite:true}},bridgeAgents:{content:'old',hash:'source'}};
  const calls=[],a=agentsHarness(c,async(path,p)=>{calls.push({path,p});return path.endsWith('preview')?{status:'ok',before:{hash:'source'}}:{status:'ok'}});
  a.render();a.h.effects.forEach(f=>f());
  a.render().edit('new');await a.render().runPreview();await a.render().commit();
  assert.equal(calls.at(-1).p.content,'new');assert.equal(calls.at(-1).p.expectedHash,'source');
});
test('dirty draft survives external disk changes and rejects an older preview',async()=>{
  const c={environmentStore:{ui:{}},environmentSnapshot:{},status:{capabilities:{diskWrite:true}},bridgeAgents:{content:'old',hash:'source'}};
  const calls=[],a=agentsHarness(c,async(path,p)=>{calls.push({path,p});return {status:'ok',before:{hash:'source'}}});
  a.render();a.h.effects.forEach(f=>f());a.render().edit('unsaved');
  await a.render().runPreview();
  const c2={...c,bridgeAgents:{content:'external',hash:'changed'}};
  a.render(c2);a.h.effects.forEach(f=>f());await a.render(c2).commit();
  assert.equal(a.render(c2).draft,'unsaved');
  assert.equal(calls.filter(c=>c.path.endsWith('commit')).length,0);
});
test('failed turn leaves the eligible prewarm selection available for retry',async()=>{
  const h=coreHarness();h.api.patchClient(h.controller);h.api.setPendingProfile('a');await h.client.prewarmThreadStart({});
  h.client.answer=()=>Promise.reject(Error('failed'));
  await assert.rejects(h.client.sendRequest('turn/start',{threadId:'t'}));
  assert.equal(h.api.publicStatus().pendingProfileId,'a');
});
test('destroy cancels an indefinitely pending module scan without timers or hooks',async()=>{
  const h=coreHarness();h.api.installScanFixture(new Promise(()=>{}));
  const work=h.api.scanClients();h.api.destroy();await work;
  assert.equal(h.api.patchedClientCount(),0);
});
test('already available React clients are discovered before a slow module import',async()=>{
  const h=coreHarness();h.api.installScanFixture(new Promise(()=>{}),h.controller);
  const work=h.api.scanClients();const count=h.api.patchedClientCount();h.api.destroy();await work;
  assert.equal(count,2);
});
test('vanilla textarea edits invalidate an earlier preview',async()=>{
  class El {
    constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.dataset={};this.value='';this.textContent='';}
    append(...c){this.children.push(...c)} replaceChildren(){this.children=[]}
    setAttribute(){} addEventListener(name,fn){this.listeners[name]=fn}
    click(){if(!this.disabled)return this.listeners.click?.()}
  }
  const h=coreHarness(),calls=[],root=new El('root');
  h.ctx.document.createElement=t=>new El(t);
  h.ctx.window.__codexSessionDeleteBridge=async(path,p)=>{calls.push({path,p});return {status:'ok',before:{hash:'source'},diff:{addedLines:1}}};
  h.api.configureAgentsFixture(root,{content:'old',hash:'source'});
  h.api.renderAgentsView();
  const flat=n=>[n,...n.children.flatMap(flat)],all=flat(root);
  const textarea=all.find(n=>n.tag==='textarea'),preview=all.find(n=>n.textContent==='预览写入'),commit=all.find(n=>n.textContent==='确认写入 AGENTS.md');
  textarea.value='A';await preview.click();
  textarea.value='B';textarea.listeners.input?.();
  await commit.click();
  assert.equal(calls.some(c=>c.path.endsWith('/commit')&&c.p.content==='B'),false);
});
test('quoted sensitive fields in draft text are rejected by core',()=>{
  const h=coreHarness();
  assert.throws(()=>h.api.updateUiPreferences({agentsDraft:JSON.stringify({api_key:'AUDIT_NOT_A_CREDENTIAL'})}));
});
test('sensitive fields outside config cannot be persisted as profile metadata',()=>{
  const h=coreHarness();
  assert.throws(()=>h.api.saveEnvironmentProfile({id:'x',developerInstructions:'safe',client_secret:'AUDIT_NOT_A_CREDENTIAL'}));
});
test('React export uses core validation for nested sensitive keys',()=>{
  const h=studioHarness({profiles:[],environmentStore:{revision:1,profiles:{}}});
  h.h.values[2]={...h.view.form,id:'x',configText:JSON.stringify({client_secret:'AUDIT_NOT_A_CREDENTIAL'})};
  h.render().exportToml();
  assert.equal(h.exported.length,0);
});
test('React export validates the metadata it actually exports',()=>{
  const h=studioHarness({profiles:[],environmentStore:{revision:1,profiles:{}}});
  h.h.values[2]={...h.view.form,id:'x',modelProvider:'https://audit-user:audit-placeholder@example.invalid'};
  h.render().exportToml();
  assert.equal(h.exported.length,0);
});
test('whole-store replacement cannot bypass draft validation',()=>{
  const h=coreHarness(),s=h.api.environmentStore();
  s.ui.agentsDraft=JSON.stringify({password:'AUDIT_NOT_A_CREDENTIAL'});
  assert.throws(()=>h.api.replaceEnvironmentStore(s));
});
test('React rename at 50 profiles is valid when it does not grow the set',()=>{
  const profiles=Object.fromEntries(Array.from({length:50},(_,i)=>['p'+i,{id:'p'+i}]));
  const h=studioHarness({profiles:[],environmentStore:{revision:1,profiles}});
  h.h.values[1]='p0';h.h.values[2]={...h.view.form,id:'renamed',developerInstructions:'safe'};
  assert.equal(h.render().validate(),'');
});
test('editing a pending profile invalidates prewarm without selecting it again',()=>{
  const h=coreHarness();let discarded=0;
  h.controller.prewarmedThreadManager={discardAllPrewarmedThreads(){discarded++}};
  h.api.patchClient(h.controller);h.api.setPendingProfile('a');discarded=0;
  const s=h.api.environmentStore();s.profiles['override:a']={id:'a',targetProfileId:'a',developerInstructions:'new'};
  h.api.replaceEnvironmentStore(s);
  assert.equal(discarded>0,true);
});
test('an old legacy commit cannot remove a draft saved by a rebuilt editor',async()=>{
  class El {
    constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.dataset={};this.value='';this.textContent='';}
    append(...c){this.children.push(...c)} replaceChildren(){this.children=[]}
    setAttribute(){} addEventListener(name,fn){this.listeners[name]=fn}
    click(){if(!this.disabled)return this.listeners.click?.()}
  }
  const h=coreHarness(),d=defer(),root=new El('root');
  h.ctx.document.createElement=t=>new El(t);
  h.ctx.window.__codexSessionDeleteBridge=async path=>path.endsWith('/commit')?d.promise:{status:'ok',before:{hash:'source'}};
  h.api.configureAgentsFixture(root,{content:'old',hash:'source'});h.api.renderAgentsView();
  const flat=n=>[n,...n.children.flatMap(flat)],all=flat(root);
  all.find(n=>n.tag==='textarea').value='A';
  await all.find(n=>n.textContent==='预览写入').click();
  const commit=all.find(n=>n.textContent==='确认写入 AGENTS.md').click();
  h.api.renderAgentsView();h.api.updateUiPreferences({agentsDraft:'B'});
  d.resolve({status:'ok'});await commit;
  assert.equal(h.api.environmentStore().ui.agentsDraft,'B');
});
test('legacy edits during post-commit refresh remain visible and editable',async()=>{
  class El {
    constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.dataset={};this.value='';this.textContent='';}
    append(...c){this.children.push(...c)} replaceChildren(){this.children=[]}
    setAttribute(){} addEventListener(name,fn){this.listeners[name]=fn}
    click(){if(!this.disabled)return this.listeners.click?.()}
  }
  const h=coreHarness(),delay=defer(),reached=defer(),root=new El('root');
  h.ctx.document.createElement=t=>new El(t);
  h.ctx.window.__codexSessionDeleteBridge=async path=>{
    if(path.endsWith('/capabilities')){reached.resolve();return delay.promise}
    if(path.endsWith('/agents/get'))return {status:'ok',content:'A',hash:'new-hash'};
    return {status:'ok',before:{hash:'source'}};
  };
  h.api.configureAgentsFixture(root,{content:'old',hash:'source'});h.api.renderAgentsView();
  const flat=n=>[n,...n.children.flatMap(flat)],all=flat(root),textarea=all.find(n=>n.tag==='textarea');
  textarea.value='A';await all.find(n=>n.textContent==='预览写入').click();
  const work=all.find(n=>n.textContent==='确认写入 AGENTS.md').click();await reached.promise;
  textarea.value='B';textarea.listeners.input?.();
  delay.resolve({status:'ok',diskWrite:true});await work;
  assert.equal(flat(root).find(n=>n.tag==='textarea').value,'B');
});
