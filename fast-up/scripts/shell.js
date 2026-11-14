import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// A changed shell must have a new cache namespace, including imported domain modules.
export async function verifyShell({write=false}={}){
 const sw=new URL('../public/sw.js',import.meta.url),source=await readFile(sw,'utf8');
 const files=JSON.parse(source.match(/const FILES=(\[[^;]+\]);/)[1].replaceAll("'",'"'));
 const digest=createHash('sha256');for(const file of files){digest.update(file);digest.update(await readFile(new URL('../public'+(file==='/'?'/index.html':file),import.meta.url)));}
 const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const cache='fast-up-shell-'+version+'-'+digest.digest('hex').slice(0,12);
 if(write){await writeFile(sw,source.replace(/const CACHE='[^']+';/,"const CACHE='"+cache+"';"));console.log('Offline shell cache updated: '+cache);}
 else if(!source.includes("const CACHE='"+cache+"';"))throw Error('Offline shell changed. Run npm run refresh-shell before testing or releasing.');
 return cache;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await verifyShell({write:process.argv.includes('--write')});
