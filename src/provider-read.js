import {documentEvidence,boundedText} from "./document-evidence.js";
// Read-only connectors for LIGHT. No provider credential is shared with GO Brain.
// All upstream origins are fixed; repositories, projects, and scripts are allowlisted.
const MAX_TEXT = 30000;
const MAX_BODY = 120000;
const schemas = [
  { name:"light_connections_status", description:"Inspect local connection configuration only, not live provider access. Reports missing configuration names without exposing secrets or testing credentials.", inputSchema:{type:"object",properties:{},additionalProperties:false} },
  { name:"light_github_repo", description:"Read a GitHub repository's basic metadata. Repository must be explicitly allowlisted for LIGHT.", inputSchema:{type:"object",properties:{repo:{type:"string"}},required:["repo"],additionalProperties:false} },
  { name:"light_github_file", description:"Read one UTF-8 GitHub source file from an allowlisted repository. Returns at most 30,000 UTF-16 units of text; never executes code.", inputSchema:{type:"object",properties:{repo:{type:"string"},path:{type:"string"},ref:{type:"string"}},required:["repo","path"],additionalProperties:false} },
  { name:"light_gitlab_project", description:"Read a GitLab project's basic metadata. Project must be explicitly allowlisted for LIGHT.", inputSchema:{type:"object",properties:{project:{type:"string"}},required:["project"],additionalProperties:false} },
  { name:"light_gitlab_file", description:"Read one UTF-8 GitLab file from an allowlisted project. Returns at most 30,000 UTF-16 units of text.", inputSchema:{type:"object",properties:{project:{type:"string"},path:{type:"string"},ref:{type:"string"}},required:["project","path"],additionalProperties:false} },
  { name:"light_cloudflare_worker", description:"Read deployment IDs, version IDs and timestamps for one allowlisted Cloudflare Worker. No secrets, bindings or source code.", inputSchema:{type:"object",properties:{script:{type:"string"}},required:["script"],additionalProperties:false} },
];
export const PROVIDER_TOOLS = Object.freeze(schemas.map(t=>({...t,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}})));
const TOOL_NAMES = new Set(schemas.map(x=>x.name));
export function isProviderTool(name){return TOOL_NAMES.has(name);}
const list = value => new Set(String(value||"").split(",").map(x=>x.trim()).filter(Boolean));
const only = (a,fields) => a && typeof a==="object" && !Array.isArray(a) && Object.keys(a).every(k=>fields.includes(k));
const id = (v) => typeof v==="string" && v.length<=130 && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v) && !v.includes("..");
const pathOK = p => typeof p==="string" && p.length>0 && p.length<=256 &&
  /^[A-Za-z0-9_.\/-]+$/.test(p) && p.split("/").every(x=>x && x!=="." && x!=="..") &&
  !/(^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519|secrets?)(?:\/|$)/i.test(p) &&
  !/\.(?:pem|key|p12|pfx)$/i.test(p);
const refOK = r => r===undefined || (typeof r==="string" && r.length<=100 && /^[A-Za-z0-9_.\/-]+$/.test(r) && r.split("/").every(x=>x && x!=="." && x!==".."));
const safeScript = s => typeof s==="string" && /^[A-Za-z0-9_-]{1,80}$/.test(s);
function allow(value,provided){if(!provided || !list(provided).has(value))throw Error("RESOURCE_NOT_ALLOWLISTED");}
function need(cond,msg){if(!cond)throw Error(msg);}
function auth(token){return token?{Authorization:"Bearer "+token}:{};}
async function requestData(url,headers,asText=false,fetcher=fetch){
  let response;
  try {response=await fetcher(url,{method:"GET",headers,redirect:"manual",signal:AbortSignal.timeout(8000)});}
  catch {throw Error("UPSTREAM_UNAVAILABLE");}
  // Workers does not implement redirect:"error". Never follow credential-bearing
  // requests, and reject every 3xx before reading a body or Location header.
  if(response.status>=300&&response.status<400)throw Error("UPSTREAM_REDIRECT_REJECTED");
  if(!response.ok)throw Error("UPSTREAM_HTTP_"+response.status);
  if(Number(response.headers.get("content-length")||0)>MAX_BODY)throw Error("UPSTREAM_TOO_LARGE");
  let body;
  if(asText){
    let bytes;try{bytes=await response.arrayBuffer();}catch{throw Error("UPSTREAM_UNREADABLE");}
    if(bytes.byteLength>MAX_BODY)throw Error("UPSTREAM_TOO_LARGE");
    try{body=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw Error("NOT_UTF8");}
  }else{try {body=await response.text();} catch {throw Error("UPSTREAM_UNREADABLE");}}
  if(body.length>MAX_BODY)throw Error("UPSTREAM_TOO_LARGE");
  if(asText)return body;
  try{return JSON.parse(body);}catch {throw Error("UPSTREAM_NOT_JSON");}
}
const fileArgs = (a,key,envList) => {
  need(only(a,[key,"path","ref"]) && id(a[key]) && pathOK(a.path) && refOK(a.ref),"INVALID_INPUT");
  allow(a[key],envList);
};
const repoArgs = (a,key,envList) => {
  need(only(a,[key]) && id(a[key]),"INVALID_INPUT");allow(a[key],envList);
};
function configuration(required,invalid=[]){
  const missing=required.filter(([,present])=>!present).map(([name])=>name);
  const configured=missing.length===0&&invalid.length===0;
  return {ready:configured,configured,status:invalid.length?"invalid_configuration":configured?"configured_unverified":"not_configured",missing_configuration:missing,...(invalid.length?{invalid_configuration:invalid}:{})};
}
function status(env){
  return {read_only:true,configuration_only:true,live_access_verified:false,
    note:"ready/configured describe local configuration only, not verified provider access. write_actions describes this status tool, not other tools.",
    github:{...configuration([["LIGHT_GITHUB_REPOS",list(env.LIGHT_GITHUB_REPOS).size]]),mode:env.LIGHT_GITHUB_READ_TOKEN?"token":"public_only"},
    gitlab:{...configuration([["LIGHT_GITLAB_PROJECTS",list(env.LIGHT_GITLAB_PROJECTS).size]]),mode:env.LIGHT_GITLAB_READ_TOKEN?"token":"public_only",private_project_route:"PANTHEON_LIGHT_TASK"},
    cloudflare:{...configuration([["LIGHT_CF_READ_TOKEN",env.LIGHT_CF_READ_TOKEN],["LIGHT_CF_ACCOUNT_ID",env.LIGHT_CF_ACCOUNT_ID],["LIGHT_CF_WORKERS",list(env.LIGHT_CF_WORKERS).size]],env.LIGHT_CF_ACCOUNT_ID&&!/^[a-f0-9]{32}$/i.test(env.LIGHT_CF_ACCOUNT_ID)?["LIGHT_CF_ACCOUNT_ID"]:[])},
    drive:{...configuration([["LIGHT_GOOGLE_CLIENT_ID",env.LIGHT_GOOGLE_CLIENT_ID],["LIGHT_GOOGLE_CLIENT_SECRET",env.LIGHT_GOOGLE_CLIENT_SECRET],["LIGHT_GOOGLE_REFRESH_TOKEN or GOOGLE_REFRESH_TOKEN",env.LIGHT_GOOGLE_REFRESH_TOKEN||env.GOOGLE_REFRESH_TOKEN]]),mode:"LIGHT_DIRECT_GOOGLE_OAUTH",note:"Local configuration only; live API access, OAuth scopes and file permissions must be tested separately."},
    pantheon:{mode:"LIGHT_TASK_PREPARE"},write_actions:false};
}
export async function runProviderTool(name,args={},env={},fetcher=fetch){
  need(isProviderTool(name),"UNKNOWN_PROVIDER_TOOL");
  if(name==="light_connections_status"){need(only(args,[]),"INVALID_INPUT");return status(env);}
  if(name==="light_github_repo"){
    repoArgs(args,"repo",env.LIGHT_GITHUB_REPOS);
    const data=await requestData("https://api.github.com/repos/"+args.repo,
      {"Accept":"application/vnd.github+json","User-Agent":"LIGHT-Bookmark",...auth(env.LIGHT_GITHUB_READ_TOKEN)},false,fetcher);
    return {source:"github",repo:data.full_name,description:data.description||"",private:!!data.private,default_branch:data.default_branch,url:data.html_url,updated_at:data.updated_at};
  }
  if(name==="light_github_file"){
    fileArgs(args,"repo",env.LIGHT_GITHUB_REPOS);
    const suffix=args.path.split("/").map(encodeURIComponent).join("/");
    const url="https://api.github.com/repos/"+args.repo+"/contents/"+suffix+(args.ref?"?ref="+encodeURIComponent(args.ref):"");
    const data=await requestData(url,{"Accept":"application/vnd.github+json","User-Agent":"LIGHT-Bookmark",...auth(env.LIGHT_GITHUB_READ_TOKEN)},false,fetcher);
    need(data.type==="file"&&data.encoding==="base64"&&typeof data.content==="string","NOT_A_TEXT_FILE");
    need(data.content.length<=MAX_BODY,"UPSTREAM_TOO_LARGE");
    let body;try{body=new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(atob(data.content.replace(/\s/g,"")),c=>c.charCodeAt(0)));}
    catch{throw Error("NOT_UTF8");}
    const text=boundedText(body,MAX_TEXT);
    const evidence=await documentEvidence({provider:"github",resource:[args.repo,args.path],requestedRef:args.ref||null,text,total:body.length,
      revision:typeof data.sha==="string"&&/^[a-f0-9]{40,64}$/i.test(data.sha)?{kind:"git_blob_sha",value:data.sha,binding:"content"}:null});
    return {source:"github",repo:args.repo,path:args.path,ref:args.ref||null,sha:data.sha||null,text,truncated:text.length<body.length,evidence};
  }
  if(name==="light_gitlab_project"){
    repoArgs(args,"project",env.LIGHT_GITLAB_PROJECTS);
    let data;
    try {data=await requestData("https://gitlab.com/api/v4/projects/"+encodeURIComponent(args.project),
      {"Accept":"application/json",...auth(env.LIGHT_GITLAB_READ_TOKEN)},false,fetcher);}
    catch(error){if(!env.LIGHT_GITLAB_READ_TOKEN && ["UPSTREAM_HTTP_401","UPSTREAM_HTTP_403","UPSTREAM_HTTP_404"].includes(error.message))return {ok:false,status:"PRIVATE_PROJECT_REQUIRES_AUTHORIZED_ROUTE",project:args.project,route:"light_pantheon_create_task",message:"Request an authorized inspection via PANTHEON; never make the project public."};throw error;}
    return {source:"gitlab",project:data.path_with_namespace,description:data.description||"",visibility:data.visibility,default_branch:data.default_branch,url:data.web_url,last_activity_at:data.last_activity_at};
  }
  if(name==="light_gitlab_file"){
    fileArgs(args,"project",env.LIGHT_GITLAB_PROJECTS);
    const url="https://gitlab.com/api/v4/projects/"+encodeURIComponent(args.project)+"/repository/files/"+encodeURIComponent(args.path)+"/raw?ref="+encodeURIComponent(args.ref||"main");
    let body;
    try{body=await requestData(url,{"Accept":"text/plain",...auth(env.LIGHT_GITLAB_READ_TOKEN)},true,fetcher);}
    catch(error){if(!env.LIGHT_GITLAB_READ_TOKEN && ["UPSTREAM_HTTP_401","UPSTREAM_HTTP_403","UPSTREAM_HTTP_404"].includes(error.message))return {ok:false,status:"PRIVATE_FILE_REQUIRES_AUTHORIZED_ROUTE",project:args.project,path:args.path,route:"light_pantheon_create_task",message:"Request authorized file inspection via PANTHEON; never make the project public."};throw error;}
    const text=boundedText(body,MAX_TEXT);
    const evidence=await documentEvidence({provider:"gitlab",resource:[args.project,args.path],requestedRef:args.ref||"main",text,total:body.length});
    return {source:"gitlab",project:args.project,path:args.path,ref:args.ref||"main",text,truncated:text.length<body.length,evidence};
  }
  if(name==="light_cloudflare_worker"){
    need(only(args,["script"])&&safeScript(args.script),"INVALID_INPUT");
    allow(args.script,env.LIGHT_CF_WORKERS);
    need(env.LIGHT_CF_READ_TOKEN&&/^[a-f0-9]{32}$/i.test(env.LIGHT_CF_ACCOUNT_ID||""),"CLOUDFLARE_READ_CONNECTION_NOT_CONFIGURED");
    const data=await requestData("https://api.cloudflare.com/client/v4/accounts/"+env.LIGHT_CF_ACCOUNT_ID+
      "/workers/scripts/"+encodeURIComponent(args.script)+"/deployments?per_page=5",
      {"Accept":"application/json",...auth(env.LIGHT_CF_READ_TOKEN)},false,fetcher);
    need(data.success===true&&Array.isArray(data.result?.deployments),"UPSTREAM_INVALID_RESULT");
    return {source:"cloudflare",script:args.script,deployments:data.result.deployments.slice(0,5).map(d=>({
      id:d.id,created_on:d.created_on,source:d.source,versions:(d.versions||[]).map(v=>({version_id:v.version_id,percentage:v.percentage}))
    }))};
  }
  throw Error("UNKNOWN_PROVIDER_TOOL");
}
