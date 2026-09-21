'use strict';

const Auth=require('./auth.js');

const OPERATOR_COOKIE_NAME='lt_operator_session';

function operatorSessionCookie(token,{secure=true,maxAgeSeconds=2*60*60}={}){
  const age=Number(maxAgeSeconds);
  if(!Number.isSafeInteger(age)||age<60||age>24*60*60)throw new Error('Ogiltig operatörssessionstid.');
  return `${OPERATOR_COOKIE_NAME}=${encodeURIComponent(String(token||''))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
}
function clearOperatorSessionCookie({secure=true}={}){
  return `${OPERATOR_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`;
}
function operatorTokenFromRequest(req){
  return Auth.parseCookies(req?.headers?.cookie||'')[OPERATOR_COOKIE_NAME]||'';
}
module.exports=Object.freeze({OPERATOR_COOKIE_NAME,operatorSessionCookie,clearOperatorSessionCookie,operatorTokenFromRequest});
