import {execute} from './domain.js';

// Mutations are durable before transmission. Only server receipts permit removing them.
export class WorkJournal {
 constructor({user,site,base,entries=[],drafts={},files={},save,send,receipts,snapshot,onChange=()=>{}}){
  this.user=user;this.site=site;this.base=structuredClone(base);this.entries=structuredClone(entries);
  this.save=save;this.send=send;this.receipts=receipts;this.snapshot=snapshot;this.onChange=onChange;
  this.tail=Promise.resolve();this.synchronizing=false;this.connected=true;this.lastError=null;
  this.drafts=structuredClone(drafts);this.files=structuredClone(files);
  this.entries.forEach(e=>{if(e.status==='pending'||!e.status)e.status='pending';});
  this.rebuild();
 }
 wire(entry){const {subject,bumps,status,lastError,confirmedAt,previewResult,...action}=entry;return action;}
 subject(action){return action.payload.id||action.payload.partId||action.payload.orderId||action.payload.assetId||action.operationId;}
 rebuild(){
  let preview=structuredClone(this.base);const blocked=new Set();
  for(const entry of this.entries){
   if(entry.siteId!==this.site)continue;
   if(entry.status==='conflict'){blocked.add(entry.subject);continue;}
   if(blocked.has(entry.subject))continue;
   try{const next=structuredClone(preview);execute(next,this.user,this.wire(entry),next.users||[]);preview=next;}
   catch(error){if(entry.status!=='confirmed'){entry.lastError=entry.lastError||error.message;blocked.add(entry.subject);}}
  }
  this.state=preview;this.onChange(this);return preview;
 }
 export(){return {schemaVersion:2,user:this.user,site:this.site,state:this.base,queue:this.entries,drafts:this.drafts,files:this.files,savedAt:new Date().toISOString()};}
 async persist(){await this.save(this.export());}
 async enqueue(type,payload,record=null){
  const run=async()=>{
   const action={type,payload:structuredClone(payload),siteId:this.site,expectedVersion:record?.version,operationId:crypto.randomUUID(),occurredAt:new Date().toISOString()};
   const copy=structuredClone(this.state),outcome=execute(copy,this.user,action,copy.users||[]);
   const entry={...action,subject:this.subject(action),status:'pending'};
   this.entries.push(entry);
   try{await this.persist();}catch(error){this.entries.pop();throw Error('No se pudo guardar en este dispositivo. El formulario se conserva. '+error.message);}
   this.state=copy;this.onChange(this);return {entry,result:outcome.result};
  };
  const promise=this.tail.then(run,run);this.tail=promise.catch(()=>{});return promise;
 }
 async reconcile(){
  if(!this.entries.length)return;
  const pending=this.entries.filter(e=>e.status!=='confirmed');
  const status={accepted:[],collisions:[]};for(let start=0;start<pending.length;start+=200){const batch=await this.receipts(pending.slice(start,start+200).map(e=>this.wire(e)));status.accepted.push(...batch.accepted);status.collisions.push(...batch.collisions);}
  for(const e of this.entries){if(status.accepted.includes(e.operationId))e.status='confirmed';if(status.collisions.includes(e.operationId)){e.status='conflict';e.lastError='El identificador ya existe con contenido distinto. Revisa el registro.';}}
 }
 async refresh(){
  await this.tail;await this.reconcile();const current=await this.snapshot();
  this.base=current;this.entries=this.entries.filter(e=>e.status!=='confirmed');this.connected=true;this.lastError=null;this.rebuild();await this.persist();
 }
 async sync(){
  if(this.synchronizing)return {pending:this.entries.length};this.synchronizing=true;
  try{
   await this.tail;await this.reconcile();this.lastError=null;this.connected=true;
   const blocked=new Set(this.entries.filter(e=>e.status==='conflict').map(e=>e.subject));
   for(const e of this.entries){
    if(e.status==='confirmed'||e.status==='conflict'||blocked.has(e.subject))continue;
    // Dependencies on locally created records must not overtake a rejected operation.
    if([...blocked].some(id=>JSON.stringify(e.payload).includes(id)))continue;
    try{await this.send(this.wire(e));e.status='confirmed';e.confirmedAt=new Date().toISOString();await this.persist();}
    catch(error){
     if(e.status==='confirmed'){this.lastError=error;throw error;}
     if(error.network||error.status===401){this.connected=false;this.lastError=error;break;}
     e.status='conflict';e.lastError=error.message;blocked.add(e.subject);await this.persist();
    }
   }
   if(!this.lastError)await this.refresh();else this.rebuild();
   return {pending:this.entries.filter(e=>e.status!=='confirmed').length,conflicts:this.entries.filter(e=>e.status==='conflict').length};
  }catch(error){this.lastError=error;if(error.network||error.status===401)this.connected=false;this.rebuild();throw error;}
  finally{this.synchronizing=false;this.onChange(this);}
 }
 async retry(operationId,note){
  const entry=this.entries.find(e=>e.operationId===operationId);if(!entry)throw Error('Registro pendiente no encontrado');
  if(!note?.trim())throw Error('Registra el motivo de revisión');
  const current=Object.values(this.base).filter(Array.isArray).flat().find(x=>x.id===entry.subject);
  const before=structuredClone(this.entries),old=entry.operationId,next=crypto.randomUUID();
  const prefix=this.user.id+':'+old+':',replacement=this.user.id+':'+next+':';
  const remap=value=>typeof value==='string'&&value.startsWith(prefix)?replacement+value.slice(prefix.length):Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)])):value;
  // Unsent dependent actions must follow the corrected creation's stable record IDs.
  for(const dependent of this.entries){if(dependent===entry)continue;const mapped=remap(dependent.payload);if(JSON.stringify(mapped)!==JSON.stringify(dependent.payload)){dependent.payload=mapped;dependent.subject=this.subject(dependent);}}
  entry.operationId=next;entry.occurredAt=new Date().toISOString();entry.payload._review={previousOperationId:old,note};entry.status='pending';entry.lastError=null;if(current)entry.expectedVersion=current.version;else entry.subject=this.subject(entry);
  try{await this.persist();}catch(error){this.entries=before;this.rebuild();throw error;}this.rebuild();return entry;
 }
}
