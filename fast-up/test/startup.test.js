import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {inspectPort,listen,startServer} from '../server/startup.js';

const close=server=>new Promise(resolve=>server.close(resolve));
async function fixture(handler){const server=http.createServer(handler);await listen(server,{port:0});return {server,port:server.address().port};}

test('launcher detects a free address',async()=>{assert.equal((await inspectPort({port:0})).kind,'free');});
test('launcher recognizes an existing Fast Up instance',async()=>{const f=await fixture((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'fast-up',demo:true,database:'embedded',version:'1.1.0'}));});try{const found=await inspectPort({port:f.port});assert.equal(found.kind,'fast-up');assert.equal(found.config.version,'1.1.0');}finally{await close(f.server);}});
test('launcher also recognizes an already running older release',async()=>{const f=await fixture((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/config'?{demo:true,database:'embedded',version:'1.1.0'}:{name:'Fast Up Mantenimiento',short_name:'Fast Up'}));});try{assert.equal((await inspectPort({port:f.port})).kind,'fast-up');}finally{await close(f.server);}});
test('launcher leaves an unrelated program occupying the port alone',async()=>{const f=await fixture((_req,res)=>res.end('Another application'));try{assert.equal((await inspectPort({port:f.port})).kind,'occupied');assert.equal(await (await fetch('http://127.0.0.1:'+f.port)).text(),'Another application');}finally{await close(f.server);}});
test('concurrent launch never initializes a second database',async()=>{
 let resume,initializations=0,port;const held=new Promise(resolve=>{resume=resolve;});
 const first=startServer(async({server})=>{initializations++;port=server.address().port;await held;server.on('request',(_req,res)=>res.end('ready'));return {store:'disposable fixture'};},{port:0});
 // Wait for the first process to own the address, without relying on a fixed sleep.
 while(port===undefined)await new Promise(resolve=>setImmediate(resolve));
 try{
  const found=await inspectPort({port});assert.equal(found.kind,'fast-up');assert.equal(found.config.status,'starting');
  await assert.rejects(()=>startServer(async()=>{initializations++;return {};},{port}),error=>error.code==='EADDRINUSE');assert.equal(initializations,1);
  resume();const app=await first;assert.equal(await (await fetch('http://127.0.0.1:'+port)).text(),'ready');await close(app.server);
 }finally{resume();const app=await first;if(app.server.listening)await close(app.server);}
});
test('failed initialization releases the reserved port',async()=>{
 let port;await assert.rejects(()=>startServer(async({server})=>{port=server.address().port;throw Error('Synthetic startup failure');},{port:0}),/Synthetic startup failure/);assert.equal((await inspectPort({port})).kind,'free');
});
