'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','supabase-session.js'),'utf8');

function sessionWithApi(api){
  const storage=new Map();
  const localStorage={
    getItem:key=>storage.has(key)?storage.get(key):null,
    setItem:(key,value)=>storage.set(key,String(value)),
    removeItem:key=>storage.delete(key)
  };
  const window={
    LT_SUPABASE:{environment:'uat'},
    LTSupabase:api
  };
  const sandbox={window,localStorage,JSON,Object,String,Set,Error,Number,RegExp,encodeURIComponent,atob:()=>'',Promise};
  vm.runInNewContext(source,sandbox,{filename:'supabase-session.js'});
  return window.LTSupabaseUat;
}

test('UAT login converts Supabase 400 into useful activation guidance',async()=>{
  const api={
    async signIn(){
      const error=new Error('Invalid login credentials');
      error.status=400;
      throw error;
    }
  };
  const session=sessionWithApi(api);
  await assert.rejects(
    ()=>session.signIn('uat@example.invalid','wrong','123456'),
    error=>error?.code==='UAT_LOGIN_NOT_READY'
      && /UAT-kontot är inte aktiverat ännu/.test(error.message)
      && /Aktivera UAT-konto/.test(error.message)
  );
});
