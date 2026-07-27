# Randamu BLS Solidity vendoring record

The files `BLS.sol`, `ModExp.sol`, `Precompiles.sol` and `LICENSE` are
line-ending-normalized copies of:

- repository: `https://github.com/randa-mu/bls-solidity`;
- commit: `11af179a8287d978659aae07adb66aa60f64b8a6`;
- license: MIT;
- upstream status observed on 2026-07-26: archived and explicitly described by
  its maintainers as experimental, unaudited cryptographic code.

Only the BN254 verifier is used. The upstream files must not be edited in this
directory. Any future upstream change requires a new pinned commit, normalized
content comparison, public drand fixture tests, HyperEVM precompile probes and
an independent cryptographic audit before production.
