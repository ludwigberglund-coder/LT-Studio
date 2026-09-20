'use strict';

const fs=require('node:fs');
const crypto=require('node:crypto');

const MAGIC=Buffer.from('ROLLBK01','ascii');
const SALT_BYTES=16;
const IV_BYTES=12;
const TAG_BYTES=16;
const HEADER_BYTES=MAGIC.length+SALT_BYTES+IV_BYTES;
const CHUNK_BYTES=1024*1024;

function backupCryptoError(message,code='BACKUP_CRYPTO_ERROR'){const e=new Error(message);e.code=code;return e}
function validatePassphrase(value){
  const secret=String(value||'');
  if(secret.length<32||new Set(secret).size<10)throw backupCryptoError('Backupkrypteringsnyckeln måste vara minst 32 tecken och tillräckligt varierad.','BACKUP_ENCRYPTION_KEY_WEAK');
  return secret;
}
function derive(secret,salt){return crypto.scryptSync(validatePassphrase(secret),salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024})}
function sha256File(filename){
  const hash=crypto.createHash('sha256'),fd=fs.openSync(filename,'r'),buffer=Buffer.allocUnsafe(CHUNK_BYTES);
  try{let read;do{read=fs.readSync(fd,buffer,0,buffer.length,null);if(read)hash.update(buffer.subarray(0,read));}while(read);}
  finally{fs.closeSync(fd)}
  return hash.digest('hex');
}
function encryptFile(source,target,secret){
  if(fs.existsSync(target))throw backupCryptoError('Den krypterade backupfilen finns redan.','BACKUP_ENCRYPTED_TARGET_EXISTS');
  const salt=crypto.randomBytes(SALT_BYTES),iv=crypto.randomBytes(IV_BYTES),key=derive(secret,salt);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const input=fs.openSync(source,'r'),output=fs.openSync(target,'wx',0o600),buffer=Buffer.allocUnsafe(CHUNK_BYTES);
  try{
    fs.writeSync(output,Buffer.concat([MAGIC,salt,iv]));
    let read;do{read=fs.readSync(input,buffer,0,buffer.length,null);if(read){const encrypted=cipher.update(buffer.subarray(0,read));if(encrypted.length)fs.writeSync(output,encrypted);}}while(read);
    const final=cipher.final();if(final.length)fs.writeSync(output,final);
    fs.writeSync(output,cipher.getAuthTag());
    fs.fsyncSync(output);
  }catch(error){try{fs.closeSync(output)}catch{}fs.rmSync(target,{force:true});throw error}
  finally{try{fs.closeSync(input)}catch{}try{fs.closeSync(output)}catch{}}
  return{sha256:sha256File(target),sizeBytes:fs.statSync(target).size};
}
function decryptFile(source,target,secret){
  if(fs.existsSync(target))throw backupCryptoError('Dekrypteringsmålet finns redan.','BACKUP_DECRYPT_TARGET_EXISTS');
  const size=fs.statSync(source).size;
  if(size<HEADER_BYTES+TAG_BYTES)throw backupCryptoError('Den krypterade backupfilen är för kort.','BACKUP_ENCRYPTED_FORMAT_INVALID');
  const input=fs.openSync(source,'r'),output=fs.openSync(target,'wx',0o600);
  try{
    const header=Buffer.alloc(HEADER_BYTES);if(fs.readSync(input,header,0,header.length,0)!==header.length)throw backupCryptoError('Krypterad backup-header saknas.','BACKUP_ENCRYPTED_FORMAT_INVALID');
    if(!header.subarray(0,MAGIC.length).equals(MAGIC))throw backupCryptoError('Krypterad backup har okänt format.','BACKUP_ENCRYPTED_FORMAT_INVALID');
    const salt=header.subarray(MAGIC.length,MAGIC.length+SALT_BYTES),iv=header.subarray(MAGIC.length+SALT_BYTES,HEADER_BYTES);
    const tag=Buffer.alloc(TAG_BYTES);if(fs.readSync(input,tag,0,TAG_BYTES,size-TAG_BYTES)!==TAG_BYTES)throw backupCryptoError('Krypterad backup saknar autentiseringstagg.','BACKUP_ENCRYPTED_FORMAT_INVALID');
    const decipher=crypto.createDecipheriv('aes-256-gcm',derive(secret,salt),iv);decipher.setAuthTag(tag);
    const buffer=Buffer.allocUnsafe(CHUNK_BYTES),cipherBytes=size-HEADER_BYTES-TAG_BYTES;
    let position=HEADER_BYTES,remaining=cipherBytes;
    while(remaining>0){const wanted=Math.min(buffer.length,remaining),read=fs.readSync(input,buffer,0,wanted,position);if(!read)throw backupCryptoError('Krypterad backup slutade oväntat.','BACKUP_ENCRYPTED_FORMAT_INVALID');position+=read;remaining-=read;const plain=decipher.update(buffer.subarray(0,read));if(plain.length)fs.writeSync(output,plain);}
    const final=decipher.final();if(final.length)fs.writeSync(output,final);fs.fsyncSync(output);
  }catch(error){try{fs.closeSync(output)}catch{}fs.rmSync(target,{force:true});if(error.code&&String(error.code).startsWith('BACKUP_'))throw error;throw backupCryptoError('Backupen kunde inte autentiseras eller dekrypteras.','BACKUP_DECRYPT_AUTH_FAILED')}
  finally{try{fs.closeSync(input)}catch{}try{fs.closeSync(output)}catch{}}
  return{sha256:sha256File(target),sizeBytes:fs.statSync(target).size};
}
module.exports=Object.freeze({MAGIC,SALT_BYTES,IV_BYTES,TAG_BYTES,validatePassphrase,sha256File,encryptFile,decryptFile});
