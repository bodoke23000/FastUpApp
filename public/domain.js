const randomUUID = () => globalThis.crypto.randomUUID();
const operationIds = new WeakMap();
const nextId = state => { const sequence=operationIds.get(state); return sequence ? `${sequence.actor}:${sequence.operation}:${++sequence.index}` : randomUUID(); };

export const KINDS = ['sites','assets','requests','orders','interventions','parts','movements','reservations','plans','readings','downtime','templates','notices','imports','resources','expenses','conflicts','exposure','documents'];
export const STATES = ['Registrada','Asignada','En proceso','En espera de repuesto','En prueba','Finalizada','Cancelada'];
export const ROLES = ['admin','supervisor','technician','operator','warehouse','manager'];
const CLOSED = ['Finalizada','Cancelada'];
const FLOW = {Registrada:['Asignada','Cancelada'],Asignada:['En proceso','Cancelada'],'En proceso':['En espera de repuesto','En prueba','Cancelada'],'En espera de repuesto':['En proceso','Cancelada'],'En prueba':['En proceso','Finalizada','Cancelada'],Finalizada:['En proceso'],Cancelada:['Registrada']};
export class DomainError extends Error { constructor(message,status=422,details={}) {super(message);this.status=status;this.details=details;} }
export const assert=(condition,message,status=422,details={})=>{if(!condition)throw new DomainError(message,status,details);};
export const emptyState=()=>Object.fromEntries(KINDS.map(k=>[k,[]]));
const text=(v,max=2000)=>String(v??'').trim().slice(0,max);
const required=(v,label)=>{const s=text(v);assert(s,`${label} es obligatorio`);return s;};
const number=(v,label,min=0)=>{const n=Number(v);assert(v!==''&&v!==null&&v!==undefined&&Number.isFinite(n)&&n>=min,`${label}: valor inválido`);return n;};
const date=(v,label)=>{assert(v&&Number.isFinite(Date.parse(v)),`${label}: fecha inválida`);return new Date(v).toISOString();};
const can=(user,...roles)=>assert(roles.includes(user.role)||user.role==='admin','No tienes permiso para esta operación',403);
const get=(s,kind,id,site)=>{const x=s[kind].find(x=>x.id===id&&(!site||x.siteId===site));assert(x,'Registro no encontrado',404);return x;};
const activeAsset=(s,id,site)=>{const a=get(s,'assets',id,site);assert(a.status!=='Retirado','El activo está retirado');return a;};
const version=(x,action)=>assert(Number.isInteger(action.expectedVersion)&&x.version===action.expectedVersion,'El registro cambió. Revisa los datos antes de reenviar.',409,{current:x});
const bump=x=>{x.version++;x.updatedAt=new Date().toISOString();return x;};
const nextCode=(s,kind,prefix)=>`${prefix}-${String(Math.max(0,...s[kind].map(x=>Number(x.code?.split('-').at(-1))||0))+1).padStart(4,'0')}`;
const add=(s,kind,site,fields)=>{const x={...fields,id:nextId(s),siteId:site,version:1,createdAt:fields.createdAt||new Date().toISOString()};s[kind].push(x);return x;};
const notice=(s,site,title,body,targetRole='supervisor',orderId=null)=>add(s,'notices',site,{title,body,targetRole,orderId,ackBy:[]});
const operatorOwn=(u,x)=>assert(u.role!=='operator'||x.requesterId===u.id,'Solo puedes consultar tus avisos',403);
const accessOrder=(s,id,site,u)=>{const o=get(s,'orders',id,site);assert(u.role!=='operator','Esta acción requiere mantenimiento',403);assert(u.role!=='technician'||o.technicianIds.includes(u.id),'La orden no está asignada a ti',403);return o;};
const openOrder=(s,id,site,u)=>{const o=accessOrder(s,id,site,u);assert(!CLOSED.includes(o.status),'La orden está cerrada; requiere revisión del supervisor',409,{current:o});return o;};
const precision=n=>Math.round(n*1e6)/1e6;
const totalIssued=(s,orderId,partId)=>precision(s.movements.filter(m=>m.orderId===orderId&&m.partId===partId).reduce((n,m)=>n+(m.type==='issue'?m.quantity:m.type==='return'?-m.quantity:0),0));
const available=(s,p,exclude)=>precision(p.stock-s.reservations.filter(r=>r.partId===p.id&&r.status==='Activa'&&r.orderId!==exclude).reduce((n,r)=>n+r.quantity,0));
export function suggestedPriority(asset,impact='Sin detención',urgency='Normal'){
 if(impact==='Seguridad'||impact==='Producción detenida'||urgency==='Inmediata')return 'Alta';
 if(asset.criticality==='Alta'&&impact==='Producción reducida'&&urgency==='Hoy')return 'Alta';
 if(asset.criticality==='Baja'&&impact==='Sin detención'&&urgency==='Planificada')return 'Baja';
 return 'Media';
}
const createOrder=(s,site,p,u,at)=>{
 const asset=activeAsset(s,p.assetId,site);
 const impact=p.impact||'Sin detención',urgency=p.urgency||'Normal',suggested=suggestedPriority(asset,impact,urgency);const priority=['Alta','Media','Baja'].includes(p.priority)?p.priority:suggested;
 const priorityReason=priority!==suggested?(['Plan','Inspección'].includes(p.source)?'Prioridad heredada del plan o de la inspección':required(p.priorityReason||p.reason,'Motivo de prioridad distinta a la sugerida')):text(p.priorityReason);
 return add(s,'orders',site,{code:nextCode(s,'orders','OT'),title:required(p.title,'Título'),assetId:asset.id,type:p.type||'Correctiva',source:p.source||'Directa',requestIds:p.requestIds||[],planId:p.planId||null,parentOrderId:p.parentOrderId||null,priority,suggestedPriority:suggested,priorityReason,impact,urgency,status:'Registrada',technicianIds:[],leadId:null,dueAt:date(p.dueAt||new Date(Date.parse(at)+86400000),'Vencimiento'),plannedAt:p.plannedAt?date(p.plannedAt,'Inicio previsto'):at,estimatedHours:number(p.estimatedHours??1,'Horas estimadas'),templateId:p.templateId||null,templateVersion:null,tasks:[],checks:[],handover:[],clearanceRequired:!!p.clearanceRequired,hazard:text(p.hazard),clearance:null,acceptance:null,createdBy:u.id,occurredAt:at});
};
function applyTemplate(s,o,templateId,site){if(!templateId)return;const t=get(s,'templates',templateId,site);o.templateId=t.id;o.templateVersion=t.version;o.tasks=structuredClone(t.tasks);}
export function execute(state,user,action,users=[]){
 assert(action&&typeof action.type==='string'&&action.payload&&typeof action.payload==='object','Acción inválida',400);
 const site=action.siteId;assert(user.siteIds.includes(site),'Sin acceso a esta planta',403);
 const s=state,p=action.payload,at=action.occurredAt?date(action.occurredAt,'Fecha del registro'):new Date().toISOString();
 assert(Date.parse(at)<=Date.now()+300000,'La fecha no puede estar en el futuro');
 operationIds.set(s,{actor:user.id,operation:action.operationId||randomUUID(),index:0});
 let result;const type=action.type;
 if(type==='site.policy'){
  can(user,'admin');result=get(s,'sites',site,site);version(result,action);result.autoGeneratePM=p.autoGeneratePM===true;result.reviewHours=number(p.reviewHours??4,'Revisión de avisos',0.1);result.escalationHours=number(p.escalationHours??24,'Escalamiento',0.1);bump(result);
 }else if(type==='asset.create'){
  can(user,'supervisor');const code=required(p.code,'Código');assert(!s.assets.some(a=>a.siteId===site&&a.code.toLowerCase()===code.toLowerCase()),'Código de activo duplicado');
  if(p.parentId)get(s,'assets',p.parentId,site);
  result=add(s,'assets',site,{code,name:required(p.name,'Nombre'),location:required(p.location,'Ubicación'),equipmentType:text(p.equipmentType)||'Otro',parentId:p.parentId||null,brand:text(p.brand),model:text(p.model),serial:text(p.serial),criticality:p.criticality||'Media',status:'Operativo',manual:text(p.manual),warrantyUntil:p.warrantyUntil||null,operatingHours:number(p.operatingHours??0,'Horas de operación'),meter:0,unit:p.unit||'h',operatingSchedule:text(p.operatingSchedule)||'Por definir',commissionedAt:p.commissionedAt||null});
 }else if(type==='asset.update'||type==='asset.retire'){
  can(user,'supervisor');result=get(s,'assets',p.id,site);version(result,action);
  if(type==='asset.retire'){assert(!s.orders.some(o=>o.assetId===result.id&&!CLOSED.includes(o.status)),'Resuelve las órdenes abiertas antes de retirar el activo');assert(!s.downtime.some(d=>d.assetId===result.id&&!d.endedAt),'Cierra la detención antes de retirar el activo');result.status='Retirado';result.retirementReason=required(p.reason,'Motivo de retiro');s.plans.filter(x=>x.assetId===result.id).forEach(x=>{x.active=false;bump(x);});}
  else {for(const k of ['name','location','equipmentType','brand','model','serial','criticality','manual','operatingSchedule'])if(p[k]!==undefined)result[k]=['name','location','criticality'].includes(k)?required(p[k],k):text(p[k]);if(p.parentId!==undefined){if(p.parentId){let a=get(s,'assets',p.parentId,site);const visited=new Set([result.id]);while(a){assert(!visited.has(a.id),'La jerarquía tendría un ciclo');visited.add(a.id);a=a.parentId?get(s,'assets',a.parentId,site):null;}}result.parentId=p.parentId||null;}}
  bump(result);
 }else if(type==='request.create'){
  can(user,'operator','technician','supervisor');activeAsset(s,p.assetId,site);
  result=add(s,'requests',site,{code:nextCode(s,'requests','AV'),assetId:p.assetId,description:required(p.description,'Descripción'),condition:p.condition||'Operando con anomalía',requesterId:user.id,status:'Por revisar',orderId:null,resolution:null,occurredAt:at});notice(s,site,'Nuevo aviso',result.code+': '+result.description);
 }else if(type==='request.triage'){
  can(user,'supervisor');result=get(s,'requests',p.id,site);version(result,action);assert(result.status==='Por revisar','El aviso ya fue revisado');
  if(p.decision==='reject'){result.status='Rechazado';result.resolution=required(p.reason,'Motivo');}
  else if(p.decision==='link'){const o=get(s,'orders',p.orderId,site);assert(o.assetId===result.assetId&&!CLOSED.includes(o.status),'Selecciona una orden abierta del mismo activo');o.requestIds.push(result.id);bump(o);result.status='Vinculado';result.orderId=o.id;result.resolution=text(p.reason)||'Vinculado a trabajo existente';}
  else {assert(p.decision==='accept','Decisión inválida');const impact=result.condition==='Equipo detenido'?'Producción detenida':result.condition==='Riesgo que requiere atención'?'Seguridad':'Sin detención';const o=createOrder(s,site,{...p,impact,assetId:result.assetId,title:p.title||result.description,source:'Aviso',requestIds:[result.id]},user,at);result.orderId=o.id;result.status='Aceptado';}
  result.reviewedBy=user.id;result.reviewedAt=at;bump(result);notice(s,site,'Aviso actualizado',`${result.code}: ${result.status}`,'operator',result.orderId);
 }else if(type==='order.create'){
  can(user,'supervisor');assert(['Correctiva','Preventiva','Inspección','Mejora'].includes(p.type),'Tipo inválido');result=createOrder(s,site,p,user,at);applyTemplate(s,result,p.templateId,site);
 }else if(type==='order.assign'){
  can(user,'supervisor');result=get(s,'orders',p.id,site);version(result,action);assert(!CLOSED.includes(result.status),'Orden cerrada');assert(Array.isArray(p.technicianIds)&&p.technicianIds.length,'Selecciona al menos un técnico');
  const ids=[...new Set(p.technicianIds)];ids.forEach(id=>{const tech=users.find(u=>u.id===id&&u.active&&u.siteIds.includes(site)&&u.role==='technician');assert(tech,'Técnico no disponible');assert(tech.available!==false,'El técnico está marcado como no disponible');});
  result.technicianIds=ids;result.leadId=ids.includes(p.leadId)?p.leadId:ids[0];result.assignmentReason=required(p.reason||'Asignación inicial','Motivo');if(result.status==='Registrada')result.status='Asignada';bump(result);notice(s,site,'Trabajo asignado',result.code,'technician',result.id);
 }else if(type==='order.update'){
  can(user,'supervisor');result=get(s,'orders',p.id,site);version(result,action);assert(!CLOSED.includes(result.status),'Orden cerrada');
  if(p.priority!==undefined){assert(['Alta','Media','Baja'].includes(p.priority),'Prioridad inválida');result.priority=p.priority;result.priorityReason=required(p.reason,'Motivo del cambio');}
  if(p.dueAt)result.dueAt=date(p.dueAt,'Vencimiento');if(p.plannedAt)result.plannedAt=date(p.plannedAt,'Inicio');if(p.estimatedHours!==undefined)result.estimatedHours=number(p.estimatedHours,'Horas');bump(result);
 }else if(type==='order.clearance'){
  can(user,'supervisor');result=get(s,'orders',p.id,site);version(result,action);assert(!CLOSED.includes(result.status),'Orden cerrada');result.clearance={reference:required(p.reference,'Referencia de permiso / autorización'),note:required(p.note,'Condiciones'),approvedBy:user.id,at};bump(result);
 }else if(type==='order.transition'){
  can(user,'technician','supervisor');result=accessOrder(s,p.id,site,user);version(result,action);assert(FLOW[result.status]?.includes(p.status),'Transición no permitida');
  if(['Cancelada','Registrada'].includes(p.status)||CLOSED.includes(result.status)){can(user,'supervisor');result.transitionReason=required(p.reason,'Motivo');}
  if(p.status==='En proceso'){assert(result.technicianIds.length,'Asigna responsables');assert(!result.clearanceRequired||result.clearance,'Falta autorización de trabajo');if(CLOSED.includes(result.status)){result.previousCompletions??=[];if(result.completedAt)result.previousCompletions.push({at:result.completedAt,acceptance:result.acceptance});result.acceptance=null;result.completedAt=null;}}
  if(p.status==='Asignada')assert(result.technicianIds.length,'Usa la asignación de técnicos antes de cambiar a Asignada');
  if(p.status==='En espera de repuesto')result.blocker=required(p.reason,'Repuesto / motivo de espera');
  if(p.status==='Finalizada'){
   const entries=s.interventions.filter(i=>i.orderId===result.id);assert(entries.some(i=>i.diagnosis&&i.activity&&i.endedAt&&i.authorId),'Faltan diagnóstico, actividad, responsable o fecha de término');
   assert(result.tasks.every(t=>result.checks.some(c=>c.taskId===t.id)),'Faltan tareas de la lista de verificación');
   assert(!result.checks.some(c=>c.result==='Fail'&&!c.followUpId),'Hay inspecciones fallidas sin acción de seguimiento');
   assert(result.acceptance?.passed,'Registra una prueba satisfactoria antes de finalizar');result.completedAt=at;
   completePlan(s,result,at);
  }
  if(p.status==='Cancelada'&&result.planId)completePlan(s,result,at);
  if(CLOSED.includes(p.status))s.reservations.filter(r=>r.orderId===result.id&&r.status==='Activa').forEach(r=>{r.status='Liberada';bump(r);bump(get(s,'parts',r.partId,site));});
  result.status=p.status;bump(result);notice(s,site,'Cambio de estado',`${result.code}: ${p.status}`,'supervisor',result.id);
 }else if(type==='order.test'){
  can(user,'technician','supervisor');result=openOrder(s,p.id,site,user);version(result,action);assert(result.status==='En prueba','La orden debe estar en prueba');
  result.acceptance={passed:p.passed===true,note:required(p.note,'Resultado de prueba'),by:user.id,at};result.testHistory??=[];result.testHistory.push(structuredClone(result.acceptance));if(!result.acceptance.passed){result.status='En proceso';result.followUpReason=result.acceptance.note;}bump(result);
 }else if(type==='intervention.add'){
  can(user,'technician','supervisor');const o=openOrder(s,p.orderId,site,user);version(o,action);assert(['En proceso','En prueba','En espera de repuesto'].includes(o.status),'Inicia la orden antes de registrar trabajo');
  const started=date(p.startedAt,'Inicio'),ended=date(p.endedAt,'Término');assert(ended>=started&&Date.parse(ended)<=Date.now()+300000,'Intervalo de trabajo inválido');
  const hours=number(p.hours,'Horas de trabajo',0.01);assert(hours<=24&&hours<=(Date.parse(ended)-Date.parse(started))/3600000+0.01,'Horas incompatibles con el intervalo (máximo 24 h)');
  assert(!s.interventions.some(i=>i.authorId===user.id&&i.startedAt<ended&&i.endedAt>started),'Ya existe una entrada de este técnico que se superpone');
  result=add(s,'interventions',site,{orderId:o.id,authorId:user.id,diagnosis:required(p.diagnosis,'Diagnóstico'),activity:required(p.activity,'Actividad'),symptom:text(p.symptom),cause:text(p.cause),causeConfirmed:!!p.causeConfirmed,failureCode:text(p.failureCode),startedAt:started,endedAt:ended,hours,rateSnapshot:Number(users.find(u=>u.id===user.id)?.hourlyRate||0),occurredAt:at});bump(o);
 }else if(type==='intervention.correct'){
  can(user,'supervisor');result=get(s,'interventions',p.id,site);version(result,action);result.corrections??=[];result.corrections.push({by:user.id,at,reason:required(p.reason,'Motivo'),previousHours:result.hours});result.hours=number(p.hours,'Horas',0.01);bump(result);
 }else if(type==='order.check'){
  can(user,'technician','supervisor');result=openOrder(s,p.id,site,user);version(result,action);assert(['En proceso','En prueba'].includes(result.status),'Inicia la orden antes de ejecutar tareas');const t=result.tasks.find(t=>t.id===p.taskId);assert(t,'Tarea desconocida');assert(['Pass','Fail','NA'].includes(p.result),'Resultado inválido');
  if(t.type==='reading'&&p.result!=='NA'){const v=number(p.value,'Medición',-1e12);assert(!((t.min!==null&&v<t.min)||(t.max!==null&&v>t.max))||p.result==='Fail','Valor fuera de rango: registra Fail');}
  const check={taskId:t.id,result:p.result,value:p.value??null,note:text(p.note),by:user.id,at,followUpId:null};
  if(p.result==='Fail'){const f=createOrder(s,site,{assetId:result.assetId,title:`Seguimiento: ${t.label}`,priority:result.priority,parentOrderId:result.id,source:'Inspección',type:'Correctiva'},user,at);check.followUpId=f.id;notice(s,site,'Inspección fallida',f.code,'supervisor',f.id);}
  result.checks=result.checks.filter(c=>c.taskId!==t.id);result.checks.push(check);bump(result);
 }else if(type==='order.handover'){
  can(user,'technician','supervisor');result=openOrder(s,p.id,site,user);version(result,action);const next=users.find(u=>u.id===p.nextUserId&&u.active&&u.role==='technician'&&u.siteIds.includes(site));assert(next,'Técnico receptor inválido');
  result.handover.push({id:nextId(s),at,by:user.id,nextUserId:next.id,condition:required(p.condition,'Estado del equipo'),pending:required(p.pending,'Trabajo pendiente'),precautions:text(p.precautions),ackAt:null});if(!result.technicianIds.includes(next.id))result.technicianIds.push(next.id);bump(result);notice(s,site,'Entrega de turno',result.code,'technician',result.id);
 }else if(type==='handover.ack'){
  can(user,'technician','supervisor');result=openOrder(s,p.id,site,user);version(result,action);const h=result.handover.find(h=>h.id===p.handoverId);assert(h&&h.nextUserId===user.id,'Entrega no dirigida a este usuario',403);h.ackAt=at;bump(result);
 }else if(type==='part.create'){
  can(user,'warehouse','supervisor');const code=required(p.code,'Código');assert(!s.parts.some(x=>x.siteId===site&&x.code.toLowerCase()===code.toLowerCase()),'Código de repuesto duplicado');result=add(s,'parts',site,{code,name:required(p.name,'Nombre'),unit:required(p.unit||'un','Unidad'),bin:required(p.bin||'Principal','Ubicación'),stock:0,minStock:number(p.minStock??0,'Mínimo'),cost:number(p.cost??0,'Costo unitario'),currency:p.currency||'CLP',assetIds:p.assetIds||[]});
 }else if(type==='stock.move'){
  can(user,'warehouse');const part=get(s,'parts',p.partId,site);version(part,action);assert(['receipt','adjustment','issue','return'].includes(p.type),'Movimiento inválido');const qty=number(p.quantity,'Cantidad',0.0001);const o=p.orderId?get(s,'orders',p.orderId,site):null;
  if(['issue','return'].includes(p.type)){assert(o&&!CLOSED.includes(o.status),'Se requiere una orden abierta');}
  if(p.type==='issue'){assert(available(s,part,o.id)>=qty,'Stock disponible insuficiente',409,{current:part});part.stock=precision(part.stock-qty);const r=s.reservations.find(r=>r.partId===part.id&&r.orderId===o.id&&r.status==='Activa');if(r){r.quantity=Math.max(0,precision(r.quantity-qty));if(!r.quantity)r.status='Consumida';bump(r);}}
  else if(p.type==='return'){assert(totalIssued(s,o.id,part.id)>=qty,'La devolución supera lo entregado');part.stock=precision(part.stock+qty);}
  else if(p.type==='adjustment'){const direction=p.direction===-1?-1:1;assert(precision(part.stock+direction*qty)>=0,'El ajuste dejaría stock negativo');if(direction<0)assert(available(s,part)>=qty,'El ajuste afecta stock reservado');part.stock=precision(part.stock+direction*qty);}
  else{part.stock=precision(part.stock+qty);if(p.cost!==undefined)part.cost=number(p.cost,'Costo');}
  const returnAllocations=[];let returnCost=0;
  if(p.type==='return'){let remaining=qty;for(const issue of s.movements.filter(m=>m.orderId===o.id&&m.partId===part.id&&m.type==='issue')){const already=s.movements.filter(m=>m.type==='return').flatMap(m=>m.returnAllocations||[]).filter(a=>a.issueId===issue.id).reduce((n,a)=>n+a.quantity,0);const amount=Math.min(remaining,issue.quantity-already);if(amount>0){returnAllocations.push({issueId:issue.id,quantity:amount,cost:issue.costSnapshot});returnCost+=amount*issue.costSnapshot;remaining-=amount;}if(remaining<=0)break;}assert(remaining<=0.00001,'No fue posible conciliar la devolución');}
  result=add(s,'movements',site,{partId:part.id,orderId:o?.id||null,type:p.type,quantity:qty,direction:p.type==='adjustment'?(p.direction===-1?-1:1):null,costSnapshot:p.type==='return'?returnCost/qty:part.cost,returnAllocations,currency:part.currency,authorId:user.id,reason:required(p.reason||'Entrega a OT','Motivo'),occurredAt:at});bump(part);
  if(part.stock<part.minStock)notice(s,site,'Stock bajo',`${part.code}: ${part.stock} ${part.unit}`,'warehouse');
 }else if(type==='part.reserve'){
  can(user,'warehouse','supervisor');const part=get(s,'parts',p.partId,site);version(part,action);const o=get(s,'orders',p.orderId,site);assert(!CLOSED.includes(o.status),'Orden cerrada');const quantity=number(p.quantity,'Cantidad',0.0001);assert(available(s,part)>=quantity,'Stock disponible insuficiente',409,{current:part});result=add(s,'reservations',site,{partId:part.id,orderId:o.id,quantity,status:'Activa',by:user.id});bump(part);
 }else if(type==='reservation.release'){
  can(user,'warehouse','supervisor');result=get(s,'reservations',p.id,site);version(result,action);assert(result.status==='Activa','Reserva ya resuelta');result.status='Liberada';bump(result);bump(get(s,'parts',result.partId,site));
 }else if(type==='expense.add'){
  can(user,'supervisor','warehouse');const o=get(s,'orders',p.orderId,site);assert(!CLOSED.includes(o.status),'Orden cerrada');result=add(s,'expenses',site,{orderId:o.id,description:required(p.description,'Concepto'),amount:number(p.amount,'Monto'),currency:p.currency||'CLP',by:user.id,occurredAt:at});
 }else if(type==='template.create'){
  can(user,'supervisor');assert(Array.isArray(p.tasks)&&p.tasks.length,'Agrega tareas');result=add(s,'templates',site,{name:required(p.name,'Nombre'),instructions:text(p.instructions),tasks:p.tasks.map(t=>({id:nextId(s),label:required(t.label,'Tarea'),type:t.type==='reading'?'reading':'check',unit:text(t.unit),min:t.min===''||t.min==null?null:Number(t.min),max:t.max===''||t.max==null?null:Number(t.max)}))});assert(result.tasks.every(t=>(t.min===null||Number.isFinite(t.min))&&(t.max===null||Number.isFinite(t.max))&&(t.min===null||t.max===null||t.min<=t.max)),'Rangos inválidos');
 }else if(type==='plan.create'){
  can(user,'supervisor');activeAsset(s,p.assetId,site);if(p.templateId)get(s,'templates',p.templateId,site);const intervalDays=number(p.intervalDays??0,'Intervalo días'),intervalMeter=number(p.intervalMeter??0,'Intervalo uso');assert(intervalDays>0||intervalMeter>0,'Define un intervalo');assert(!intervalDays||p.nextDue,'Define la próxima fecha');assert(['fixed','floating'].includes(p.mode),'Regla inválida');
  result=add(s,'plans',site,{name:required(p.name,'Nombre'),assetId:p.assetId,templateId:p.templateId||null,mode:p.mode,intervalDays,intervalMeter,nextDue:p.nextDue?date(p.nextDue,'Próxima fecha'):null,nextMeter:intervalMeter?number(p.nextMeter??intervalMeter,'Próximo medidor'):null,active:true,horizonDays:number(p.horizonDays??7,'Horizonte'),priority:p.priority||'Media'});
 }else if(type==='plan.update'){
  can(user,'supervisor');result=get(s,'plans',p.id,site);version(result,action);result.revisions??=[];result.revisions.push({at,by:user.id,reason:required(p.reason,'Motivo'),previous:{active:result.active,nextDue:result.nextDue}});if(p.active!==undefined)result.active=!!p.active;if(p.nextDue)result.nextDue=date(p.nextDue,'Próxima fecha');bump(result);
 }else if(type==='plan.generate'){
  can(user,'supervisor');result=generatePlans(s,site,user,at);
 }else if(type==='reading.add'){
  can(user,'technician','supervisor');const asset=activeAsset(s,p.assetId,site);version(asset,action);const value=number(p.value,'Lectura');assert(value>=asset.meter||p.reset===true,'El medidor no puede retroceder sin registrar un reemplazo');if(p.reset)required(p.reason,'Motivo del reinicio');const effectiveValue=(asset.meterOffset||0)+value+(p.reset?asset.meter:0);if(p.reset)asset.meterOffset=(asset.meterOffset||0)+asset.meter;asset.meter=value;asset.effectiveMeter=effectiveValue;bump(asset);result=add(s,'readings',site,{assetId:asset.id,value,effectiveValue,unit:asset.unit,reset:!!p.reset,reason:text(p.reason),by:user.id,occurredAt:at});
 }else if(type==='downtime.open'){
  can(user,'operator','technician','supervisor');const asset=activeAsset(s,p.assetId,site);version(asset,action);assert(!s.downtime.some(d=>d.assetId===asset.id&&!d.endedAt),'El activo ya tiene una detención abierta',409);const started=date(p.startedAt||at,'Inicio de detención');assert(Date.parse(started)<=Date.now()+300000,'Fecha futura');assert(!s.downtime.some(d=>d.assetId===asset.id&&d.endedAt&&started<d.endedAt&&(!p.endedAt||p.endedAt>d.startedAt)),'La detención se superpone a otra');result=add(s,'downtime',site,{assetId:asset.id,startedAt:started,endedAt:null,planned:!!p.planned,reason:required(p.reason,'Motivo'),orderIds:p.orderIds||[],by:user.id});asset.status='Detenido';bump(asset);
 }else if(type==='downtime.close'){
  can(user,'supervisor');result=get(s,'downtime',p.id,site);version(result,action);assert(!result.endedAt,'Detención cerrada');result.endedAt=date(p.endedAt||at,'Retorno a servicio');assert(result.endedAt>result.startedAt&&Date.parse(result.endedAt)<=Date.now()+300000,'Fecha de retorno inválida');result.returnNote=required(p.note,'Verificación de retorno');result.closedBy=user.id;bump(result);const asset=get(s,'assets',result.assetId,site);asset.status='Operativo';bump(asset);
 }else if(type==='exposure.add'){
  can(user,'supervisor');get(s,'assets',p.assetId,site);const from=date(p.from,'Desde'),to=date(p.to,'Hasta');assert(to>from,'Período inválido');const runtimeHours=number(p.runtimeHours,'Horas operativas'),scheduledHours=number(p.scheduledHours,'Horas programadas',0.01);assert(runtimeHours<=scheduledHours&&scheduledHours<=(Date.parse(to)-Date.parse(from))/3600000,'Horas incompatibles con el período');assert(!s.exposure.some(e=>e.assetId===p.assetId&&e.from<to&&e.to>from),'Período ya registrado');result=add(s,'exposure',site,{assetId:p.assetId,from,to,runtimeHours,scheduledHours,source:required(p.source,'Origen de horas'),by:user.id});
 }else if(type==='document.add'){
  can(user,'technician','supervisor','warehouse');if(p.orderId)openOrder(s,p.orderId,site,user);else get(s,'assets',p.assetId,site);assert(['image/jpeg','image/png','image/webp','application/pdf','text/plain'].includes(p.mime),'Tipo de archivo no permitido');assert(typeof p.base64==='string'&&p.base64.length<=7000000&&/^[a-zA-Z0-9+/]*={0,2}$/.test(p.base64),'Archivo inválido (máximo 5 MB)');assert(p.base64.length>0,'Archivo vacío');result=add(s,'documents',site,{orderId:p.orderId||null,assetId:p.assetId||null,name:required(p.name,'Nombre'),mime:p.mime,base64:p.base64,authorId:user.id,occurredAt:at});
 }else if(type==='conflict.resolve'){
  result=get(s,'conflicts',p.id,site);assert(user.role==='admin'||user.role==='supervisor'||result.userId===user.id,'Sin acceso al conflicto',403);version(result,action);assert(result.status==='Pendiente','Conflicto resuelto');result.status='Revisado';result.resolution=required(p.note,'Resolución');result.resolvedBy=user.id;result.resolvedAt=at;bump(result);
 }else if(type==='notice.ack'){
  result=get(s,'notices',p.id,site);assert(result.targetRole===user.role||user.role==='admin','Sin acceso a la alerta',403);if(!result.ackBy.includes(user.id))result.ackBy.push(user.id);bump(result);
 }else if(type==='resource.create'||type==='resource.update'){
  can(user,'supervisor');assert(['contractor','tool','calibration','warranty'].includes(p.category),'Categoría inválida');if(p.assetId)get(s,'assets',p.assetId,site);
  if(type==='resource.create')result=add(s,'resources',site,{category:p.category,name:required(p.name,'Nombre'),assetId:p.assetId||null,reference:text(p.reference),dueAt:p.dueAt?date(p.dueAt,'Fecha'):null,status:'Activo',note:text(p.note),holderId:null});
  else{result=get(s,'resources',p.id,site);version(result,action);if(p.status)result.status=required(p.status,'Estado');if(p.holderId!==undefined){assert(!p.holderId||users.some(u=>u.id===p.holderId&&u.active&&u.siteIds.includes(site)),'Responsable inválido');result.holderId=p.holderId||null;}if(p.note!==undefined)result.note=text(p.note);if(p.dueAt)result.dueAt=date(p.dueAt,'Fecha');bump(result);}
 }else if(type==='history.preview'){
  can(user,'admin');assert(Array.isArray(p.rows)&&p.rows.length&&p.rows.length<=2000,'Se admiten entre 1 y 2000 filas');
  const seen=new Set(),rows=p.rows.map((r,i)=>{const errors=[],asset=s.assets.find(a=>a.siteId===site&&a.code.toLowerCase()===text(r.assetCode).toLowerCase()),technician=users.find(u=>u.siteIds.includes(site)&&u.email.toLowerCase()===text(r.technicianEmail).toLowerCase());
   if(!asset)errors.push('Activo inexistente');if(!technician)errors.push('Técnico no reconocido: crea o mapea la cuenta');if(!text(r.legacyOrderCode)||!text(r.diagnosis)||!text(r.activity))errors.push('Falta código original, diagnóstico o actividad');
   if(!Number.isFinite(Date.parse(r.startedAt))||!Number.isFinite(Date.parse(r.endedAt))||Date.parse(r.endedAt)<=Date.parse(r.startedAt))errors.push('Fechas inválidas (usa ISO con zona horaria)');
   if(!Number.isFinite(Number(r.hours))||Number(r.hours)<=0)errors.push('Horas inválidas');if(r.historicalRate!==undefined&&r.historicalRate!==''&&(!Number.isFinite(Number(r.historicalRate))||Number(r.historicalRate)<0))errors.push('Tarifa histórica inválida');
   const fingerprint=[asset?.id,text(r.legacyOrderCode),r.startedAt,r.endedAt,technician?.id].join('|');if(seen.has(fingerprint)||s.interventions.some(x=>x.importFingerprint===fingerprint))errors.push('Intervención duplicada');seen.add(fingerprint);
   return {line:i+2,data:{...r,code:text(r.legacyOrderCode),name:text(r.diagnosis),assetId:asset?.id,authorId:technician?.id,fingerprint},errors};});result=add(s,'imports',site,{kind:'history',source:required(p.source,'Archivo'),status:'Validado',rows,createdIds:[],by:user.id});
 }else if(type==='history.commit'){
  can(user,'admin');result=get(s,'imports',p.id,site);version(result,action);assert(result.kind==='history'&&result.status==='Validado','Lote inválido');const skip=new Set(p.skipLines||[]);const accepted=result.rows.filter(r=>!skip.has(r.line));assert(accepted.every(r=>!r.errors.length),'Omite las filas inválidas');
  for(const row of accepted){const r=row.data;assert(!s.interventions.some(x=>x.importFingerprint===r.fingerprint),'Intervención ya importada',409);get(s,'assets',r.assetId,site);const existing=s.orders.find(o=>o.siteId===site&&o.legacyOrderCode===r.legacyOrderCode&&o.assetId===r.assetId);assert(!existing||existing.importId===result.id,'La orden original pertenece a otro lote');
   let order=existing;if(!order){order=add(s,'orders',site,{code:nextCode(s,'orders','OT'),legacyOrderCode:r.legacyOrderCode,title:r.diagnosis,assetId:r.assetId,type:'Correctiva',source:'Histórico importado',status:'Finalizada',priority:'Media',requestIds:[],planId:null,parentOrderId:null,technicianIds:[r.authorId],leadId:r.authorId,dueAt:date(r.endedAt,'Término'),plannedAt:date(r.startedAt,'Inicio'),estimatedHours:Number(r.hours),tasks:[],checks:[],handover:[],clearanceRequired:false,acceptance:null,importId:result.id,completedAt:date(r.endedAt,'Término'),createdAt:date(r.startedAt,'Inicio')});result.createdIds.push({kind:'orders',id:order.id,version:1});}
   const entry=add(s,'interventions',site,{orderId:order.id,authorId:r.authorId,diagnosis:r.diagnosis,activity:r.activity,cause:text(r.cause),failureCode:text(r.failureCode),causeConfirmed:false,startedAt:date(r.startedAt,'Inicio'),endedAt:date(r.endedAt,'Término'),hours:Number(r.hours),rateSnapshot:r.historicalRate===''||r.historicalRate===undefined?null:Number(r.historicalRate),occurredAt:date(r.endedAt,'Término'),importId:result.id,importFingerprint:r.fingerprint});result.createdIds.push({kind:'interventions',id:entry.id,version:1});}
  result.status='Importado';result.importedAt=at;result.skippedLines=[...skip];bump(result);
 }else if(type==='history.reverse'){
  can(user,'admin');result=get(s,'imports',p.id,site);version(result,action);assert(result.kind==='history'&&result.status==='Importado','Lote inválido');result.reason=required(p.reason,'Motivo');const ids=new Set(result.createdIds.map(c=>c.id));
  for(const c of result.createdIds){const x=get(s,c.kind,c.id,site);assert(x.version===c.version,'Un registro importado fue modificado');if(c.kind==='orders')assert(!s.movements.some(m=>m.orderId===x.id)&&!s.documents.some(d=>d.orderId===x.id)&&!s.expenses.some(e=>e.orderId===x.id)&&!s.interventions.some(i=>i.orderId===x.id&&!ids.has(i.id)),'Hay registros posteriores dependientes');}
  s.orders=s.orders.filter(x=>!ids.has(x.id));s.interventions=s.interventions.filter(x=>!ids.has(x.id));result.status='Revertido';bump(result);
 }else if(type==='import.preview'){
  can(user,'admin');assert(['assets','parts'].includes(p.kind)&&Array.isArray(p.rows)&&p.rows.length>0&&p.rows.length<=2000,'Importación inválida (máximo 2000 filas)');
  const seen=new Set();const rows=p.rows.map((r,i)=>{const code=text(r.code),name=text(r.name),errors=[];if(!code||!name)errors.push('Falta código o nombre');if(p.kind==='assets'&&!text(r.location))errors.push('Falta ubicación');if(seen.has(code.toLowerCase())||s[p.kind].some(x=>x.siteId===site&&x.code.toLowerCase()===code.toLowerCase()))errors.push('Código duplicado: omitir o corregir');seen.add(code.toLowerCase());if(p.kind==='parts'&&(!Number.isFinite(Number(r.stock||0))||Number(r.stock||0)<0||!Number.isFinite(Number(r.cost||0))||Number(r.cost||0)<0))errors.push('Stock/costo inválido');return {line:i+2,data:{...r,code,name},errors};});result=add(s,'imports',site,{kind:p.kind,source:required(p.source,'Archivo'),status:'Validado',rows,createdIds:[],by:user.id});
 }else if(type==='import.commit'){
  can(user,'admin');result=get(s,'imports',p.id,site);version(result,action);assert(result.status==='Validado','Importación ya procesada');const skipped=new Set(p.skipLines||[]);assert(result.rows.filter(r=>!skipped.has(r.line)).every(r=>!r.errors.length),'Omite o corrige las filas inválidas');
  result.rows.filter(r=>!skipped.has(r.line)).forEach(r=>{assert(!s[result.kind].some(x=>x.siteId===site&&x.code.toLowerCase()===r.data.code.toLowerCase()),'Otro proceso creó este código. Vuelve a validar.',409);let x;if(result.kind==='assets')x=add(s,'assets',site,{...r.data,equipmentType:text(r.data.equipmentType)||'Otro',status:'Operativo',parentId:null,criticality:r.data.criticality||'Media',meter:0,unit:'h',operatingHours:0});else x=add(s,'parts',site,{...r.data,stock:Number(r.data.stock||0),cost:Number(r.data.cost||0),minStock:Number(r.data.minStock||0),unit:r.data.unit||'un',bin:r.data.bin||'Principal',currency:r.data.currency||'CLP',assetIds:[]});x.importId=result.id;result.createdIds.push({id:x.id,version:x.version});});result.status='Importado';result.importedAt=at;result.skippedLines=[...skipped];bump(result);
 }else if(type==='import.reverse'){
  can(user,'admin');result=get(s,'imports',p.id,site);version(result,action);assert(result.status==='Importado','Lote no reversible');required(p.reason,'Motivo');
  result.createdIds.forEach(c=>{const x=get(s,result.kind,c.id,site);assert(x.version===c.version,'Un registro importado fue modificado; requiere corrección manual');assert(!s.orders.some(o=>o.assetId===x.id)&&!s.movements.some(m=>m.partId===x.id)&&!s.plans.some(p=>p.assetId===x.id)&&!s.downtime.some(d=>d.assetId===x.id)&&!s.requests.some(r=>r.assetId===x.id),'El lote ya tiene registros dependientes');});
  const ids=new Set(result.createdIds.map(c=>c.id));s[result.kind]=s[result.kind].filter(x=>!ids.has(x.id));result.status='Revertido';result.reason=p.reason;bump(result);
 }else throw new DomainError('Acción desconocida',400);
 return {state:s,result,audit:{id:randomUUID(),siteId:site,actorId:user.id,operation:type,subjectId:result?.id||p.id||null,occurredAt:at,details:{payload:p,result}}};
}
function completePlan(s,o,at){if(!o.planId)return;const plan=s.plans.find(p=>p.id===o.planId);if(plan?.mode==='floating'){if(plan.intervalDays)plan.nextDue=new Date(Date.parse(at)+plan.intervalDays*86400000).toISOString();if(plan.intervalMeter){const a=s.assets.find(a=>a.id===plan.assetId);plan.nextMeter=(a.effectiveMeter??a.meter)+plan.intervalMeter;}bump(plan);}}
export function generatePlans(s,site,u,at=new Date().toISOString()){
 const created=[];
 for(const p of s.plans.filter(p=>p.siteId===site&&p.active)){
  const a=s.assets.find(a=>a.id===p.assetId);if(!a||a.status==='Retirado')continue;
  const horizon=Date.parse(at)+p.horizonDays*86400000,meter=a.effectiveMeter??a.meter;
  const due=(p.nextDue&&Date.parse(p.nextDue)<=horizon)||(p.nextMeter!==null&&meter>=p.nextMeter);if(!due)continue;
  if(s.orders.some(o=>o.planId===p.id&&!CLOSED.includes(o.status)))continue;
  const token=`${p.nextDue}|${p.nextMeter}`;if(s.orders.some(o=>o.planId===p.id&&o.scheduleToken===token))continue;
  const o=createOrder(s,site,{assetId:a.id,title:p.name,type:'Preventiva',source:'Plan',priority:p.priority,planId:p.id,dueAt:p.nextDue||at},u,at);o.scheduleToken=token;applyTemplate(s,o,p.templateId,site);created.push(o);
  if(p.mode==='fixed'){if(p.intervalDays&&p.nextDue){do{p.nextDue=new Date(Date.parse(p.nextDue)+p.intervalDays*86400000).toISOString();}while(Date.parse(p.nextDue)<=Date.parse(at));}if(p.intervalMeter&&p.nextMeter!==null){do{p.nextMeter+=p.intervalMeter;}while(p.nextMeter<=meter);}bump(p);}
  notice(s,site,'Preventivo generado',o.code,'supervisor',o.id);
 }
 return {created};
}
export function project(state,user,site,users){
 assert(user.siteIds.includes(site),'Sin acceso a esta planta',403);const s=structuredClone(state);for(const k of KINDS)s[k]=s[k].filter(x=>x.siteId===site||k==='sites'&&user.siteIds.includes(x.id));
 if(user.role==='operator'){s.requests=s.requests.filter(x=>x.requesterId===user.id);for(const k of ['orders','interventions','parts','movements','reservations','plans','readings','templates','imports','resources','expenses','conflicts','exposure','documents'])s[k]=[];}
 if(user.role==='technician'){s.requests=[];s.imports=[];s.expenses=[];s.conflicts=s.conflicts.filter(c=>c.userId===user.id);}
 if(user.role!=='admin'){s.imports=[];if(user.role!=='supervisor')s.conflicts=s.conflicts.filter(c=>c.userId===user.id);}
 s.notices=s.notices.filter(n=>n.targetRole===user.role||user.role==='admin');
 const costs=['admin','supervisor','manager','warehouse'].includes(user.role);if(!costs){const sensitive=new Set(['cost','costSnapshot','rateSnapshot','hourlyRate']);const redact=x=>{if(!x||typeof x!=='object')return;for(const key of Object.keys(x)){if(sensitive.has(key))delete x[key];else redact(x[key]);}};redact(s);}
 s.documents.forEach(d=>delete d.base64);
 s.users=users.filter(u=>u.siteIds.includes(site)).map(u=>{const {passwordHash,...profile}=u;if(!costs)delete profile.hourlyRate;return profile;});return s;
}
export function reports(s,site,from,to,filters={}){
 if(filters.assetId||filters.workType||filters.equipmentType){
  const scoped=structuredClone(s);if(filters.assetId)get(s,'assets',filters.assetId,site);
  if(filters.workType)assert(['Correctiva','Preventiva','Inspección','Mejora'].includes(filters.workType),'Tipo de trabajo inválido');
  const assetIds=new Set(s.assets.filter(a=>a.siteId===site&&(!filters.equipmentType||(a.equipmentType||'Otro')===filters.equipmentType)).map(a=>a.id));
  scoped.orders=scoped.orders.filter(o=>o.siteId===site&&assetIds.has(o.assetId)&&(!filters.assetId||o.assetId===filters.assetId)&&(!filters.workType||o.type===filters.workType));const ids=new Set(scoped.orders.map(o=>o.id));
  scoped.assets=scoped.assets.filter(a=>a.siteId===site&&assetIds.has(a.id)&&(!filters.assetId||a.id===filters.assetId));
  for(const kind of ['interventions','movements','expenses'])scoped[kind]=scoped[kind].filter(x=>ids.has(x.orderId));
  scoped.downtime=scoped.downtime.filter(d=>assetIds.has(d.assetId)&&(!filters.assetId||d.assetId===filters.assetId)&&(!filters.workType||d.orderIds.some(id=>ids.has(id))));
  const report=reports(scoped,site,from,to);report.filters=filters;if(filters.workType){report.definitions.downtime+=' Con filtro de tipo: solo detenciones vinculadas a órdenes del tipo elegido.';report.assets.forEach(a=>a.mtbfHours=null);report.definitions.reliability+=' MTBF deshabilitado al filtrar tipo de trabajo para no excluir fallas de su denominador.';}return report;
 }
 const start=from?Date.parse(from):Date.now()-30*86400000,end=to?Date.parse(to)+(/^\d{4}-\d{2}-\d{2}$/.test(to)?86400000:0):Date.now();assert(Number.isFinite(start)&&Number.isFinite(end)&&end>start,'Período inválido');
 const within=v=>Date.parse(v)>=start&&Date.parse(v)<end;
 const orders=s.orders.filter(o=>o.siteId===site),inPeriod=orders.filter(o=>within(o.createdAt)),closed=orders.filter(o=>o.status==='Finalizada'&&o.completedAt&&within(o.completedAt));
 const intervention=s.interventions.filter(i=>i.siteId===site&&within(i.endedAt));const moves=s.movements.filter(m=>m.siteId===site&&within(m.occurredAt));
 const labor=intervention.reduce((n,i)=>n+i.hours,0),laborCost=intervention.reduce((n,i)=>n+i.hours*i.rateSnapshot,0);
 const partsByCurrency={};moves.forEach(m=>{if(['issue','return'].includes(m.type))partsByCurrency[m.currency]=(partsByCurrency[m.currency]||0)+(m.type==='issue'?1:-1)*m.quantity*m.costSnapshot;});
 const expensesByCurrency={};s.expenses.filter(e=>e.siteId===site&&within(e.occurredAt)).forEach(e=>expensesByCurrency[e.currency]=(expensesByCurrency[e.currency]||0)+e.amount);
 const assetRows=s.assets.filter(a=>a.siteId===site).map(a=>{const stops=s.downtime.filter(d=>d.assetId===a.id&&Date.parse(d.startedAt)<end&&Date.parse(d.endedAt||new Date())>start);const duration=d=>Math.max(0,Math.min(end,Date.parse(d.endedAt||new Date()))-Math.max(start,Date.parse(d.startedAt)))/3600000;const failures=stops.filter(d=>!d.planned&&within(d.startedAt)).length;const exposures=s.exposure.filter(e=>e.assetId===a.id&&Date.parse(e.from)>=start&&Date.parse(e.to)<=end);const covered=exposures.reduce((n,e)=>n+Date.parse(e.to)-Date.parse(e.from),0)===end-start;const runtimeHours=covered?exposures.reduce((n,e)=>n+e.runtimeHours,0):null;const restored=s.downtime.filter(d=>d.assetId===a.id&&!d.planned&&d.endedAt&&within(d.endedAt));const restorationHours=restored.reduce((n,d)=>n+(Date.parse(d.endedAt)-Date.parse(d.startedAt))/3600000,0);return {id:a.id,code:a.code,name:a.name,plannedHours:stops.filter(d=>d.planned).reduce((n,d)=>n+duration(d),0),unplannedHours:stops.filter(d=>!d.planned).reduce((n,d)=>n+duration(d),0),failures,runtimeHours,mtbfHours:covered&&failures?runtimeHours/failures:null,meanRestorationHours:restored.length?restorationHours/restored.length:null};});
 return {from:new Date(start).toISOString(),to:new Date(end).toISOString(),created:inPeriod.length,open:orders.filter(o=>!CLOSED.includes(o.status)).length,overdue:orders.filter(o=>!CLOSED.includes(o.status)&&Date.parse(o.dueAt)<Date.now()).length,closed:closed.length,onTime:closed.filter(o=>o.completedAt<=o.dueAt).length,laborHours:labor,laborCost,unknownLaborCostEntries:intervention.filter(i=>i.rateSnapshot===null||i.rateSnapshot===undefined).length,partsByCurrency,expensesByCurrency,preventiveDue:orders.filter(o=>o.type==='Preventiva'&&within(o.dueAt)).length,preventiveOnTime:orders.filter(o=>o.type==='Preventiva'&&within(o.dueAt)&&o.completedAt&&o.completedAt<=o.dueAt).length,assets:assetRows,definitions:{period:'Días de cálculo en UTC; inicio incluido, fin excluido. Fechas de visualización en la zona horaria de la planta.',labor:'Suma de entradas por técnico, por fecha de término. No representa detención.',downtime:'Intersección de eventos de detención con el período. Finalizar OT no cierra la detención.',reliability:'MTBF = horas reales verificadas / fallas iniciadas. Solo se calcula con cobertura operativa completa y fallas > 0. Restauración media = duración completa de detenciones no planificadas cuyo retorno está en el período; incluye esperas.',costs:'Costos históricos conocidos; monedas separadas. Mano de obra usa la moneda base de la planta. Registros históricos sin tarifa no se valorizan.'}};
}
