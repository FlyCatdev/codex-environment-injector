// Regression expectations for newly discovered defects. The production file
// is read-only; failures are intentional audit evidence, not claimed fixes.
const test=require('node:test');
const assert=require('node:assert/strict');
const {coreHarness,studioHarness,agentsHarness}=require('./audit-harness.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const clone=o=>JSON.parse(JSON.stringify(o));
const makeStore=()=>({schemaVersion:2,revision:1,profiles:{a:{id:'a',name:'Original A',developerInstructions:'Original rule'}},
  selection:{pendingProfileId:'',promptOnNewThread:true},bindingsByThread:{},proofByThread:{},migration:{completed:true,sources:[]},ui:{}});
const core=()=>({profiles:[{id:'base'},{id:'studio:a',name:'Original A',source:'studio',developerInstructions:'Original rule'}],
  environmentStore:makeStore(),environmentSnapshot:{},status:{capabilities:{diskWrite:true}},bridgeAgents:{content:'original',hash:'old-hash'}});
test('A01 new React environment must not silently overwrite an existing ID',()=>{
  const s=studioHarness(core());
  s.h.values[2]={...s.view.form,id:'a',name:'New A',developerInstructions:'Replacement'};
  s.render().save();
  assert.equal(s.saved.length,0,'duplicate new ID was saved without a collision check');
});
test('A02 Additional Config must reject null rather than crash',()=>{
  const s=studioHarness(core());
  s.h.values[2]={...s.view.form,id:'new',configText:'null',reasoning:'medium'};
  const v=s.render();
  assert.notEqual(v.validate(),'','null JSON incorrectly passes validation');
});
test('A03 quoted sensitive JSON keys must be detected',()=>{
  const s=studioHarness(core());
  assert.equal(s.likelySecret(JSON.stringify({api_key:'AUDIT_PLACEHOLDER_NOT_A_CREDENTIAL'})),true);
});
test('A04 storage failure must propagate instead of claiming save succeeded',()=>{
  const h=coreHarness();
  h.ctx.localStorage.setItem=()=>{throw Error('quota exhausted')};
  assert.throws(()=>h.api.setPendingProfile('a'));
});
test('A05 async scan cannot reinstall hooks after destroy',async()=>{
  const h=coreHarness(),d=deferred();
  h.api.installScanFixture(d.promise);
  const work=h.api.scanClients();h.api.destroy();
  d.resolve(h.controller);await work;
  assert.equal(h.api.patchedClientCount(),0,'unloaded scanner reinstalled prototype hooks');
});
test('A06 clearing a persisted React draft must really delete it',()=>{
  const h=coreHarness(),s=makeStore();s.ui.agentsDraft='old-draft';h.api.setStore(s);
  h.api.updateUiPreferences({agentsDraft:undefined});
  assert.equal(Object.hasOwn(h.api.getStore().ui,'agentsDraft'),false);
});
test('A07 a response to an older preview must not authorize a changed draft',async()=>{
  const d=deferred(),calls=[],c=core();
  const a=agentsHarness(c,async(path,payload)=>{calls.push({path,payload});return path.endsWith('/preview')?d.promise:{status:'ok'};});
  a.render();a.h.effects.forEach(fn=>fn());
  a.h.values[0]='draft-A';
  const pending=a.render().runPreview();
  // Exactly the textarea onChange effects: change text and invalidate preview.
  a.h.values[0]='draft-B';a.h.values[1]=null;a.render();
  d.resolve({status:'ok',before:{hash:'old-hash'},diff:{addedLines:1}});
  await pending;await a.render().commit();
  assert.equal(calls.some(c=>c.path.endsWith('/commit')&&c.payload.content==='draft-B'),false,'unpreviewed draft-B was submitted');
});
test('A08 unrelated store revisions must not erase unsaved Agents text',()=>{
  const c=core(),a=agentsHarness(c,async()=>({}));
  a.render();a.h.effects.forEach(fn=>fn());a.h.values[0]='unsaved-text';
  a.render({...c,environmentStore:{...c.environmentStore,revision:2}});a.h.effects.forEach(fn=>fn());
  assert.equal(a.h.values[0],'unsaved-text');
});
test('A09 editing a pending environment must invalidate its earlier prewarm cache',()=>{
  const h=coreHarness();let discarded=0;
  h.controller.prewarmedThreadManager={discardAllPrewarmedThreads(){discarded++}};
  h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  discarded=0;
  const s=h.api.environmentStore();
  s.profiles['override:a']={id:'a',targetProfileId:'a',developerInstructions:'Changed rule'};
  h.api.replaceEnvironmentStore(s);h.api.setPendingProfile('a');
  assert.equal(discarded>0,true,'same ID with changed content did not invalidate cache');
});
test('A10 profile edits must not make historical proof confirm the new contents',async()=>{
  const h=coreHarness();h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  await h.client.sendRequest('thread/start',{});
  const originalProof=h.api.environmentStore().proofByThread.t;
  const s=h.api.environmentStore();s.profiles['override:a']={id:'a',targetProfileId:'a',developerInstructions:'New never-sent rule'};
  h.api.replaceEnvironmentStore(s);
  assert.notEqual(h.api.currentBindingStatus(h.api.threadProfileEntry('t'),'t').kind,'confirmed',
    'historical proof still confirms a newly edited profile');
  assert(originalProof);
});
test('A11 using an old same-profile thread must not consume the next new-thread choice',async()=>{
  const h=coreHarness();h.api.patchClient(h.controller);h.api.setPendingProfile('a');
  await h.client.sendRequest('thread/start',{});
  // A separate user choice for the next conversation, followed by a turn
  // in an older conversation that happens to have the same profile ID.
  h.api.setPendingProfile('a');
  await h.client.sendRequest('turn/start',{threadId:'t'});
  assert.equal(h.api.publicStatus().pendingProfileId,'a',
    'an old conversation consumed the choice intended for a new conversation');
});
