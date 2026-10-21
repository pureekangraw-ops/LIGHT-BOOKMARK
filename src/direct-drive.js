// LIGHT-owned Drive API: never expose credentials to MCP callers.
export const DIRECT_DRIVE_API="https://www.googleapis.com/drive/v3";
export const DIRECT_DRIVE_OPERATIONS=Object.freeze(["list","read","create","update","rename","move","copy","share"]);
export async function lightDriveAccessToken(env){
 if(!env.LIGHT_GOOGLE_CLIENT_ID||!env.LIGHT_GOOGLE_CLIENT_SECRET||!env.LIGHT_GOOGLE_REFRESH_TOKEN) throw Error("LIGHT_DRIVE_NOT_CONFIGURED");
 const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.LIGHT_GOOGLE_CLIENT_ID,client_secret:env.LIGHT_GOOGLE_CLIENT_SECRET,refresh_token:env.LIGHT_GOOGLE_REFRESH_TOKEN,grant_type:"refresh_token"})});
 if(!response.ok) throw Error("LIGHT_DRIVE_AUTH_FAILED");
 const data=await response.json();
 if(!data.access_token) throw Error("LIGHT_DRIVE_AUTH_FAILED");
 return data.access_token;
}
export async function lightDriveRequest(env,path,options={}){
 const token=await lightDriveAccessToken(env);
 const response=await fetch(DIRECT_DRIVE_API+path,{...options,headers:{authorization:"Bearer "+token,...options.headers}});
 if(!response.ok) return {ok:false,status:response.status===403?"LIGHT_DRIVE_PERMISSION_DENIED":"LIGHT_DRIVE_UPSTREAM_ERROR",upstream_status:response.status};
 return {ok:true,result:await response.json()};
}
