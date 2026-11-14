import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {verifyShell} from './shell.js';
async function walk(path){for(const file of await readdir(path,{withFileTypes:true})){const item=path+'/'+file.name;if(file.isDirectory())await walk(item);else if(file.name.endsWith('.js')){const r=spawnSync(process.execPath,['--check',item],{stdio:'inherit'});if(r.status)process.exit(r.status);}}}
for(const dir of ['server','public','scripts','test'])await walk(dir);await verifyShell();console.log('JavaScript syntax and offline shell consistency checks passed');
