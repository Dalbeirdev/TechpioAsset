import type { Algorithm, Options } from '@node-rs/argon2';

/**
 * argon2id parameters, shared by PasswordService and the demonstration seed so
 * hashes produced by either are verifiable by the other.
 *
 * OWASP-recommended settings: 19 MiB of memory, 2 iterations, 1 lane. argon2id
 * is chosen over bcrypt for GPU resistance and over argon2i for side-channel
 * resistance.
 *
 * The algorithm is written as a numeric literal rather than `Algorithm.Argon2id`
 * because @node-rs/argon2 declares that enum as an *ambient const enum*, which a
 * per-file transpiler (isolatedModules, used by the seed's tsx runtime) cannot
 * inline. A type-only import keeps the annotation without the runtime access.
 */
export const ARGON2_PARAMS: Options = {
  algorithm: 2 as Algorithm, // Algorithm.Argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
