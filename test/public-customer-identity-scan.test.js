'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const root=path.resolve(__dirname,'..');
const roots=['apps','config','content','docs','lib','packages','public','scripts','test'];
const textExtensions=new Set(['.js','.cjs','.mjs','.json','.md','.html','.txt','.yml','.yaml','.css']);
const forbidden=new Set([
  '92675296515bb386f3b3ad64c6b9dd11961bfe8ffd97e544ed1ef4f0d494dee5',
  'ef769efb75a58f178dedce6dfaf3833272822f6d50653c89fe28250557982c2d',
  '8b25009c7a29d0357027152ad8b75bdf4abad46c59ab490306d685388d6aeb8e',
  '7eb2adc8551d7471e0096af66685950031a1852e4f3519154526e3847b3d91bb',
  '8f344259effaac9818a888e985d9ffbec2ad2e2d0d38592047f4dedffa2906cc',
  'c4bf7ac8da8a751556c58cc2a1ad9b3e9fc3c979ffef5725f7d9f078c7dac07c',
  '623ca04f7a4ae689af8008da9929b626f505e3af7eb843786bcfaaa7fcf7b8c1',
  '982d028ed51b441f28a65c44f1d9719870a90c046debe73b8b63429a8a6138b4',
  'aa79ee8d5986f3847a9d03cf7b7d9ca0380de1d2f5c88be5d29a58d58c484331',
  'a86689185dbb364851e18523b8d82887e7eb026203ca2166dfd0034f23045775'
]);

const normalize=value=>String(value||'').trim().toLocaleLowerCase('sv-SE');
const digest=value=>crypto.createHash('sha256').update(normalize(value),'utf8').digest('hex');
const isForbidden=value=>forbidden.has(digest(value));

function walk(dir,out=[]){
  if(!fs.existsSync(dir))return out;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())walk(full,out);
    else if(entry.isFile()&&textExtensions.has(path.extname(entry.name).toLowerCase()))out.push(full);
  }
  return out;
}

function candidates(text){
  const values=[];
  values.push(...(text.match(/\b\d{6}-\d{4}\b/g)||[]));
  values.push(...(text.match(/\bSE\d{12}\b/gi)||[]));

  for(const email of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]){
    values.push(email);
    values.push((email.split('@')[1]||'').replace(/^www\./i,''));
  }
  for(const match of text.matchAll(/https?:\/\/([A-Z0-9.-]+)/gi)){
    values.push(String(match[1]||'').replace(/^www\./i,''));
  }
  for(const phone of text.match(/(?:\+46|0)[0-9 ()-]{7,}/g)||[]){
    values.push(phone.replace(/\D/g,''));
  }

  for(const line of text.split(/\r?\n/)){
    const words=line.match(/[\p{L}\p{N}]+/gu)||[];
    for(let width=2;width<=6;width++){
      for(let start=0;start+width<=words.length;start++)values.push(words.slice(start,start+width).join(' '));
    }
  }
  return values;
}

test('aktuellt repository innehåller inte tidigare kundidentitet i klartext',()=>{
  const files=roots.flatMap(dir=>walk(path.join(root,dir)));
  const rootFiles=fs.readdirSync(root,{withFileTypes:true})
    .filter(entry=>entry.isFile()&&textExtensions.has(path.extname(entry.name).toLowerCase()))
    .map(entry=>path.join(root,entry.name));
  const hits=[];
  for(const file of [...files,...rootFiles]){
    const text=fs.readFileSync(file,'utf8');
    if(candidates(text).some(isForbidden))hits.push(path.relative(root,file));
  }
  assert.deepEqual(hits,[],`Kundidentitet hittades i spårade källfiler: ${hits.join(', ')}`);
});
