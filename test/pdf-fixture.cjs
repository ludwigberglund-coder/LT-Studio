'use strict';

const {PDFDocument,StandardFonts}=require('pdf-lib');

async function safePdf(label='LT Studio PDF fixture'){
  const document=await PDFDocument.create();
  const page=document.addPage([300,400]);
  const font=await document.embedFont(StandardFonts.Helvetica);
  page.drawText(String(label).slice(0,120),{x:24,y:360,size:10,font});
  return Buffer.from(await document.save({useObjectStreams:false}));
}

module.exports=Object.freeze({safePdf});
