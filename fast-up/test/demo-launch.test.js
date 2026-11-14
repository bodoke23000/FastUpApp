import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm as removeFixture} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {demoProcess} from '../scripts/launch.js';
async function rm(directory,options){const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('fast-up no env template '));await removeFixture(target,options);}

test('demo child starts without an env template and overrides inherited production settings',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'fast-up no env template '));
 try{
  await mkdir(join(directory,'server'));await writeFile(join(directory,'package.json'),'{"type":"module"}');
  const keys=['DATABASE_MODE','DATABASE_URL','DATA_DIRECTORY','DEMO_MODE','NODE_ENV','HOST','PORT','PUBLIC_ORIGIN','COOKIE_SECURE','WEBHOOK_URL','WEBHOOK_SECRET'];
  await writeFile(join(directory,'server','index.js'),'console.log(JSON.stringify(Object.fromEntries('+JSON.stringify(keys)+'.map(key=>[key,process.env[key]]))));');
  const command=demoProcess(directory,{...process.env,DATABASE_MODE:'postgres',DATABASE_URL:'postgresql://synthetic.invalid/production',NODE_ENV:'production',DEMO_MODE:'false',WEBHOOK_URL:'https://synthetic.invalid/webhook',WEBHOOK_SECRET:'synthetic-test-secret'});
  const result=spawnSync(process.execPath,command.args,{...command.options,stdio:'pipe',encoding:'utf8',timeout:10000});assert.ifError(result.error);assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout);
  assert.deepEqual(actual,{DATABASE_MODE:'embedded',DATABASE_URL:'',DATA_DIRECTORY:join(directory,'data'),DEMO_MODE:'true',NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3030',PUBLIC_ORIGIN:'http://localhost:3030',COOKIE_SECURE:'false',WEBHOOK_URL:'',WEBHOOK_SECRET:''});
 }finally{await rm(directory,{recursive:true,force:true});}
});
