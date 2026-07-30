# HWA HyperEVM mainnet Genesis bootstrap receipt

Date: 2026-07-29  
Chain: HyperEVM mainnet (`999`)  
Core: `0x4E010e44E6369A92c090069833144901a92bed5E`  
Collection: HWA Genesis (`0x89D52133B105E9548Df16dE4d7cf59c412daf191`)  
Depositor: `0x24398fc31899E2384E4E070fcdBF8Bb6D916FcD9`  
Backing per listing: `0.25 HYPE`

## Result

Forty HWA Genesis NFTs (`#2` through `#41`) were deposited into the production core with a total isolated backing of `10 HYPE`. Acquisitions remained closed throughout the bootstrap and public Project X HWA buys were not enabled.

Final direct on-chain reads:

- `activeListingCount() == 40`
- `stagedCount() == 0`
- `activeBackingTotal() == 10 HYPE`
- `totalWeight() == 160000000000000000000`
- `weightedBackingTotal() == 40000000000000000000000000000000000000`
- `acquisitionFee() == 0.275 HYPE`
- `acquisitionsEnabled() == false`
- `externalBuysEnabled() == false`

The acquisition fee is already dynamic. Because all forty initial listings have the same `0.25 HYPE` backing, their harmonic-mean expected value is `0.25 HYPE`; the configured 10% surcharge produces a current pool fee of `0.275 HYPE`, excluding the separately quoted drand service fee.

## Approval

| Action | Transaction |
|---|---|
| Approve the HWA core for all deployer-owned Genesis NFTs | `0x48562e4d13b01481e383147f9409ae0ba678e182eb5289c34ad6b8f4fd99b049` |

## Listings

| Genesis token | Transaction |
|---:|---|
| 2 | `0xf89062a5fdec289f6a5bbc58d6c3d389d966014f22b503e47b25bfdbb72d1bbc` |
| 3 | `0xac8cfafb46f59f4c6fb32428564acc26cc85a237d25525f64e1364688b978149` |
| 4 | `0xf56b1b0d753ea62a887bcf9e178e4203d5b96c9b63da02382c51878837d65f27` |
| 5 | `0x7168a15cec520c5917f61842022bffa15ea792f5a4f7bdb1ac4d4ea0595d535b` |
| 6 | `0x28e6dade383124f8fbcbb066c4a8b8b6e6999aa034e38ed8917692fc85a40824` |
| 7 | `0x882a2a41a8edb2efd20eae247eca165b9bc8d8aab188619c3230628940428bf9` |
| 8 | `0x96eefa867b62256930af8689dbcf55d2bb7818a762ab3b073284173aea96219b` |
| 9 | `0x72ec1ebdf555343498cc7f6be0cff58db52da01791c10dca77d4a4d3703510df` |
| 10 | `0x48dc80f74dbee9130be2a8e66812f9a1b5f58ba68a52706814b3f7a63488607d` |
| 11 | `0xe4c40f9772ff0b0078e3b79b853a6cd64250e6674ad08b404df26748bf4b0d0a` |
| 12 | `0xa3c0e6622069365bcd29b96db2e5c20272be602d195451eb4fca7f7288211ce8` |
| 13 | `0x7649e9865c9e5b8630912ec53230f0ada64e66f05edda3c9a361453e1f77f37a` |
| 14 | `0x17b5a6e9a6e0b89da39d0f1c99e4c161f240c3c0de3510a44f1ff811c5f9a810` |
| 15 | `0x335d52e42ed37bb1b571fc1b3551e644907f26447e981b8a0c0db422a2d1997e` |
| 16 | `0x1e7a626a8e8f327bc70ddd371775d71c50f11e0162d14c33e5603469ecd4faa7` |
| 17 | `0x78f8a8678306cb1c39ed31286fa48df138f132d73968576cd8eb9153652c3f9b` |
| 18 | `0xbdbe14c9f685a36f95f790d780b276bfa53b6ad41ce3d1cc1a7aa0c85cc84275` |
| 19 | `0x2413072fef680ea13328d5d46985eed9a9b360c820005564490efb41190ec82d` |
| 20 | `0xe85bf8391f4fbd515dd21d2c63ec61dba05e5cf428630e3e627934df5138b9fa` |
| 21 | `0xebc524967f6b5c093a96d956dd04c2d4e5209c4b3b41ee20a6d86402f7396472` |
| 22 | `0x6557047354f3ebcfdaa5f1d1f6888d0e91c00679e297a4b020667ece7c8f39a5` |
| 23 | `0x498bdb1a4a621239dd6ce7a66a030c60812f6205b302b6c8064e92986c716ec3` |
| 24 | `0xf86f651f3549cfb5dc925734f3b3f916094b1e79dea3ccb00427afd6f9cf1994` |
| 25 | `0x03d37fe5a5048dcf10ebfb7ec5f3b6840317280f81cf8a32ebd28bcf9b2b02f7` |
| 26 | `0x448077763e5bf60faea17f99564376b4a98209077306cb2b1e37e0b877a82c13` |
| 27 | `0x15cbcd4b7bdf82b5ceaf726045fbea51c4d2e65ed38a7b9dfe3f5fd7d207dc62` |
| 28 | `0x983048b6f239b8099bf2f9e890f47a2dd182bb3f9c1ce0ee5272407b495ce6d7` |
| 29 | `0xa231cf0903918a80027187967204c78e5fcc2e004e6834d2ec132ad184353750` |
| 30 | `0x49d34d0c484e47eb568e670b3262ea872f4a69598bf34ba42858f3f1fbc6251f` |
| 31 | `0x0578ab2e80a35f67a6c6ef8b5f5e3c08dba4810986912a48d4b2daec644afd46` |
| 32 | `0x58ad4532ba937ba3ff1b04b49e14bc907109502cacd4f13f85e8255c6da5a40a` |
| 33 | `0x73608a47dfd6f43f0774a6fdd8cd2d8c31c01c20d99b5c84011f2482cb2f5847` |
| 34 | `0xc953743cc5e819fe5970244949a3b931759c58462e55e15fe308969dc6af0ca4` |
| 35 | `0xf0cd413c0f304e9738e4a01087f3570cf8efa28380364cd841a1408680417abf` |
| 36 | `0x89cabc925d3966111f6b07f0c2b9d292ec73c0f7d9cffdc9ca764a7f08ee7d4b` |
| 37 | `0x72d24d6f972b3f41d31d1e318be5635c6a26b2ad8ec55c5290c20dee731dc29a` |
| 38 | `0x089d2c8f8906ef4af8b98f11f26418162c4acacf8d7df082993c21b6639facd3` |
| 39 | `0x473639238198068b40d3e4b4a0852c51d7bfb30b66410a0b5ca94ffa68c7eb66` |
| 40 | `0xcd5c57c111031a326fbcaa3f36f18617511148f51027f44964c3fe4efbbd785f` |
| 41 | `0x15d9c1ccf88bbc962c4c9f296832ac4619024bd17c81931526ae5e11a3c385e7` |

## Public deposit collections

The following reviewed collections were enabled for deposits while acquisitions remained closed:

- Lucky Hypio Winners: `0x63eb9d77d083ca10c304e28d5191321977fd0bfb`
- PiP & Friends: `0xbc4a26ba78ce05e8bcbf069bbb87fb3e1dac8df8`
- Odd Otties: `0x43a9652e2b3ce8970e8d33d8c34252a59a6596aa`
- Hypurr: `0x9125e2d6827a00b0f8330d6ef7bef07730bac685`
- HWA Genesis: `0x89D52133B105E9548Df16dE4d7cf59c412daf191`

Allowlist transaction: `0x9a5458f18d596015a079c0cb9cb308a2ea077e3bc24f1291a22641987957fdd8`.

The production manifest enables deposit writes but keeps `acquisitionsEnabled=false`. No spin or public HWA token buy was enabled by this bootstrap.
