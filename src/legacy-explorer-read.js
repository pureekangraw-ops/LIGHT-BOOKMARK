// Single-purpose internal Service Binding read for GO Hub recovery.
// No public route, secrets, user content, or write method is exposed.
import { runNotionTool } from "./notion-read.js";
import { runProviderTool } from "./provider-read.js";
import { runLightDriveTool } from "./drive-bridge.js";

const RESULT_BASE = Object.freeze({
  readOnly:true, privateDataReturned:false, service:"LIGHT_LEGACY_READER",
  mutationAllowed:false
});
const normalizeError = e => {
  const permitted = new Set([
    "LIGHT_DRIVE_NOT_CONFIGURED", "LIGHT_DRIVE_AUTH_FAILED",
    "CLOUDFLARE_READ_CONNECTION_NOT_CONFIGURED",
    "NOTION_NOT_CONFIGURED", "UPSTREAM_UNAVAILABLE",
    "RESOURCE_NOT_ALLOWLISTED"
  ]);
  return permitted.has(e?.message) ? e.message : "UPSTREAM_UNAVAILABLE";
};
export function createLegacyCapabilityProbe({
  notion=runNotionTool,
  provider=runProviderTool,
  drive=runLightDriveTool
}={}) {
  return async function legacyCapabilityProbe(capability, env={}) {
    if(!["notion","cloudflare","google"].includes(capability))
      return {...RESULT_BASE, capability:"unknown", status:"UNSUPPORTED_CAPABILITY",connected:false};
    try {
      if(capability==="notion"){
        const result=await notion("light_notion_search",{},env);
        const connected=result?.status==="ok";
        return {...RESULT_BASE,capability,status:connected?"CONNECTED":String(result?.status||"UNVERIFIED").slice(0,40),
          connected,provider:"NOTION_REST_MANIFEST",notionAiEnabled:false};
      }
      if(capability==="cloudflare"){
        // Legacy deployments used these secret names. Alias in request memory
        // only; neither token nor account ID is returned to the caller.
        const local={
          LIGHT_CF_READ_TOKEN:env.LIGHT_CF_READ_TOKEN||env.CLOUDFARE_TOKEN,
          LIGHT_CF_ACCOUNT_ID:env.LIGHT_CF_ACCOUNT_ID||env.CLOUDFAIR_ID,
          LIGHT_CF_WORKERS:env.LIGHT_CF_WORKERS
        };
        const result=await provider("light_cloudflare_worker",{script:"light-bookmark"},local);
        const connected=result?.source==="cloudflare";
        return {...RESULT_BASE,capability,status:connected?"CONNECTED":"UNVERIFIED",connected,
          provider:"LIGHT_CLOUDFLARE_READ",script:"light-bookmark"};
      }
      const result=await drive("light_drive_roots",{},env);
      const connected=result?.ok===true;
      return {...RESULT_BASE,capability,status:connected?"CONNECTED":String(result?.status||"UNVERIFIED").slice(0,40),
        connected,provider:"LIGHT_GOOGLE_DRIVE_READ"};
    } catch(e) {
      return {...RESULT_BASE,capability,status:normalizeError(e),connected:false};
    }
  };
}
export const legacyCapabilityProbe = createLegacyCapabilityProbe();
