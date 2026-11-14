import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {openStore} from '../server/store.js';
import {createApp} from '../server/index.js';
import {startServer} from '../server/startup.js';
import {WorkJournal} from '../public/journal.js';
import * as vault from '../public/storage.js';

// Integration walkthrough of the actual HTTP API, encrypted device store and sync engine.
// This deliberately does not claim to verify browser rendering or service-worker installation.
test('admin online → offline → encrypted restart → reconnect completes the maintenance lifecycle',async t=>{
 const store=await openStore({memory:true});const {server}=await startServer(options=>createApp({...options,store,demo:true}),{port:0});const origin='http://127.0.0.1:'+server.address().port;
 let session,cookie,connected=true,dropResponse=false;
 const request=async(path,{method='GET',body,headers={}}={})=>{
  if(!connected)throw Object.assign(Error('Simulated network interruption'),{network:true});
  const response=await fetch(origin+path,{method,headers:{Cookie:cookie||'','X-Workspace-User':session?.user.id||'',...(body?{'Content-Type':'application/json','X-CSRF-Token':session?.csrf||''}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error),{status:response.status,details:data.details});return data;
 };
 try{
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@fastup.local',password:'FastUp-Demo-2026!'})});assert.equal(login.status,200);session=await login.json();cookie=login.headers.get('set-cookie').split(';')[0];
  const initial=await request('/api/state?site=plant-1');assert.equal(session.user.role,'admin');assert.ok(Array.isArray(initial.audit));
  const options={user:session.user,site:'plant-1',base:initial,save:async data=>assert.equal(await vault.saveVault(data),true),snapshot:()=>request('/api/state?site=plant-1'),receipts:actions=>request('/api/action-status',{method:'POST',body:{actions}}),send:async action=>{const result=await request('/api/actions',{method:'POST',body:action});if(dropResponse){dropResponse=false;throw Object.assign(Error('Response lost after commit'),{network:true});}return result;}};
  let journal=new WorkJournal(options);await vault.enableVault(session.user,'disposable-admin-walkthrough-key',journal.export());
  const perform=async(type,payload,record)=>{const result=await journal.enqueue(type,payload,record);if(connected)await journal.sync();return result.result;};
  const current=(kind,id)=>journal.state[kind].find(x=>x.id===id);
  for(const path of ['/api/config','/api/me','/api/health?site=plant-1','/api/integrations?site=plant-1','/api/audit?site=plant-1','/api/reports?site=plant-1'])await request(path);
  for(const file of ['/','/app.js','/redesign.css','/domain.js','/journal.js','/storage.js','/sw.js','/manifest.webmanifest'])assert.equal((await fetch(origin+file)).status,200,file);
  const asset=await perform('asset.create',{code:'QA-ADMIN-01',name:'Bomba de recorrido',location:'Planta de prueba',equipmentType:'Bomba',brand:'QA',model:'Fixture'});
  const order=await perform('order.create',{assetId:asset.id,title:'Mantenimiento del recorrido',type:'Correctiva',clearanceRequired:true});
  await perform('order.assign',{id:order.id,technicianIds:['technician'],reason:'Asignación del recorrido'},current('orders',order.id));
  await assert.rejects(()=>journal.enqueue('order.transition',{id:order.id,status:'En proceso'},current('orders',order.id)),/autorización/);
  await perform('order.clearance',{id:order.id,reference:'QA-PERMISO',note:'Autorización sintética'},current('orders',order.id));
  await perform('order.transition',{id:order.id,status:'En proceso'},current('orders',order.id));
  const part=await perform('part.create',{code:'QA-SELLO',name:'Sello de prueba',unit:'un',bin:'QA',cost:1000});
  await perform('stock.move',{partId:part.id,type:'receipt',quantity:5,reason:'Recepción QA'},current('parts',part.id));
  t.diagnostic('Online admin: authenticated access, dashboard data, assets, controlled assignment, clearance, inventory and API resources passed.');
  connected=false;
  await perform('intervention.add',{orderId:order.id,diagnosis:'Sello con desgaste',activity:'Reemplazo y verificación',cause:'Desgaste',hours:1,startedAt:new Date(Date.now()-7200000).toISOString(),endedAt:new Date(Date.now()-3600000).toISOString()},current('orders',order.id));
  await perform('stock.move',{partId:part.id,orderId:order.id,type:'issue',quantity:1,reason:'Consumo en mantenimiento'},current('parts',part.id));
  const evidence=await perform('document.add',{orderId:order.id,name:'evidencia-qa.txt',mime:'text/plain',base64:Buffer.from('Evidencia sintética offline').toString('base64')});
  journal.drafts['unsubmitted']={diagnosis:'Borrador pendiente'};journal.files['prepared-manual']={name:'manual.txt',base64:'aG9sYQ=='};await journal.persist();
  assert.equal(journal.entries.length,3);assert.equal(current('parts',part.id).stock,4);assert.equal(current('documents',evidence.id).base64,evidence.base64);
  vault.lockVault();const restartedVault=await import('../public/storage.js?admin-restart=1');const cached=await restartedVault.unlockVault(session.user.id,'disposable-admin-walkthrough-key');
  journal=new WorkJournal({...options,base:cached.state,entries:cached.queue,drafts:cached.drafts,files:cached.files,save:async data=>assert.equal(await restartedVault.saveVault(data),true)});
  assert.equal(journal.drafts.unsubmitted.diagnosis,'Borrador pendiente');assert.equal(current('parts',part.id).stock,4);assert.equal(current('documents',evidence.id).base64,evidence.base64);
  await perform('order.transition',{id:order.id,status:'En prueba'},current('orders',order.id));
  await perform('order.test',{id:order.id,passed:true,note:'Prueba de funcionamiento satisfactoria'},current('orders',order.id));
  await perform('order.transition',{id:order.id,status:'Finalizada'},current('orders',order.id));
  assert.equal(current('orders',order.id).status,'Finalizada');assert.equal((await store.load()).orders.find(o=>o.id===order.id).status,'En proceso');
  t.diagnostic('Offline admin: intervention, parts consumption, attachment, draft recovery and closure validation survived encrypted restart.');
  connected=true;dropResponse=true;await journal.sync();assert.ok(journal.entries.length>0);await journal.sync();assert.equal(journal.entries.length,0);await journal.sync();
  const final=await request('/api/state?site=plant-1');assert.equal(final.orders.find(o=>o.id===order.id).status,'Finalizada');assert.equal(final.parts.find(p=>p.id===part.id).stock,4);assert.equal(final.interventions.filter(i=>i.orderId===order.id).length,1);
  const document=await fetch(origin+'/api/document?site=plant-1&id='+encodeURIComponent(evidence.id),{headers:{Cookie:cookie,'X-Workspace-User':session.user.id}});assert.equal(document.status,200);assert.equal(await document.text(),'Evidencia sintética offline');
  const report=await request('/api/reports?site=plant-1&assetId='+encodeURIComponent(asset.id));assert.equal(report.closed,1);assert.equal(report.laborHours,1);assert.equal(report.partsByCurrency.CLP,1000);assert.ok(final.audit.some(e=>e.operation==='order.transition'&&e.subject_id===order.id));
  const mismatched=await fetch(origin+'/api/state?site=plant-1',{headers:{Cookie:cookie,'X-Workspace-User':'another-account'}});assert.equal(mismatched.status,401);
  const receipts=await request('/api/action-status',{method:'POST',body:{actions:[]}});assert.deepEqual(receipts,{accepted:[],collisions:[]});
  t.diagnostic('Reconnection: lost response recovered in the same session, exactly one intervention and stock issue, downloadable evidence, report totals, audit and account binding passed.');
  await restartedVault.removeVault(session.user.id);
 }finally{await new Promise(r=>server.close(r));await store.close();}
});
