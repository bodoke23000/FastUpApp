import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,extname,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID,createHmac } from 'node:crypto';
import { openStore } from './store.js';
import { login,authenticate,passwordHash,tokenHash } from './auth.js';
import { seedData } from './seed.js';
import { maintenanceTick } from './maintenance.js';
import { validateWorkbookArchive } from './xlsx.js';
import { startServer } from './startup.js';
import { assert,DomainError,ROLES,project,reports,emptyState } from './domain.js';

const root=fileURLToPath(new URL('../public/',import.meta.url));
export async function createApp(options={}){
 const demo=options.demo??process.env.DEMO_MODE==='true';
 assert(!(demo&&process.env.NODE_ENV==='production'),'Demo mode is disabled in production',500);
 const store=options.store||await openStore();
 const existing=await store.db.query('SELECT count(*) as n FROM accounts');
 if(!Number(existing.rows[0].n)){
  if(!demo)assert(process.env.BOOTSTRAP_EMAIL&&process.env.BOOTSTRAP_PASSWORD?.length>=14,'Set BOOTSTRAP_EMAIL and a password of at least 14 characters',500);
  const seed=seedData(demo);await store.seed(seed.state,seed.accounts);
 }
 const attempts=new Map();
 const server=options.server||http.createServer();server.on('request',async(req,res)=>{
  const requestId=randomUUID();res.setHeader('X-Request-Id',requestId);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(self), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  try{
   const url=new URL(req.url,'http://localhost');const path=url.pathname;
   if(path==='/healthz')return json({status:'ok'});
   if(path==='/readyz'){await store.db.query('SELECT 1');return json({status:'ready'});}
   if(path==='/api/config'&&req.method==='GET')return json({app:'fast-up',demo,database:store.mode,version:'1.1.0'});
   if(path.startsWith('/api/')){
    if(!['GET','POST'].includes(req.method))throw new DomainError('Método no permitido',405);
    if(req.method==='POST'){
     const origin=req.headers.origin;const allowed=process.env.PUBLIC_ORIGIN||`http://${req.headers.host}`;
     assert(!origin||origin===allowed,'Origen no autorizado',403);
     assert(req.headers['content-type']?.startsWith('application/json'),'Se requiere JSON',415);
    }
    if(path==='/api/login'&&req.method==='POST'){
     const key=req.socket.remoteAddress;const rate=attempts.get(key)||{count:0,reset:Date.now()+900000};if(rate.reset<Date.now()){rate.count=0;rate.reset=Date.now()+900000;}assert(rate.count<15,'Demasiados intentos. Intenta más tarde.',429);rate.count++;attempts.set(key,rate);
     const data=await body(req),session=await login(store,data.email,data.password);rate.count=0;
     res.setHeader('Set-Cookie',cookie(session.token));return json({user:session.user,csrf:session.csrf});
    }
    const session=await authenticate(store,req),u=session.user;
    if(req.headers['x-workspace-user'])assert(req.headers['x-workspace-user']===u.id,'La cuenta cambió en otra pestaña. Inicia sesión con el usuario de esta copia.',401);
    if(req.method==='POST')assert(req.headers['x-csrf-token']===session.csrf,'Sesión desactualizada; vuelve a iniciar sesión',403);
    const site=url.searchParams.get('site')||u.siteIds[0];assert(u.siteIds.includes(site),'Sin acceso a esta planta',403);
    if(path==='/api/me')return json({user:u,csrf:session.csrf});
    if(path==='/api/logout'&&req.method==='POST'){await store.db.query('DELETE FROM sessions WHERE token_hash=$1',[tokenHash(session.token)]);res.setHeader('Set-Cookie',cookie('',0));return json({ok:true});}
    if(path==='/api/state'&&req.method==='GET'){const snapshot=project(await store.load(),u,site,await store.users());if(['admin','supervisor','manager'].includes(u.role))snapshot.audit=await store.auditList(site);return json(snapshot);}
    if(path==='/api/action-status'&&req.method==='POST'){const data=await body(req);return json(await store.receipts(u,data.actions));}
    if(path==='/api/actions'&&req.method==='POST'){
     const action=await body(req);try{return json(await store.action(u,action));}catch(error){if(error.status>=400&&error.status<500&&action.operationId&&u.siteIds.includes(action.siteId))await store.recordConflict(u,action,error);throw error;}
    }
    if(path==='/api/reports'){
     assert(['admin','supervisor','manager'].includes(u.role),'Sin acceso a reportes',403);return json(reports(await store.load(),site,url.searchParams.get('from'),url.searchParams.get('to'),{assetId:url.searchParams.get('assetId'),workType:url.searchParams.get('workType'),equipmentType:url.searchParams.get('equipmentType')}));
    }
    if(path==='/api/audit'){assert(['admin','supervisor','manager'].includes(u.role),'Sin acceso a auditoría',403);return json(await store.auditList(site));}
    if(path==='/api/users'&&req.method==='POST'){
     assert(u.role==='admin','Solo administración',403);const data=await body(req);assert(ROLES.includes(data.role),'Rol inválido');assert(Array.isArray(data.siteIds)&&data.siteIds.length&&data.siteIds.every(s=>u.siteIds.includes(s)),'Plantas inválidas');assert(data.name&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email),'Nombre/correo inválido');
     const id=data.id||randomUUID();const old=(await store.db.query('SELECT * FROM accounts WHERE id=$1',[id])).rows[0];
     if(old)assert(old.profile.siteIds.every(s=>u.siteIds.includes(s)),'Sin permiso sobre este usuario',403);
     assert(old||data.password?.length>=14,'Contraseña mínima de 14 caracteres');if(data.password)assert(data.password.length>=14,'Contraseña mínima de 14 caracteres');
     const profile={name:String(data.name).slice(0,120),role:data.role,siteIds:data.siteIds,hourlyRate:Number(data.hourlyRate||0),specialty:String(data.specialty||''),shift:String(data.shift||'Día'),available:data.available!==false};assert(Number.isFinite(profile.hourlyRate)&&profile.hourlyRate>=0,'Tarifa inválida');assert(id!==u.id||(profile.role==='admin'&&data.active!==false),'No puedes desactivar tu propia cuenta administrativa');
     await store.transaction(async c=>{await c.query('INSERT INTO accounts(id,email,password_hash,profile,active) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(id) DO UPDATE SET email=excluded.email,password_hash=excluded.password_hash,profile=excluded.profile,active=excluded.active',[id,data.email.toLowerCase(),data.password?passwordHash(data.password):old.password_hash,JSON.stringify(profile),data.active!==false]);if(old)await c.query('DELETE FROM sessions WHERE user_id=$1',[id]);await store.audit(c,{id:randomUUID(),siteId:site,actorId:u.id,operation:'account.update',subjectId:id,occurredAt:new Date().toISOString(),details:{before:old?{...old.profile,email:old.email,active:old.active}:null,after:profile}});});return json({id});
    }
    if(path==='/api/sites'&&req.method==='POST'){
     assert(u.role==='admin','Solo administración',403);const p=await body(req);assert(p.name&&p.currency&&p.timezone,'Completa planta, moneda y zona horaria');try{new Intl.DateTimeFormat('es',{timeZone:p.timezone});}catch{throw new DomainError('Zona horaria inválida');}
     const id=randomUUID();await store.transaction(async c=>{const record={id,siteId:id,version:1,createdAt:new Date().toISOString(),name:String(p.name),currency:String(p.currency),timezone:String(p.timezone)};await c.query('INSERT INTO records(kind,id,site_id,version,data) VALUES($1,$2,$3,1,$4::jsonb)',['sites',id,id,JSON.stringify(record)]);u.siteIds.push(id);const {id:uid,email,active,...profile}=u;await c.query('UPDATE accounts SET profile=$1::jsonb WHERE id=$2',[JSON.stringify(profile),uid]);await store.audit(c,{id:randomUUID(),siteId:site,actorId:u.id,operation:'site.create',subjectId:id,occurredAt:new Date().toISOString(),details:{after:record}});});return json({id});
    }
    if(path==='/api/import-file'&&req.method==='POST'){
     assert(u.role==='admin','Solo administración',403);const data=await body(req);assert(typeof data.base64==='string'&&data.base64.length<=7000000,'Archivo demasiado grande');const workbookBytes=Buffer.from(data.base64,'base64');validateWorkbookArchive(workbookBytes);const ExcelJS=(await import('exceljs')).default;const book=new ExcelJS.Workbook();await book.xlsx.load(workbookBytes);const sheet=book.worksheets[0];assert(sheet&&sheet.rowCount<=2001&&sheet.columnCount<=30,'Hoja inválida (2000 filas / 30 columnas)');const keys=sheet.getRow(1).values.slice(1).map(k=>String(k).trim());const rows=[];sheet.eachRow((r,i)=>{if(i===1)return;const item={};keys.forEach((key,j)=>{const v=r.getCell(j+1).value;assert(v===null||['string','number','boolean'].includes(typeof v),'Usa valores simples, sin fórmulas, en la importación');item[key]=v;});rows.push(item);});return json({rows});
    }
    if(path==='/api/document'){
     const s=await store.load(),view=project(s,u,site,await store.users()),id=url.searchParams.get('id');assert(view.documents.some(d=>d.id===id),'Archivo no encontrado',404);const doc=(await store.db.query("SELECT data FROM records WHERE kind='documents' AND id=$1 AND site_id=$2",[id,site])).rows[0].data;res.writeHead(200,{'Content-Type':doc.mime,'Content-Disposition':`attachment; filename="${doc.name.replace(/[^\w. -]/g,'_')}"`,'Cache-Control':'no-store'});return res.end(Buffer.from(doc.base64,'base64'));
    }
    if(path==='/api/qr'){
     const assetId=url.searchParams.get('asset');const asset=(await store.load()).assets.find(a=>a.id===assetId&&a.siteId===site);assert(asset,'Activo no encontrado',404);const QR=(await import('qrcode')).default;const origin=process.env.PUBLIC_ORIGIN||`http://${req.headers.host}`;const svg=await QR.toString(`${origin}/?asset=${encodeURIComponent(asset.id)}&site=${encodeURIComponent(site)}`,{type:'svg',margin:2});res.writeHead(200,{'Content-Type':'image/svg+xml'});return res.end(svg);
    }
    if(path==='/api/integrations'){
     assert(u.role==='admin','Solo administración',403);return json({configured:!!process.env.WEBHOOK_URL,events:(await store.db.query('SELECT id,site_id,attempts,delivered_at,next_attempt_at,last_error FROM integration_outbox WHERE site_id=$1 ORDER BY next_attempt_at DESC LIMIT 100',[site])).rows});
    }
    if(path==='/api/health'){
     assert(u.role==='admin','Solo administración',403);const rows=await store.db.query('SELECT kind,count(*) as count FROM records WHERE site_id=$1 GROUP BY kind',[site]);return json({database:store.mode,uptimeSeconds:Math.round(process.uptime()),records:rows.rows,pendingEvents:Number((await store.db.query('SELECT count(*) as n FROM integration_outbox WHERE delivered_at IS NULL AND site_id=$1',[site])).rows[0].n)});
    }
    if(path==='/api/export'){
     assert(u.role==='admin','Solo administración',403);const state=await store.load(undefined,true);for(const k of Object.keys(state))state[k]=state[k].filter(x=>x.siteId===site||k==='sites'&&x.id===site);return json({format:'fast-up-site-export-v1',exportedAt:new Date().toISOString(),state,users:(await store.users()).filter(x=>x.siteIds.includes(site)),audit:await store.auditList(site)});
    }
    throw new DomainError('Ruta no encontrada',404);
   }
   assert(req.method==='GET'||req.method==='HEAD','Método no permitido',405);
   const decoded=decodeURIComponent(path),file=resolve(root,'.'+(decoded==='/'?'/index.html':decoded));assert(file.startsWith(root.endsWith(sep)?root:root+sep),'Ruta inválida',403);const bytes=await readFile(file).catch(()=>{throw new DomainError('No encontrado',404);});
   const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Cache-Control':file.endsWith('sw.js')?'no-cache':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){const status=error.status||(error.code==='23505'?409:500);if(status===500)console.error(JSON.stringify({requestId,error:error.message}));json({error:status===500?'Error del servidor. Conserva el registro e intenta nuevamente.':error.message,details:error.details||{},requestId},status);}
 });
 let ticking=false;const timer=setInterval(async()=>{if(ticking)return;ticking=true;try{await maintenanceTick(store);await deliverOutbox(store);}catch(e){console.error('Background job failed:',e.message);}finally{ticking=false;}},60000);timer.unref();server.on('close',()=>clearInterval(timer));return {server,store};
}
function cookie(token,maxAge=43200){return `fastup_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.COOKIE_SECURE==='true'?'; Secure':''}`;}
async function body(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;assert(size<=8*1024*1024,'Solicitud demasiado grande',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new DomainError('JSON inválido',400);}}
async function deliverOutbox(store){
 if(!process.env.WEBHOOK_URL)return;assert(process.env.WEBHOOK_URL.startsWith('https://')&&process.env.WEBHOOK_SECRET?.length>=24,'Webhook requires HTTPS and a secret of at least 24 characters');
 const rows=(await store.db.query('SELECT * FROM integration_outbox WHERE delivered_at IS NULL AND next_attempt_at<=now() LIMIT 20')).rows;
 for(const row of rows){try{const data=JSON.stringify({id:row.id,...row.event});const signature=createHmac('sha256',process.env.WEBHOOK_SECRET).update(data).digest('hex');const response=await fetch(process.env.WEBHOOK_URL,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-FastUp-Signature':signature,'X-FastUp-Event':row.id},body:data,signal:AbortSignal.timeout(10000)});assert(response.ok,`HTTP ${response.status}`);await store.db.query('UPDATE integration_outbox SET delivered_at=now(),attempts=attempts+1,last_error=NULL WHERE id=$1',[row.id]);}catch(e){await store.db.query('UPDATE integration_outbox SET attempts=attempts+1,last_error=$2,next_attempt_at=$3 WHERE id=$1',[row.id,String(e.message).slice(0,300),new Date(Date.now()+Math.min(86400000,60000*2**Math.min(row.attempts,10))).toISOString()]);}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||3030);
 try{
  const {server,store}=await startServer(createApp,{port,host:process.env.HOST||'127.0.0.1'});
  console.log(`Fast Up: http://localhost:${port} (${store.mode}${process.env.DEMO_MODE==='true'?', demo':''})`);
  const stop=()=>server.close(()=>store.close().then(()=>process.exit(0)));process.on('SIGTERM',stop);process.on('SIGINT',stop);
 }catch(error){
  if(error.code==='EADDRINUSE')console.error(`Port ${port} is already in use. If Fast Up is running, open http://localhost:${port}. To restart, stop its original terminal with Ctrl+C first. No second database was opened.`);
  else console.error('Fast Up could not start: '+error.message);
  process.exit(1);
 }
}
