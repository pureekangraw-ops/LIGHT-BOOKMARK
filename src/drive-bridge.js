// No Google credentials are stored in LIGHT; read calls use PANTHEON's explicit capability.
export const LIGHT_DRIVE_TOOLS=Object.freeze([
  {name:"light_drive_roots",description:"Show the Google Drive root available to the account authorized in PANTHEON. Read-only.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}},
  {name:"light_drive_list",description:"List accessible Google Drive files, optionally under a folder or matching a name. Supports pagination. Read-only.",inputSchema:{type:"object",properties:{folder_id:{type:"string",description:"Optional Drive folder ID; omit to search across accessible drives."},query:{type:"string",maxLength:80},limit:{type:"integer",minimum:1,maximum:30},page_token:{type:"string",maxLength:2048}},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}},
  {name:"light_drive_file",description:"Read bounded text from any Google Drive file accessible to the PANTHEON-authorized account. Never edits files.",inputSchema:{type:"object",properties:{file_id:{type:"string"}},required:["file_id"],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}},
]);
const names=new Set(LIGHT_DRIVE_TOOLS.map(x=>x.name));
const safeId=v=>typeof v==="string"&&/^[a-zA-Z0-9_-]{12,100}$/.test(v);
const safeFolderId=v=>v==="root"||safeId(v);
const only=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
export function isLightDriveTool(name){return names.has(name);}
export async function runLightDriveTool(name,args={},env={}){
  if(!isLightDriveTool(name))throw Error("UNKNOWN_DRIVE_TOOL");
  const fields=name==="light_drive_roots"?[]:name==="light_drive_list"?["folder_id","query","limit","page_token"]:["file_id"];
  if(!only(args,fields))throw Error("INVALID_INPUT");
  if(name==="light_drive_list"&&
    ((args.folder_id!==undefined&&!safeFolderId(args.folder_id))||
     (args.query!==undefined&&(typeof args.query!=="string"||args.query.length>80))||
     (args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>30))||
     (args.page_token!==undefined&&(typeof args.page_token!=="string"||args.page_token.length>2048))))throw Error("INVALID_INPUT");
  if(name==="light_drive_file"&&!safeId(args.file_id))throw Error("INVALID_INPUT");
  if(!env.PANTHEON_LIGHT||typeof env.PANTHEON_LIGHT.lightCall!=="function")throw Error("PANTHEON_LIGHT_BRIDGE_NOT_CONFIGURED");
  let data;
  try{data=await env.PANTHEON_LIGHT.lightCall({operation:"pantheon.drive.read",name,args});}
  catch{throw Error("PANTHEON_DRIVE_UNAVAILABLE");}
  if(!data||typeof data!=="object"||data.caller!=="LIGHT-BOOKMARK"||data.capability!=="pantheon.drive.read")throw Error("DRIVE_INVALID_BRIDGE_RESPONSE");
  if(data.ok!==true)return {ok:false,status:data.status||"DRIVE_UNAVAILABLE",upstream_status:data.upstream_status??null};
  if(!data.result||typeof data.result!=="object")throw Error("DRIVE_INVALID_BRIDGE_RESPONSE");
  return {ok:true,result:data.result};
}
