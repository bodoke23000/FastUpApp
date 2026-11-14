import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,mkdir,writeFile,rm as removeFixture} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,delimiter,resolve,basename} from 'node:path';
import {spawnSync} from 'node:child_process';

const required=['scripts/launch.js','server/index.js','server/startup.js','public/index.html','package.json','package-lock.json'];
async function rm(directory,options){const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('fast-up launcher with spaces '));await removeFixture(target,options);}
const launch=directory=>{const result=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/c','Start-FastUp.cmd'],{cwd:directory,input:'\r\n',encoding:'utf8',timeout:10000,windowsHide:true,env:{...process.env,PATH:dirname(process.execPath)+delimiter+process.env.PATH}});if(result.stderr)console.error('Launcher child-process diagnostic: '+result.stderr);return result;};
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'fast-up launcher with spaces '));await copyFile(new URL('../Start-FastUp.cmd',import.meta.url),join(directory,'Start-FastUp.cmd'));return directory;}
async function complete(directory,script="console.log('EXTRACTED_LAUNCH_OK');\n"){for(const file of required){const path=join(directory,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,file==='scripts/launch.js'?script:file.endsWith('.json')?'{}':'');}}

test('Windows ZIP-preview launch explains extraction before attempting Node or installing anything',{skip:process.platform!=='win32'},async()=>{
 const directory=await fixture();try{const result=launch(directory);assert.ifError(result.error);assert.equal(result.status,1);assert.match(result.stdout,/EXTRACT THE ZIP FIRST/);assert.match(result.stdout,/Extract All/);assert.doesNotMatch(result.stdout+result.stderr,/MODULE_NOT_FOUND|Installing application dependencies/);}finally{await rm(directory,{recursive:true,force:true});}
});
test('Windows launcher runs an extracted project with spaces in its path and no env template',{skip:process.platform!=='win32'},async()=>{
 const directory=await fixture();try{await complete(directory);const result=launch(directory);assert.ifError(result.error);assert.equal(result.status,0);assert.match(result.stdout,/EXTRACTED_LAUNCH_OK/);assert.doesNotMatch(result.stdout,/EXTRACT THE ZIP FIRST/);}finally{await rm(directory,{recursive:true,force:true});}
});
test('Windows launcher preserves a startup failure exit status',{skip:process.platform!=='win32'},async()=>{
 const directory=await fixture();try{await complete(directory,"process.exit(7);\n");const result=launch(directory);assert.ifError(result.error);assert.equal(result.status,7);}finally{await rm(directory,{recursive:true,force:true});}
});
