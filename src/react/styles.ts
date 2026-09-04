export const REACT_UI_STYLES = `
:host { all: initial; color-scheme: light dark; }
* { box-sizing: border-box; }
button, input, select, textarea { font: inherit; }
.ei-shell { position: fixed; inset: 0; z-index: 2147483200; pointer-events: none; color: var(--color-text, CanvasText); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.ei-pill { position: fixed; right: 16px; bottom: 16px; pointer-events: auto; appearance: none; border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 999px; padding: 8px 12px; background: color-mix(in srgb, var(--color-surface, Canvas) 94%, transparent); color: inherit; box-shadow: 0 6px 24px rgba(0,0,0,.2); cursor: pointer; backdrop-filter: blur(14px); font-size: 12px; font-weight: 650; }
.ei-pill:hover { border-color: color-mix(in srgb, var(--color-token-primary, #3b82f6) 58%, transparent); transform: translateY(-1px); }
.ei-backdrop { position: fixed; inset: 0; display: grid; place-items: center; padding: 16px; pointer-events: auto; background: rgba(0,0,0,.44); backdrop-filter: blur(3px); animation: ei-fade .15s ease-out; }
.ei-dialog { width: min(440px, calc(100vw - 24px)); max-height: min(760px, calc(100vh - 32px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); border-radius:14px; background:color-mix(in srgb,var(--color-surface,Canvas) 98%,transparent); color:inherit; box-shadow:0 16px 48px rgba(0,0,0,.3); animation: ei-dialog .17s cubic-bezier(.2,.8,.2,1); transition: width .18s ease,height .18s ease,border-radius .18s ease; }
.ei-dialog[data-mode="select"] { width:min(700px,calc(100vw - 24px)); }
.ei-dialog:not([data-mode="select"]) { width:min(840px,calc(100vw - 24px)); height:auto; max-height:min(780px,calc(100vh - 24px)); }
.ei-dialog[data-mode="memory"],.ei-dialog[data-mode="agents"] { height:min(760px,calc(100vh - 24px)); }
.ei-dialog[data-expanded="true"] { width: calc(100vw - 24px) !important; height: calc(100vh - 24px) !important; max-height: none; border-radius: 14px; }
.ei-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 14px 16px 11px; border-bottom: 1px solid color-mix(in srgb, CanvasText 9%, transparent); }
.ei-header-copy { min-width: 0; }
.ei-header h2 { margin: 0; font-size: 17px; line-height: 22px; letter-spacing: -.01em; }
.ei-header p { margin:2px 0 0; color:color-mix(in srgb,CanvasText 58%,transparent); font-size:11px; line-height:15px; }
.ei-main-header { align-items:center; padding:10px 14px 7px; }
.ei-main-header h2 { font-size:15px; }
.ei-main-header p { display:none; }
.ei-header-actions { display: flex; gap: 4px; }
.ei-icon-button { width: 30px; height: 30px; display: grid; place-items: center; appearance: none; border: 0; border-radius: 8px; background: transparent; color: color-mix(in srgb, CanvasText 68%, transparent); cursor: pointer; font-size: 18px; }
.ei-icon-button:hover,.ei-icon-button:focus-visible { background: color-mix(in srgb, CanvasText 8%, transparent); color: CanvasText; outline: none; }
.ei-main-layout { min-height:0; flex:1 1 auto; display:grid; grid-template-columns:145px minmax(0,1fr); overflow:hidden; }
.ei-scope-nav { min-height:0; display:grid; align-content:start; gap:14px; padding:12px 8px; border-right:1px solid color-mix(in srgb,CanvasText 7%,transparent); }
.ei-scope-nav-group { display:grid; gap:2px; }
.ei-scope-nav-group>span { padding:0 8px 4px; color:color-mix(in srgb,CanvasText 38%,transparent); font-size:9px; font-weight:700; letter-spacing:.08em; }
.ei-scope-nav-group button { width:100%; appearance:none; border:0; border-radius:6px; padding:7px 8px; background:transparent; color:color-mix(in srgb,CanvasText 62%,transparent); text-align:left; cursor:pointer; font-size:11px; }
.ei-scope-nav-group button:hover,.ei-scope-nav-group button:focus-visible { background:color-mix(in srgb,CanvasText 5%,transparent); color:CanvasText; outline:none; }
.ei-scope-nav-group button[aria-current="page"] { background:color-mix(in srgb,var(--color-token-primary,#3b82f6) 9%,transparent); color:CanvasText; font-weight:650; box-shadow:inset 2px 0 0 var(--color-token-primary,#3b82f6); }
.ei-scope-header { display:flex; align-items:flex-start; gap:10px; padding:1px 0 8px; border-bottom:1px solid color-mix(in srgb,CanvasText 7%,transparent); }
.ei-scope-header>span { flex:none; margin-top:2px; padding:2px 6px; border-radius:999px; background:color-mix(in srgb,CanvasText 7%,transparent); color:color-mix(in srgb,CanvasText 58%,transparent); font-size:9px; font-weight:700; }
.ei-scope-header>span[data-scope="会话级"] { background:color-mix(in srgb,#3b82f6 12%,transparent); color:#72a7f8; }
.ei-scope-header>span[data-scope="全局"] { background:color-mix(in srgb,#8b5cf6 12%,transparent); color:#a78bfa; }
.ei-scope-header>div { min-width:0; display:grid; gap:2px; }
.ei-scope-header h3 { margin:0; font-size:13px; line-height:18px; }
.ei-scope-header p { margin:0; color:color-mix(in srgb,CanvasText 50%,transparent); font-size:10px; line-height:15px; }
.ei-scope-toggle { display:flex; align-items:center; gap:7px; padding:8px 2px 0; color:color-mix(in srgb,CanvasText 62%,transparent); font-size:11px; cursor:pointer; }
.ei-scope-toggle input { accent-color:var(--color-token-primary,#3b82f6); }
.ei-tabs { display: flex; gap: 3px; padding: 6px 8px 0; overflow-x: auto; }
.ei-tab { flex:none; appearance:none; border:0; border-radius:0; padding:7px 9px 8px; background:transparent; color:color-mix(in srgb,CanvasText 55%,transparent); cursor:pointer; font-size:12px; font-weight:600; }
.ei-tab:hover,.ei-tab:focus-visible { color:CanvasText; outline:none; }
.ei-tab[aria-selected="true"] { color:CanvasText; box-shadow:inset 0 -2px 0 var(--color-token-primary,#3b82f6); }
.ei-body { min-height: 0; flex: 1 1 auto; display: grid; align-content: start; gap: 8px; padding: 10px 12px 12px; overflow: auto; overscroll-behavior: contain; }
.ei-body-current { grid-template-columns:1fr; gap:12px; }
.ei-heading { display: grid; gap: 3px; padding: 2px 2px 4px; }
.ei-heading h3 { margin: 0; font-size: 14px; }
.ei-heading p,.ei-help,.ei-note { margin: 0; color: color-mix(in srgb, CanvasText 55%, transparent); font-size: 10px; line-height: 16px; }
.ei-current-summary { display:grid; gap:5px; padding:4px 2px 10px; border-bottom:1px solid color-mix(in srgb,CanvasText 8%,transparent); }
.ei-current-title { display:flex; align-items:center; gap:8px; min-width:0; }
.ei-current-title strong { font-size:16px; line-height:22px; }
.ei-current-status { color:color-mix(in srgb,CanvasText 58%,transparent); font-size:11px; }
.ei-current-summary p { margin:0; color:color-mix(in srgb,CanvasText 62%,transparent); font-size:11px; }
.ei-status-dot { width:7px; height:7px; flex:none; border-radius:50%; background:#8a8a8a; }
.ei-status-dot[data-kind="confirmed"] { background:#39b77a; box-shadow:0 0 0 3px color-mix(in srgb,#39b77a 12%,transparent); }
.ei-status-dot[data-kind="unconfirmed"],.ei-status-dot[data-kind="unknown"] { background:#d99124; }
.ei-inspector { overflow:hidden; border:1px solid color-mix(in srgb,CanvasText 10%,transparent); border-radius:9px; background:color-mix(in srgb,CanvasText 1.5%,transparent); }
.ei-inspector-tabs { display:flex; gap:2px; overflow-x:auto; padding:5px 6px; border-bottom:1px solid color-mix(in srgb,CanvasText 8%,transparent); }
.ei-inspector-tabs button { display:flex; align-items:center; gap:5px; appearance:none; border:0; border-radius:5px; padding:5px 8px; background:transparent; color:color-mix(in srgb,CanvasText 55%,transparent); cursor:pointer; font-size:10px; }
.ei-inspector-tabs button[aria-selected="true"] { background:color-mix(in srgb,CanvasText 7%,transparent); color:CanvasText; }
.ei-inspector-tabs button span { min-width:15px; padding:0 4px; border-radius:999px; background:color-mix(in srgb,CanvasText 7%,transparent); font-size:8px; text-align:center; }
.ei-inspector>.ei-pre { border:0; }
.ei-hero { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid color-mix(in srgb, CanvasText 10%, transparent); border-radius: 12px; background: color-mix(in srgb, CanvasText 3%, transparent); }
.ei-hero-head { display: flex; justify-content: space-between; gap: 12px; }
.ei-eyebrow { display: block; color: color-mix(in srgb, CanvasText 52%, transparent); font-size: 10px; }
.ei-hero strong { display: block; font-size: 15px; }
.ei-badge { height: fit-content; padding: 3px 8px; border-radius: 999px; background: color-mix(in srgb, CanvasText 8%, transparent); color: color-mix(in srgb, CanvasText 72%, transparent); font-size: 10px; font-weight: 700; }
.ei-badge[data-kind="confirmed"] { background: color-mix(in srgb,#22a06b 15%,transparent); color:#3fbf88; }
.ei-thread { color: color-mix(in srgb, CanvasText 54%, transparent); font: 10px/14px ui-monospace,Consolas,monospace; overflow-wrap:anywhere; }
.ei-meta { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:0 14px; border-block:1px solid color-mix(in srgb,CanvasText 7%,transparent); }
.ei-meta-row { min-width:0; min-height:34px; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:5px 2px; border:0; border-bottom:1px solid color-mix(in srgb,CanvasText 5%,transparent); border-radius:0; }
.ei-meta-row span { color: color-mix(in srgb,CanvasText 52%,transparent); font-size:10px; }
.ei-meta-row code { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:CanvasText; font:10px/14px ui-monospace,Consolas,monospace; }
.ei-meta-flat { padding:6px 8px; border:0; }
.ei-meta-flat .ei-meta-row { min-height:32px; border:0; border-radius:0; padding:5px 8px; }
.ei-disclosure { overflow:hidden; border:0; border-bottom:1px solid color-mix(in srgb,CanvasText 9%,transparent); border-radius:0; background:transparent; }
.ei-disclosure-trigger { width:100%; min-height:38px; display:flex; align-items:center; justify-content:space-between; gap:12px; appearance:none; border:0; padding:8px 2px; color:color-mix(in srgb,CanvasText 76%,transparent); background:transparent; text-align:left; cursor:pointer; font-size:11px; font-weight:620; }
.ei-disclosure-trigger:hover,.ei-disclosure-trigger:focus-visible { color:CanvasText; outline:none; }
.ei-disclosure-end { flex:none; display:flex; align-items:center; gap:7px; }
.ei-disclosure-meta { color:color-mix(in srgb,CanvasText 45%,transparent); font-size:9px; font-weight:500; }
.ei-chevron { font-size:15px; transform:rotate(-90deg); transition:transform .16s ease; }
.ei-disclosure[data-open="true"] .ei-chevron { transform:rotate(0deg); }
.ei-disclosure-body { border-top:1px solid color-mix(in srgb,CanvasText 8%,transparent); animation:ei-reveal .14s ease-out; }
.ei-pre { max-height:min(42vh,360px); margin:0; padding:11px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; color:color-mix(in srgb,CanvasText 82%,transparent); background:color-mix(in srgb,CanvasText 2%,transparent); font:10px/16px ui-monospace,Consolas,monospace; }
.ei-pre[data-empty="true"] { color:color-mix(in srgb,CanvasText 45%,transparent); font-family:inherit; }
.ei-profile-list { display:grid; gap:0; }
.ei-profile { width:100%; min-height:48px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 6px; appearance:none; border:0; border-bottom:1px solid color-mix(in srgb,CanvasText 7%,transparent); border-radius:0; background:transparent; color:inherit; text-align:left; cursor:pointer; }
.ei-profile:hover,.ei-profile:focus-visible { background:color-mix(in srgb,CanvasText 5%,transparent); outline:none; }
.ei-profile[data-selected="true"] { background:color-mix(in srgb,var(--color-token-primary,#3b82f6) 9%,transparent); box-shadow:inset 2px 0 0 var(--color-token-primary,#3b82f6); }
.ei-profile-copy { min-width:0; display:grid; gap:3px; }
.ei-profile-copy strong,.ei-profile-copy small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ei-profile-copy small { color:color-mix(in srgb,CanvasText 58%,transparent); font-size:11px; }
.ei-check { width:22px; height:22px; display:grid; place-items:center; border:1px solid color-mix(in srgb,CanvasText 18%,transparent); border-radius:50%; }
.ei-profile[data-selected="true"] .ei-check { border-color:var(--color-token-primary,#3b82f6); background:var(--color-token-primary,#3b82f6); color:white; }
.ei-footer { display:grid; gap:7px; padding:10px 14px 12px; border-top:1px solid color-mix(in srgb,CanvasText 9%,transparent); background:color-mix(in srgb,CanvasText 2.5%,transparent); }
.ei-toggle { display:flex; align-items:center; gap:8px; width:fit-content; cursor:pointer; font-size:12px; }
.ei-toggle input { accent-color:var(--color-token-primary,#3b82f6); }
.ei-card { display:grid; gap:8px; padding:4px 0 0; border:0; background:transparent; }
.ei-textarea { width:100%; min-height:150px; resize:vertical; border:1px solid color-mix(in srgb,CanvasText 12%,transparent); border-radius:9px; padding:10px; background:color-mix(in srgb,CanvasText 2%,transparent); color:CanvasText; outline:none; font:10px/16px ui-monospace,Consolas,monospace; }
.ei-textarea-tall { min-height:clamp(170px,30vh,270px); }
.ei-actions { display:flex; flex-wrap:wrap; gap:7px; }
.ei-button { appearance:none; border:1px solid color-mix(in srgb,CanvasText 12%,transparent); border-radius:8px; padding:6px 9px; background:color-mix(in srgb,CanvasText 4%,transparent); color:CanvasText; cursor:pointer; font-size:10px; font-weight:650; }
.ei-button:hover:not(:disabled),.ei-button:focus-visible { background:color-mix(in srgb,CanvasText 8%,transparent); outline:none; }
.ei-button-primary { border-color:color-mix(in srgb,var(--color-token-primary,#3b82f6) 55%,transparent); background:color-mix(in srgb,var(--color-token-primary,#3b82f6) 14%,transparent); }
.ei-button:disabled { opacity:.38; cursor:not-allowed; }
.ei-status { min-height:16px; margin:0; color:color-mix(in srgb,CanvasText 52%,transparent); font-size:10px; }
.ei-status[data-kind="success"] { color:#3fbf88; }.ei-status[data-kind="error"] { color:#ef6b73; }
.ei-steps { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.ei-step { display:grid; grid-template-columns:26px minmax(0,1fr); gap:9px; padding:8px 2px; border:0; }
.ei-step-number { width:24px; height:24px; display:grid; place-items:center; border-radius:50%; background:color-mix(in srgb,var(--color-token-primary,#3b82f6) 16%,transparent); color:var(--color-token-primary,#3b82f6); font-size:11px; font-weight:750; }
.ei-step h4,.ei-step p { margin:0; }.ei-step h4 { font-size:11px; }.ei-step p { color:color-mix(in srgb,CanvasText 58%,transparent); font-size:10px; line-height:16px; }
.ei-tutorial-copy { display:grid; gap:7px; padding:10px 11px; }.ei-tutorial-copy p { margin:0; color:color-mix(in srgb,CanvasText 58%,transparent); font-size:10px; line-height:16px; }
.ei-studio-backdrop { z-index:3; }
.ei-studio-dialog { width:min(980px,calc(100vw - 24px)); height:min(680px,calc(100vh - 24px)); display:grid; grid-template-rows:auto minmax(0,1fr); overflow:hidden; border:1px solid color-mix(in srgb,CanvasText 13%,transparent); border-radius:14px; background:color-mix(in srgb,var(--color-surface,Canvas) 98%,transparent); color:inherit; box-shadow:0 18px 56px rgba(0,0,0,.34); }
.ei-studio-layout { min-height:0; display:grid; grid-template-columns:205px minmax(0,1fr); }
.ei-studio-sidebar { min-height:0; display:grid; align-content:start; gap:0; overflow:auto; padding:10px; border-right:1px solid color-mix(in srgb,CanvasText 8%,transparent); }
.ei-studio-profile { width:100%; display:grid; gap:2px; appearance:none; border:0; border-radius:6px; padding:8px 9px; background:transparent; color:inherit; text-align:left; cursor:pointer; }
.ei-studio-profile:hover,.ei-studio-profile[data-active="true"] { background:color-mix(in srgb,var(--color-token-primary,#3b82f6) 8%,transparent); }
.ei-studio-profile[data-active="true"] { box-shadow:inset 2px 0 0 var(--color-token-primary,#3b82f6); }
.ei-studio-profile small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:color-mix(in srgb,CanvasText 55%,transparent); font-size:10px; }
.ei-studio-editor { min-height:0; display:grid; grid-template-rows:auto minmax(0,1fr) auto auto; overflow:hidden; }
.ei-studio-editor-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px 8px; border-bottom:1px solid color-mix(in srgb,CanvasText 7%,transparent); }
.ei-studio-editor-head>div { min-width:0; display:flex; align-items:baseline; gap:7px; }
.ei-studio-editor-head strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
.ei-studio-editor-head span { color:color-mix(in srgb,CanvasText 50%,transparent); font-size:10px; }
.ei-studio-tabs { display:flex; gap:2px; }
.ei-studio-tabs button { appearance:none; border:0; border-radius:5px; padding:5px 8px; background:transparent; color:color-mix(in srgb,CanvasText 52%,transparent); cursor:pointer; font-size:10px; }
.ei-studio-tabs button[aria-selected="true"] { background:color-mix(in srgb,CanvasText 7%,transparent); color:CanvasText; }
.ei-studio-content { min-height:0; overflow:auto; padding:16px; }
.ei-studio-section { display:grid; gap:12px; }
.ei-studio-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px 14px; }
.ei-studio-grid-compact { max-width:760px; }
.ei-studio-field { min-width:0; display:grid; gap:5px; }
.ei-studio-field>span { color:color-mix(in srgb,CanvasText 60%,transparent); font-size:11px; }
.ei-studio-field-full { grid-column:1 / -1; }
.ei-studio-input { width:100%; min-height:36px; border:1px solid color-mix(in srgb,CanvasText 13%,transparent); border-radius:6px; padding:6px 8px; background:color-mix(in srgb,CanvasText 3%,transparent); color:inherit; outline:none; }
.ei-studio-input:focus,.ei-studio-field .ei-textarea:focus { border-color:var(--color-token-primary,#3b82f6); }
.ei-studio-import { width:fit-content; appearance:none; border:0; border-radius:6px; padding:6px 8px; background:color-mix(in srgb,CanvasText 6%,transparent); color:inherit; cursor:pointer; font-size:10px; font-weight:650; }
.ei-studio-import input { display:none; }
.ei-studio-textarea { min-height:170px; }
.ei-studio-code { min-height:360px; }
.ei-studio-savebar { display:flex; align-items:center; gap:7px; padding:9px 16px; border-top:1px solid color-mix(in srgb,CanvasText 8%,transparent); background:color-mix(in srgb,var(--color-surface,Canvas) 98%,transparent); }
.ei-studio-spacer { flex:1; }
.ei-studio-status { padding:0 16px 8px; }
.ei-toast { position:fixed; right:16px; bottom:58px; max-width:360px; pointer-events:none; padding:8px 11px; border-radius:9px; background:#111827; color:white; box-shadow:0 8px 28px rgba(0,0,0,.3); font-size:12px; }
.ei-toast[data-kind="error"] { background:#991b1b; }.ei-toast[data-kind="success"] { background:#166534; }
@keyframes ei-fade { from{opacity:0} to{opacity:1} } @keyframes ei-dialog { from{opacity:0;transform:translateY(8px) scale(.985)} to{opacity:1;transform:none} } @keyframes ei-reveal { from{opacity:0;transform:translateY(-3px)} to{opacity:1;transform:none} }
@media(max-width:760px){.ei-main-layout{grid-template-columns:1fr}.ei-scope-nav{display:flex;gap:4px;overflow-x:auto;padding:6px;border-right:0;border-bottom:1px solid color-mix(in srgb,CanvasText 7%,transparent)}.ei-scope-nav-group{display:flex;gap:2px}.ei-scope-nav-group>span{display:none}.ei-scope-nav-group button{width:auto;white-space:nowrap}.ei-scope-nav-group button[aria-current="page"]{box-shadow:inset 0 -2px 0 var(--color-token-primary,#3b82f6)}.ei-body-current{grid-template-columns:1fr}.ei-meta{grid-template-columns:repeat(2,minmax(0,1fr))}.ei-studio-layout{grid-template-columns:1fr}.ei-studio-sidebar{max-height:150px;border-right:0;border-bottom:1px solid color-mix(in srgb,CanvasText 10%,transparent)}.ei-studio-editor-head{align-items:stretch;flex-direction:column}.ei-studio-tabs{overflow-x:auto}.ei-studio-grid{grid-template-columns:1fr}.ei-studio-field-full{grid-column:1}.ei-studio-savebar{flex-wrap:wrap}.ei-studio-spacer{display:none}}
@media(max-width:560px){.ei-backdrop{padding:8px}.ei-dialog,.ei-dialog:not([data-mode="select"]),.ei-dialog[data-expanded="true"]{width:calc(100vw - 16px)!important;height:calc(100vh - 16px)!important;max-height:none;border-radius:14px}.ei-meta,.ei-steps{grid-template-columns:1fr}.ei-body{padding:8px}.ei-header{padding:11px 12px 9px}}
@media(prefers-reduced-motion:reduce){.ei-dialog,.ei-backdrop,.ei-disclosure-body,.ei-chevron{animation:none;transition:none}}
`
