import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,Log,LogLevel} from 'miniflare';
const source=readFileSync(new URL('../src/notion-read.js',import.meta.url),'utf8');
test('Notion request constructs and reaches transport in Workers runtime',async()=>{
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-08-06',log:new Log(LogLevel.NONE),script:source+`
 export default {async fetch(){let calls=0;const data=await runNotionTool('light_notion_search',{}, {NOTION_API:'runtime-test-credential'},async(url,init)=>{calls++;return Response.json({results:[],has_more:false,next_cursor:null});});return Response.json({data,calls});}};`});
 try{const r=await mf.dispatchFetch('http://localhost/');const {data,calls}=await r.json();assert.equal(data.status,'ok',JSON.stringify(data));assert.equal(calls,1);}finally{await mf.dispose();}
});
