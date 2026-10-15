'use strict';
// Local-only PDF text reader for passive, text-based Swedish invoice/receipt PDFs.
// This is NOT OCR, AI, bookkeeping or a replacement for the server PDF upload gate.
// No network calls, persistence, model prompts or customer database access.
(function(root){
  const MAX_BYTES=10*1024*1024;
  const MAX_STREAMS=32;
  const MAX_STREAM_BYTES=512*1024;
  const MAX_TEXT_CHARS=48000;
  const ACTIVE=/\/(?:JavaScript|JS|OpenAction|AA|Launch|SubmitForm|ImportData|RichMedia|EmbeddedFiles?|XFA|AcroForm|Encrypt)\b/i;
  function failure(code){return Object.assign(new Error(code),{code});}
  function latin1(bytes){
    const chunks=[];
    for(let i=0;i<bytes.length;i+=8192)chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
    return chunks.join('');
  }
  function pdfBytes(text){return Uint8Array.from(text,c=>c.charCodeAt(0)&255);}
  function assertPassivePdf(bytes,fileName,mimeType){
    if(typeof fileName!=='string'||fileName.length>180||!/\.pdf$/i.test(fileName)||
      /[\x00-\x1f\x7f\\/]/.test(fileName)||mimeType!=='application/pdf'){
      throw failure('PDF_ONLY');
    }
    if(bytes.length<32||bytes.length>MAX_BYTES)throw failure('PDF_SIZE_INVALID');
    const raw=latin1(bytes);
    if(!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r?\n|\r)/.test(raw.slice(0,16))||
      !/%%EOF[\x00\t\n\f\r ]*$/.test(raw.slice(-1024)))throw failure('PDF_INVALID');
    // Decode escaped PDF name bytes so /J#61vaScript cannot bypass the guard.
    if(ACTIVE.test(raw.replace(/#([0-9a-fA-F]{2})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16))))){
      throw failure('PDF_ACTIVE_CONTENT');
    }
    return raw;
  }
  async function inflateLimited(bytes){
    if(typeof DecompressionStream!=='function')throw failure('PDF_COMPRESSION_UNAVAILABLE');
    const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const parts=[];let total=0;
    try{
      while(true){
        const {value,done}=await reader.read();
        if(done)break;
        total+=value.length;
        if(total>MAX_STREAM_BYTES){await reader.cancel().catch(()=>{});throw failure('PDF_TEXT_TOO_LARGE');}
        parts.push(value);
      }
    }catch(error){
      if(error?.code)throw error;
      throw failure('PDF_UNSUPPORTED_STREAM');
    }finally{reader.releaseLock();}
    const out=new Uint8Array(total);let offset=0;
    for(const part of parts){out.set(part,offset);offset+=part.length;}
    return latin1(out);
  }
  function decodeLiteral(source){
    const values=[];
    for(let i=1;i<source.length-1;i++){
      let code=source.charCodeAt(i);
      if(code===92){
        const next=source[++i];
        if(next===undefined)break;
        if(/[0-7]/.test(next)){
          let oct=next;
          for(let k=0;k<2&&/[0-7]/.test(source[i+1]||'');k++)oct+=source[++i];
          code=parseInt(oct,8);
        }else if(next==='n')code=10;
        else if(next==='r')code=13;
        else if(next==='t')code=9;
        else if(next==='b')code=8;
        else if(next==='f')code=12;
        else if(next==='\n'){continue;}
        else if(next==='\r'){if(source[i+1]==='\n')i++;continue;}
        else code=next.charCodeAt(0);
      }
      values.push(code&255);
    }
    const bytes=new Uint8Array(values);
    if(bytes.length>=2&&bytes[0]===0xfe&&bytes[1]===0xff){
      try{return new TextDecoder('utf-16be',{fatal:true}).decode(bytes.subarray(2));}catch{return '';}
    }
    return new TextDecoder('windows-1252').decode(bytes);
  }
  function decodeTextOperand(operand){
    const tokens=operand.match(/\((?:\\[\s\S]|[^\\)])*\)|<[0-9a-fA-F\s]+>/g)||[];
    return tokens.map(token=>{
      if(token[0]==='(')return decodeLiteral(token);
      const hex=token.slice(1,-1).replace(/\s/g,'');
      if(hex.length%2!==0)return '';
      const bytes=new Uint8Array(hex.match(/../g)?.map(h=>parseInt(h,16))||[]);
      return new TextDecoder('windows-1252').decode(bytes);
    }).join('');
  }
  function textFromStream(stream){
    const blocks=stream.match(/\bBT\b[\s\S]*?\bET\b/g)||[];
    const lines=[];
    for(const block of blocks){
      const operands=/((?:\((?:\\[\s\S]|[^\\)])*\)|<[0-9a-fA-F\s]+>|\[[^\]]{0,8192}\]))\s*(?:Tj|TJ|'|")\b?/g;
      let match,last=0,parts=[];
      while((match=operands.exec(block))!==null){
        const between=block.slice(last,match.index);
        if(/(?:\b(?:Td|TD)\b|T\*)/.test(between)&&parts.length){lines.push(parts.join(' ').trim());parts=[];}
        const value=decodeTextOperand(match[1]).replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').trim();
        if(value)parts.push(value);
        last=operands.lastIndex;
      }
      if(parts.length)lines.push(parts.join(' ').trim());
    }
    return lines.join('\n');
  }
  async function extractText(raw){
    const chunks=[];let count=0,total=0;
    const objectRe=/\b\d+\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g;
    let object;
    while((object=objectRe.exec(raw))!==null){
      const content=object[1];
      const start=/\bstream\r?\n/.exec(content);
      if(!start)continue;
      if(++count>MAX_STREAMS)throw failure('PDF_TOO_MANY_STREAMS');
      const begin=start.index+start[0].length;
      const end=content.indexOf('endstream',begin);
      if(end<0)throw failure('PDF_INVALID');
      const dictionary=content.slice(0,start.index);
      const payload=content.slice(begin,end).replace(/\r?\n$/,'');
      if(payload.length>MAX_BYTES)throw failure('PDF_SIZE_INVALID');
      let stream;
      if(/\/Filter\s*(?:\[\s*)?\/FlateDecode\b/.test(dictionary)){
        if(/\/Filter\s*\[[^\]]*\/[^\s\]]+\s+\/[^\s\]]+/.test(dictionary))continue;
        stream=await inflateLimited(pdfBytes(payload));
      }else if(/\/Filter\b/.test(dictionary))continue;
      else {
        if(payload.length>MAX_STREAM_BYTES)throw failure('PDF_TEXT_TOO_LARGE');
        stream=payload;
      }
      if(ACTIVE.test(stream.replace(/#([0-9a-fA-F]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))))){
        throw failure('PDF_ACTIVE_CONTENT');
      }
      const extracted=textFromStream(stream);
      if(extracted){total+=extracted.length;if(total>MAX_TEXT_CHARS)throw failure('PDF_TEXT_TOO_LARGE');chunks.push(extracted);}
    }
    const text=chunks.join('\n').normalize('NFC').trim();
    if(text.length<12)throw failure('PDF_NO_SELECTABLE_TEXT');
    return text;
  }
  function moneyOre(input){
    let value=String(input||'').trim().replace(/(?:\s*(?:kr|SEK))\s*$/i,'').replace(/[\u00a0\u202f\s]/g,'');
    if(!/^\d[\d.,]*$/.test(value))return null;
    const comma=value.lastIndexOf(','),dot=value.lastIndexOf('.');
    const decimal=Math.max(comma,dot);
    let fraction='00',whole=value;
    if(decimal>=0&&value.length-decimal-1===2){
      fraction=value.slice(decimal+1);
      whole=value.slice(0,decimal);
    }
    whole=whole.replace(/[.,]/g,'');
    if(!/^\d{1,9}$/.test(whole)||!/^[0-9]{2}$/.test(fraction))return null;
    const ore=Number(whole)*100+Number(fraction);
    return Number.isSafeInteger(ore)&&ore<=99999999999?ore:null;
  }
  function isoDate(value){
    const match=String(value||'').match(/\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b|\b(\d{1,2})[-./](\d{1,2})[-./](\d{4})\b/);
    if(!match)return null;
    const [y,m,d]=match[1]?[match[1],match[2],match[3]]:[match[6],match[5],match[4]];
    const normalized=y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0');
    const date=new Date(normalized+'T00:00:00Z');
    return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===normalized?normalized:null;
  }
  function parseFacts(text,documentType){
    if(!['supplier-invoice','receipt'].includes(documentType))throw failure('INVALID_DOCUMENT_TYPE');
    if(typeof text!=='string'||text.length>MAX_TEXT_CHARS)throw failure('PDF_TEXT_TOO_LARGE');
    const fields={supplier:[],reference:[],invoiceDate:[],dueDate:[],netOre:[],vatOre:[],grossOre:[]};
    const lines=text.split(/\n+/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,800);
    const add=(key,value,line)=>{
      if(value===null||value===undefined||value==='')return;
      if(!fields[key].some(x=>x.value===value))fields[key].push({value,evidence:line.slice(0,140)});
    };
    const amount=(line)=>{const match=line.match(/(?:^|[:\s])([\d][\d\s\u00a0\u202f.,]{0,24})(?:\s*(?:kr|SEK))?\s*$/i);return match?moneyOre(match[1]):null;};
    for(const line of lines){
      let m;
      if((m=line.match(/^(?:leverantör|säljare|butik)\s*[:\-]\s*(.{2,100})$/i)))add('supplier',m[1],line);
      if((m=line.match(/^(?:faktura(?:nummer|nr|nr\.)?|kvitto(?:nummer|nr|nr\.)?|referens)\s*[:#\-]?\s*([\w/-]{2,64})$/i)))add('reference',m[1],line);
      if((m=line.match(/^(?:fakturadatum|köpdatum|inköpsdatum|datum)\s*[:\-]?\s*(.+)$/i)))add('invoiceDate',isoDate(m[1]),line);
      if((m=line.match(/^(?:förfallodatum|förfaller)\s*[:\-]?\s*(.+)$/i)))add('dueDate',isoDate(m[1]),line);
      if(/^(?:netto(?:belopp)?|summa exkl\.? moms|belopp exkl\.? moms|exkl\.? moms)\s*[:\-]?\s*/i.test(line))add('netOre',amount(line),line);
      if(/^(?:varav moms|moms(?:\s*\(?\d{1,2}\s*%\)?)?|momsbelopp)\s*[:\-]?\s*/i.test(line))add('vatOre',amount(line),line);
      if(/^(?:summa att betala|att betala|belopp att betala|totalt(?: belopp)?|totalbelopp|summa inkl\.? moms)\s*[:\-]?\s*/i.test(line))add('grossOre',amount(line),line);
    }
    const resolved={};const warnings=[];
    for(const [key,found] of Object.entries(fields)){
      resolved[key]=found.length===1?{value:found[0].value,evidence:found[0].evidence,verified:false}:null;
      if(found.length>1)warnings.push('Motstridiga uppgifter för '+key+'. Kontrollera originalet.');
    }
    if(!resolved.grossOre)warnings.push('Totalt belopp kunde inte fastställas säkert.');
    if(!resolved.invoiceDate)warnings.push('Datum måste kontrolleras mot originalet.');
    if(/\b(?:EUR|USD|GBP)\b|€/i.test(text))warnings.push('Möjlig utländsk valuta. Kontrollera manuellt.');
    const net=resolved.netOre?.value,vat=resolved.vatOre?.value,gross=resolved.grossOre?.value;
    const amountBalance=Number.isInteger(net)&&Number.isInteger(vat)&&Number.isInteger(gross)
      ?Math.abs(net+vat-gross)<=1:null;
    if(amountBalance===false)warnings.push('Netto + moms stämmer inte med totalbeloppet.');
    if(amountBalance===null)warnings.push('Netto, moms och totalbelopp kan inte stämmas av fullständigt.');
    return {status:'needs-review',posted:false,source:'local-pdf-text',documentType,
      fields:resolved,checks:{amountBalance},warnings};
  }
  async function readPdf(file,documentType){
    if(!file||typeof file.arrayBuffer!=='function')throw failure('PDF_ONLY');
    if(Number(file.size)>MAX_BYTES)throw failure('PDF_SIZE_INVALID');
    const bytes=new Uint8Array(await file.arrayBuffer());
    const raw=assertPassivePdf(bytes,String(file.name||''),String(file.type||''));
    const text=await extractText(raw);
    return parseFacts(text,documentType);
  }
  const api=Object.freeze({readPdf,parseFacts,moneyOre,isoDate});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.LTStudioDocumentReader=api;
})(typeof window!=='undefined'?window:null);
