// LIGHT job tools use a dedicated LIGHT-only PANTHEON Service Binding entrypoint.
// Never bind OwnerBridge into LIGHT and never share the WorkHub bearer token.
const shape=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const jobId=v=>typeof v==="string"&&/^task_[a-f0-9]{32}$/.test(v);
const requestOK=v=>typeof v==="string"&&v.trim().length>0&&v.length<=2000;
export const LIGHT_WORK_TOOLS=Object.freeze([
  {name:"light_pantheon_tasks",description:"Read the shared PANTHEON task queue or a task by exact ID. Does not modify state.",inputSchema:{type:"object",properties:{task_id:{type:"string"}},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}},
  {name:"light_pantheon_create_task",description:"Create a PANTHEON work request attributed to LIGHT. Creates a queued task only; does not execute code or Factory work.",inputSchema:{type:"object",properties:{request:{type:"string",minLength:1,maxLength:2000}},required:["request"],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false}},
  {name:"light_pantheon_queue_factory",description:"Queue (DO NOT DISPATCH) a LOGIC training job for Factory in PANTHEON. The job awaits explicit owner action.",inputSchema:{type:"object",properties:{request:{type:"string",minLength:1,maxLength:2000}},required:["request"],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false}},
  {name:"light_pantheon_factory",description:"Read Factory readiness or one job receipt through PANTHEON; never dispatch or reconcile.",inputSchema:{type:"object",properties:{task_id:{type:"string"}},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}},
]);
const NAMES=new Set(LIGHT_WORK_TOOLS.map(x=>x.name));
export function isLightWorkTool(name){return NAMES.has(name);}
export async function runLightWorkTool(name,args={},env={}){
  if(!isLightWorkTool(name))throw Error("UNKNOWN_WORK_TOOL");
  if(!env.PANTHEON_LIGHT||typeof env.PANTHEON_LIGHT.lightCall!=="function")throw Error("LIGHT_WORK_BRIDGE_NOT_CONFIGURED");
  let payload;
  if(name==="light_pantheon_tasks"){
    if(!shape(args,["task_id"])||(args.task_id!==undefined&&!jobId(args.task_id)))throw Error("INVALID_INPUT");
    payload=args.task_id?{operation:"show_task",task_id:args.task_id}:{operation:"list_tasks"};
  }else if(name==="light_pantheon_create_task"||name==="light_pantheon_queue_factory"){
    if(!shape(args,["request"])||!requestOK(args.request))throw Error("INVALID_INPUT");
    payload={operation:name==="light_pantheon_create_task"?"create_task":"queue_factory",request:args.request.trim()};
  }else{
    if(!shape(args,["task_id"])||(args.task_id!==undefined&&!jobId(args.task_id)))throw Error("INVALID_INPUT");
    payload=args.task_id?{operation:"factory_job",task_id:args.task_id}:{operation:"factory_health"};
  }
  let response;
  try{response=await env.PANTHEON_LIGHT.lightCall(payload);}
  catch{throw Error("LIGHT_WORK_UPSTREAM_UNAVAILABLE");}
  if(!response||typeof response!=="object"||response.caller!=="LIGHT-BOOKMARK")throw Error("LIGHT_WORK_INVALID_UPSTREAM");
  if(response.ok!==true)return {ok:false,status:response.status||"UPSTREAM_REJECTED",upstream_status:response.upstream_status??null};
  return {ok:true,caller:"LIGHT-BOOKMARK",executed:false,...response.result};
}
