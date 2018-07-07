declare module 'shlex' {
  declare function quote(arg: string): string;
  declare function split(command: string): string[];
}