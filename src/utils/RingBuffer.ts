export class RingBuffer<T> {
  private buf: T[]
  private head = 0
  private size = 0

  constructor(private capacity: number) {
    this.buf = new Array<T>(capacity)
  }

  push(item: T): void {
    this.buf[this.head % this.capacity] = item
    this.head++
    if (this.size < this.capacity) this.size++
  }

  /** Returns items oldest-first */
  toArray(): T[] {
    if (this.size < this.capacity) return this.buf.slice(0, this.size)
    const start = this.head % this.capacity
    return [...this.buf.slice(start), ...this.buf.slice(0, start)]
  }

  get length(): number { return this.size }

  last(): T | undefined {
    if (this.size === 0) return undefined
    return this.buf[(this.head - 1 + this.capacity) % this.capacity]
  }
}
