// Build a source-linked lesson and honest coverage ledger; never run lesson code.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, hash } from './patch_utils.mjs';
const BASE='docs/learning';
export function sourceLines(text){const lines=text.split('\n');if(lines.at(-1)==='')lines.pop();return lines;}
export function verifyAnnotation(entry,bytes){
  if(hash(bytes)!==entry.sha256)throw new Error(`Lesson source changed: ${entry.source}`);
  const lines=sourceLines(bytes.toString('utf8'));
  if(lines.length!==entry.lines.length)throw new Error(`Missing line explanations: ${entry.source}`);
  entry.lines.forEach((line,index)=>{
    if(line.number!==index+1 || line.code!==lines[index])throw new Error(`Stale line mapping: ${entry.source}:${index+1}`);
    if(typeof line.explanation!=='string'||line.explanation.trim().length<12)throw new Error(`Empty/inadequate explanation: ${entry.source}:${index+1}`);
  });
}
async function walk(folder){
  const out=[];
  for(const e of await readdir(path.join(ROOT,folder),{withFileTypes:true})){
    if(['__pycache__','node_modules'].includes(e.name))continue;
    const p=folder+'/'+e.name;
    if(e.isDirectory())out.push(...await walk(p));
    else if(/\.(?:ts|mts|mjs|cjs|py|yml|cmd|js|js\.txt)$/.test(p))out.push(p);
  }
  return out;
}
const prose=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export async function learningArtifacts(){
  const annotations=JSON.parse(await readFile(path.join(ROOT,BASE,'annotations.json'),'utf8'));
  const explained=new Map();
  for(const entry of annotations.files){
    if(path.posix.isAbsolute(entry.source)||entry.source.split('/').includes('..')||explained.has(entry.source))throw new Error('Unsafe/duplicate lesson source');
    verifyAnnotation(entry,await readFile(path.join(ROOT,entry.source)));explained.set(entry.source,entry);
  }
  const roots=['community','reconstructed/bridge-core/src','recovered/shuncode-extension/src','recovered/bridge-ui','recovered/bridge-ui-sessions','tools','tests','.github/workflows'];
  const files=[];
  for(const source of (await Promise.all(roots.map(walk))).flat().sort()){
    const bytes=await readFile(path.join(ROOT,source));
    files.push({source,sha256:hash(bytes),lines:sourceLines(bytes.toString('utf8')).length,explainedLines:explained.get(source)?.lines.length??0,status:explained.has(source)?'line-by-line-authored':'pending'});
  }
  for(const source of explained.keys())if(!files.some(f=>f.source===source))throw new Error(`Annotated source outside coverage: ${source}`);
  const report={scope:'Explicit code roots listed here, including maintenance, recovered source/UI, reconstructed JS, tools, tests and CI. Not an all-repository/all-upstream completion claim.',roots,
    excluded:['Third-party node_modules and mixed original dist bundles (reference evidence, not counted as self-authored curriculum)','Generated lesson documents/annotation data, images, binary installers, JSON configs and lockfiles; configuration reading is tracked separately in the curriculum'],
    summary:{files:files.length,lines:files.reduce((n,f)=>n+f.lines,0),fullyExplainedFiles:explained.size,explainedLines:files.reduce((n,f)=>n+f.explainedLines,0),projectWideExplanationComplete:false},files,
    limits:'Tests verify coverage, exact source mapping and freshness, NOT that every explanation is semantically correct. Human review and exercises are still required.'};
  const book=['# 第一组代码逐行精读：社区策略、控制器与补丁基础','',`先读 [零基础实验课](START_HERE.md)，再读本页。这里完整讲解${report.summary.fullyExplainedFiles}个文件的${report.summary.explainedLines}行（含注释、空行和结构行），不是全工程已经讲完。`,'','本页由手写注解和真实源码生成；不要复制本页去覆盖原源文件。修改源码后需重新审阅注解并生成。类型声明不等于运行时保证，测试也不等于完整安全认证。','','## 阅读顺序','','1. `BridgeLicenseService`：回答“商业账号/付款是否必要”。','2. `BridgeAccessController`：把请求转给真实 Bridge，不伪造运行状态。','3. `patch_utils.mjs`：内容指纹、逆序替换、AST 遍历、唯一定位。','4. `build_community.mjs`：原件校验、策略/入口替换、manifest与双宿主UI组装。','5. `patch_bridge_ui.mjs`：双宿主来源、位置补偿、拒绝异常与保留方法核对。','6. `access-methods.mjs`：状态渲染、错误反馈与取消套餐查询。','','章节目录：'];
  annotations.files.forEach((entry,i)=>book.push(`- [第${i+1}部分：${entry.title}](#file-${i+1})`));
  for(const [index,entry] of annotations.files.entries()){
    book.push('',`<a id="file-${index+1}"></a>`,`## 第${index+1}部分：${entry.title}`,'',`原文件：[${entry.source}](../../${entry.source})`,'',`对应源码 SHA-256：\`${entry.sha256}\``,'');
    for(const line of entry.lines){
      book.push(`### L${line.number}`,'',line.code===''?'（空行）':`\`\`\`${entry.source.endsWith('.ts')?'ts':'js'}\n${line.code}\n\`\`\``,'',prose(line.explanation),'');
    }
  }
  book.push('## 学完后如何确认不是只看懂了文字','','回到 [实验课的自测](START_HERE.md#自测与答案)，执行教学测试。完整待讲文件见 [覆盖清单](COVERAGE.md)。');
  const coverage=['# 逐行教程覆盖清单','','**这是进度清单，不是完成声明。** 自动核验可以防止“源码变了、教程仍拿旧行号解释”，不能自动证明教学质量。','',`当前：${report.summary.fullyExplainedFiles}/${report.summary.files} 个纳入范围的文件完整逐行解释；${report.summary.explainedLines}/${report.summary.lines} 行已解释。`,'','统计包含注释、结构行和空行；不同原件/重建/维护文件分别计数，不把重复代码算成独立功能。分母随工程变化更新。','','## 统计边界','',...report.excluded.map(x=>'- '+x),'','配置、锁文件和完整 Code OSS 的阅读任务见 [课程总目录](README.md)，不在这里被冒充为已讲解。','','| 文件 | 总行数 | 已解释 | 状态 |','|---|---:|---:|---|',...files.map(f=>`| [${f.source}](../../${f.source}) | ${f.lines} | ${f.explainedLines} | ${f.status==='pending'?'待逐行讲解':'本组已逐行解释'} |`)];
  return {report,files:new Map([['LINE_BY_LINE.md',book.join('\n')+'\n'],['COVERAGE.md',coverage.join('\n')+'\n'],['coverage.json',JSON.stringify(report,null,2)+'\n']])};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {report,files}=await learningArtifacts();
  for(const [file,text] of files){const dest=path.join(ROOT,BASE,file);if(process.argv.includes('--check')){if(await readFile(dest,'utf8')!==text)throw new Error(`Stale lesson artifact: ${file}`);}else await writeFile(dest,text);}
  console.log(JSON.stringify(report.summary,null,2));
}
