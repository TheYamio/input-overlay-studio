// Bind identity and a reachable local client address are deliberately distinct.
export const bindHost=(host:string)=>host.startsWith('[')&&host.endsWith(']')?host.slice(1,-1):host;
export const clientHost=(host:string)=>{const bare=bindHost(host);return bare==='0.0.0.0'?'127.0.0.1':bare==='::'?'::1':bare;};
export function validBindHost(host:string){
 const bare=bindHost(host);if(!host||host.length>253)return false;
 if(bare.includes(':')){try{return !bare.includes('%')&&new URL(`http://[${bare}]/`).hostname.length>2;}catch{return false;}}
 if(host!==bare)return false;
 if(/^[0-9.]+$/.test(host))return host.split('.').length===4&&host.split('.').every(part=>/^(?:0|[1-9][0-9]{0,2})$/.test(part)&&Number(part)<=255);
 const domain=host.endsWith('.')?host.slice(0,-1):host;
 return domain.split('.').every(part=>/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(part));
}
export function localEndpoint(protocol:'http'|'ws',host:string,port:number,path=''){
 if(!validBindHost(host)||!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid local endpoint.');
 const client=clientHost(host);return `${protocol}://${client.includes(':')?'['+client+']':client}:${port}${path}`;
}
