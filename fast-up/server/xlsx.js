import {assert} from './domain.js';
export function validateWorkbookArchive(bytes){
 assert(Buffer.isBuffer(bytes)&&bytes.length>=22&&bytes.length<=5*1024*1024,'Archivo XLSX inválido o demasiado grande');
 const end=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));assert(end>=0&&end+22<=bytes.length,'No es un archivo XLSX ZIP válido');
 assert(end+22+bytes.readUInt16LE(end+20)===bytes.length,'Directorio ZIP inválido');
 const entries=bytes.readUInt16LE(end+10);assert(entries>0&&entries<=3000,'Archivo con demasiadas entradas');let offset=bytes.readUInt32LE(end+16),expanded=0;const names=[];
 for(let i=0;i<entries;i++){
  assert(offset+46<=end&&bytes.readUInt32LE(offset)===0x02014b50,'Directorio ZIP inválido');
  assert(!(bytes.readUInt16LE(offset+8)&1),'No se admiten archivos cifrados');const size=bytes.readUInt32LE(offset+24);expanded+=size;assert(size!==0xffffffff&&expanded<=40*1024*1024,'El contenido expandido supera 40 MB');
  const nameLength=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32);assert(offset+46+nameLength+extra+comment<=end,'Entrada ZIP inválida');names.push(bytes.toString('utf8',offset+46,offset+46+nameLength));offset+=46+nameLength+extra+comment;
 }
 assert(names.includes('xl/workbook.xml')&&names.includes('[Content_Types].xml'),'El archivo no contiene un libro XLSX');return true;
}
