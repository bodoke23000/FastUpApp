import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {inspectPort} from '../server/startup.js';

export function demoProcess(project,environment=process.env){
 return {args:['server/index.js'],options:{cwd:project,stdio:'inherit',windowsHide:true,env:{...environment,DATABASE_MODE:'embedded',DATABASE_URL:'',DATA_DIRECTORY:join(project,'data'),DEMO_MODE:'true',NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3030',PUBLIC_ORIGIN:'http://localhost:3030',COOKIE_SECURE:'false',WEBHOOK_URL:'',WEBHOOK_SECRET:''}}};
}

async function main(){
const project=fileURLToPath(new URL('../',import.meta.url));process.chdir(project);
if(Number(process.versions.node.split('.')[0])<24)throw Error('Fast Up requires Node.js 24 or newer.');
const existing=await inspectPort({port:3030});
if(existing.kind==='fast-up'){
 console.log(existing.config.status==='starting'?'Fast Up is already starting. Wait a moment, then open:':'Fast Up is already running'+(existing.config.version?' (v'+existing.config.version+')':'')+'. Open:');
 console.log('http://localhost:3030');
 console.log('A second copy was not started. Keep the original server window open.');
 console.log('To use this folder instead, stop the original server with Ctrl+C, then launch again.');
 return;
}
if(existing.kind==='occupied')throw Error('Port 3030 is being used by another program or an unresponsive server. Close that program or stop its original terminal, then try again. No existing process or data was changed.');
if(['pg','@electric-sql/pglite','exceljs','qrcode'].some(dependency=>!existsSync(join(project,'node_modules',dependency)))){
 console.log('Installing application dependencies from the npm registry…');
 const tools=join(project,'.tools'),npmDirectory=join(tools,'npm');await mkdir(npmDirectory,{recursive:true});
 const cli=join(npmDirectory,'package','bin','npm-cli.js');
 if(!existsSync(cli)){const response=await fetch('https://registry.npmjs.org/npm/-/npm-11.6.2.tgz');if(!response.ok)throw Error('Cannot download the npm installer');const archive=join(tools,'npm.tgz');await writeFile(archive,Buffer.from(await response.arrayBuffer()));const extracted=spawnSync('tar',['-xf',archive,'-C',npmDirectory],{stdio:'inherit',windowsHide:true});if(extracted.status)throw Error('Could not unpack npm. Install Node.js 24 with npm, then run npm ci.');}
 const installed=spawnSync(process.execPath,[cli,'ci','--ignore-scripts','--cache',join(tools,'npm-cache')],{stdio:'inherit',windowsHide:true});if(installed.status)process.exit(installed.status||1);
}
console.log('Fast Up evaluation: http://localhost:3030');
console.log('Sign in: supervisor@fastup.local / FastUp-Demo-2026!');
console.log('Press Ctrl+C to stop.');
const command=demoProcess(project),child=spawn(process.execPath,command.args,command.options);
child.on('exit',code=>process.exit(code||0));process.on('SIGINT',()=>child.kill('SIGINT'));process.on('SIGTERM',()=>child.kill('SIGTERM'));
child.on('error',error=>{console.error('Fast Up could not launch: '+error.message);process.exitCode=1;});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('Fast Up: '+error.message);process.exitCode=1;});
