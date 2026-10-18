// No Google secrets are stored in LIGHT; Drive calls go to PANTHEON's restricted LightBridge RPC.
export const LIGHT_DRIVE_TOOLS=Object.freeze([
  {name:"light_drive_roots",description:"List Google Drive folders explicitly authorized for LIGHT by PANTHEON. Read-only.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}},
  {name:"light_drive_list",description:"List files under a PANTHEON-allowlisted Drive folder (initially HERMES Academy runs). Read-only.",inputSchema:{type:"object",properties:{folder_id:{type:"string"},query:{type:"string",maxLength:80},limit:{type:"integer",minimum:1,maximum:30}},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}},
  {name:"light_drive_file",description:"Read bounded UTF-8 text from a Google Drive file within approved folder tree. Never edit files.",inputSchema:{type:"object",properties:{file_id:{type:"string"}},required:["file_id"],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}},
]);
const names=new Set(LIGHT_DRIVE_TOOLS.map(x=>x.name));
const safeId=v=>typeof v==="string"&&/^[a-zA-Z0-9_-]{12,100}$/.test(v);
const only=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
export function isLightDriveTool(name){return names.has(name);}
export async function runLightDriveTool(name,args={},env={}){
  if(!isLightDriveTool(name))throw Error("UNKNOWN_DRIVE_TOOL");
  if(!only(args,name==="light_drive_roots"?[]:name==="light_drive_list"?["folder_id","query","limit"]:["file_id"]))throw Error("INVALID_INPUT");
  if(name==="light_drive_list"&&
    ((args.folder_id!==undefined&&!safeId(args.folder_id))||
     (args.query!==undefined&&(typeof args.query!=="string"||args.query.length>80))||
     (args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>30))))throw Error("INVALID_INPUT");
  if(name==="light_drive_file"&&!safeId(args.file_id))throw Error("INVALID_INPUT");
  if(!env.PANTHEON_LIGHT||typeof env.PANTHEON_LIGHT.lightCall!=="function")throw Error("PANTHEON_LIGHT_BRIDGE_NOT_CONFIGURED");
  let data;
  try{data=await env.PANTHEON_LIGHT.lightCall({operation:"drive_read",name,args});}
  catch{throw Error("PANTHEON_DRIVE_UNAVAILABLE");}
  if(!data||typeof data!=="object"||data.caller!=="LIGHT-BOOKMARK"||data.capability!=="LIGHT_DRIVE_READ")throw Error("DRIVE_INVALID_BRIDGE_RESPONSE");
  if(data.ok!==true)return {ok:false,status:data.status||"DRIVE_UNAVAILABLE",upstream_status:data.upstream_status??null};
  if(!data.result||typeof data.result!=="object")throw Error("DRIVE_INVALID_BRIDGE_RESPONSE");
  return {ok:true,result:data.result};
}
