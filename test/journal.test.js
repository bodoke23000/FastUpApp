import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkJournal} from '../public/journal.js';
import {execute,project} from '../server/domain.js';
import {seedData} from '../server/seed.js';

function fixture(){
 const seed=seedData(true),users=seed.accounts.map(x=>({...x.profile,id:x.id,email:x.email,active:true}));const user=users.find(x=>x.id==='admin');let server=seed.state,persisted;const accepted=new Map();let failNetwork=false,lostResponse=false,failStorage=false;let sends=0;
 const options={user,site:'plant-1',base:project(server,user,'plant-1',users),save:async value=>{if(failStorage)throw Error('Device storage unavailable');persisted=structuredClone(value);},receipts:async actions=>{if(failNetwork)throw Object.assign(Error('Disconnected'),{network:true});return {accepted:actions.filter(a=>accepted.has(a.operationId)).map(a=>a.operationId),collisions:[]};},snapshot:async()=>{if(failNetwork)throw Object.assign(Error('Disconnected'),{network:true});return project(server,user,'plant-1',users);},send:async action=>{sends++;if(failNetwork)throw Object.assign(Error('Disconnected'),{network:true});if(accepted.has(action.operationId))return accepted.get(action.operationId);const next=structuredClone(server),result=execute(next,user,action,users);server=result.state;accepted.set(action.operationId,result.result);if(lostResponse){lostResponse=false;throw Object.assign(Error('Response lost after commit'),{network:true});}return {result:result.result};}};
 const journal=new WorkJournal(options);
 return {journal,options,get persisted(){return persisted;},get server(){return server;},get sends(){return sends;},disconnect(){failNetwork=true;},connect(){failNetwork=false;},loseResponse(){lostResponse=true;},storageFailure(value){failStorage=value;},restore(){return new WorkJournal({...options,base:persisted.state,entries:persisted.queue,drafts:persisted.drafts,files:persisted.files});},mutate(action){const next=structuredClone(server);execute(next,user,{siteId:'plant-1',operationId:crypto.randomUUID(),...action},users);server=next;}};
}
test('offline admin creates an asset and dependent order, reloads and synchronizes exactly once',async()=>{
 const f=fixture();f.disconnect();const asset=await f.journal.enqueue('asset.create',{code:'OFF-001',name:'Equipo sin conexión',location:'Sector B'});
 await f.journal.enqueue('order.create',{assetId:asset.result.id,title:'Inspección sin red',type:'Inspección'});
 assert.equal(f.journal.state.orders.at(-1).assetId,asset.result.id);assert.equal(f.persisted.queue.length,2);assert.equal(f.server.assets.some(a=>a.code==='OFF-001'),false);
 const reopened=f.restore();assert.equal(reopened.state.assets.find(a=>a.code==='OFF-001').id,asset.result.id);f.connect();await reopened.sync();assert.equal(reopened.entries.length,0);assert.equal(f.server.assets.filter(a=>a.code==='OFF-001').length,1);assert.equal(f.server.orders.filter(o=>o.title==='Inspección sin red')[0].assetId,asset.result.id);await reopened.sync();assert.equal(f.sends,2);
});
test('mutation is saved before transmission and never acknowledged after local storage failure',async()=>{
 const f=fixture();f.storageFailure(true);await assert.rejects(()=>f.journal.enqueue('asset.create',{code:'UNSAVED',name:'Draft stays open',location:'A'}),/formulario se conserva/);assert.equal(f.journal.entries.length,0);assert.equal(f.sends,0);assert.equal(f.journal.state.assets.some(a=>a.code==='UNSAVED'),false);
});
test('lost response after server commit is reconciled on restart without a duplicate',async()=>{
 const f=fixture();await f.journal.enqueue('request.create',{assetId:'pump',description:'ACK perdido'});f.loseResponse();await f.journal.sync();assert.equal(f.persisted.queue.length,1);assert.equal(f.server.requests.filter(r=>r.description==='ACK perdido').length,1);const reopened=f.restore();await reopened.sync();assert.equal(reopened.entries.length,0);assert.equal(f.server.requests.filter(r=>r.description==='ACK perdido').length,1);assert.equal(f.sends,1);
});
test('dependent edits use predicted versions and keep the local view current',async()=>{
 const f=fixture();f.disconnect();let order=f.journal.state.orders.find(o=>o.id==='ot-248');await f.journal.enqueue('order.update',{id:order.id,priority:'Media',reason:'Reevaluación'},order);order=f.journal.state.orders.find(o=>o.id===order.id);assert.equal(order.version,2);await f.journal.enqueue('order.update',{id:order.id,dueAt:new Date(Date.now()+86400000).toISOString()},order);assert.equal(f.journal.state.orders.find(o=>o.id===order.id).version,3);f.connect();await f.journal.sync();assert.equal(f.server.orders.find(o=>o.id===order.id).version,3);assert.equal(f.journal.entries.length,0);
});
test('concurrent server edits preserve a conflict and block later dependent work',async()=>{
 const f=fixture();const order=f.journal.state.orders.find(o=>o.id==='ot-248');await f.journal.enqueue('order.update',{id:order.id,priority:'Media',reason:'Edición local'},order);const updated=f.journal.state.orders.find(o=>o.id===order.id);await f.journal.enqueue('order.update',{id:order.id,priority:'Baja',reason:'Edición local posterior'},updated);
 f.mutate({type:'order.update',payload:{id:order.id,priority:'Media',reason:'Otro supervisor'},expectedVersion:1});await f.journal.sync();assert.equal(f.journal.entries[0].status,'conflict');assert.equal(f.journal.entries[1].status,'pending');assert.equal(f.sends,1);assert.equal(f.persisted.queue.length,2);
});
test('drafts and prepared files survive journal reconstruction',async()=>{const f=fixture();f.journal.drafts.example={diagnosis:'Borrador conservado'};f.journal.files.example={name:'manual.txt',base64:'aG9sYQ=='};await f.journal.persist();const reopened=f.restore();assert.equal(reopened.drafts.example.diagnosis,'Borrador conservado');assert.equal(reopened.files.example.base64,'aG9sYQ==');});

test('the same open session recovers after a network failure without requiring reload',async()=>{
 const f=fixture();await f.journal.enqueue('request.create',{assetId:'pump',description:'Reconnect without reload'});f.loseResponse();await f.journal.sync();assert.equal(f.journal.connected,false);await f.journal.sync();assert.equal(f.journal.connected,true);assert.equal(f.journal.entries.length,0);assert.equal(f.sends,1);
});

test('reviewing a rejected creation preserves dependent record references',async()=>{
 const f=fixture();const asset=await f.journal.enqueue('asset.create',{code:'OFF-CONFLICT',name:'Local creation',location:'A'});await f.journal.enqueue('order.create',{assetId:asset.result.id,title:'Dependent work',type:'Correctiva'});
 f.mutate({type:'asset.create',payload:{code:'OFF-CONFLICT',name:'Concurrent creation',location:'B'}});await f.journal.sync();assert.equal(f.journal.entries[0].status,'conflict');assert.equal(f.journal.entries[1].status,'pending');
 f.journal.entries[0].payload.code='OFF-CORRECTED';await f.journal.retry(f.journal.entries[0].operationId,'Reviewed duplicate code');const newAsset=f.journal.state.assets.find(a=>a.code==='OFF-CORRECTED');assert.ok(newAsset);assert.equal(f.journal.state.orders.find(o=>o.title==='Dependent work').assetId,newAsset.id);await f.journal.sync();assert.equal(f.journal.entries.length,0);assert.equal(f.server.orders.find(o=>o.title==='Dependent work').assetId,newAsset.id);
});
