import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildUiPatch, parseClass } from '../tools/patch_bridge_ui.mjs';

const ui = await buildUiPatch();
// Only instantiate method definitions in a stubbed environment. Do NOT run the
// recovered widget constructor, host, extension, payment handlers or transport.
const Widget = new Function('Disposable','BRIDGE_START','BRIDGE_STOP','localizeBridge',
  `return (${ui.code});`)(class {},'start','stop',(_key,fallback)=>fallback);
function stub(state={state:'stopped',tunnelProvider:'cloudflare'}) {
  const widget = Object.create(Widget.prototype), calls=[], errors=[];
  Object.assign(widget,{
    busy:false,lastStatus:state,lastAccessStatus:{edition:'community',available:true,signedIn:false},
    domainInput:{value:'',focus(){}},namedTunnelInput:{focus(){}},namedTunnelDomainInput:{focus(){}},namedTunnelTokenInput:{focus(){}},
    connectionCard:{open:false},runCommand:async(...args)=>calls.push(args),
    renderLocalError:message=>errors.push(message),renderAccessError:message=>errors.push(message),
  });
  return {widget,calls,errors};
}
test('custom Bridge panel contains no shop/login/activation nodes or handlers',async()=>{
  assert.ok(Object.keys(ui.preservedMethods).length>50);
  for(const needle of ['purchaseSection','activationInput','BRIDGE_LICENSE_','BRIDGE_PAYMENT_','alipay','signInButton']) assert.ok(!ui.code.includes(needle),needle);
  for(const name of ['renderCustomTools','renderSkillsCard','importSkill','toggleWorkspaceScope','saveNamedTunnel','clearNamedTunnelToken']) assert.ok(ui.preservedMethods[name],name);
  assert.ok(ui.code.includes('Bridge can edit files and run terminal commands. Keep the MCP address private.'));
});
test('signed-out community user may start Bridge; stop remains available',async()=>{
  const {widget,calls,errors}=stub();
  await widget.toggleBridge();assert.deepEqual(calls,[['start',undefined]]);assert.deepEqual(errors,[]);
  widget.lastStatus.state='running';widget.lastAccessStatus=undefined;
  await widget.toggleBridge();assert.deepEqual(calls[1],['stop']);
});
test('partially installed UI cannot pretend a paid backend is community',async()=>{
  const {widget,calls,errors}=stub();widget.lastAccessStatus={signedIn:true,licensed:true};
  await widget.toggleBridge();assert.equal(calls.length,0);assert.equal(errors.length,1);
});
test('commercial gate removal preserves ngrok and named-tunnel configuration checks',async()=>{
  for(const provider of ['ngrok','cloudflare-named']){
    const {widget,calls,errors}=stub({state:'stopped',tunnelProvider:provider});
    await widget.toggleBridge();assert.equal(calls.length,0);assert.equal(errors.length,1);assert.equal(widget.connectionCard.open,true);
  }
});
test('rendering free access does not claim login or query payment plans',()=>{
  const {widget}=stub();
  widget.accessBadge={};widget.accessDetails={};let updates=0;
  widget.updateControls=()=>updates++;
  widget.renderAccess({edition:'community',available:true,signedIn:false});
  assert.match(widget.accessBadge.textContent,/免费/);assert.match(widget.accessDetails.textContent,/无需账号/);assert.equal(updates,1);
  widget.renderAccess({licensed:true,signedIn:true});assert.match(widget.accessBadge.textContent,/需要更新组件/);
});
test('auto-start callback uses community capability rather than a paid licence',()=>{
  const constructor=parseClass(ui.code).body.body.find(n=>n.key.name==='constructor');
  const source=ui.code.slice(constructor.start-1,constructor.end-1);
  assert.ok(source.includes('enabled && (this.lastAccessStatus?.edition !== "community"'));
  assert.ok(!source.includes('.licensed'));
});
