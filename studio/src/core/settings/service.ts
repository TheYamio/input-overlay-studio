import { moduleKind } from '../module-envelope';
import { commonFields } from '../module-format';
import { documentSchema, type StudioDocument } from '../config';
import { pruneAssets } from '../skins';
import type { ConnectionOptions, ConnectionState } from '../connection';
import type { SyncMetadata } from '../storage';
import { builtinCatalog } from '../architecture/builtins';
import type { Catalog, DefinitionId, Scope, SettingsAddress } from '../architecture/contracts';
import { immutable, SettingsError, SettingsEvents, type SettingsChange } from './events';
import type { PreservedConfiguration } from '../compatibility/preserved';

export interface DocumentStorage {
  load(): {document:StudioDocument;warning:string;sync?:SyncMetadata;unsupported?:PreservedConfiguration};
  save(document:StudioDocument,metadata:SyncMetadata): void;
  backup(): StudioDocument;
}
export interface SettingsTransport {
  onStatus: (status:ConnectionState)=>void;
  onError: (message:string)=>void;
  onDocument: (document:StudioDocument|null,revision?:string)=>void;
  onConflict: (document:StudioDocument|null,revision?:string)=>void;
  onRecovery: (backup:StudioDocument|null,revision?:string)=>void;
  onSaved: (json:string,revision?:string)=>void;
  onUnsupported?: (source:PreservedConfiguration)=>void;
  connect(options:ConnectionOptions): void;
  stop(): void;
  publish(document:StudioDocument,baseRevision?:string): boolean;
}
export interface SettingsSnapshot {
  readonly document: StudioDocument;
  readonly version: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly protected: boolean;
  readonly pending: boolean;
  readonly conflict: boolean;
  readonly hasRemoteDocument: boolean;
  readonly warning: string;
  readonly saveStatus: string;
  readonly connectionState: ConnectionState;
  readonly unsupported: PreservedConfiguration|null;
}
export interface TransactionOptions {
  source?: string;
  scopes?: readonly Scope[];
  allowOverwrite?: boolean;
}
const documentScopes: readonly Scope[]=['global','game-profile','overlay-profile','module'];
const invalidChange='This change exceeds configuration limits or contains invalid settings. Remove an unused image or export a separate preset.';
type Remote = {document:StudioDocument|null;revision?:string};

export class SettingsService {
  private doc: StudioDocument;
  private json: string;
  private history: StudioDocument[]=[];
  private future: StudioDocument[]=[];
  private gesture: {token:unknown;recorded:boolean;operationId:string}|null=null;
  private inTransaction=false;
  private batchDraft?:StudioDocument;
  private disposed=false;
  private listeners=new Set<()=>void>();
  private view!: SettingsSnapshot;
  private version=0;
  private warning='';
  private saveStatus='Saved locally';
  private connectionState: ConnectionState='Offline';
  private protected=false;
  private unsupported:PreservedConfiguration|null=null;
  private inspectionWarning='';
  private pending=false;
  private initialized=false;
  private baseRevision?:string;
  private baseEndpoint?:string;
  private endpoint:string;
  private remote:Remote|null=null;
  private serverBackup:StudioDocument|null=null;
  private timer?:ReturnType<typeof setTimeout>;
  private epoch=0;
  constructor(private readonly storage:DocumentStorage, private readonly transport:SettingsTransport, endpoint:string, readonly events=new SettingsEvents(), private readonly catalog:Catalog=builtinCatalog) {
    const loaded=storage.load(); this.doc=immutable(documentSchema.parse(loaded.document)); this.json=JSON.stringify(this.doc);
    this.warning=loaded.warning; this.protected=!!loaded.warning;
    this.unsupported=loaded.unsupported ? immutable({...loaded.unsupported}) : null;
    if(this.unsupported)this.saveStatus='Read-only · original preserved';
    this.pending=!this.protected && (loaded.sync?.pending ?? false);
    this.endpoint=endpoint;this.baseRevision=loaded.sync?.baseRevision;this.baseEndpoint=loaded.sync?.endpoint;
    this.publishView();
  }
  get document() { return this.batchDraft ?? this.doc; }
  getSnapshot = () => this.view;
  subscribe = (listener:()=>void) => { this.listeners.add(listener); return ()=>{this.listeners.delete(listener);}; };
  subscribeChanges(scopes:Scope|readonly Scope[],listener:(event:SettingsChange)=>void) { return this.events.subscribe(scopes,listener); }
  private assertWritable() {
    this.events.assertWritable();
    if (this.disposed) throw new SettingsError('disposed','Settings service has been disposed.');
    if (this.inTransaction || this.batchDraft) throw new SettingsError('nested-transaction','Use one draft for the entire logical operation.');
  }
  private publishView() {
    const next:SettingsSnapshot={document:this.doc,version:this.version,canUndo:!this.unsupported&&!!this.history.length,canRedo:!this.unsupported&&!!this.future.length,protected:this.protected||!!this.unsupported,pending:this.pending,conflict:!!this.remote,hasRemoteDocument:!!this.remote?.document,warning:this.warning,saveStatus:this.saveStatus,connectionState:this.connectionState,unsupported:this.unsupported};
    if (this.view && Object.entries(next).every(([key,value])=>Object.is(this.view[key as keyof SettingsSnapshot],value))) return;
    this.view=Object.freeze(next); this.events.notify(this.listeners);
  }
  setWarning(message:string) { this.assertWritable(); this.warning=message; this.publishView(); }
  protect(message:string, expected=this.doc) { this.assertWritable(); if (this.doc===expected) {this.protected=true;this.warning=message;clearTimeout(this.timer);this.publishView();} }
  inspectUnsupported(source:PreservedConfiguration) {
    this.assertWritable();if(this.unsupported)return false;
    if(source.source==='import')this.inspectionWarning=this.warning;
    clearTimeout(this.timer);this.unsupported=immutable({...source});this.warning=source.reason;this.saveStatus='Read-only · original preserved';this.publishView();return true;
  }
  closeUnsupportedImport() {
    this.assertWritable();if(this.unsupported?.source!=='import')return false;
    this.unsupported=null;this.warning=this.inspectionWarning;this.inspectionWarning='';this.initialized=false;this.saveStatus=this.pending?'Saved locally':'Not synchronized';this.publishView();return true;
  }
  beginGesture(token:unknown,restart=false) { this.assertWritable(); if (restart || this.gesture?.token!==token) this.gesture={token,recorded:false,operationId:this.events.operation()}; }
  endGesture() { this.assertWritable(); this.gesture=null; }
  endGestureFor(token:unknown) { if (this.gesture?.token===token) this.endGesture(); }
  private pushHistory() { this.history.push(this.doc); if (this.history.length>60) this.history.shift(); this.future=[]; }
  private notifyChange(operationId:string,source:string,scopes:readonly Scope[]=documentScopes) { this.events.emit({operationId,source,scopes,store:'document'}); }
  private writableDocument() {if(!this.unsupported)return true;this.warning=this.unsupported.reason;this.saveStatus='Read-only · original preserved';this.publishView();return false;}
  transaction(mutate:(draft:StudioDocument)=>void, options:TransactionOptions={}):boolean {
    if(this.unsupported) {this.assertWritable();return this.writableDocument();}
    if(this.batchDraft) {
      this.events.assertWritable();if(this.inTransaction)throw new SettingsError('nested-transaction','Use one draft for the entire logical operation.');
      const next=structuredClone(this.batchDraft);this.inTransaction=true;let result:unknown;
      try {result=mutate(next);} finally {this.inTransaction=false;}
      if(result && typeof(result as {then?:unknown}).then==='function')throw new SettingsError('async-transaction','Decode asynchronous data before starting a settings transaction.');
      this.batchDraft=next;return true;
    }
    this.assertWritable(); const draft=structuredClone(this.doc); let returned:unknown;
    this.inTransaction=true;
    try { returned=mutate(draft); }
    finally {this.inTransaction=false;}
    if (returned && typeof (returned as {then?:unknown}).then==='function') throw new SettingsError('async-transaction','Decode asynchronous data before starting a settings transaction.');
    pruneAssets(draft);
    const parsed=documentSchema.safeParse(draft);
    if (!parsed.success) {this.warning=invalidChange;this.publishView();return false;}
    if (JSON.stringify(draft)===this.json) {
      if (options.allowOverwrite) {this.protected=false;this.warning='';this.persist();this.publishView();}
      return true;
    }
    const operationId=this.gesture?.operationId ?? this.events.operation();
    if (!this.gesture?.recorded) {this.pushHistory();if (this.gesture) this.gesture.recorded=true;}
    this.doc=immutable(parsed.data);this.json=JSON.stringify(this.doc);this.version++;
    if (options.allowOverwrite) {this.protected=false;this.warning='';}
    this.persist();this.publishView();this.notifyChange(operationId,options.source||'editor',options.scopes);
    return true;
  }
  // Joins existing inspector callbacks into one atomic operation (e.g. import
  // an SVG and apply it). Only the final complete document is validated/saved.
  batch(work:()=>void,options:TransactionOptions={}) {
    this.assertWritable();if(!this.writableDocument())return false;this.endGesture();this.batchDraft=structuredClone(this.doc);let draft:StudioDocument,result:unknown;
    try {result=work();draft=this.batchDraft;} finally {this.batchDraft=undefined;}
    if(result && typeof(result as {then?:unknown}).then==='function')throw new SettingsError('async-transaction','Decode asynchronous data before starting a settings transaction.');
    return this.transaction(next=>Object.assign(next,draft),options);
  }
  replace(document:StudioDocument,options:TransactionOptions={}) { this.endGesture();return this.transaction(draft=>Object.assign(draft,document),options); }
  undo = () => {
    this.assertWritable();if(!this.writableDocument())return false;this.gesture=null;const previous=this.history.pop();if (!previous) return false;
    this.future.push(this.doc);this.doc=previous;this.json=JSON.stringify(previous);this.version++;this.persist();this.publishView();this.notifyChange(this.events.operation(),'undo');return true;
  };
  redo = () => {
    this.assertWritable();if(!this.writableDocument())return false;this.gesture=null;const next=this.future.pop();if (!next) return false;
    this.history.push(this.doc);this.doc=next;this.json=JSON.stringify(next);this.version++;this.persist();this.publishView();this.notifyChange(this.events.operation(),'redo');return true;
  };
  // Keep the base paired with its server while startup resolves native config.
  // An interim connection to the preference URL must not erase a durable base,
  // or use it against a different server that happens to have the same revision.
  private currentRevision() {return this.baseEndpoint===this.endpoint ? this.baseRevision : undefined;}
  private acceptRevision(revision?:string) {this.baseRevision=revision;this.baseEndpoint=this.endpoint;}
  private local(dirty:boolean) { this.storage.save(this.doc,{pending:dirty,baseRevision:this.currentRevision(),endpoint:this.endpoint}); }
  private persist() {
    if (this.protected || this.unsupported) return false;
    this.pending=true;let saved=true;
    try {this.local(true);this.saveStatus=this.remote ? 'Conflict · local draft kept' : 'Saved locally';}
    catch {saved=false;this.saveStatus='Local save failed';this.warning='Storage is full or unavailable. Export your configuration to keep a copy.';}
    clearTimeout(this.timer);this.timer=setTimeout(this.flush,350);return saved;
  }
  save() {this.assertWritable();if(!this.writableDocument())return false;this.protected=false;this.warning='';const saved=this.persist();this.publishView();return saved;}
  flush = () => {
    if(this.disposed)return;this.assertWritable();
    if (this.protected || this.unsupported || !this.initialized || !this.pending || this.remote) return;
    if (this.transport.publish(this.doc,this.currentRevision())) {this.saveStatus='Saving…';this.publishView();}
  };
  private showConflict(document:StudioDocument|null,revision?:string) {
    if(this.unsupported)return;
    const parsed=document===null ? null : documentSchema.safeParse(document);
    if(parsed && !parsed.success) {this.warning='The server contains an unsupported configuration. Export your settings before replacing it.';this.publishView();return;}
    clearTimeout(this.timer);this.initialized=true;this.remote={document:parsed?.success ? immutable(parsed.data) : null,revision};this.saveStatus='Conflict · local draft kept';this.publishView();
  }
  private receiveDocument(value:StudioDocument|null,revision?:string) {
    if(this.unsupported)return;
    const parsed=value===null ? null : documentSchema.safeParse(value);
    if (parsed && !parsed.success) {this.warning='The server contains an unsupported configuration. Export your settings before replacing it.';this.publishView();return;}
    const document=parsed?.success ? immutable(parsed.data) : null;
    this.initialized=true;const same=document!==null && JSON.stringify(document)===this.json;
    if (this.pending && !same) {
      if (!this.remote && (this.currentRevision()===revision || document===null && !this.currentRevision())) {this.acceptRevision(revision);this.flush();}
      else this.showConflict(document,revision);
      return;
    }
    this.acceptRevision(revision);
    if (document) {
      clearTimeout(this.timer);
      if (!same) {this.pushHistory();this.gesture=null;this.doc=document;this.json=JSON.stringify(document);this.version++;}
      this.pending=false;this.remote=null;
      if (!this.protected) {try {this.local(false);} catch {this.warning='Local storage is unavailable. Server settings remain available.';}}
      this.saveStatus='Synced to OBS';

      this.publishView();if (!same) this.notifyChange(this.events.operation(),'remote');
    } else if (!this.protected) {this.persist();this.publishView();}
  }
  connect(options:ConnectionOptions) {
    this.assertWritable();const epoch=++this.epoch;clearTimeout(this.timer);this.initialized=false;
    if(this.unsupported?.source==='server') {if(this.warning===this.unsupported.reason)this.warning='';this.unsupported=null;}
    if (this.endpoint!==options.url) {this.endpoint=options.url;this.remote=null;}
    const active=()=>!this.disposed && epoch===this.epoch;
    this.transport.onStatus=status=>{if (!active()) return;this.connectionState=status;if(status!=='Connected')this.initialized=false;this.publishView();};
    this.transport.onError=message=>{if (!active()) return;this.saveStatus='Save failed · draft kept';this.warning=message;this.publishView();};
    this.transport.onConflict=(document,revision)=>{if(active())this.showConflict(document,revision);};
    this.transport.onUnsupported=source=>{if(active())this.inspectUnsupported(source);};
    this.transport.onRecovery=(backup,revision)=>{
      if (!active()||this.unsupported) return;this.acceptRevision(revision);this.protected=true;this.initialized=true;
      const parsed=documentSchema.safeParse(backup);this.serverBackup=parsed.success ? immutable(parsed.data) : null;
      this.warning='The server configuration is damaged. The original file is preserved. Restore a backup or explicitly save your current defaults.';this.publishView();
    };
    this.transport.onSaved=(json,revision)=>{
      if (!active()||this.unsupported) return;this.acceptRevision(revision);const same=json===this.json;
      if (!this.remote) this.pending=!same;
      if(!this.protected) {try {this.local(this.pending);} catch {this.warning='Server saved the profile, but local storage is unavailable. Export a copy.';}}
      if (this.remote) {this.publishView();return;}
      this.saveStatus=same ? 'Synced to OBS' : 'Saved locally';this.publishView();if (!same) this.flush();
    };
    this.transport.onDocument=(document,revision)=>{if(active())this.receiveDocument(document,revision);};
    this.transport.connect(options);
    return ()=>{if (epoch===this.epoch) this.disconnect();};
  }
  private disconnect() {
    this.epoch++;this.initialized=false;clearTimeout(this.timer);this.transport.stop();
    this.transport.onStatus=()=>{};this.transport.onError=()=>{};this.transport.onDocument=()=>{};
    this.transport.onConflict=()=>{};this.transport.onRecovery=()=>{};this.transport.onSaved=()=>{};
    this.transport.onUnsupported=()=>{};
  }
  pause() {this.assertWritable();this.disconnect();this.connectionState='Paused';this.publishView();}
  resolveConflict(choice:'local'|'server') {
    this.assertWritable();if(!this.writableDocument())return false;const latest=this.remote;if (!latest || choice==='server' && !latest.document) return false;
    this.acceptRevision(latest.revision);this.remote=null;this.gesture=null;
    if (choice==='local') {this.persist();this.publishView();return true;}
    this.pushHistory();this.doc=latest.document!;this.json=JSON.stringify(this.doc);this.version++;this.pending=false;
    try {this.local(false);this.saveStatus='Synced to OBS';} catch {this.saveStatus='Local save failed';this.warning='Could not save locally. Export a copy.';}
    this.publishView();this.notifyChange(this.events.operation(),'conflict-server');return true;
  }
  restoreBackup() {
    this.assertWritable();if(!this.writableDocument())return false;
    const backup=this.serverBackup||this.storage.backup();const accepted=this.replace(backup,{source:'restore',allowOverwrite:true});
    if (accepted) this.serverBackup=null;return accepted;
  }
  private target(document:StudioDocument,id:DefinitionId,address:SettingsAddress,write=false) {
    const definition=this.catalog.settings.get(id);if (!definition) throw new SettingsError('unknown-setting',`Unknown setting: ${id}`,{id});
    const {binding}=definition;
    if (binding.store!=='document' || binding.scope!==address.scope) throw new SettingsError('wrong-scope','Use the explicit settings address and matching storage adapter.');
    let root:Record<string,unknown>=document as unknown as Record<string,unknown>, path=binding.path;
    let module:StudioDocument['profiles'][number]['modules'][number]|undefined;
    if (address.scope==='game-profile'||address.scope==='overlay-profile'||address.scope==='module') {
      const profile=address.scope==='game-profile'?document.gameProfiles.find(p=>p.id===address.profileId):document.profiles.find(p=>p.id===address.profileId);if(!profile)throw new SettingsError('missing-profile','Profile does not exist.');
      root=profile as unknown as Record<string,unknown>;
      if (address.scope==='module') {
        module=(profile as StudioDocument['profiles'][number]).modules.find(m=>m.id===address.moduleId);if(!module)throw new SettingsError('missing-module','Module does not exist.');
        const owner=this.catalog.modules.all().find(m=>m.builtinType===moduleKind(module!)||m.id===moduleKind(module!));
        if (!owner?.settings.includes(id)&&!(id.startsWith('overlay.instance.')&&binding.path.length===1&&(commonFields as readonly string[]).includes(binding.path[0]))) throw new SettingsError('wrong-module','Setting does not apply to this module.');
        root=module as unknown as Record<string,unknown>;
        if (address.element) {
          if (!binding.overrides) throw new SettingsError('not-inheritable','This setting does not support element overrides.');
          if (address.element.kind==='key') {
            if (module.type!=='keyboard') throw new SettingsError('wrong-element','Keys belong to keyboard modules.');
            const keyId=address.element.keyId,key=module.keys.find(k=>k.id===keyId);if(!key)throw new SettingsError('missing-key','Key does not exist.');
            root=key as unknown as Record<string,unknown>;path=binding.overrides.key;
          } else {
            const button=address.element.button;
            if (module.type!=='mouse'||!Number.isInteger(button)||button<1||button>7) throw new SettingsError('missing-button','Mouse button does not exist.');
            if (write) module.buttonStyles[button]||={};
            root=(module.buttonStyles[button]||{}) as Record<string,unknown>;path=binding.overrides.mouseButton;
          }
        }
      }
    }
    return {definition,root,path,module};
  }
  private at(root:Record<string,unknown>,path:readonly string[]) {let value:unknown=root;for(const part of path)value=value && typeof value==='object' ? (value as Record<string,unknown>)[part] : undefined;return value;}
  read(id:DefinitionId,address:SettingsAddress):unknown {
    const target=this.target(this.doc,id,address), value=this.at(target.root,target.path);
    if (value===undefined && address.scope==='module' && address.element) return this.read(id,{scope:'module',profileId:address.profileId,moduleId:address.moduleId});
    return structuredClone(value);
  }
  set(id:DefinitionId,address:SettingsAddress,value:unknown) {return this.transaction(draft=>this.write(draft,id,address,value,false),{source:'settings',scopes:[address.scope]});}
  setMany(changes:readonly {id:DefinitionId;address:SettingsAddress;value:unknown}[],options:{preserveGesture?:boolean}={}) {
    if(!options.preserveGesture)this.endGesture();
    return this.transaction(draft=>{
      for (const change of changes) this.write(draft,change.id,change.address,change.value,false);
    },{source:'settings',scopes:[...new Set(changes.map(c=>c.address.scope))]});
  }
  reset(id:DefinitionId,address:SettingsAddress) {
    const target=this.target(this.doc,id,address), inherited=address.scope==='module' && !!address.element;
    // Factory UUIDs cannot identify a profile in an existing document. Reset the
    // selection to its first real profile, without creating a dangling reference.
    const value=inherited ? undefined : id==='studio.document.active-profile' ? this.doc.profiles[0].id : id==='profiles.overlay.game-profile' ? this.doc.gameProfiles[0].id : this.catalog.settings.readDefault(id,{moduleType:target.module?moduleKind(target.module):undefined});
    this.endGesture();
    return this.transaction(draft=>this.write(draft,id,address,value,inherited),{source:'reset',scopes:[address.scope]});
  }
  private write(document:StudioDocument,id:DefinitionId,address:SettingsAddress,value:unknown,inheritedReset:boolean) {
    let target=this.target(document,id,address);
    if (!inheritedReset) {const parsed=target.definition.schema.safeParse(value);if(!parsed.success)throw new SettingsError('invalid-setting',`Invalid value for ${id}`,{id});value=parsed.data;}
    if(value===undefined && this.at(target.root,target.path)===undefined) return;
    if(value!==undefined) target=this.target(document,id,address,true);
    if (target.module?.locked && address.scope==='module' && !address.element && ['x','y','w','h'].includes(target.path[0]) && !Object.is(this.at(target.root,target.path),value)) throw new SettingsError('locked-module','The module position is locked.');
    let parent=target.root;
    for (const part of target.path.slice(0,-1)) {if (!parent[part]) parent[part]={};parent=parent[part] as Record<string,unknown>;}
    const field=target.path.at(-1)!;if(value===undefined)delete parent[field];else parent[field]=structuredClone(value);
  }
  dispose() {if(this.disposed)return;this.disconnect();this.disposed=true;this.listeners.clear();this.events.clear();this.history=[];this.future=[];this.gesture=null;}
}
