// Fixed-origin read-only Notion adapter. Page bodies exist only in request memory.
// No D1, logging, arbitrary URLs, mutation methods, or upstream error text.
const VERSION = '2025-09-03';
const validId = x => typeof x === 'string' && /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(x);
const cursorOK = x => x === undefined || x === null || (typeof x === 'string' && x.length > 0 && x.length <= 1000);
const only = (x, keys) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).every(k=>keys.includes(k));
const need = x => { if(!x) throw Error('INVALID_INPUT'); };
const idSchema = {type:'string',description:'Notion UUID, not a URL.'};
const cursorSchema = {type:'string',maxLength:1000};
const taskSchema = {type:'object',properties:{id:idSchema,cursor:cursorSchema},required:['id'],additionalProperties:false};
const schemas = [
 ['light_notion_search','List accessible pages and data sources as a content-free manifest. Follow next_cursor until null. Search is not a complete workspace inventory; unshared objects are invisible.',{cursor:cursorSchema}],
 ['light_notion_data_source','List rows in one data source as a content-free manifest. Follow next_cursor until null; no row properties are returned.',{id:idSchema,cursor:cursorSchema},['id']],
 ['light_notion_database','Read a database container to discover data source IDs. No titles or schema content are returned.',{id:idSchema},['id']],
 ['light_notion_page','Inspect page blocks recursively; return IDs, types and coverage only. Resume with continuation and the same page ID until null. Each call returns a manifest delta; combine deltas. Inaccessible means unavailable to this connection, never nonexistent.',{id:idSchema,max_requests:{type:'integer',minimum:1,maximum:20},continuation:{type:'object',properties:{phase:{type:'string',enum:['page','blocks']},page_id:idSchema,tasks:{type:'array',maxItems:1000,items:taskSchema},seen:{type:'array',maxItems:10000,items:{type:'string',maxLength:1100}},inaccessible:{type:'integer',minimum:0},gaps:{type:'integer',minimum:0}},required:['phase','page_id','tasks','seen','inaccessible','gaps'],additionalProperties:false}},['id']],
];
export const NOTION_TOOLS = Object.freeze(schemas.map(([name,description,properties,required=[]])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}})));
export const isNotionTool = name => schemas.some(t=>t[0]===name);
const manifest = x => ({id:x.id,kind:x.object === 'data_source'?'data_source':'page',status:'accessible'});
const coverage = status => ({status,workspace_complete:false,scope:'Only objects shared with this integration; search indexing may omit objects. Known inaccessible IDs remain gaps. Provide expected page/data source IDs to verify sharing.'});

async function request(env, path, body, fetcher) {
 // Only call sites below construct path; POST is restricted to read-only search/query.
 let r;
 try {r=await fetcher('https://api.notion.com/v1'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+env.NOTION_API,'Notion-Version':VERSION,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(8000)});}
 catch {return {error:'upstream_unavailable'};}
 if(!r.ok){
  if([401,403,404].includes(r.status))return {error:'inaccessible',http_status:r.status};
  if(r.status===429){const retry=Number(r.headers.get('Retry-After'));return {error:'rate_limited',retry_after_seconds:Number.isFinite(retry)&&retry>0?Math.ceil(retry):1};}
  return {error:'upstream_error',http_status:r.status};
 }
 try {return {data:await r.json()};} catch {return {error:'invalid_response'};}
}
function listData(data){
 if(!Array.isArray(data?.results) || typeof data.has_more!=='boolean' || (data.has_more && (!cursorOK(data.next_cursor)||!data.next_cursor)))return null;
 return data;
}
function errorResult(r,id,kind){return {status:r.error,manifest:id?[{id,kind,status:r.error,http_status:r.http_status}]:[],coverage:coverage('partial'),...(r.retry_after_seconds?{retry_after_seconds:r.retry_after_seconds}:{})};}

export async function runNotionTool(name,args={},env={},fetcher=fetch){
 need(isNotionTool(name));
 const schema=NOTION_TOOLS.find(t=>t.name===name).inputSchema;
 need(only(args,Object.keys(schema.properties)) && (!schema.required.length || schema.required.every(k=>validId(args[k]))) && cursorOK(args.cursor));
 if(!env.NOTION_API)throw Error('NOTION_NOT_CONFIGURED');
 if(name==='light_notion_database'){
  const r=await request(env,'/databases/'+args.id,undefined,fetcher);
  if(r.error)return errorResult(r,args.id,'database');
  if(!Array.isArray(r.data.data_sources))return errorResult({error:'invalid_response'},args.id,'database');
  return {status:'ok',manifest:r.data.data_sources.filter(x=>validId(x.id)).map(x=>({id:x.id,kind:'data_source',status:'discovered'})),coverage:coverage('complete_for_requested_database')};
 }
 if(name!=='light_notion_page'){
  const r=await request(env,name==='light_notion_search'?'/search':'/data_sources/'+args.id+'/query',{page_size:100,...(args.cursor?{start_cursor:args.cursor}:{})},fetcher);
  if(r.error)return {...errorResult(r,args.id,'data_source'),next_cursor:args.cursor||null,retry_required:true};
  const data=listData(r.data);if(!data)return errorResult({error:'invalid_response'},args.id,'data_source');
  return {status:'ok',manifest:data.results.filter(x=>validId(x.id)&&['page','data_source'].includes(x.object)).map(manifest),next_cursor:data.has_more?data.next_cursor:null,coverage:coverage(data.has_more?'partial':'complete_for_requested_listing')};
 }
 const budget=args.max_requests??20;need(Number.isInteger(budget)&&budget>=1&&budget<=20);
 const c=args.continuation;
 if(c){
  need(only(c,['phase','page_id','tasks','seen','inaccessible','gaps']) && ['page','blocks'].includes(c.phase) && c.page_id===args.id && Array.isArray(c.tasks)&&c.tasks.length<=1000 && c.tasks.every(t=>only(t,['id','cursor'])&&validId(t.id)&&cursorOK(t.cursor)) && Array.isArray(c.seen)&&c.seen.length<=10000&&c.seen.every(x=>typeof x==='string'&&x.length<=1100) && Number.isSafeInteger(c.inaccessible)&&c.inaccessible>=0 && Number.isSafeInteger(c.gaps)&&c.gaps>=0);
 }
 let tasks=c?c.tasks.map(t=>({...t})):[{id:args.id}];const seen=new Set(c?.seen||[]);let inaccessible=c?.inaccessible||0,gaps=c?.gaps||0;
 const entries=[];let used=0,status='ok',retry;
 if(!c || c.phase==='page'){
  const r=await request(env,'/pages/'+args.id,undefined,fetcher);used++;
  if(r.error){if(r.error==='inaccessible')return errorResult(r,args.id,'page');status=r.error;retry=r.retry_after_seconds;
   return {...errorResult(r,args.id,'page'),continuation:{phase:'page',page_id:args.id,tasks,seen:[...seen],inaccessible,gaps},retry_required:true};}
  entries.push({id:args.id,kind:'page',status:'accessible'});
 }
 while(tasks.length && used<budget){
  const t=tasks.shift(), key=t.id+':'+(t.cursor||'');
  if(seen.has(key)){gaps++;continue;}
  const url='/blocks/'+t.id+'/children?page_size=100'+(t.cursor?'&start_cursor='+encodeURIComponent(t.cursor):'');
  const r=await request(env,url,undefined,fetcher);used++;
  if(r.error){
   entries.push({id:t.id,kind:'block_children',status:r.error,http_status:r.http_status});
   if(r.error==='inaccessible'){inaccessible++;seen.add(key);continue;}
   tasks.unshift(t);status=r.error;retry=r.retry_after_seconds;break;
  }
  const data=listData(r.data);
  if(!data){tasks.unshift(t);status='invalid_response';break;}
  seen.add(key);
  const enqueue=t=>{if(tasks.length>=1000){gaps++;return;}tasks.push(t);};
  for(const b of data.results){
   if(!validId(b.id)){gaps++;continue;}
   entries.push({id:b.id,kind:'block',type:b.type,status:'accessible',parent_id:t.id});
   if(b.type==='unsupported')gaps++;
   if(b.type==='child_database')entries.push({id:b.id,kind:'database',status:'discovered',next_tool:'light_notion_database'});
   else if(b.has_children || b.type==='child_page')enqueue({id:b.id});
   if(b.type==='link_to_page'){
    const link=b.link_to_page;const target=link?.page_id||link?.database_id;
    if(validId(target))entries.push({id:target,kind:link.page_id?'page':'database',status:'unverified_reference'});
   }
  }
  if(data.has_more){if(data.next_cursor===t.cursor){gaps++;}else enqueue({id:t.id,cursor:data.next_cursor});}
  if(seen.size>=10000){gaps++;status='limit_reached';break;}
 }
 return {status,manifest:entries,requests:used,...(retry?{retry_after_seconds:retry}:{}),coverage:{...coverage(tasks.length||inaccessible||gaps||status!=='ok'?'partial':'complete_for_requested_page'),inaccessible,gaps},continuation:tasks.length&&seen.size<10000?{phase:'blocks',page_id:args.id,tasks,seen:[...seen],inaccessible,gaps}:null};
}
