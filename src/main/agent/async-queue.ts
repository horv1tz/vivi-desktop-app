/**
 * Push-based async queue used as the streaming-input prompt for the Agent SDK.
 * `push()` enqueues a message, `end()` completes the iterable (the SDK then closes the CLI's stdin).
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiters: ((r: IteratorResult<T>) => void)[] = []
  private ended = false

  get size(): number {
    return this.items.length
  }

  get isEnded(): boolean {
    return this.ended
  }

  push(item: T): boolean {
    if (this.ended) return false
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value: item, done: false })
    else this.items.push(item)
    return true
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    for (const w of this.waiters.splice(0)) w({ value: undefined as unknown as T, done: true })
  }

  clear(): T[] {
    return this.items.splice(0)
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const item = this.items.shift()
        if (item !== undefined) return Promise.resolve({ value: item, done: false })
        if (this.ended) return Promise.resolve({ value: undefined as unknown as T, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      },
      return: (): Promise<IteratorResult<T>> => {
        this.end()
        return Promise.resolve({ value: undefined as unknown as T, done: true })
      },
    }
  }
}
