const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const source = fs.readFileSync(process.env.INJECTOR_PATH || require('node:path').resolve(__dirname, '../../dist/codex-environment-injector.js'), 'utf8');
function extract(name, next) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf(`  function ${next}(`, start);
  assert(start >= 0 && end > start);
  return source.slice(start, end);
}
function run(status) {
  const context = {
    window:{injector:{status:()=>status}}, INJECTOR_GLOBAL_KEY:'injector',
    state:{proofByThread:{t:status.currentProof}},
    proofMatchesProfile:(p,id)=>p?.profileId===id && p.matchesCurrentProfile===true,
  };
  vm.createContext(context);
  vm.runInContext(extract('environmentStatusLabel','replaceStatusNavText') +
    extract('bindingStatus','InspectorTabs') +
    extract('currentBindingStatus','renderCurrentProfileView'), context);
  return {
    label:context.environmentStatusLabel(),
    react:context.bindingStatus({status}),
    vanilla:context.currentBindingStatus(status.currentProfileBinding, status.currentThreadId),
  };
}
const base = {currentThreadId:'t',currentProfileId:'work',profiles:[{id:'work',name:'work'}]};
const binding = {profileId:'work',applied:true,proofId:'p'};
const proof = {profileId:'work',matchesCurrentProfile:true,status:'acknowledged',proofId:'p',payloadDigest:'sha256:'+'a'.repeat(64)};
test('unconfirmed binding is not presented as success', () => {
  const r = run({...base,currentProfileBinding:{...binding,applied:false}});
  assert.match(r.label,/未确认/);
});
test('applied without proof cannot be confirmed in either renderer', () => {
  const r=run({...base,currentProfileBinding:binding});
  assert.notEqual(r.react.kind,'confirmed');
  assert.notEqual(r.vanilla.kind,'confirmed');
});
test('matching acknowledgment means forwarding, not model behavior', () => {
  const r=run({...base,currentProfileBinding:binding,currentProof:proof});
  assert.match(r.label,/转发已确认/);
  assert.equal(r.react.kind,'confirmed');
  assert.equal(r.vanilla.kind,'confirmed');
  assert.match(r.react.detail,/行为/);
});
for (const [name,p] of Object.entries({wrongId:{...proof,proofId:'other'},noDigest:{...proof,payloadDigest:null},failed:{...proof,status:'failed'}})) {
  test(name+' is never confirmed',()=>{
    const r=run({...base,currentProfileBinding:binding,currentProof:p});
    assert.notEqual(r.react.kind,'confirmed');
    assert.notEqual(r.vanilla.kind,'confirmed');
    assert.doesNotMatch(r.label,/转发已确认/);
  });
}
test('pending environment remains a next-conversation label',()=>{
  const r=run({...base,currentThreadId:'',pendingProfileId:'work'});
  assert.match(r.label,/下次环境: work/);
});
