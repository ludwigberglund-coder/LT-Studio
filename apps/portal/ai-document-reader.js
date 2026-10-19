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
      /[\x00-\x1f\x7f\\/]/.test(fileName)||(mimeType&&mimeType!=='application/pdf')){
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
    // Zero-filled CID glyph IDs without a BOM need the font's ToUnicode map.
    // Dropping NULs would fabricate apparently valid invoice text.
    if(bytes.includes(0))return '';
    return new TextDecoder('windows-1252').decode(bytes);
  }
  function decodeTextOperand(operand){
    const tokens=operand.match(/\((?:\\[\s\S]|[^\\)])*\)|<[0-9a-fA-F\s]+>/g)||[];
    return tokens.map(token=>{
      if(token[0]==='(')return decodeLiteral(token);
      const hex=token.slice(1,-1).replace(/\s/g,'');
      if(hex.length%2!==0)return '';
      const bytes=new Uint8Array(hex.match(/../g)?.map(h=>parseInt(h,16))||[]);
      // PDF text can be encoded as UTF-16BE/LE with a BOM, including hex
      // operands. Decode only when the BOM is explicit: CID font glyph codes
      // without ToUnicode must never be guessed as readable text.
      if(bytes.length>=2&&
        ((bytes[0]===0xfe&&bytes[1]===0xff)||(bytes[0]===0xff&&bytes[1]===0xfe))){
        try{
          return new TextDecoder(bytes[0]===0xfe?'utf-16be':'utf-16le',{fatal:true})
            .decode(bytes.subarray(2));
        }catch{return '';}
      }
      if(bytes.includes(0))return '';
      return new TextDecoder('windows-1252').decode(bytes);
    }).join('');
  }
  function textFromStream(stream){
    const blocks=stream.match(/\bBT\b[\s\S]*?\bET\b/g)||[];
    const lines=[];
    for(const block of blocks){
      const operands=/((?:\((?:\\[\s\S]|[^\\)])*\)|<[0-9a-fA-F\s]+>|\[[^\]]{0,8192}\]))\s*(?:Tj|TJ|'|")/g;
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
  // Read exact PDF stream lengths. Searching for "endstream" in binary data
  // truncates valid compressed streams, and stripping a final newline can corrupt
  // their zlib checksum. A referenced length is accepted only when unambiguous.
  function streamByteLength(dictionary,raw){
    const entries=[...dictionary.matchAll(/\/Length\s+(\d+)(?:\s+(\d+)\s+R)?(?=\s|\/|>)/g)];
    if(entries.length!==1)throw failure('PDF_UNSUPPORTED_STREAM');
    const entry=entries[0];
    let length=Number(entry[1]);
    if(entry[2]!==undefined){
      const ref=new RegExp('(?:^|[\\r\\n])\\s*'+entry[1]+'\\s+'+entry[2]+
        '\\s+obj\\s+(\\d+)\\s+endobj\\b','g');
      const values=[...raw.matchAll(ref)];
      if(values.length!==1)throw failure('PDF_UNSUPPORTED_STREAM');
      length=Number(values[0][1]);
    }
    if(!Number.isSafeInteger(length)||length<0||length>MAX_BYTES){
      throw failure('PDF_SIZE_INVALID');
    }
    return length;
  }
  async function extractText(raw){
    const chunks=[];let count=0,total=0;
    // Advance beyond each whole stream object: binary contents may themselves
    // contain "obj", "endobj" or "endstream" as ordinary byte sequences.
    const objectRe=/\b\d+\s+\d+\s+obj\b/g;
    let object;
    while((object=objectRe.exec(raw))!==null){
      const beginObject=objectRe.lastIndex;
      const firstEnd=raw.indexOf('endobj',beginObject);
      if(firstEnd<0)throw failure('PDF_INVALID');
      const startRe=/\bstream(?:\r\n|\r|\n)/g;
      startRe.lastIndex=beginObject;
      const start=startRe.exec(raw);
      if(!start||start.index>firstEnd){
        objectRe.lastIndex=firstEnd+'endobj'.length;
        continue;
      }
      if(++count>MAX_STREAMS)throw failure('PDF_TOO_MANY_STREAMS');
      const dictionary=raw.slice(beginObject,start.index);
      const begin=startRe.lastIndex;
      const length=streamByteLength(dictionary,raw);
      const end=begin+length;
      if(end>raw.length)throw failure('PDF_INVALID');
      const marker=/^(?:\r\n|\n|\r)?endstream\b/.exec(raw.slice(end,end+24));
      if(!marker)throw failure('PDF_INVALID');
      const afterMarker=end+marker[0].length;
      const closing=/^[\x00\t\n\f\r ]*endobj\b/.exec(raw.slice(afterMarker,afterMarker+256));
      if(!closing)throw failure('PDF_INVALID');
      objectRe.lastIndex=afterMarker+closing[0].length;
      const payload=raw.slice(begin,end);
      let stream;
      if(/\/Filter\s*(?:\[\s*)?\/FlateDecode\b/.test(dictionary)){
        if(/\/Filter\s*\[[^\]]*\/[^\s\]]+\s+\/[^\s\]]+/.test(dictionary))continue;
        stream=await inflateLimited(pdfBytes(payload));
      }else if(/\/Filter\b/.test(dictionary))continue;
      else {
        if(length>MAX_STREAM_BYTES)throw failure('PDF_TEXT_TOO_LARGE');
        stream=payload;
      }
      if(ACTIVE.test(stream.replace(/#([0-9a-fA-F]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))))){
        throw failure('PDF_ACTIVE_CONTENT');
      }
      const extracted=textFromStream(stream);
      if(extracted){
        total+=extracted.length;
        if(total>MAX_TEXT_CHARS)throw failure('PDF_TEXT_TOO_LARGE');
        chunks.push(extracted);
      }
    }
    const text=chunks.join('\n').normalize('NFC').trim();
    if(text.length<12)throw failure('PDF_NO_SELECTABLE_TEXT');
    return text;
  }
  function moneyOre(input){
    const value=String(input??'').trim().replace(/(?:\s*(?:kr|SEK))\s*$/i,'')
      .replace(/[\u00a0\u202f]/g,' ').replace(/\s+/g,' ').trim();
    if(!/^\d[\d., ]*$/.test(value))return null;
    const decimal=value.match(/([.,])(\d{2})$/);
    const decimalSeparator=decimal?.[1]||null;
    const fraction=decimal?.[2]||'00';
    const whole=decimal?value.slice(0,-3):value;
    let digits=whole;
    if(!/^\d{1,9}$/.test(whole)){
      // A thousands separator is only valid in consistent 3-digit groups.
      // Never silently remove malformed punctuation, e.g. 12,34,56 or 1.2.
      const separator=whole.match(/[., ]/)?.[0];
      if(!separator||separator===decimalSeparator)return null;
      const groups=whole.split(separator);
      if(groups.length<2||!/^\d{1,3}$/.test(groups[0])||
        groups.slice(1).some(group=>!/^\d{3}$/.test(group))||
        !/^\d+$/.test(groups.join('')))return null;
      digits=groups.join('');
    }
    if(!/^\d{1,9}$/.test(digits))return null;
    const ore=Number(digits)*100+Number(fraction);
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
    // Credit documents often show *positive* totals. Never reinterpret these as
    // ordinary purchases simply because net + VAT = gross.
    const creditNote=/(?:^|[^\p{L}])(?:kreditfaktura|kreditnota|credit\s+note|kreditering\s+av\s+faktura|fakturatyp\s*[:\-]\s*kredit|returkvitto|återköpskvitto|återbetalningskvitto)(?=$|[^\p{L}])/iu.test(text);
    // Detect negative summary amounts even when another positive total exists.
    // A negative discount line alone is not a negative invoice.
    const summaryLabel=/^(?:netto(?:belopp)?|summa exkl\.? moms|belopp exkl\.? moms|exkl\.? moms|varav moms|moms(?:belopp)?|summa att betala|att betala|belopp att betala|totalt(?: belopp)?|totalbelopp|summa inkl\.? moms)\b/i;
    const negativeSummary=lines.some(line=>{
      const label=line.match(summaryLabel);
      if(!label)return false;
      const rest=line.slice(label[0].length).trim()
        .replace(/^\(?\s*\d{1,3}\s*%\s*\)?\s*/,'').replace(/^:\s*/,'');
      return /^[-\u2212\u2013]\s*\d/.test(rest)||
        /^\(\s*\d[\d\s.,]*(?:\s*(?:kr|SEK))?\s*\)$/i.test(rest);
    });
    const declaredRates=[...new Set([...text.matchAll(/(?:^|\n)\s*(?:varav\s+)?moms(?:sats|belopp)?\s*[:\s(]*([0-9]{1,3})\s*%/gim)]
      .map(match=>Number(match[1])))];
    const mixedVatRates=declaredRates.length>1;
    const declaredVatRate=declaredRates.length===1?declaredRates[0]:null;
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
    if(/\b(?:EUR|USD|GBP|NOK|DKK|CHF|PLN|CAD|AUD|JPY|CNY)\b|[€£]/i.test(text))
      warnings.push('Möjlig utländsk valuta. Kontrollera manuellt.');
    if(creditNote)warnings.push('Kreditfaktura eller returkvitto: kräver separat krediteringsflöde.');
    if(negativeSummary)warnings.push('Negativt netto-, moms- eller totalbelopp: kräver manuell kontroll.');
    if(mixedVatRates)warnings.push('Flera angivna momssatser: utkastet måste hanteras manuellt.');
    if(declaredVatRate!==null&&![0,6,12,25].includes(declaredVatRate))
      warnings.push('Angiven momssats stöds inte i granskningsutkastet.');
    const net=resolved.netOre?.value,vat=resolved.vatOre?.value,gross=resolved.grossOre?.value;
    const amountBalance=Number.isInteger(net)&&Number.isInteger(vat)&&Number.isInteger(gross)
      ?Math.abs(net+vat-gross)<=1:null;
    if(amountBalance===false)warnings.push('Netto + moms stämmer inte med totalbeloppet.');
    if(amountBalance===null)warnings.push('Netto, moms och totalbelopp kan inte stämmas av fullständigt.');
    return {status:'needs-review',posted:false,source:'local-pdf-text',documentType,
      fields:resolved,checks:{amountBalance,creditNote,negativeSummary,mixedVatRates,declaredVatRate},warnings};
  }
  async function readPdf(file,documentType){
    if(!file||typeof file.arrayBuffer!=='function')throw failure('PDF_ONLY');
    if(!Number.isSafeInteger(file.size)||file.size<32||file.size>MAX_BYTES)throw failure('PDF_SIZE_INVALID');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes.length!==file.size)throw failure('PDF_SIZE_INVALID');
    const raw=assertPassivePdf(bytes,String(file.name||''),String(file.type||''));
    const text=await extractText(raw);
    return parseFacts(text,documentType);
  }
  const api=Object.freeze({readPdf,parseFacts,moneyOre,isoDate});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.LTStudioDocumentReader=api;
})(typeof window!=='undefined'?window:null);
