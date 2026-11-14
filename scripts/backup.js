import {randomBytes,scryptSync,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore} from '../server/store.js';

const TABLES=['records','accounts','action_receipts','audit_events','integration_outbox'];
export async function snapshot(store){return store.transaction(async c=>{const tables={};for(const t of TABLES)tables[t]=(await c.query('SELECT * FROM '+t)).rows;return {format:'fast-up-backup-v1',createdAt:new Date().toISOString(),tables};});}
export async function restoreSnapshot(store,backup){
 if(backup.format!=='fast-up-backup-v1'||!TABLES.every(t=>Array.isArray(backup.tables[t])))throw Error('Formato de copia inválido');
 return store.transaction(async c=>{
  for(const table of TABLES){const count=(await c.query('SELECT count(*) as n FROM '+table)).rows[0];if(Number(count.n))throw Error('La restauración requiere una base vacía; conserva la base existente.');}
  const columns={records:['kind','id','site_id','version','data','updated_at'],accounts:['id','email','password_hash','profile','active'],action_receipts:['user_id','operation_id','request_hash','result','created_at'],audit_events:['id','site_id','actor_id','operation','subject_id','occurred_at','received_at','details'],integration_outbox:['id','site_id','event','attempts','delivered_at','next_attempt_at','last_error']};
  const jsonColumns=new Set(['data','profile','result','details','event']);
  for(const table of TABLES){const fields=columns[table];for(const row of backup.tables[table])await c.query(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map((f,i)=>'$'+(i+1)+(jsonColumns.has(f)?'::jsonb':'')).join(',')})`,fields.map(f=>jsonColumns.has(f)?JSON.stringify(row[f]):row[f]));}
  // Sessions are intentionally not restored. Clients must authenticate again.
 });
}
export function encryptBackup(data,passphrase){if(!passphrase||passphrase.length<14)throw Error('BACKUP_PASSPHRASE requiere al menos 14 caracteres');const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(passphrase,salt,32),cipher=createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.from(JSON.stringify(data)),encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);return JSON.stringify({format:'fast-up-encrypted-backup-v1',salt:salt.toString('hex'),iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),sha256:createHash('sha256').update(bytes).digest('hex'),data:encrypted.toString('base64')});}
export function decryptBackup(text,passphrase){const file=JSON.parse(text);if(file.format!=='fast-up-encrypted-backup-v1')throw Error('Formato de archivo inválido');const key=scryptSync(passphrase,Buffer.from(file.salt,'hex'),32),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(file.iv,'hex'));decipher.setAuthTag(Buffer.from(file.tag,'hex'));const bytes=Buffer.concat([decipher.update(Buffer.from(file.data,'base64')),decipher.final()]);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Checksum inválido');return JSON.parse(bytes.toString());}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const passphrase=process.env.BACKUP_PASSPHRASE;if(!passphrase||passphrase.length<14)throw Error('Define BACKUP_PASSPHRASE (mínimo 14 caracteres)');const store=await openStore();
 try{if(process.argv[2]==='restore'){if(!process.argv[3])throw Error('Indica la ruta de copia');await restoreSnapshot(store,decryptBackup(await readFile(process.argv[3],'utf8'),passphrase));console.log('Restauración verificada. Inicia sesión y sincroniza los dispositivos.');}else{await mkdir('backups',{recursive:true});const path=resolve('backups',`fast-up-${new Date().toISOString().replace(/[:.]/g,'-')}.json.enc`);await writeFile(path,encryptBackup(await snapshot(store),passphrase),{mode:0o600});console.log(path);}}finally{await store.close();}
}
