import type {LocalePack} from './registry';

// Upgrade only installed v4 locale resources. Stable IDs keep pure decoding and
// revision comparisons deterministic; new file imports always allocate random UUIDs.
export function isolateDocumentLanguages<T extends {languagePacks:LocalePack[];profiles:{locale:string;localePackageId?:string}[]}>(value:T):T{
 if(!value.languagePacks.some(p=>!p.id))return value;
 const used=new Set(value.languagePacks.flatMap(p=>p.id?[p.id]:[])),byLocale=new Map<string,string>();
 const languagePacks=value.languagePacks.map(pack=>{
  if(pack.id)return pack;
  const canonical=JSON.stringify({...pack,namespaces:Object.fromEntries(Object.entries(pack.namespaces).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([ns,entries])=>[ns,Object.fromEntries(Object.entries(entries).sort(([a],[b])=>a<b?-1:a>b?1:0))]))});
  let id='',salt=0;
  do{const hashes=[2166136261,3335557771,1234567891,987654323],text=canonical+salt++;for(let i=0;i<text.length;i++)for(let j=0;j<hashes.length;j++)hashes[j]=Math.imul(hashes[j]^text.charCodeAt(i),16777619);const hex=hashes.map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');id=`${hex.slice(0,8)}-${hex.slice(8,12)}-8${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20)}`;}while(used.has(id));
  used.add(id);byLocale.set(pack.locale.toLowerCase(),id);return {...pack,id,origin:'custom' as const};
 });
 return {...value,languagePacks,profiles:value.profiles.map(p=>p.localePackageId?p:byLocale.has(p.locale.toLowerCase())?{...p,localePackageId:byLocale.get(p.locale.toLowerCase())}:p)};
}
