// Observational evidence only: no storage, provider calls, credentials, or authority.
export async function documentEvidence({provider,resource,requestedRef=null,text,total,revision=null}) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return {schema:'light.document-observation.v1',provider,resource,requested_ref:requestedRef,
    observed_at:new Date().toISOString(),revision,
    content_sha256:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join(''),
    coverage:{complete:text.length===total,returned_utf16_units:text.length,total_utf16_units:total},
  };
}
// Preserve the existing UTF-16 output cap without cutting a surrogate pair.
export function boundedText(text,limit) {
  let end=Math.min(text.length,limit);
  if(end<text.length&&end>0&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
  return text.slice(0,end);
}

const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const short=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max&&!/[\u0000-\u001f]/.test(x);
function validObservation(x){
  if(!exact(x,['schema','provider','resource','requested_ref','observed_at','revision','content_sha256','coverage'])||x.schema!=='light.document-observation.v1')return false;
  if(!['github','gitlab','drive'].includes(x.provider)||!Array.isArray(x.resource)||x.resource.length!==2||!short(x.resource[0],130))return false;
  if(!(short(x.resource[1],256)||(x.provider==='drive'&&x.resource[1]===null)))return false;
  if(!(x.requested_ref===null||short(x.requested_ref,100))||!short(x.observed_at,32)||!/^\d{4}-\d\d-\d\dT.*Z$/.test(x.observed_at)||!Number.isFinite(Date.parse(x.observed_at)))return false;
  if(typeof x.content_sha256!=='string'||!/^[a-f0-9]{64}$/.test(x.content_sha256))return false;
  const c=x.coverage;
  if(!exact(c,['complete','returned_utf16_units','total_utf16_units'])||typeof c.complete!=='boolean'||!Number.isSafeInteger(c.returned_utf16_units)||!Number.isSafeInteger(c.total_utf16_units)||c.returned_utf16_units<0||c.total_utf16_units<c.returned_utf16_units||c.returned_utf16_units>(x.provider==='drive'?60000:30000)||c.total_utf16_units>4194304||c.complete!==(c.total_utf16_units===c.returned_utf16_units))return false;
  const r=x.revision;
  if(r===null)return true;
  if(!exact(r,['kind','value','binding']))return false;
  return (x.provider==='github'&&r.kind==='git_blob_sha'&&r.binding==='content'&&typeof r.value==='string'&&/^[a-f0-9]{40,64}$/i.test(r.value))||
    (x.provider==='drive'&&r.kind==='drive_version'&&r.binding==='metadata_only'&&typeof r.value==='string'&&/^\d{1,30}$/.test(r.value));
}
export function compareDocumentEvidence(args){
  const result={status:'incomparable',content_status:'unknown',revision_status:'unknown',authenticity_verified:false,
    basis:'Caller-supplied observations only; no live read, signature verification, semantic analysis, or historical authenticity verification.'};
  if(!exact(args,['before','after'])||!validObservation(args.before)||!validObservation(args.after))return {...result,reason:'invalid_or_missing_observation'};
  const {before:a,after:b}=args;
  if(a.provider!==b.provider||JSON.stringify(a.resource)!==JSON.stringify(b.resource)||a.requested_ref!==b.requested_ref)return {...result,reason:'different_resource_or_ref'};
  if(!a.coverage.complete||!b.coverage.complete)return {...result,status:'incomplete',reason:'partial_content'};
  const content=a.content_sha256===b.content_sha256?'unchanged':'changed';
  const revision=a.revision&&b.revision&&a.revision.kind===b.revision.kind&&a.revision.binding===b.revision.binding?
    (a.revision.value===b.revision.value?'unchanged':'changed'):'unknown';
  if((content==='unchanged'&&a.coverage.total_utf16_units!==b.coverage.total_utf16_units)||(content==='changed'&&revision==='unchanged'&&a.revision.binding==='content'))return {...result,reason:'conflicting_observations'};
  return {...result,status:content==='changed'||revision==='changed'?'changed':'unchanged',content_status:content,revision_status:revision,
    revision_binding:a.revision?.binding===b.revision?.binding?a.revision?.binding||null:null,
    reason:'complete_supplied_content_fingerprints_compared'};
}
export const DOCUMENT_EVIDENCE_TOOLS=Object.freeze([{
  name:'light_document_compare',description:'Compare two caller-supplied evidence objects from supported file reads. No network, storage, authenticity verification, or semantic conflict detection. Partial or mismatched observations cannot prove equality. Drive revisions describe metadata only, not the downloaded body.',
  inputSchema:{type:'object',properties:{before:{type:'object',description:'The evidence object from the earlier file read.'},after:{type:'object',description:'The evidence object from the later file read.'}},required:['before','after'],additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true},
}]);
