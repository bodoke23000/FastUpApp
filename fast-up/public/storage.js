let database,session,writeChain=Promise.resolve();
const encoder=new TextEncoder(),decoder=new TextDecoder();
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const un64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function db(){
 if(database)return database;
 database=await new Promise((resolve,reject)=>{const r=indexedDB.open('fast-up-encrypted-vault',1);r.onupgradeneeded=()=>r.result.createObjectStore('vaults');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 return database;
}
async function get(id){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('vaults','readonly').objectStore('vaults').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function put(id,value,expectedRevision){
 const d=await db();return new Promise((resolve,reject)=>{
  const tx=d.transaction('vaults','readwrite'),store=tx.objectStore('vaults');let conflict=false;
  const current=store.get(id);current.onsuccess=()=>{
   if((current.result?.revision||0)!==expectedRevision){conflict=true;tx.abort();return;}
   store.put({...value,revision:expectedRevision+1},id);
  };
  tx.oncomplete=()=>resolve(expectedRevision+1);
  tx.onabort=()=>reject(conflict?Error('La copia se actualizó en otra pestaña. Conserva este formulario y vuelve a abrir la copia antes de continuar.'):tx.error||Error('No fue posible guardar la copia local.'));
  tx.onerror=()=>reject(tx.error||Error('No fue posible guardar la copia local.'));
 });
}
async function derive(passphrase,salt){const base=await crypto.subtle.importKey('raw',encoder.encode(passphrase),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export async function vaultProfiles(){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('vaults','readonly').objectStore('vaults').getAll();r.onsuccess=()=>resolve(r.result.map(x=>({id:x.id,name:x.name})));r.onerror=()=>reject(r.error);});}
export async function unlockVault(id,passphrase){
 await writeChain;const record=await get(id);if(!record)throw Error('No existe una copia preparada para este usuario');
 try{const key=await derive(passphrase,un64(record.salt));const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(record.iv)},key,record.data);const data=JSON.parse(decoder.decode(bytes));session={id,key,revision:record.revision||0};return data;}
 catch{throw Error('Frase de acceso incorrecta o copia dañada');}
}
export async function enableVault(user,passphrase,data){
 if(passphrase.length<10)throw Error('Usa una frase local de al menos 10 caracteres');
 if(await get(user.id))throw Error('Ya existe una copia. Desbloquéala antes de actualizarla.');
 const salt=crypto.getRandomValues(new Uint8Array(16)),key=await derive(passphrase,salt),iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify(data)));
 const revision=await put(user.id,{id:user.id,name:user.name,salt:b64(salt),iv:b64(iv),data:encrypted},0);session={id:user.id,key,revision};navigator.storage?.persist?.().catch(()=>{});
}
export function saveVault(data){
 if(!session)return Promise.resolve(false);const active=session,serialized=JSON.stringify(data);
 const run=async()=>{const record=await get(active.id);if(!record)throw Error('No existe la copia local');const iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},active.key,encoder.encode(serialized));active.revision=await put(active.id,{...record,iv:b64(iv),data:encrypted},active.revision);return true;};
 const result=writeChain.then(run,run);writeChain=result.catch(()=>{});return result;
}
export const vaultUnlocked=()=>!!session;
export function lockVault(){session=null;}
export async function removeVault(id){await writeChain;if(session?.id===id)lockVault();const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('vaults','readwrite');tx.objectStore('vaults').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
