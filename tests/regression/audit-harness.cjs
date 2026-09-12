const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const sourcePath = require('node:path').resolve(__dirname, '../../dist/codex-environment-injector.js');
const source = fs.readFileSync(sourcePath,'utf8');
const syntax = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(syntax));
  ts.forEachChild(node, visit);
}
visit(syntax);
function functionSource(name) {
  const result = functions.get(name);
  if (!result) throw Error('Missing function '+name);
  return result;
}
function hookGlobals(react) {
  return Object.fromEntries([...new Set(source.match(/\bimport_react\d*\b/g))].map(name=>[name,react]));
}
function coreHarness() {
  let script=source.split('/* Codex++ Environment Studio')[0];
  const apiStart=source.indexOf('  const publicApi = {');
  const storeMethods=source.slice(source.indexOf('    replaceEnvironmentStore:',apiStart),
    source.indexOf('    setPromptOnNewThread:',apiStart));
  script=script.replace(/  const ENVIRONMENT_BUNDLE = .*;\r?\n/,
    '  const ENVIRONMENT_BUNDLE = '+JSON.stringify({profiles:[{id:'a',name:'A',developerInstructions:'Rule A'}]})+';\n');
  // Instrument the shipped test-only branch inside an isolated VM, not disk.
  script=script.replace('    const testApi = {',`    const testApi = {
      ${storeMethods}
      publicStatus, refreshEnvironmentData, saveEnvironmentStore, loadEnvironmentStore,
      ...(typeof switchThreadProfile === "function" ? {switchThreadProfile} : {}),
      ...(typeof currentSwitchStatus === "function" ? {currentSwitchStatus} : {}),
      saveEnvironmentProfile, assertSafeProfile, assertSafeDraft,
      normalizeEnvironmentStore, renderAgentsView,
      configureAgentsFixture:(root,source)=>{agentsRoot=root;bridgeAgents=source;bridgeCapabilities={diskWrite:true};panelMode="agents";},
      setStore: value => {environmentStore=normalizeEnvironmentStore(value);refreshProfileCatalog();state=loadState();},
      getStore:()=>environmentStore,
      installScanFixture: (promise, fiberController) => {
        preferredAssetUrls=()=>["fixture"];
        importAsset=()=>promise;
        moduleCandidates=m=>[m];
        patchFromReactFibers=()=>fiberController ? Number(patchClient(fiberController)) : 0;
      },
      scanClients,
    `);
  const storage=new Map();const timers=[];
  const ctx={
    AbortController,TextEncoder,crypto:crypto.webcrypto,URL,Element:class {},Node:class {},
    document:{querySelector:()=>null},location:{href:'app://-/index.html'},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    CustomEvent:class {},console,
    window:{__CODEX_ENVIRONMENT_INJECTOR_TEST__:true,dispatchEvent(){},
      clearTimeout(){},clearInterval(){},setTimeout:(cb,delay)=>{timers.push({cb,delay});return timers.length;}},
  };
  vm.createContext(ctx);vm.runInContext(script,ctx);
  vm.runInContext(`
    class Client {
      async sendRequest(m,p,...rest){return this.enqueueRequest(m,p,...rest)}
      enqueueRequest(m,p,...rest){return this.answer(m,p,...rest)}
      async prewarmThreadStart(p,...rest){return this.enqueueRequest("prewarm",p,...rest)}
      constructor(){this.answer=()=>({thread:{id:"t"}})}
    }
    globalThis.Client=Client;
  `,ctx);
  const client=new ctx.Client(),controller={requestClient:client,threadCreation:{}};
  return {api:ctx.window.__codexEnvironmentInjectorTest,storage,ctx,client,controller,timers};
}
function block(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  if(a<0||b<0)throw Error('Missing source boundary');
  return source.slice(a,b);
}
function hooks() {
  const values=[],effects=[],dependencies=[];let cursor=0;
  return {values,effects,reset(){cursor=0;effects.length=0},
    react:{
      useMemo:cb=>cb(),
      useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;
        return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}];},
      useRef(initial){const i=cursor++;if(!(i in values))values[i]={current:initial};return values[i];},
      useEffect(cb,deps){const i=cursor++;
        if(!dependencies[i]||deps.some((v,n)=>v!==dependencies[i][n])){dependencies[i]=deps;effects.push(cb);}},
    },
  };
}
function studioHarness(core, apiOverrides = {}) {
  const h=hooks(),saved=[],messages=[],exported=[];let confirmations=0;
  const src=block('  var blankForm =','  function ButtonLike(');
  const cut=src.indexOf('    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ei-backdrop ei-studio-backdrop"');
  if(cut<0)throw Error('Missing Studio return');
  const ctx={...hookGlobals(h.react),window:{confirm(){confirmations++;return true;}},
    Blob:class{constructor(data){exported.push(data)}},URL:{createObjectURL(){return 'fixture'},revokeObjectURL(){}},setTimeout(){},document:{createElement(){return {click(){}}}}};
  vm.createContext(ctx);vm.runInContext(src.slice(0,cut)+'return {save,validate,exportToml,loadAgents,form,selectProfile,createNew};\n}\n',ctx);
  function render(){h.reset();return ctx.StudioDialog({
    api:{replaceEnvironmentStore:s=>saved.push(s),saveProfile:(profile,options)=>saved.push({profile,options}),
      validateProfileData:profile=>coreHarness().api.assertSafeProfile(profile),setNext(){},...apiOverrides},
    store:{showToast:m=>messages.push(m)},core,
  });}
  const view=render();
  return {h,saved,exported,render,view,get confirmations(){return confirmations},likelySecret:ctx.likelySecret};
}
function agentsHarness(core,bridgeCall,apiOverrides = {}) {
  const h=hooks();
  const src=functionSource('AgentsView');
  const cut=src.indexOf('    return /* @__PURE__ */');
  const ctx=hookGlobals(h.react);
  vm.createContext(ctx);vm.runInContext(functionSource('useDraftEditor')+'\n'+
    src.slice(0,cut)+'return {runPreview,commit,draft,preview,edit};\n}\n',ctx);
  return {h,render(nextCore=core){h.reset();return ctx.AgentsView({api:{bridgeCall,validateDraftData:text=>coreHarness().api.assertSafeDraft(text),updateUiPreferences(){},refreshBridge:async()=>{},...apiOverrides},
    store:{showToast(){}},core:nextCore});}};
}
module.exports={source,sourcePath,coreHarness,studioHarness,agentsHarness,block};
