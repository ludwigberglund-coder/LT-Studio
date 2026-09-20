'use strict';

const fs=require('node:fs');
const crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');

const MAGIC=Buffer.from('RLBKENC1','ascii');
const SALT_BYTES=16;
const IV_BYTES=12;
const TAG_BYTES=16;
const HEADER_BYTES=MAGIC.length+SALT_BYTES+IV_BYTES;

function backupCryptoError(message,code='BACKUP_CRYPTO_ERROR'){const error=new Error(message);error.code=code;return error}
function validatePassphrase(value){
  const secret=String(value||'');
  if(secret.length<32||/REPLACE_WITH|example\.invalid|changeme|default|placeholder/i.test(secret)||new Set(secret).size<10)throw backupCryptoError('Backupkrypteringsnyckeln är för svag eller ser ut som ett exempelvärde.','BACKUP_ENCRYPTION_KEY_INVALID');
  return secret;
}
function deriveKey(passphrase,salt){return crypto.scryptSync(validatePassphrase(passphrase),salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024})}
function headerParts(header){
  if(!Buffer.isBuffer(header)||header.length!==HEADER_BYTES||!header.subarray(0,MAGIC.length).equals(MAGIC))throw backupCryptoError('Backupfilen har ett ogiltigt krypteringsformat.','BACKUP_ENCRYPTION_FORMAT_INVALID');
  return{salt:header.subarray(MAGIC.length,MAGIC.length+SALT_BYTES),iv:header.subarray(MAGIC.length+SALT_BYTES,HEADER_BYTES)};
}
function isEncryptedBackup(filename){
  if(!fs.existsSync(filename)||fs.statSync(filename).size<HEADER_BYTES+TAG_BYTES)return false;
  const fd=fs.openSync(filename,'r');
  try{const magic=Buffer.alloc(MAGIC.length);fs.readSync(fd,magic,0,magic.length,0);return magic.equals(MAGIC)}
  finally{fs.closeSync(fd)}
}
async function encryptFile(source,target,passphrase){
  if(!fs.existsSync(source)||!fs.statSync(source).isFile())throw backupCryptoError('Backupkällan saknas.','BACKUP_ENCRYPTION_SOURCE_MISSING');
  if(fs.existsSync(target))throw backupCryptoError('Den krypterade backupfilen finns redan.','BACKUP_ENCRYPTION_TARGET_EXISTS');
  const salt=crypto.randomBytes(SALT_BYTES),iv=crypto.randomBytes(IV_BYTES);
  const header=Buffer.concat([MAGIC,salt,iv]),key=deriveKey(passphrase,salt);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(header);
  fs.writeFileSync(target,header,{flag:'wx',mode:0o600});
  try{
    await pipeline(fs.createReadStream(source),cipher,fs.createWriteStream(target,{flags:'a',mode:0o600}));
    fs.appendFileSync(target,cipher.getAuthTag());
    fs.chmodSync(target,0o600);
    return{source,target,sizeBytes:fs.statSync(target).size};
  }catch(error){
    fs.rmSync(target,{force:true});
    throw backupCryptoError('Backupen kunde inte krypteras: '+error.message,'BACKUP_ENCRYPTION_FAILED');
  }finally{key.fill(0)}
}
async function decryptFile(source,target,passphrase){
  if(!fs.existsSync(source)||!fs.statSync(source).isFile())throw backupCryptoError('Den krypterade backupfilen saknas.','BACKUP_DECRYPTION_SOURCE_MISSING');
  if(fs.existsSync(target))throw backupCryptoError('Dekrypteringsmålet finns redan.','BACKUP_DECRYPTION_TARGET_EXISTS');
  const size=fs.statSync(source).size;
  if(size<=HEADER_BYTES+TAG_BYTES)throw backupCryptoError('Den krypterade backupfilen är ofullständig.','BACKUP_ENCRYPTION_FORMAT_INVALID');
  const fd=fs.openSync(source,'r');
  let header,tag;
  try{
    header=Buffer.alloc(HEADER_BYTES);fs.readSync(fd,header,0,HEADER_BYTES,0);
    tag=Buffer.alloc(TAG_BYTES);fs.readSync(fd,tag,0,TAG_BYTES,size-TAG_BYTES);
  }finally{fs.closeSync(fd)}
  const {salt,iv}=headerParts(header),key=deriveKey(passphrase,salt);
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
  decipher.setAAD(header);decipher.setAuthTag(tag);
  try{
    await pipeline(fs.createReadStream(source,{start:HEADER_BYTES,end:size-TAG_BYTES-1}),decipher,fs.createWriteStream(target,{flags:'wx',mode:0o600}));
    fs.chmodSync(target,0o600);
    return{source,target,sizeBytes:fs.statSync(target).size};
  }catch(error){
    fs.rmSync(target,{force:true});
    throw backupCryptoError('Den krypterade backupen kunde inte autentiseras eller dekrypteras.','BACKUP_DECRYPTION_FAILED');
  }finally{key.fill(0)}
}
module.exports=Object.freeze({MAGIC,SALT_BYTES,IV_BYTES,TAG_BYTES,HEADER_BYTES,validatePassphrase,isEncryptedBackup,encryptFile,decryptFile});
