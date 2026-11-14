import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { KINDS, emptyState, execute, DomainError } from './domain.js';

export async function openStore(options={}){
 const mode=options.mode||(options.memory?'embedded':process.env.DATABASE_MODE||(process.env.DATABASE_URL?'postgres':'embedded'));
 let db,pool;
 if(mode==='postgres'){
  const {Pool}=await import('pg');pool=new Pool({connectionString:options.url||process.env.DATABASE_URL,max:10,connectionTimeoutMillis:10000,ssl:process.env.PGSSL==='true'?{rejectUnauthorized:true}:undefined});
  db={query:(sql,params=[])=>pool.query(sql,params)};
 }else{
  if(process.env.NODE_ENV==='production')throw new Error('Production requires PostgreSQL DATABASE_URL.');
  const {PGlite}=await import('@electric-sql/pglite');const path=options.memory?'memory://':resolve(options.directory||process.env.DATA_DIRECTORY||'./data');if(path!=='memory://')await mkdir(path,{recursive:true});
  const instance=new PGlite(path);await instance.waitReady;db={query:(sql,params=[])=>instance.query(sql,params),close:()=>instance.close(),exec:sql=>instance.exec(sql)};
 }
 const sql=await readFile(new URL('../migrations/001_initial.sql',import.meta.url),'utf8');if(pool)await db.query(sql);else await db.exec(sql);
 if(!(await db.query('SELECT version FROM schema_migrations WHERE version=2')).rows.length){const migration=await readFile(new URL('../migrations/002_audit_immutability.sql',import.meta.url),'utf8');if(pool)await db.query(migration);else await db.exec(migration);}
 let tail=Promise.resolve();
 const transaction=fn=>{
  const run=async()=>{const client=pool?await pool.connect():db;try{await client.query('BEGIN');if(pool)await client.query('SELECT pg_advisory_xact_lock(740031)');const value=await fn(client);await client.query('COMMIT');return value;}catch(e){await client.query('ROLLBACK');throw e;}finally{if(pool)client.release();}};
  const result=tail.then(run,run);tail=result.catch(()=>{});return result;
 };
 const load=async(client,includeBinary=false)=>{const state=emptyState();const {rows}=await client.query(includeBinary?'SELECT kind,data FROM records ORDER BY id':"SELECT kind,CASE WHEN kind='documents' THEN data - 'base64' ELSE data END AS data FROM records ORDER BY id");for(const r of rows)if(state[r.kind])state[r.kind].push(r.data);return state;};
 const save=async(client,before,after)=>{
  for(const kind of KINDS){const old=new Map(before[kind].map(x=>[x.id,x]));for(const record of after[kind]){
   if(JSON.stringify(old.get(record.id))!==JSON.stringify(record))await client.query('INSERT INTO records(kind,id,site_id,version,data) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(kind,id) DO UPDATE SET site_id=excluded.site_id,version=excluded.version,data=excluded.data,updated_at=now()',[kind,record.id,record.siteId,record.version,JSON.stringify(record)]);old.delete(record.id);
  }for(const id of old.keys())await client.query('DELETE FROM records WHERE kind=$1 AND id=$2',[kind,id]);}
 };
 const audit=async(client,event)=>{
  await client.query('INSERT INTO audit_events(id,site_id,actor_id,operation,subject_id,occurred_at,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[event.id,event.siteId,event.actorId,event.operation,event.subjectId,event.occurredAt,scrub(event.details)]);
  await client.query('INSERT INTO integration_outbox(id,site_id,event) VALUES($1,$2,$3::jsonb)',[randomUUID(),event.siteId,scrub(event)]);
 };
 return {
  mode,db,transaction,load:(client=db,includeBinary=false)=>load(client,includeBinary),save,audit,
  async receipts(user,actions){
   if(!Array.isArray(actions)||actions.length>200)throw new DomainError('Consulta de confirmaciones inválida',400);
   const accepted=[],collisions=[];for(const action of actions){if(!user.siteIds.includes(action.siteId))continue;const result=await db.query('SELECT request_hash FROM action_receipts WHERE user_id=$1 AND operation_id=$2',[user.id,action.operationId]);if(result.rows.length){const hash=createHash('sha256').update(JSON.stringify(action)).digest('hex');(hash===result.rows[0].request_hash?accepted:collisions).push(action.operationId);}}
   return {accepted,collisions};
  },
  async users(){return (await db.query('SELECT id,email,profile,active FROM accounts ORDER BY email')).rows.map(a=>({...a.profile,id:a.id,email:a.email,active:a.active}));},
  async seed(state,accounts){await transaction(async c=>{const count=await c.query('SELECT count(*) as n FROM accounts');if(Number(count.rows[0].n))return;await save(c,emptyState(),state);for(const a of accounts)await c.query('INSERT INTO accounts(id,email,password_hash,profile) VALUES($1,$2,$3,$4::jsonb)',[a.id,a.email,a.passwordHash,JSON.stringify(a.profile)]);});},
  async action(user,action){
   if(!action.operationId||!/^[\w-]{8,100}$/.test(action.operationId))throw new DomainError('operationId inválido',400);
   const hash=createHash('sha256').update(JSON.stringify(action)).digest('hex');
   return transaction(async c=>{
    const prior=await c.query('SELECT request_hash,result FROM action_receipts WHERE user_id=$1 AND operation_id=$2',[user.id,action.operationId]);
    if(prior.rows.length){if(prior.rows[0].request_hash!==hash)throw new DomainError('Identificador reutilizado con contenido diferente',409);return {...prior.rows[0].result,replayed:true};}
    const state=await load(c),before=structuredClone(state);const users=(await c.query('SELECT id,email,profile,active FROM accounts')).rows.map(a=>({...a.profile,id:a.id,email:a.email,active:a.active}));
    const outcome=execute(state,user,action,users);await save(c,before,outcome.state);await audit(c,{...outcome.audit,details:{...outcome.audit.details,before:beforeSubject(before,action),after:outcome.result}});
    const response={result:JSON.parse(scrub(outcome.result)),operationId:action.operationId};await c.query('INSERT INTO action_receipts(user_id,operation_id,request_hash,result) VALUES($1,$2,$3,$4::jsonb)',[user.id,action.operationId,hash,JSON.stringify(response)]);return response;
   });
  },
  async recordConflict(user,action,error){
   await transaction(async c=>{const existing=await c.query("SELECT id FROM records WHERE kind='conflicts' AND data->>'userId'=$1 AND data->'action'->>'operationId'=$2",[user.id,action.operationId]);if(existing.rows.length)return;const conflict={id:randomUUID(),siteId:action.siteId,version:1,userId:user.id,action,error:error.message,current:error.details?.current||null,status:'Pendiente',createdAt:new Date().toISOString()};await c.query('INSERT INTO records(kind,id,site_id,version,data) VALUES($1,$2,$3,1,$4::jsonb)',['conflicts',conflict.id,action.siteId,JSON.stringify(conflict)]);});
  },
  async auditList(site){return (await db.query('SELECT id,actor_id,operation,subject_id,occurred_at,received_at,details FROM audit_events WHERE site_id=$1 ORDER BY received_at DESC LIMIT 1000',[site])).rows;},
  async close(){await tail;if(pool)await pool.end();else await db.close();}
 };
}
function beforeSubject(before,action){const id=action.payload.id||action.payload.partId||action.payload.orderId||action.payload.assetId;for(const list of Object.values(before)){const found=list.find(x=>x.id===id);if(found)return found;}return null;}
function scrub(value){return JSON.stringify(value,(key,item)=>key==='base64'&&typeof item==='string'?`[sha256:${createHash('sha256').update(item).digest('hex')}]`:item);}
