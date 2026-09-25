'use strict';
const fs=require('node:fs');
const path=require('node:path');
function stampRelease(target,commit){
  if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('Static release requires a full Git commit SHA.');
  fs.copyFileSync(path.join(__dirname,'static-release-client.js'),path.join(target,'release.js'));
  function walk(directory){for(const name of fs.readdirSync(directory)){
    const file=path.join(directory,name);
    if(fs.statSync(file).isDirectory()){walk(file);continue;}
    if(!/\.(html|js|css)$/.test(name))continue;
    let source=fs.readFileSync(file,'utf8');
    // Stamp local assets, including ES-module imports and JSON data paths.
    // Only exact existing files are rewritten; API URLs and user data are untouched.
    source=source.replace(/(["'])([^"'\s<>`]+\.(?:js|css|json)(?:\?[^"'\s<>`]*)?)\1/g,(match,quote,url)=>{
      if(/^(?:[a-z]+:|\/\/|\/)/i.test(url))return match;
      const [pathname,query='']=url.split('?');
      const resolved=path.resolve(path.dirname(file),pathname);
      if(!resolved.startsWith(target+path.sep)||!fs.existsSync(resolved))return match;
      const params=new URLSearchParams(query);params.set('v',commit);
      return quote+pathname+'?'+params.toString()+quote;
    });
    if(name.endsWith('.html')){
      const relative=path.relative(path.dirname(file),target).split(path.sep).join('/')||'.';
      source=source.replace('</head>',`<meta name="lt-release" content="${commit}"><script defer src="${relative}/release.js?v=${commit}"></script>\n</head>`);
    }
    fs.writeFileSync(file,source);
  }}
  walk(target);
}
module.exports={stampRelease};
