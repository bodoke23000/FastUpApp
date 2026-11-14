import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {openStore} from '../server/store.js';
import {seedData} from '../server/seed.js';

const url=process.env.FASTUP_TEST_DATABASE_URL;
test('external PostgreSQL driver: migrations, concurrent writes, receipts and immutable audit',
 {skip:!url?'Set FASTUP_TEST_DATABASE_URL to enable the external PostgreSQL test':false,timeout:60000},async()=>{
  const database='fastup_test_'+randomUUID().replaceAll('-','');const control=new pg.Pool({connectionString:url,max:1});let store,created=false;
  try{
   await control.query('CREATE DATABASE "'+database+'"');created=true;const target=new URL(url);target.pathname='/'+database;store=await openStore({mode:'postgres',url:target.href});const seed=seedData(true);await store.seed(seed.state,seed.accounts);const admin=(await store.users()).find(u=>u.id==='admin');
   const actions=Array.from({length:50},(_,i)=>({type:'request.create',siteId:'plant-1',operationId:randomUUID(),payload:{assetId:'pump',description:'PG concurrency '+i}}));
   await Promise.all(actions.map(a=>store.action(admin,a)));const state=await store.load();assert.equal(state.requests.filter(r=>r.description.startsWith('PG concurrency ')).length,50);assert.equal(new Set(state.requests.map(r=>r.code)).size,state.requests.length);
   assert.equal((await store.action(admin,actions[0])).replayed,true);assert.deepEqual((await store.receipts(admin,actions)).accepted.sort(),actions.map(a=>a.operationId).sort());
   await assert.rejects(()=>store.action(admin,{...actions[0],payload:{assetId:'pump',description:'Changed'}}),e=>e.status===409);await assert.rejects(()=>store.db.query('DELETE FROM audit_events'),/append-only/);
  }finally{
   if(store)await store.close();if(created){assert.match(database,/^fastup_test_[a-f0-9]{32}$/);await control.query('DROP DATABASE "'+database+'"');}await control.end();
  }
 });
