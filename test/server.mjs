import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = process.argv[2] || '.'; const port = +process.argv[3] || 8080;
const types = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.cjs':'text/javascript','.wasm':'application/wasm','.task':'application/octet-stream','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.css':'text/css','.y4m':'video/x-y4m','.wav':'audio/wav'};
http.createServer((req,res)=>{
  let p = decodeURIComponent(new URL(req.url,'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  fs.stat(f,(e,st)=>{ if(e||!st.isFile()){res.writeHead(404);res.end('nf');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream','Content-Length':st.size,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
    fs.createReadStream(f).pipe(res); });
}).listen(port,()=>console.log('serving',root,'on',port));
