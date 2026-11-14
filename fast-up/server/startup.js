import http from 'node:http';

export function listen(server,{port,host='127.0.0.1'}){
 return new Promise((resolve,reject)=>{
  const failed=error=>{server.off('listening',ready);reject(error);};
  const ready=()=>{server.off('error',failed);resolve(server);};
  server.once('error',failed);server.once('listening',ready);server.listen(port,host);
 });
}

// Reserve the address before opening a database. A second launch cannot open the
// same embedded database while the first process is still initializing.
export async function startServer(factory,{port,host='127.0.0.1'}){
 const starting=(_req,res)=>{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':'2'});res.end(JSON.stringify({app:'fast-up',status:'starting'}));};
 const server=http.createServer(starting);await listen(server,{port,host});
 try{const app=await factory({server});server.off('request',starting);return {...app,server};}
 catch(error){await new Promise(resolve=>server.close(resolve));throw error;}
}

export async function inspectPort({port,host='127.0.0.1',timeoutMs=1800}){
 const probe=http.createServer();
 try{await listen(probe,{port,host});await new Promise(resolve=>probe.close(resolve));return {kind:'free'};}
 catch(error){if(error.code!=='EADDRINUSE')throw error;}
 const base='http://'+host+':'+port;
 try{
  const read=async path=>{const response=await fetch(base+path,{signal:AbortSignal.timeout(timeoutMs),redirect:'error'});return response.json();};
  const config=await read('/api/config');
  if(config.app==='fast-up'&&(['starting'].includes(config.status)||typeof config.version==='string'))return {kind:'fast-up',config};
  // Recognize versions shipped before the explicit application marker existed.
  if(config.demo===true&&['embedded','postgres'].includes(config.database)&&/^\d+\.\d+\.\d+/.test(config.version)){
   const manifest=await read('/manifest.webmanifest');if(manifest.name==='Fast Up Mantenimiento'&&manifest.short_name==='Fast Up')return {kind:'fast-up',config};
  }
 }catch{/* A busy non-HTTP or unresponsive service must not be stopped or replaced. */}
 return {kind:'occupied'};
}
