import fs from "node:fs";
import path from "node:path";

export interface DocumentStore<T> {
  load(): T | undefined;
  save(value: T): void;
}

export class JsonDocumentStore<T> implements DocumentStore<T> {
  constructor(private readonly filename: string) {}

  load() {
    try { return JSON.parse(fs.readFileSync(this.filename, "utf8")) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }

  save(value: T) {
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
    fs.renameSync(temporary, this.filename);
  }
}

export class MemoryDocumentStore<T> implements DocumentStore<T> {
  load() { return undefined; }
  save(_value: T) {}
}
