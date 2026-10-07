const text=(value:unknown)=>String(value??"").trim();

function normalizeOrgNumber(value:unknown){
  const digits=text(value).replace(/\D/g,"");
  return digits.length===10?digits.slice(0,6)+"-"+digits.slice(6):text(value);
}

function swedishOrgNumberOk(value:string){
  const digits=value.replace(/\D/g,"");
  if(digits.length!==10)return false;
  let sum=0;
  for(let i=0;i<9;i++){
    let n=Number(digits[i])*(i%2===0?2:1);
    if(n>9)n-=9;
    sum+=n;
  }
  return (10-(sum%10))%10===Number(digits[9]);
}

function emailOk(value:string){
  return value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function websiteOk(value:string){
  if(!value)return true;
  try{
    const parsed=new URL(value);
    return parsed.protocol==="https:"&&Boolean(parsed.hostname);
  }catch{return false}
}

function bankgiroOk(value:string){
  return !value||/^\d{3,4}-\d{4}$/.test(value);
}

async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

function randomInviteCode(){
  const bytes=new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

const allowedTaxStatuses=new Set([
  "Godkänd för F-skatt",
  "Godkänd för FA-skatt",
  "Ej godkänd för F-skatt"
]);

export async function createCompanyOnboarding(admin:any,operatorUserId:string,body:any){
  const legalName=text(body.legalName),displayName=text(body.displayName),orgNumber=normalizeOrgNumber(body.orgNumber);
  const address=text(body.address),companyEmail=text(body.companyEmail).toLowerCase(),phone=text(body.phone),website=text(body.website);
  const bankgiro=text(body.bankgiro),taxStatus=text(body.taxStatus),adminName=text(body.adminName),adminEmail=text(body.adminEmail).toLowerCase();
  const orgDigits=orgNumber.replace(/\D/g,""),vatNumber=text(body.vatNumber).toUpperCase().replace(/\s/g,"");

  if(legalName.length<2||legalName.length>160)return{status:422,body:{error:"Juridiskt namn måste vara 2–160 tecken.",code:"INVALID_COMPANY_NAME"}};
  if(displayName.length<2||displayName.length>80)return{status:422,body:{error:"Visningsnamn måste vara 2–80 tecken.",code:"INVALID_COMPANY_DISPLAY_NAME"}};
  if(!/^\d{6}-\d{4}$/.test(orgNumber)||!swedishOrgNumberOk(orgNumber))return{status:422,body:{error:"Ange ett giltigt svenskt organisationsnummer.",code:"INVALID_ORG_NUMBER"}};
  if(address.length<4||address.length>240)return{status:422,body:{error:"Företagsadress måste vara 4–240 tecken.",code:"INVALID_COMPANY_ADDRESS"}};
  if(vatNumber!==("SE"+orgDigits+"01"))return{status:422,body:{error:"Momsregistreringsnumret ska vara SE + organisationsnumrets tio siffror + 01.",code:"INVALID_VAT_NUMBER"}};
  if(!emailOk(companyEmail))return{status:422,body:{error:"Ange en giltig e-postadress för företaget.",code:"INVALID_COMPANY_EMAIL"}};
  if(phone.length>40)return{status:422,body:{error:"Telefonnumret är för långt.",code:"INVALID_COMPANY_PHONE"}};
  if(!websiteOk(website))return{status:422,body:{error:"Webbplatsen måste använda https://.",code:"INVALID_COMPANY_WEBSITE"}};
  if(!bankgiroOk(bankgiro))return{status:422,body:{error:"Bankgiro ska anges som 123-4567 eller 1234-5678.",code:"INVALID_BANKGIRO"}};
  if(!allowedTaxStatuses.has(taxStatus))return{status:422,body:{error:"Välj en giltig skattestatus.",code:"INVALID_TAX_STATUS"}};
  if(adminName.length<2||adminName.length>120)return{status:422,body:{error:"Första administratörens namn måste vara 2–120 tecken.",code:"INVALID_ADMIN_NAME"}};
  if(!emailOk(adminEmail))return{status:422,body:{error:"Ange en giltig e-postadress för första administratören.",code:"INVALID_ADMIN_EMAIL"}};
  if(body.confirmed!==true)return{status:422,body:{error:"Bekräfta att organisationsnummer och administratörens e-postadress är kontrollerade.",code:"ONBOARDING_CONFIRMATION_REQUIRED"}};

  const existing=await admin.from("companies").select("id").eq("org_number",orgNumber).maybeSingle();
  if(existing.error)throw existing.error;
  if(existing.data)return{status:409,body:{error:"Organisationsnumret finns redan registrerat i LT Studio.",code:"COMPANY_ORG_NUMBER_EXISTS"}};

  const inviteCode=randomInviteCode(),codeHash=await sha256Hex(inviteCode);
  const result=await admin.rpc("operator_create_company_onboarding",{
    p_operator_id:operatorUserId,
    p_code_sha256:codeHash,
    p_legal_name:legalName,
    p_display_name:displayName,
    p_org_number:orgNumber,
    p_address:address,
    p_vat_number:vatNumber,
    p_phone:phone,
    p_company_email:companyEmail,
    p_website:website,
    p_bankgiro:bankgiro,
    p_tax_status:taxStatus,
    p_admin_name:adminName,
    p_admin_email:adminEmail
  });
  if(result.error)throw result.error;
  const created=result.data?.[0];
  if(!created?.company_id)throw new Error("Företaget kunde inte skapas atomiskt.");

  return{
    status:201,
    body:{
      company:{id:created.company_id,legalName,displayName,orgNumber},
      activation:{
        inviteCode,
        adminName,
        adminEmail,
        expiresAt:created.invite_expires_at,
        setupPath:"/portal/company-activate.html"
      }
    }
  };
}

export async function reissueCompanyActivation(admin:any,operatorUserId:string,body:any){
  const companyId=text(body.companyId),adminName=text(body.adminName),adminEmail=text(body.adminEmail).toLowerCase();
  if(!emailOk(adminEmail))return{status:422,body:{error:"Ange en giltig e-postadress för administratören.",code:"INVALID_ADMIN_EMAIL"}};
  if(adminName.length<2||adminName.length>120)return{status:422,body:{error:"Administratörens namn måste vara 2–120 tecken.",code:"INVALID_ADMIN_NAME"}};

  const inviteCode=randomInviteCode(),codeHash=await sha256Hex(inviteCode);
  const result=await admin.rpc("operator_reissue_company_activation",{
    p_operator_id:operatorUserId,
    p_company_id:companyId,
    p_code_sha256:codeHash,
    p_admin_name:adminName,
    p_admin_email:adminEmail
  });
  if(result.error)throw result.error;

  return{
    status:201,
    body:{
      activation:{
        inviteCode,
        adminName,
        adminEmail,
        expiresAt:result.data?.[0]?.invite_expires_at||null,
        setupPath:"/portal/company-activate.html"
      }
    }
  };
}
