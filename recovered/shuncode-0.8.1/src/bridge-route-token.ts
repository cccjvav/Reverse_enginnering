/** Route identity is published only after durable storage succeeds.
 * Serialize initialize/reset so delayed startup reads cannot undo a manual reset.
 * Existing secrets and their workspace scope remain unchanged.
 */
export class DurableBridgeRouteToken {
  private token = "";
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly deps: {
    read(): Promise<string | undefined>;
    write(value: string): Promise<void>;
    generate(): string;
    withLock?<T>(action: () => Promise<T>): Promise<T>;
  }) {}
  get value(): string { return this.token; }
  initialize(): Promise<void> {
    return this.enqueue(async () => {
      // Re-read under the lease: another stopped window may have explicitly reset.
      const stored = await this.deps.read();
      const candidate = stored || this.token || this.deps.generate();
      if (!stored) await this.deps.write(candidate);
      this.token = candidate;
    });
  }
  rotate(): Promise<void> {
    return this.enqueue(async () => {
      const candidate = this.deps.generate();
      await this.deps.write(candidate);
      this.token = candidate;
    });
  }
  private enqueue(action: () => Promise<void>): Promise<void> {
    const result = this.pending.then(() => this.deps.withLock ? this.deps.withLock(action) : action());
    this.pending = result.catch(() => {});
    return result;
  }
}
