import {randomUUID} from 'node:crypto';
import {generatePlans} from './domain.js';

export async function maintenanceTick(store,now=new Date()){
 return store.transaction(async client=>{
  const state=await store.load(client),before=structuredClone(state),at=now.toISOString();let count=0;
  const add=(site,key,title,body,role='supervisor',orderId=null)=>{if(state.notices.some(n=>n.siteId===site&&n.key===key))return;state.notices.push({id:randomUUID(),siteId:site,version:1,createdAt:at,key,title,body,targetRole:role,orderId,ackBy:[]});count++;};
  for(const site of state.sites){const generated=site.autoGeneratePM?generatePlans(state,site.id,{id:'system',role:'admin',siteIds:[site.id]},at):{created:[]};count+=generated.created.length;
   for(const request of state.requests.filter(r=>r.siteId===site.id&&r.status==='Por revisar'))if(now-Date.parse(request.createdAt)>=(site.reviewHours||4)*3600000)add(site.id,`request-review:${request.id}`,'Aviso sin revisar',`${request.code} espera revisión de mantenimiento.`);
   for(const order of state.orders.filter(o=>o.siteId===site.id&&!['Finalizada','Cancelada'].includes(o.status)&&Date.parse(o.dueAt)<now)){
    add(site.id,`order-overdue:${order.id}:${order.dueAt}`,'Orden vencida',`${order.code}: ${order.title}`,'supervisor',order.id);
    if(now-Date.parse(order.dueAt)>=(site.escalationHours||24)*3600000)add(site.id,`order-escalation:${order.id}:${order.dueAt}`,'Escalamiento por atraso',`${order.code} excedió el plazo de escalamiento.`,'manager',order.id);
   }
   for(const resource of state.resources.filter(r=>r.siteId===site.id&&r.dueAt&&r.status!=='Retirado'&&r.status!=='Completado'))if(Date.parse(resource.dueAt)-now<=30*86400000)add(site.id,`resource-due:${resource.id}:${resource.dueAt}`,'Vencimiento de recurso',`${resource.name}: ${resource.dueAt.slice(0,10)}`);
  }
  if(count){await store.save(client,before,state);for(const site of state.sites)await store.audit(client,{id:randomUUID(),siteId:site.id,actorId:'system',operation:'automation.tick',subjectId:site.id,occurredAt:at,details:{changedRecords:count}});}
  return {changedRecords:count};
 });
}
