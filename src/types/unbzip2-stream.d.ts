declare module 'unbzip2-stream' {
  import type { Duplex } from 'node:stream'
  function unbzip2(): Duplex
  export default unbzip2
}
