export interface PreservedConfiguration {
  readonly source:'local'|'server'|'import';
  readonly version:number;
  readonly reason:string;
  // Absent when the server file is too large for the bounded transport.
  readonly text?:string;
}
