import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, scriptModule, patchExtension, protectedHashes, communityManifest, build } from '../tools/build_community.mjs';

const serviceTS = await readFile(path.join(ROOT,'community/extension/src/bridge-license-service.ts'),'utf8');
const controllerTS = await readFile(path.join(ROOT,'community/extension/src/bridge-access-controller.ts'),'utf8');
// Evaluate only the newly authored standalone policy modules, never the recovered app.
const Service = new Function(`${scriptModule(serviceTS)};return BridgeLicenseService;`)();
const Controller = new Function(`${scriptModule(controllerTS)};return BridgeAccessController;`)();
const forbiddenContext = new Proxy({}, { get() { throw new Error('Commercial storage/OAuth must not be accessed'); } });

test('community availability is offline, signed out, free, and not an impersonated account', async t => {
  t.mock.method(globalThis,'fetch',() => { throw new Error('Network forbidden'); });
  t.mock.method(globalThis,'setTimeout',() => { throw new Error('Payment polling forbidden'); });
  t.mock.method(globalThis,'setInterval',() => { throw new Error('Revalidation forbidden'); });
  const service = new Service(forbiddenContext,forbiddenContext);
  await service.initialize();
  for (const method of ['getStatus','signIn','signInWithGitee','refresh','refreshSession','signOut','loadPlans','getPaymentOrder']) {
    const status = await service[method]();
    assert.equal(status.edition,'community');
    assert.equal(status.available,true);
    assert.equal(status.requiresAccount,false);
    assert.equal(status.requiresPayment,false);
    assert.equal(status.signedIn,false);
    assert.equal(status.githubUserId,'');
    assert.equal(status.licensed,true); // legacy capability flag, not a signed token
    assert.deepEqual(status.plans,[]);
    assert.deepEqual(status.paymentTypes,[]);
    assert.equal(status.paymentOrder.checkoutUrl,'');
  }
  await service.requireFeature('bridge');
  await assert.rejects(service.requireFeature('unknown-capability'),/Unknown community capability/);
  assert.equal(await service.reportUsage(42),true);
  service.dispose();
});

test('payment and redemption cannot silently create a charge', async () => {
  const service = new Service(forbiddenContext);
  await assert.rejects(service.createPayment('month_1','alipay'),/COMMUNITY_PAYMENTS_DISABLED/);
  await assert.rejects(service.redeem('ANY-CODE'),/COMMUNITY_PAYMENTS_DISABLED/);
  const first = await service.getStatus();
  first.paymentOrder.checkoutUrl = 'tampered';
  assert.equal((await service.getStatus()).paymentOrder.checkoutUrl,'');
});

test('legacy account actions and refresh do not stop a running community Bridge', async t => {
  t.mock.method(globalThis,'setInterval',() => { throw new Error('No commercial timer'); });
  let starts=0,stops=0;
  const bridge = { async start(domain) { starts++; assert.equal(domain,'owned.example'); return {state:'running'}; }, async stop() { stops++; return {state:'stopped'}; } };
  const c = new Controller(new Service(forbiddenContext),bridge);
  assert.deepEqual(await c.start('owned.example'),{state:'running'});
  await c.refresh(); await c.signOut(); await c.getPaymentOrder(); c.dispose();
  assert.equal(starts,1); assert.equal(stops,0);
  await c.stop(); assert.equal(stops,1);
});

test('BridgeManager safety failures still propagate to the caller', async () => {
  const c = new Controller(new Service(),{async start(){throw new Error('Unsafe workspace');}});
  await assert.rejects(c.start(),/Unsafe workspace/);
});

test('version-locked bundle removes commercial service, preserves transport/tool/provider modules', async () => {
  const original = await readFile(path.join(ROOT,'recovered/shuncode-extension/dist/extension.js'),'utf8');
  const result = patchExtension(original,serviceTS,controllerTS);
  assert.deepEqual(protectedHashes(result.code),protectedHashes(original));
  assert.ok(!result.code.includes('shuncode-bridge-license.'));
  assert.ok(!result.code.includes('GITEE_CALLBACK_PAGE_PENDING'));
  assert.ok(!result.code.includes('PAYMENT_POLL_INTERVAL_MS'));
  assert.ok(result.code.includes('COMMUNITY_PAYMENTS_DISABLED'));
  assert.throws(() => patchExtension('var unrelated = 1;',serviceTS,controllerTS),/expected exactly one/);
});

test('remove only proprietary checkout/login commands from the palette, retain model logins', async () => {
  const original = JSON.parse(await readFile(path.join(ROOT,'recovered/shuncode-extension/package.json'),'utf8'));
  const p = communityManifest(original);
  const commands = p.contributes.commands.map(c => c.command);
  assert.ok(!commands.some(c => /^shuncode\.bridge\.(license|payment)\./.test(c)));
  assert.ok(commands.includes('shuncode.codex.login'));
  assert.ok(commands.includes('shuncode.setApiKey'));
  assert.ok(commands.includes('shuncode.bridge.start'));
  assert.deepEqual(p.enabledApiProposals,original.enabledApiProposals);
});

test('build records original and replacement hashes, never modifies evidence', async () => {
  const dir = await mkdtemp(path.join(tmpdir(),'shuncode-overlay-test-'));
  try {
    const report = await build(dir);
    assert.equal(report.files.length,6);
    assert.equal(report.edition,'community');
    for (const f of report.files) { assert.match(f.originalSha256,/^[a-f0-9]{64}$/); assert.match(f.sha256,/^[a-f0-9]{64}$/); }
    const source = await readFile(path.join(dir,'resources/app/extensions/shuncode/src/extension.ts'),'utf8');
    assert.ok(!source.includes('SHUNCODE_BRIDGE_LICENSE_SMOKE_BYPASS'));
    assert.ok(!source.includes('update("persistentMode", false'));
  } finally { await rm(dir,{recursive:true,force:true}); }
});
