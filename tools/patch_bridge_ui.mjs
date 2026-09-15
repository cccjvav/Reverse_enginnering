// Patch only the custom Bridge widget. Keep the host and tool/tunnel UI intact.
import { parse } from 'acorn';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { accessMethods } from '../community/ui/access-methods.mjs';
import { ROOT, applyEdits, allNodes, only, hash } from './patch_utils.mjs';

export function parseClass(code) {
  if (typeof code !== 'string') throw new TypeError('UI class source must be a string');
  const ast = parse('('+code+')',{ecmaVersion:'latest',sourceType:'module'});
  const expression = ast.body.length === 1 ? ast.body[0].expression : undefined;
  if (expression?.type !== 'ClassExpression') throw new Error('Expected one UI class expression');
  return expression;
}
const retiredMethods = new Set(['signOut','createPayment','redeemActivationCode','fetchPaymentPlans','runAccessCommand','accessAccountLabel']);
const retiredControls = ['signInButton','giteeSignInButton','refreshSessionButton','refreshLicenseButton','signOutButton','planSelect','paymentTypeSelect','purchaseButton','reloadPaymentPlansButton','checkPaymentButton','activationInput','redeemButton'];
export function patchUiClass(original,card) {
  const cls = parseClass(original);
  const methods = cls.body.body.filter(n => n.type === 'MethodDefinition');
  const method = name => only(methods,n => n.key.name === name,`UI method ${name}`);
  const text = n => original.slice(n.start-1,n.end-1);
  const edit = (n,value) => ({start:n.start-1,end:n.end-1,text:value});
  const edits = [];
  const constructor = method('constructor');
  const body = constructor.value.body.body;
  const accessStart = only(body,n => text(n).startsWith('this.accessCard ='), 'account card start');
  const connectionStart = only(body,n => text(n).startsWith('this.connectionCard ='), 'connection card start');
  if (accessStart.start >= connectionStart.start) throw new Error('Unexpected UI card order');
  edits.push({start:accessStart.start-1,end:connectionStart.start-1,text:card+'\n    '});
  for (const n of body) if (/^this\.paymentPlans(?:FetchAttempted|Loading) =/.test(text(n))) edits.push(edit(n,''));
  for (const n of methods) {
    if (retiredMethods.has(n.key.name)) edits.push(edit(n,''));
    else if (Object.hasOwn(accessMethods,n.key.name)) edits.push(edit(n.value.body,accessMethods[n.key.name]));
  }
  const guards = allNodes(cls).filter(n => n.type === 'IfStatement' && text(n.test).includes('this.lastAccessStatus?.licensed'));
  if (guards.length !== 2) throw new Error(`Expected start and auto-start commercial guards, got ${guards.length}`);
  for (const n of guards) {
    const persistent = text(n.test).includes('enabled');
    edits.push(edit(n,`if (${persistent?'enabled && ':''}(this.lastAccessStatus?.edition !== "community" || this.lastAccessStatus?.available !== true)) {
      this.renderAccessError("社区版组件尚未就绪，请先完成社区版更新。");
      return;
    }`));
  }
  for (const n of method('updateControls').value.body.body) {
    const s = text(n);
    if (/^const (signedIn|hasPaymentPlans)\b/.test(s) || retiredControls.some(name => s.startsWith(`this.${name}.`))) edits.push(edit(n,''));
  }
  const updated = applyEdits(original,edits);
  const newMethods = parseClass(updated).body.body.filter(n => n.type === 'MethodDefinition');
  for (const forbidden of ['BRIDGE_LICENSE_', 'BRIDGE_PAYMENT_', '.signedIn', '.licensed', 'paymentPlans', 'purchaseSection', 'activationInput']) {
    if (updated.includes(forbidden)) throw new Error(`Commercial UI reference remains: ${forbidden}`);
  }
  const changed = new Set(['constructor','renderAccess','renderAccessError','refreshAccessAndPlans','toggleBridge','updateControls',...retiredMethods]);
  const preserved = {};
  for (const n of methods) if (!changed.has(n.key.name)) {
    const after = only(newMethods,m => m.key.name === n.key.name,`preserved UI method ${n.key.name}`);
    const beforeText = text(n), afterText = updated.slice(after.start-1,after.end-1);
    if (beforeText !== afterText) throw new Error(`Unexpected change to UI method ${n.key.name}`);
    preserved[n.key.name] = hash(beforeText);
  }
  return { code:updated, preservedMethods:preserved };
}
export async function buildUiPatch(variant = 'workbench') {
  if (!['workbench','sessions'].includes(variant)) throw new Error('Unknown UI variant');
  const suffix = variant === 'sessions' ? '-sessions' : '';
  const evidence = JSON.parse(await readFile(path.join(ROOT,'docs/evidence/bridge-ui'+suffix+'.json'),'utf8'));
  const target = only(evidence.classes,c => c.methods.includes('toggleBridge') && c.methods.includes('renderCustomTools'),'Bridge UI class');
  const original = await readFile(path.join(ROOT,'recovered/bridge-ui'+suffix,target.file),'utf8');
  if (hash(original) !== target.sha256) throw new Error('Original Bridge UI evidence changed');
  const card = await readFile(path.join(ROOT,'community/ui/access-card.js.txt'),'utf8');
  return { original, ...patchUiClass(original,card) };
}
