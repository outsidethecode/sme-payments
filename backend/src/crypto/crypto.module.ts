import { Global, Module } from "@nestjs/common";
import { CRYPTO_SERVICE } from "./crypto.interface";
import { NodeCryptoService } from "./node-crypto.service";

/**
 * Global CryptoModule — provides the CRYPTO_SERVICE token platform-wide.
 *
 * To swap to a Rust implementation:
 *   1. Create `RustCryptoService` implementing `ICryptoService`
 *   2. Change the `useClass` below from `NodeCryptoService` to `RustCryptoService`
 *   3. All tests pass without modification
 *
 * Or conditionally:
 *   useClass: process.env.CRYPTO_BACKEND === 'rust'
 *     ? RustCryptoService
 *     : NodeCryptoService,
 */
@Global()
@Module({
  providers: [
    {
      provide: CRYPTO_SERVICE,
      useClass: NodeCryptoService,
    },
  ],
  exports: [CRYPTO_SERVICE],
})
export class CryptoModule {}
