import {documentEvidence,boundedText} from "./document-evidence.js";
import {lightDriveRequest,lightDriveDownload} from "./direct-drive.js";
import {unzipSync} from "fflate";
// LIGHT-owned OAuth credentials remain in Cloudflare secrets; never return them.
const READ_ANNOTATIONS={readOnlyHint:true,destructiveHint:false,idempotentHint:true};
const WRITE_ANNOTATIONS={readOnlyHint:false,destructiveHint:true,idempotentHint:false};
export const LIGHT_DRIVE_TOOLS=Object.freeze([
  {name:"light_drive_roots",description:"List root children available to the account authorized by LIGHT-owned Google OAuth. Read-only.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:READ_ANNOTATIONS},
  {name:"light_drive_list",description:"List accessible Google Drive files, optionally under a folder or matching a name. Supports pagination. Read-only.",inputSchema:{type:"object",properties:{folder_id:{type:"string",description:"Optional Drive folder ID; omit to search across accessible drives."},query:{type:"string",maxLength:80},limit:{type:"integer",minimum:1,maximum:30},page_token:{type:"string",maxLength:2048}},additionalProperties:false},annotations:READ_ANNOTATIONS},
  {name:"light_drive_file",description:"Read bounded UTF-8 text from Drive files, or inspect ZIP entries. Read-only; maximum download 4 MiB and returned text 60,000 UTF-16 units.",inputSchema:{type:"object",properties:{file_id:{type:"string"},entry:{type:"string",maxLength:240}},required:["file_id"],additionalProperties:false},annotations:READ_ANNOTATIONS},
  {name:"light_drive_permissions",description:"List a Drive file's existing sharing permissions. Read-only.",inputSchema:{type:"object",properties:{file_id:{type:"string"},page_token:{type:"string",maxLength:2048}},required:["file_id"],additionalProperties:false},annotations:READ_ANNOTATIONS},
  {name:"light_drive_create",description:"Create Google Drive file metadata or a folder without text. Creation with text is not implemented and returns LIGHT_DRIVE_OPERATION_NOT_IMPLEMENTED. Only call on explicit user request.",inputSchema:{type:"object",properties:{folder_id:{type:"string"},name:{type:"string",minLength:1,maxLength:180},text:{type:"string",maxLength:60000},mime_type:{type:"string",enum:["text/plain","text/markdown","text/csv","application/json","application/vnd.google-apps.folder"]}},required:["name"],additionalProperties:false},annotations:WRITE_ANNOTATIONS},
  {name:"light_drive_update",description:"Content updates are not implemented; returns LIGHT_DRIVE_OPERATION_NOT_IMPLEMENTED. Tool name retained for compatibility; do not claim an edit occurred.",inputSchema:{type:"object",properties:{file_id:{type:"string"},text:{type:"string",maxLength:60000}},required:["file_id","text"],additionalProperties:false},annotations:WRITE_ANNOTATIONS},
  {name:"light_drive_rename",description:"Rename a Google Drive file or folder. Do not call unless the user requests the change.",inputSchema:{type:"object",properties:{file_id:{type:"string"},name:{type:"string",minLength:1,maxLength:180}},required:["file_id","name"],additionalProperties:false},annotations:WRITE_ANNOTATIONS},
  {name:"light_drive_move",description:"Move is not implemented; returns LIGHT_DRIVE_OPERATION_NOT_IMPLEMENTED. Tool name retained for compatibility; do not claim a move occurred.",inputSchema:{type:"object",properties:{file_id:{type:"string"},folder_id:{type:"string"}},required:["file_id","folder_id"],additionalProperties:false},annotations:WRITE_ANNOTATIONS},
  {name:"light_drive_copy",description:"Copy a Google Drive file. Do not call unless the user requests a copy.",inputSchema:{type:"object",properties:{file_id:{type:"string"},name:{type:"string",minLength:1,maxLength:180},folder_id:{type:"string"}},required:["file_id"],additionalProperties:false},annotations:WRITE_ANNOTATIONS},
  {name:"light_drive_share",description:"Sharing is not implemented; returns LIGHT_DRIVE_OPERATION_NOT_IMPLEMENTED. Tool name retained for compatibility; do not claim permissions changed.",inputSchema:{type:"object",properties:{file_id:{type:"string"},type:{type:"string",enum:["user","group","domain","anyone"]},role:{type:"string",enum:["reader","commenter","writer"]},email_address:{type:"string"},domain:{type:"string"},send_notification_email:{type:"boolean"}},required:["file_id","type","role"],additionalProperties:false},annotations:WRITE_ANNOTATIONS},
  {name:"light_drive_permission_update",description:"Permission updates are not implemented; returns LIGHT_DRIVE_OPERATION_NOT_IMPLEMENTED. Tool name retained for compatibility; do not claim permissions changed.",inputSchema:{type:"object",properties:{file_id:{type:"string"},permission_id:{type:"string"},role:{type:"string",enum:["reader","commenter","writer"]},allow_file_discovery:{type:"boolean"}},required:["file_id","permission_id"],additionalProperties:false},annotations:WRITE_ANNOTATIONS},
]);
const names=new Set(LIGHT_DRIVE_TOOLS.map(x=>x.name));
const WRITE_NAMES=new Set(["light_drive_create","light_drive_update","light_drive_rename","light_drive_move","light_drive_copy","light_drive_share","light_drive_permission_update"]);
const safeId=v=>typeof v==="string"&&/^[a-zA-Z0-9_-]{12,100}$/.test(v);
const safeFolderId=v=>v==="root"||safeId(v);
const only=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
export function isLightDriveTool(name){return names.has(name);}
export async function runLightDriveTool(name,args={},env={}){
  if(!isLightDriveTool(name))throw Error("UNKNOWN_DRIVE_TOOL");
  const fields={light_drive_roots:[],light_drive_list:["folder_id","query","limit","page_token"],light_drive_file:["file_id","entry"],light_drive_permissions:["file_id","page_token"],
    light_drive_create:["folder_id","name","text","mime_type"],light_drive_update:["file_id","text"],light_drive_rename:["file_id","name"],light_drive_move:["file_id","folder_id"],
    light_drive_copy:["file_id","name","folder_id"],light_drive_share:["file_id","type","role","email_address","domain","send_notification_email"],light_drive_permission_update:["file_id","permission_id","role","allow_file_discovery"]}[name];
  if(!only(args,fields))throw Error("INVALID_INPUT");
  if(name==="light_drive_list"&&((args.folder_id!==undefined&&!safeFolderId(args.folder_id))||(args.query!==undefined&&(typeof args.query!=="string"||args.query.length>80))||(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>30))||(args.page_token!==undefined&&(typeof args.page_token!=="string"||args.page_token.length>2048))))throw Error("INVALID_INPUT");
  if(name==="light_drive_file"&&(!safeId(args.file_id)||(args.entry!==undefined&&(typeof args.entry!=="string"||args.entry.length>240||args.entry.includes("..")||args.entry.startsWith("/")))))throw Error("INVALID_INPUT");
  if(name==="light_drive_permissions"&&(!safeId(args.file_id)||(args.page_token!==undefined&&(typeof args.page_token!=="string"||args.page_token.length>2048))))throw Error("INVALID_INPUT");
  if(["light_drive_update","light_drive_rename","light_drive_move","light_drive_copy","light_drive_share","light_drive_permission_update"].includes(name)&&!safeId(args.file_id))throw Error("INVALID_INPUT");
  if(["light_drive_move"].includes(name)&&!safeFolderId(args.folder_id))throw Error("INVALID_INPUT");
  if(["light_drive_create"].includes(name)&&((args.folder_id!==undefined&&!safeFolderId(args.folder_id))||typeof args.name!=="string"||!args.name.trim()||args.name.length>180||(args.text!==undefined&&(typeof args.text!=="string"||new TextEncoder().encode(args.text).length>60000))))throw Error("INVALID_INPUT");
  if(name==="light_drive_update"&&(typeof args.text!=="string"||new TextEncoder().encode(args.text).length>60000))throw Error("INVALID_INPUT");
  if(name==="light_drive_rename"&&(typeof args.name!=="string"||!args.name.trim()||args.name.length>180))throw Error("INVALID_INPUT");
  if(name==="light_drive_copy"&&((args.name!==undefined&&(typeof args.name!=="string"||!args.name.trim()||args.name.length>180))||(args.folder_id!==undefined&&!safeFolderId(args.folder_id))))throw Error("INVALID_INPUT");
  if(name==="light_drive_share"&&(!["user","group","domain","anyone"].includes(args.type)||!["reader","commenter","writer"].includes(args.role)||(["user","group"].includes(args.type)&&typeof args.email_address!=="string")||(args.type==="domain"&&typeof args.domain!=="string")||(args.send_notification_email!==undefined&&typeof args.send_notification_email!=="boolean")))throw Error("INVALID_INPUT");
  if(name==="light_drive_permission_update"&&((typeof args.permission_id!=="string"||!/^[a-zA-Z0-9_-]{1,200}$/.test(args.permission_id))||(args.role!==undefined&&!["reader","commenter","writer"].includes(args.role))||(args.allow_file_discovery!==undefined&&typeof args.allow_file_discovery!=="boolean")||(args.role===undefined&&args.allow_file_discovery===undefined)))throw Error("INVALID_INPUT");
  const q=(values)=>new URLSearchParams(values).toString();
  const f=(id)=>"/files/"+encodeURIComponent(id);
  const fileFields="fields=id,name,mimeType,parents,size,webViewLink";
  if(name==="light_drive_roots")return lightDriveRequest(env,"/files?"+q({q:"'root' in parents and trashed = false",fields:"nextPageToken,files(id,name,mimeType)"}));
  if(name==="light_drive_list"){
    const filters=["trashed = false"];
    if(args.folder_id)filters.push("'"+args.folder_id+"' in parents");
    if(args.query)filters.push("name contains '"+args.query.replaceAll("'","\\'")+"'");
    return lightDriveRequest(env,"/files?"+q({q:filters.join(" and "),fields:"nextPageToken,files(id,name,mimeType,parents,size,webViewLink)",pageSize:String(args.limit||30),...(args.page_token?{pageToken:args.page_token}:{})}));
  }
  if(name==="light_drive_permissions")return lightDriveRequest(env,f(args.file_id)+"/permissions?"+q({fields:"nextPageToken,permissions(id,type,role,emailAddress,domain)",...(args.page_token?{pageToken:args.page_token}:{})}));
  if(name==="light_drive_file"){
    const metadata=await lightDriveRequest(env,f(args.file_id)+"?"+fileFields+",version,modifiedTime");
    if(!metadata.ok)return metadata;
    const file=metadata.result;
    const readText=async(bytes,entry)=>{
      const body=new TextDecoder("utf-8",{fatal:true}).decode(bytes),text=boundedText(body,60000);
      const revision=typeof file.version==="string"&&/^\d{1,30}$/.test(file.version)?{kind:"drive_version",value:file.version,binding:"metadata_only"}:null;
      const evidence=await documentEvidence({provider:"drive",resource:[args.file_id,entry||null],text,total:body.length,revision});
      return {ok:true,result:{file,...(entry?{entry}:{}),text,truncated:text.length<body.length,evidence}};
    };
    const zip=file.mimeType==="application/zip"||/\\.zip$/i.test(file.name||"");
    const textFile=(file.mimeType||"").startsWith("text/")||["application/json","application/javascript","application/xml","application/x-sh","application/x-yaml"].includes(file.mimeType)||["js","ts","tsx","jsx","py","go","rs","md","txt","json","yaml","yml","toml","html","css","sh","sql","xml"].includes((file.name||"").split(".").pop().toLowerCase());
    if(!zip&&!textFile)return {ok:false,status:"LIGHT_DRIVE_UNSUPPORTED_FILE_TYPE",file};
    const download=await lightDriveDownload(env,args.file_id);
    if(!download.ok)return download;
    if(zip){
      let entries;try{
        let total=0;let count=0;
        entries=unzipSync(download.bytes,{filter:e=>{
          count++;if(count>500||e.originalSize>1048576||total+e.originalSize>4194304)throw Error("LIGHT_DRIVE_ZIP_LIMIT");
          total+=e.originalSize;return args.entry?e.name===args.entry:false;
        }});
      }catch{return {ok:false,status:"LIGHT_DRIVE_INVALID_OR_OVERSIZED_ZIP"};}
      if(!args.entry){
        // List entries from ZIP central directory without decompressing payloads.
        const view=new DataView(download.bytes.buffer,download.bytes.byteOffset,download.bytes.byteLength);
        const names=[];let offset=0;
        while(offset+46<=download.bytes.length){
          if(view.getUint32(offset,true)===0x02014b50){
            const n=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true);
            if(offset+46+n+extra+comment>download.bytes.length)break;
            names.push(new TextDecoder().decode(download.bytes.subarray(offset+46,offset+46+n)));
            if(names.length>500)return {ok:false,status:"LIGHT_DRIVE_ZIP_LIMIT"};
            offset+=46+n+extra+comment;
          }else offset++;
        }
        return {ok:true,result:{file,entries:names,entry_count:names.length}};
      }
      const bytes=entries[args.entry];if(!bytes)return {ok:false,status:"LIGHT_DRIVE_ENTRY_NOT_FOUND"};
      if(!/\.(js|ts|tsx|jsx|py|go|rs|md|txt|json|yaml|yml|toml|html|css|sh|sql|xml)$/i.test(args.entry))return {ok:false,status:"LIGHT_DRIVE_UNSUPPORTED_ENTRY_TYPE"};
      if(bytes.includes(0))return {ok:false,status:"LIGHT_DRIVE_BINARY_ENTRY"};
      try{return await readText(bytes,args.entry);}catch{return {ok:false,status:"LIGHT_DRIVE_NOT_UTF8"};}
    }
    if(args.entry)return {ok:false,status:"LIGHT_DRIVE_NOT_ZIP"};
    if(download.bytes.includes(0))return {ok:false,status:"LIGHT_DRIVE_BINARY_FILE"};
    try{return await readText(download.bytes);}
    catch{return {ok:false,status:"LIGHT_DRIVE_NOT_UTF8"};}
  }
  if(name==="light_drive_rename")return lightDriveRequest(env,f(args.file_id)+"?"+fileFields,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({name:args.name})});
  if(name==="light_drive_copy")return lightDriveRequest(env,f(args.file_id)+"/copy?"+fileFields,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...(args.name?{name:args.name}:{}),...(args.folder_id?{parents:[args.folder_id]}:{})})});
  if(name==="light_drive_create"&&args.text===undefined)return lightDriveRequest(env,"/files?"+fileFields,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:args.name,mimeType:args.mime_type||"text/plain",...(args.folder_id?{parents:[args.folder_id]}:{})})});
  throw Error("LIGHT_DRIVE_OPERATION_NOT_IMPLEMENTED");
}
