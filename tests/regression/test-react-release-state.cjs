const test = require('node:test');
const assert = require('node:assert/strict');
const { coreHarness, studioHarness, agentsHarness } = require('./audit-harness.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Flush the passive effects after each rendered snapshot, including preference
// deletion. Older tests did not re-render between commit and Bridge refresh.
function flush(editor) {
  let view = editor.render();
  const effects = [...editor.h.effects];
  for (const effect of effects) effect();
  if (effects.length) view = editor.render();
  return view;
}

for (const editDuringRefresh of [false, true]) {
  test(`React commit keeps submitted text while refreshing (new edit: ${editDuringRefresh})`, async () => {
    const core = {
      environmentStore: { ui: { agentsDraft: 'saved draft' } },
      environmentSnapshot: {},
      status: { capabilities: { diskWrite: true } },
      bridgeAgents: { content: 'old disk text', hash: 'old-hash' },
    };
    const waiting = deferred(), refresh = deferred();
    const editor = agentsHarness(core, async path => path.endsWith('/preview')
      ? { status: 'ok', before: { hash: 'old-hash' } }
      : { status: 'ok' }, {
      updateUiPreferences(patch) {
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete core.environmentStore.ui[key];
          else core.environmentStore.ui[key] = value;
        }
      },
      async refreshBridge() {
        waiting.resolve();
        await refresh.promise;
        core.bridgeAgents = { content: 'submitted text', hash: 'new-hash' };
        flush(editor);
      },
    });
    flush(editor).edit('submitted text');
    await flush(editor).runPreview();
    const work = flush(editor).commit();
    await waiting.promise;
    try {
      assert.equal(flush(editor).draft, 'submitted text',
        'preference deletion must not restore the stale pre-commit source');
      if (editDuringRefresh) flush(editor).edit('submitted text plus another edit');
    } finally {
      refresh.resolve();
      await work;
    }
    assert.equal(flush(editor).draft,
      editDuringRefresh ? 'submitted text plus another edit' : 'submitted text');
    assert.equal(Object.hasOwn(core.environmentStore.ui, 'agentsDraft'), false);
  });
}

for (const previousId of ['', 'original']) {
  test(`React can save again after setNext fails (${previousId ? 'rename' : 'create'})`, () => {
    const live = coreHarness();
    if (previousId) live.api.saveEnvironmentProfile({ id: previousId, developerInstructions: 'original rule', config: {} });
    const core = { profiles: [], environmentStore: live.api.environmentStore() };
    let saves = 0;
    const editor = studioHarness(core, {
      saveProfile(profile, options) {
        live.api.saveEnvironmentProfile(profile, options);
        core.environmentStore = live.api.environmentStore();
        saves++;
      },
      setNext() { throw new Error('simulated pending-selection storage failure'); },
    });
    if (previousId) editor.view.selectProfile({ id: `studio:${previousId}`, name: previousId, developerInstructions: 'original rule' });
    editor.h.values[2] = { ...editor.render().form, id: 'saved', developerInstructions: 'new rule' };
    editor.render().save();
    assert.equal(saves, 1, 'the Profile itself was already saved');
    assert.equal(editor.render().validate(), '', 'the editor must retain the saved identity even if setNext fails');
    editor.h.values[2] = { ...editor.render().form, developerInstructions: 'updated rule' };
    editor.render().save();
    assert.equal(saves, 2);
    assert.equal(core.environmentStore.profiles.saved.developerInstructions, 'updated rule');
    if (previousId) assert.equal(Object.hasOwn(core.environmentStore.profiles, previousId), false);
  });
}
