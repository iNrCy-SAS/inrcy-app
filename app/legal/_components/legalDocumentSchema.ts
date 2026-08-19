export type LegalDocumentId = "mentions-legales" | "confidentialite" | "cga";

export type LegalDocumentBlock =
  | { readonly kind: "heading"; readonly key: string }
  | { readonly kind: "paragraph"; readonly key: string }
  | { readonly kind: "list"; readonly keys: readonly string[] };

export const LEGAL_DOCUMENT_BLOCKS = {
  "mentions-legales": [
    {
      "kind": "heading",
      "key": "mentions_legales_0001_8259f691"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0002_416cc2b9"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0003_6674aa04"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0004_5c078b7e"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0005_5bf26cc6"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0006_5b486d2c"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0007_580c6d21"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0008_15bf5546"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0009_9315dab1"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0010_2d60cd55"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0011_41b3864a"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0012_900a8619"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0013_75ba36cb"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0014_caa5b2de"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0015_fab8f133"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0016_a562a181"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0017_cd442937"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0018_0e996506"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0019_183e6d08"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0020_deb41fe8"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0021_c1191808"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0022_103c637b"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0023_fa4cbd8d"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0024_42c42c92"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0025_ae9ea543"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0026_b55d555d"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0027_2b5c3d26"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0028_ef46a7e2"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0029_665e243b"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0030_a810e47b"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0031_65b9203a"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0032_93503df1"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0033_3db25d0e"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0034_d01655e9"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0035_85b534c6"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0036_1ff736f2"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0037_47d4818e"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0038_2cd092f5"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0039_8d3084f5"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0040_a5a36f9f"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0041_f7ac0be7"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0042_bd9d0f96"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0043_95ede359"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0044_eb68e7cd"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0045_feffb9f4"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0046_59385139"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0047_27c09b95"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0048_61c0c8f8"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0049_087d2858"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0050_e2b1fe08"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0051_ec57cb9f"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0052_913b4ea9"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0053_b3463983"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0054_74ccffaa"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0055_b79f8ff3"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0056_16dd2e0d"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0057_66206a75"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0058_8d086246"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0059_afe61874"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0060_e6ae894b"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0061_cd4feefa"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0062_c095bd9a"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0063_f2921a74"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0064_8d29b4de"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0065_9a7f5fe6"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0066_137bba54"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0067_6e4afd29"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0068_ee0c5460"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0069_8be036b4"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0070_e0b00a68"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0071_25e7b787"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0072_100d4eeb"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0073_51d3847f"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0074_8dd05f1b"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0075_35cacd26"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0076_735f962a"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0077_be96fb13"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0078_89cd2152"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0079_176f177d"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0080_11866f60"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0081_b467e086"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0082_4276dc53"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0083_7a50965a"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0084_65d19d78"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0085_ab9f96fc"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0086_e0339ba2"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0087_e1b665b1"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0088_20750c2e"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0089_be8c21c6"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0090_91a92063"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0091_11dbb91b"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0092_4b3e33de"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0093_ba1cffde"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0094_dad700d0"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0095_fb483ee0"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0096_495ebf33"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0097_d20afebc"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0098_f550bc57"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0099_5a98efb2"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0100_6dd4baec"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0101_f9fbbb25"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0102_ff4fd3fb"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0103_0a37e342"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0104_4a83d488"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0105_1029d0d1"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0106_c734d9bb"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0107_41de02b9"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0108_3a5e1220"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0109_ba727aa3"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0110_d6b7c891"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0111_2d93fdef"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0112_9b555996"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0113_0b42c7f0"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0114_49602962"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0115_78bce0bb"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0116_794416aa"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0117_841f5b84"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0118_a092403a"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0119_7b8b8afa"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0120_9580d159"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0121_78fa4b21"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0122_ee26d5c2"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0123_cd7487d5"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0124_94068a1b"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0125_a1a8dce5"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0126_679ae09a"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0127_3d3a89e6"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0128_d089bbef"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0129_a0362e5e"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0130_b06a7b36"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0131_0e1067f7"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0132_141395eb"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0133_12c12bd6"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0134_def63ead"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0135_7d198d58"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0136_662e3437"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0137_a1035ae4"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0138_ba727aa3"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0139_8f512008"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0140_57ee701d"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0141_5a1c152a"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0142_e2c0c085"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0143_07015564"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0144_bf7da17d"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0145_e584380a"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0146_bbc8821f"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0147_d36a9e32"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0148_28ce97d2"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0149_ba727aa3"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0150_648331d0"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0151_271b22c6"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0152_1ec5f266"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0153_8595fda2"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0154_9b5dce81"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0155_62f16857"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0156_ffee4262"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0157_a2c8b4e0"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0158_dbb41878"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0159_ef5432b2"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0160_a0bf44d8"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0161_30157157"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0162_cbe28431"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0163_da968158"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0164_f25864bb"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0165_9256ee25"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0166_9fae14db"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0167_a875bf9a"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0168_05d8c369"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0169_8df25ca0"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0170_a6b7ebb0"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0171_33826b7f"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0172_b35640fe"
    },
    {
      "kind": "heading",
      "key": "mentions_legales_0173_1fcfb394"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0174_aa00fac1"
    },
    {
      "kind": "paragraph",
      "key": "mentions_legales_0175_dbeb7d5f"
    }
  ],
  "confidentialite": [
    {
      "kind": "paragraph",
      "key": "confidentialite_0001_2e4b87bf"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0002_1e60c02c"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0003_62496532"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0004_673a4917"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0005_d01655e9"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0006_ee97946e"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0007_7120891d",
        "confidentialite_0008_c8b62fc4",
        "confidentialite_0009_ddb981d2",
        "confidentialite_0010_2dbaaa8e",
        "confidentialite_0011_e6ec7391",
        "confidentialite_0012_df495901",
        "confidentialite_0013_1b8786c5",
        "confidentialite_0014_3ad67b65",
        "confidentialite_0015_aca27235",
        "confidentialite_0016_53694ddf",
        "confidentialite_0017_1ce3c58e"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0018_90f842f2"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0019_6e0fa0b7"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0020_6b1c1336"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0021_7adcb873",
        "confidentialite_0022_7f901783",
        "confidentialite_0023_62ec0915",
        "confidentialite_0024_21ce5c00",
        "confidentialite_0025_4d49b52e",
        "confidentialite_0026_ef3dc920",
        "confidentialite_0027_6c6897d0",
        "confidentialite_0028_f0fb0def",
        "confidentialite_0029_ae9ea543",
        "confidentialite_0030_7a88a70a",
        "confidentialite_0031_34bb5a37"
      ]
    },
    {
      "kind": "heading",
      "key": "confidentialite_0032_2b2a888d"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0033_cacbdb75"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0034_0aa210e9",
        "confidentialite_0035_24d1636e",
        "confidentialite_0036_e8fb8b78",
        "confidentialite_0037_ae21ca21",
        "confidentialite_0038_64d5e7fc",
        "confidentialite_0039_fd258a82",
        "confidentialite_0040_f3fdd230",
        "confidentialite_0041_0d7f7b40",
        "confidentialite_0042_594ea003",
        "confidentialite_0043_00e4c8a7",
        "confidentialite_0044_08e64bdb",
        "confidentialite_0045_8e8eaa20",
        "confidentialite_0046_515aa975",
        "confidentialite_0047_f60ee3cf"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0048_7a5170ad"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0049_14fd5157"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0050_91bfea42"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0051_0aa210e9",
        "confidentialite_0052_24d1636e",
        "confidentialite_0053_31c65c39",
        "confidentialite_0054_06aa2e66",
        "confidentialite_0055_64d5e7fc",
        "confidentialite_0056_251db963",
        "confidentialite_0057_3d5bf0b2",
        "confidentialite_0058_95ad7808",
        "confidentialite_0059_aa8e61d8",
        "confidentialite_0060_238646b8",
        "confidentialite_0061_69e0d72a",
        "confidentialite_0062_4a41a9af"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0063_3c69d9aa"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0064_40fdb394"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0065_0480ea97"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0066_0aa210e9",
        "confidentialite_0067_24d1636e",
        "confidentialite_0068_64d5e7fc",
        "confidentialite_0069_8643178b",
        "confidentialite_0070_31c65c39",
        "confidentialite_0071_06aa2e66",
        "confidentialite_0072_2d6831b8",
        "confidentialite_0073_053800dc",
        "confidentialite_0074_2172b20e",
        "confidentialite_0075_a04c6c84",
        "confidentialite_0076_4b5149a4",
        "confidentialite_0077_a6dbadc9",
        "confidentialite_0078_aa6c603b",
        "confidentialite_0079_c0f962e9",
        "confidentialite_0080_9cf67034",
        "confidentialite_0081_2d5a03c2",
        "confidentialite_0082_18bd4e6c",
        "confidentialite_0083_eecce683",
        "confidentialite_0084_56835874"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0085_597c5919"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0086_6ba93bed"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0087_2b2b6ae0"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0088_6f05dfb1"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0089_0aa210e9",
        "confidentialite_0090_24d1636e",
        "confidentialite_0091_64d5e7fc",
        "confidentialite_0092_ad4b2c42",
        "confidentialite_0093_e8fb8b78",
        "confidentialite_0094_ae21ca21",
        "confidentialite_0095_25638e7d",
        "confidentialite_0096_e2829db0",
        "confidentialite_0097_ca5e409c",
        "confidentialite_0098_a1faf8d3",
        "confidentialite_0099_a04c6c84",
        "confidentialite_0100_1b01e508",
        "confidentialite_0101_086af41a",
        "confidentialite_0102_7d2d4fcb",
        "confidentialite_0103_0dfae21a",
        "confidentialite_0104_18148c68",
        "confidentialite_0105_2d0672cc",
        "confidentialite_0106_f37bdbe3"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0107_f950e87b"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0108_9e964468"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0109_b6e42123"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0110_4fb2aca7"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0111_7cc3a9d4"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0112_4863a30a"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0113_908b0ec3",
        "confidentialite_0114_3b0918d7",
        "confidentialite_0115_11f659a9",
        "confidentialite_0116_8ff75e09",
        "confidentialite_0117_1b01e508",
        "confidentialite_0118_14a0f7e4",
        "confidentialite_0119_6d5c3b7d",
        "confidentialite_0120_89c9685f",
        "confidentialite_0121_d1d38127",
        "confidentialite_0122_42ec78b9",
        "confidentialite_0123_f2156176",
        "confidentialite_0124_053936db"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0125_de845ba8"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0126_93039b30"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0127_8eaea110"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0128_5be20491"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0129_f7269dde"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0130_522cdeea"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0131_2bac0936",
        "confidentialite_0132_a9ec0530",
        "confidentialite_0133_a5fc1cd2",
        "confidentialite_0134_90450e6d",
        "confidentialite_0135_669c3ea5",
        "confidentialite_0136_b8005b7f",
        "confidentialite_0137_861d7da2",
        "confidentialite_0138_8d086246",
        "confidentialite_0139_7164e6a9",
        "confidentialite_0140_c19f8940",
        "confidentialite_0141_ec573359",
        "confidentialite_0142_05afcb1c",
        "confidentialite_0143_ec3bf4bb",
        "confidentialite_0144_8d36e09b",
        "confidentialite_0145_b84b352b",
        "confidentialite_0146_e0b3db11",
        "confidentialite_0147_c2225f15"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0148_bdbad021"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0149_2f7cb0b2"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0150_6b0a1286"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0151_dac6093a"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0152_bf1fae86",
        "confidentialite_0153_3ab24874",
        "confidentialite_0154_eeb791ca",
        "confidentialite_0155_fd6f966a",
        "confidentialite_0156_987aa637",
        "confidentialite_0157_a5d67647",
        "confidentialite_0158_6f130bf9",
        "confidentialite_0159_d7e0354c",
        "confidentialite_0160_54b618c1"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0161_64bb45db"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0162_593a3cfc"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0163_fe10e6fa"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0164_43c0f8ce"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0165_c250d94b"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0166_a2ac6ad1"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0167_416f1053",
        "confidentialite_0168_331fab37",
        "confidentialite_0169_41842df8",
        "confidentialite_0170_5fa8393b",
        "confidentialite_0171_e90080dc",
        "confidentialite_0172_f25c2449"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0173_542ac777"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0174_c2b67c6d"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0175_19d10e78"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0176_689e67f3"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0177_d26d8b43"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0178_fb731bd4"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0179_522cdeea"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0180_ca1e63c2",
        "confidentialite_0181_8b3ba681",
        "confidentialite_0182_ee9f014d",
        "confidentialite_0183_7b278f14",
        "confidentialite_0184_c9d51d2d",
        "confidentialite_0185_68becb86",
        "confidentialite_0186_96414473",
        "confidentialite_0187_42ec78b9",
        "confidentialite_0188_89c9685f",
        "confidentialite_0189_02c925a9",
        "confidentialite_0190_92f43b3f",
        "confidentialite_0191_602776ac",
        "confidentialite_0192_fe284a8f",
        "confidentialite_0193_13c66480"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0194_2684cf35"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0195_22d74030",
        "confidentialite_0196_f333ba24",
        "confidentialite_0197_e31f5f48",
        "confidentialite_0198_8167d1b8",
        "confidentialite_0199_77da034c",
        "confidentialite_0200_c5f12a4a",
        "confidentialite_0201_a64bb3e7"
      ]
    },
    {
      "kind": "heading",
      "key": "confidentialite_0202_e454651d"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0203_9298e6e5"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0204_14b5c7b0"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0205_b2043a5a",
        "confidentialite_0206_72f2b621",
        "confidentialite_0207_d8e6add2",
        "confidentialite_0208_9e2bc4b3",
        "confidentialite_0209_98627b6b",
        "confidentialite_0210_2c7fad29",
        "confidentialite_0211_7b571b24",
        "confidentialite_0212_234b640d",
        "confidentialite_0213_afd154b2",
        "confidentialite_0214_c6fc2fe2",
        "confidentialite_0215_ef38acbb",
        "confidentialite_0216_cd84e8fc",
        "confidentialite_0217_5aa1292e",
        "confidentialite_0218_9b633ca7",
        "confidentialite_0219_75945a55",
        "confidentialite_0220_20e93ca0",
        "confidentialite_0221_2f301144",
        "confidentialite_0222_45cc3ebf",
        "confidentialite_0223_7b0f1e7b",
        "confidentialite_0224_810e5417",
        "confidentialite_0225_d5b484b3",
        "confidentialite_0226_4c4dc1bd",
        "confidentialite_0227_28be218d"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0228_17f3dddc"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0229_7a37e724",
        "confidentialite_0230_e5f2a4e9",
        "confidentialite_0231_1b336073",
        "confidentialite_0232_4ac81476",
        "confidentialite_0233_566e55bb",
        "confidentialite_0234_f4b62dd2",
        "confidentialite_0235_4b2b78fb",
        "confidentialite_0236_8ae476f2",
        "confidentialite_0237_22823864",
        "confidentialite_0238_24e3b19e",
        "confidentialite_0239_01d6c31b",
        "confidentialite_0240_d4f44bc2",
        "confidentialite_0241_0d5e777f",
        "confidentialite_0242_02c925a9",
        "confidentialite_0243_65083945"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0244_0621f759"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0245_435a0873"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0246_caf31329"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0247_08a1df46"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0248_47c114cd"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0249_3f3fe9f2"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0250_86c7beb5"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0251_3e605e73",
        "confidentialite_0252_47af91fb",
        "confidentialite_0253_479ea0fb",
        "confidentialite_0254_b6e13292",
        "confidentialite_0255_6f3ab6f5",
        "confidentialite_0256_74678f03",
        "confidentialite_0257_4ac81476",
        "confidentialite_0258_9aa5fece",
        "confidentialite_0259_5fec3951",
        "confidentialite_0260_1b78e983",
        "confidentialite_0261_1074ac58",
        "confidentialite_0262_b76d2c1d"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0263_cfc5ca6e"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0264_a1ed1dfc",
        "confidentialite_0265_2a1a6cdd",
        "confidentialite_0266_3ab24874",
        "confidentialite_0267_5f1b1667",
        "confidentialite_0268_dda99ada",
        "confidentialite_0269_632df4df",
        "confidentialite_0270_9ebfacd3",
        "confidentialite_0271_897dbba5",
        "confidentialite_0272_397e1ad5",
        "confidentialite_0273_52bb2fe6",
        "confidentialite_0274_1a9c350e"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0275_e3a66e4d"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0276_337a083a"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0277_bd327187",
        "confidentialite_0278_5ad62d25",
        "confidentialite_0279_d3b7fc19",
        "confidentialite_0280_ab454b8d",
        "confidentialite_0281_5751d636"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0282_5495eb05"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0283_6eeca0a7",
        "confidentialite_0284_3a27c97e",
        "confidentialite_0285_2bc02af1",
        "confidentialite_0286_b2043a5a",
        "confidentialite_0287_2c7fad29",
        "confidentialite_0288_21855c4e",
        "confidentialite_0289_87fa5817",
        "confidentialite_0290_d883059d",
        "confidentialite_0291_71ee5903"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0292_cf307aa4"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0293_a021cf97"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0294_b052f958"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0295_46df34ab"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0296_8bc0f6fd",
        "confidentialite_0297_d9f1b7d3",
        "confidentialite_0298_1bbcd892",
        "confidentialite_0299_3f2cb204"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0300_e9d1f223"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0301_05b10116"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0302_99990497"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0303_acdf0124"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0304_accdd63c"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0305_bdd169a9",
        "confidentialite_0306_1c76b0b4",
        "confidentialite_0307_7394bc5e",
        "confidentialite_0308_669c3ea5",
        "confidentialite_0309_3d8ddd70",
        "confidentialite_0310_635af9e1",
        "confidentialite_0311_17e02875",
        "confidentialite_0312_e0b3db11",
        "confidentialite_0313_c851a547",
        "confidentialite_0314_6bfb21f5",
        "confidentialite_0315_8ab5d15d"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0316_12402927"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0317_9f7d9266"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0318_49821dca"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0319_c2f639f1"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0320_69a8264d"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0321_11704aec"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0322_57cb5808"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0323_ff50b5e9",
        "confidentialite_0324_a31ee719",
        "confidentialite_0325_178b6c8e",
        "confidentialite_0326_1ac9272a",
        "confidentialite_0327_1074ac58",
        "confidentialite_0328_55c0ae0d",
        "confidentialite_0329_b5a48130",
        "confidentialite_0330_29369881",
        "confidentialite_0331_3493eaa1",
        "confidentialite_0332_e0b3db11",
        "confidentialite_0333_db51a7f1",
        "confidentialite_0334_67f699f5"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0335_65f1e4cd"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0336_0ea7f7e6"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0337_193bff4b"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0338_64a273f5"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0339_8f697b61",
        "confidentialite_0340_33476506",
        "confidentialite_0341_504e6da4",
        "confidentialite_0342_d028c7ed"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0343_c5292031"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0344_32117db4"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0345_05b10116"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0346_9f5bba46"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0347_fff855cb"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0348_1b139bf8"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0349_49238016"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0350_ddb4aa2c"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0351_4eecd31b"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0352_bb7b0a13"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0353_98b3c852"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0354_11e7a3b9"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0355_826fe990"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0356_e0b3db11"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0357_5c47c71f"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0358_d80b77e9"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0359_1074ac58"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0360_e74d169c"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0361_1579ed22"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0362_05a78270"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0363_cf5aef96"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0364_64e8ee3f"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0365_8f697b61"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0366_33476506"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0367_504e6da4"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0368_c4fea4cf"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0369_d028c7ed"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0370_f88b5e95"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0371_63cc52f2"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0372_05b10116"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0373_54b035a3"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0374_677752c2"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0375_34835871"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0376_98c7051f"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0377_b70d6edf"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0378_1d0e1190"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0379_cf8ad886"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0380_786b0559"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0381_442f4ac3"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0382_05b10116"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0383_db292814"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0384_2058176f"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0385_6544fa99",
        "confidentialite_0386_0672ca52",
        "confidentialite_0387_31507c26",
        "confidentialite_0388_853803a3",
        "confidentialite_0389_cbd84993",
        "confidentialite_0390_c1c7f9f3",
        "confidentialite_0391_f7f80819",
        "confidentialite_0392_ec386f6e",
        "confidentialite_0393_90016b83"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0394_3034978f"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0395_867f98c8"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0396_4aa3bcff",
        "confidentialite_0397_251db963",
        "confidentialite_0398_65df136e",
        "confidentialite_0399_0e7c454e",
        "confidentialite_0400_8ece80ba",
        "confidentialite_0401_16116809",
        "confidentialite_0402_f14260ea",
        "confidentialite_0403_1d2cc9dc",
        "confidentialite_0404_f7a2dcff"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0405_112a6b13"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0406_0e468519"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0407_f0a5ca37"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0408_e6e3cbec"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0409_4954cd49"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0410_695d96a5"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0411_a665791a"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0412_785c5b07"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0413_0aa210e9",
        "confidentialite_0414_31c65c39",
        "confidentialite_0415_d60c262c",
        "confidentialite_0416_91986cc8",
        "confidentialite_0417_b13f8231",
        "confidentialite_0418_4f168f6c",
        "confidentialite_0419_02f2dbe0",
        "confidentialite_0420_732797d2"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0421_3f8c96ec"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0422_d2981bd0"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0423_59bd769b"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0424_cfb9fef4"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0425_ea0133de",
        "confidentialite_0426_56997514",
        "confidentialite_0427_c7555b95"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0428_91f8f78a"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0429_ce66c320"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0430_ad817907"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0431_a4fc1a67",
        "confidentialite_0432_29ec90db",
        "confidentialite_0433_ea990f9c",
        "confidentialite_0434_b75c5d0b",
        "confidentialite_0435_4db2d6b1",
        "confidentialite_0436_71a6205d",
        "confidentialite_0437_7005a99e",
        "confidentialite_0438_90308537",
        "confidentialite_0439_00c29034",
        "confidentialite_0440_7c252931",
        "confidentialite_0441_10a4f5c3",
        "confidentialite_0442_79e5dd66",
        "confidentialite_0443_8193c520",
        "confidentialite_0444_54ba16fe",
        "confidentialite_0445_a269a63e",
        "confidentialite_0446_ca74b89a",
        "confidentialite_0447_a396668c",
        "confidentialite_0448_0e8bdb25",
        "confidentialite_0449_78efc2f5",
        "confidentialite_0450_91f869dc",
        "confidentialite_0451_89d9ad03",
        "confidentialite_0452_31d3685e"
      ]
    },
    {
      "kind": "heading",
      "key": "confidentialite_0453_27a11b7f"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0454_5c770ae1"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0455_0451ba68",
        "confidentialite_0456_a1bf271a",
        "confidentialite_0457_58f11abc",
        "confidentialite_0458_6aaf4975",
        "confidentialite_0459_07a5f644",
        "confidentialite_0460_401fc6eb",
        "confidentialite_0461_d0c40bbb",
        "confidentialite_0462_b18d6f8a",
        "confidentialite_0463_9d3a9773",
        "confidentialite_0464_9597bdcc",
        "confidentialite_0465_b340078e",
        "confidentialite_0466_084e1a9a",
        "confidentialite_0467_9b858888",
        "confidentialite_0468_9cfe1ad8"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0469_6876dd14"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0470_6eeca0a7",
        "confidentialite_0471_3a27c97e",
        "confidentialite_0472_2bc02af1",
        "confidentialite_0473_f87a4f6a",
        "confidentialite_0474_1e2bcba4",
        "confidentialite_0475_b2043a5a",
        "confidentialite_0476_72f2b621",
        "confidentialite_0477_d8e6add2",
        "confidentialite_0478_e1d2797c",
        "confidentialite_0479_98627b6b",
        "confidentialite_0480_2c7fad29",
        "confidentialite_0481_7b571b24",
        "confidentialite_0482_234b640d",
        "confidentialite_0483_afd154b2",
        "confidentialite_0484_c6fc2fe2",
        "confidentialite_0485_20e93ca0",
        "confidentialite_0486_ef38acbb",
        "confidentialite_0487_cd84e8fc",
        "confidentialite_0488_5aa1292e",
        "confidentialite_0489_9b633ca7",
        "confidentialite_0490_75945a55",
        "confidentialite_0491_2f301144",
        "confidentialite_0492_df07576a"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0493_16eed36d"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0494_d8673686"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0495_054a06ba"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0496_4b9cc908"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0497_1cf1f1b6"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0498_928de6fc",
        "confidentialite_0499_35f32ecb",
        "confidentialite_0500_2ef5809d",
        "confidentialite_0501_855e16b1"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0502_56720f2c"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0503_025c3213"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0504_481ccf63"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0505_966162cd"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0506_ac141f55"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0507_d92fc401"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0508_f9d41e42"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0509_6ceb003a"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0510_08d61317"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0511_974f49d7"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0512_139a3b79"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0513_e0b1bcaf"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0514_cafc3720"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0515_a6c89ebd"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0516_628c01b0"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0517_14c20b66"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0518_8ada54ce"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0519_baa28f03"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0520_59ab67dd"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0521_d5a726e8"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0522_4a1620f1"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0523_3ab2c0ba"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0524_5aa10797"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0525_b1f30c6d"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0526_188d0694"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0527_f26b1f2b",
        "confidentialite_0528_9f3ef820",
        "confidentialite_0529_6aa06ff7",
        "confidentialite_0530_2c7ec78a",
        "confidentialite_0531_4206b920",
        "confidentialite_0532_dc9eecfe",
        "confidentialite_0533_1336e413",
        "confidentialite_0534_fd185276",
        "confidentialite_0535_72119962",
        "confidentialite_0536_fdbe0135",
        "confidentialite_0537_3413b85f",
        "confidentialite_0538_b25058de",
        "confidentialite_0539_8044916b",
        "confidentialite_0540_49c205a8"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0541_6f8418d3"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0542_231cd848"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0543_e162d232"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0544_e8cdec29"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0545_320e62c8"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0546_3c66145c",
        "confidentialite_0547_17cdcd94",
        "confidentialite_0548_5d632992",
        "confidentialite_0549_c901ac07"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0550_0448d5e3"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0551_212550a6"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0552_7d198d58"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0553_96d697b2"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0554_13a18eb1"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0555_4404b2c3",
        "confidentialite_0556_cb23917b",
        "confidentialite_0557_8d82c516",
        "confidentialite_0558_edf064a8",
        "confidentialite_0559_f26aaf2e",
        "confidentialite_0560_b4a928bb",
        "confidentialite_0561_d7b2e78e",
        "confidentialite_0562_32b53659"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0563_690937dc"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0564_33826b7f"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0565_77133997"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0566_c10d289e"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0567_d674b63b"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0568_38086ae8"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0569_a0a3a0c8"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0570_f79acbc5"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0571_ef7e7a6d"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0572_cbb386cd"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0573_8c4ae342"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0574_8f9a6fcb"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0575_16e1de50"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0576_d32a3a30"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0577_cbce5760"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0578_05afbb8b"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0579_e3a4f889"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0580_bce75293"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0581_4d33fa11"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0582_edf8c9a8"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0583_eb600eb1"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0584_f3c70740"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0585_207a0ffc"
    },
    {
      "kind": "list",
      "keys": [
        "confidentialite_0586_5a883042",
        "confidentialite_0587_6c5ffd67",
        "confidentialite_0588_0bebb7b9",
        "confidentialite_0589_def9e759",
        "confidentialite_0590_cd628b60",
        "confidentialite_0591_2ad0efb9"
      ]
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0592_c9b067c6"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0593_b762175a"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0594_4a146396"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0595_99234877"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0596_6bfef9d5"
    },
    {
      "kind": "heading",
      "key": "confidentialite_0597_11fea964"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0598_1d265040"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0599_35db60cf"
    },
    {
      "kind": "paragraph",
      "key": "confidentialite_0600_45c15dab"
    }
  ],
  "cga": [
    {
      "kind": "heading",
      "key": "cga_0001_07cc4bf9"
    },
    {
      "kind": "paragraph",
      "key": "cga_0002_ee5746f0"
    },
    {
      "kind": "paragraph",
      "key": "cga_0003_c1370014"
    },
    {
      "kind": "paragraph",
      "key": "cga_0004_9b03dea6"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0005_a80085fe",
        "cga_0006_88bfc970",
        "cga_0007_2dc6c25c",
        "cga_0008_ae9ea543",
        "cga_0009_4e1cf312",
        "cga_0010_8cbedcb4",
        "cga_0011_1b3be119"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0012_4136e6ef"
    },
    {
      "kind": "paragraph",
      "key": "cga_0013_8bc741a9"
    },
    {
      "kind": "heading",
      "key": "cga_0014_b9d3edde"
    },
    {
      "kind": "paragraph",
      "key": "cga_0015_41b3864a"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0016_24ed8f7e",
        "cga_0017_7f1d04e5",
        "cga_0018_d9144641",
        "cga_0019_05842c71",
        "cga_0020_d1997beb",
        "cga_0021_7277af9a",
        "cga_0022_5f794ead",
        "cga_0023_143a1979",
        "cga_0024_07e2e8b5",
        "cga_0025_abf79f3e",
        "cga_0026_f4020b3e",
        "cga_0027_753388f0",
        "cga_0028_e359ecee"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0029_779a2e20"
    },
    {
      "kind": "paragraph",
      "key": "cga_0030_7f12e989"
    },
    {
      "kind": "heading",
      "key": "cga_0031_d3423751"
    },
    {
      "kind": "paragraph",
      "key": "cga_0032_4b36de77"
    },
    {
      "kind": "paragraph",
      "key": "cga_0033_d169fc23"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0034_74e31d25",
        "cga_0035_1116ceff",
        "cga_0036_b467e086",
        "cga_0037_4276dc53",
        "cga_0038_7a50965a",
        "cga_0039_bf8d35cc"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0040_dfe10048"
    },
    {
      "kind": "paragraph",
      "key": "cga_0041_269ba2d5"
    },
    {
      "kind": "heading",
      "key": "cga_0042_bbe34a39"
    },
    {
      "kind": "paragraph",
      "key": "cga_0043_52fe2d58"
    },
    {
      "kind": "paragraph",
      "key": "cga_0044_77039a6c"
    },
    {
      "kind": "paragraph",
      "key": "cga_0045_45cdd4d8"
    },
    {
      "kind": "paragraph",
      "key": "cga_0046_d52a9aa3"
    },
    {
      "kind": "heading",
      "key": "cga_0047_a45f0f19"
    },
    {
      "kind": "paragraph",
      "key": "cga_0048_1409d18f"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0049_a411b346",
        "cga_0050_2ea09c29",
        "cga_0051_b4b36e5d",
        "cga_0052_2c9493e7",
        "cga_0053_7d1408e7"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0054_2b9f75aa"
    },
    {
      "kind": "paragraph",
      "key": "cga_0055_bf4b61ed"
    },
    {
      "kind": "paragraph",
      "key": "cga_0056_62a286ee"
    },
    {
      "kind": "paragraph",
      "key": "cga_0057_2fcb373a"
    },
    {
      "kind": "paragraph",
      "key": "cga_0058_f6b8eb85"
    },
    {
      "kind": "paragraph",
      "key": "cga_0059_8c6b9746"
    },
    {
      "kind": "paragraph",
      "key": "cga_0060_7d2708b4"
    },
    {
      "kind": "heading",
      "key": "cga_0061_2383181d"
    },
    {
      "kind": "paragraph",
      "key": "cga_0062_6de5f686"
    },
    {
      "kind": "paragraph",
      "key": "cga_0063_deaeec6e"
    },
    {
      "kind": "paragraph",
      "key": "cga_0064_ef9ea8ff"
    },
    {
      "kind": "paragraph",
      "key": "cga_0065_f280ba3a"
    },
    {
      "kind": "paragraph",
      "key": "cga_0066_956371f0"
    },
    {
      "kind": "paragraph",
      "key": "cga_0067_8e686263"
    },
    {
      "kind": "paragraph",
      "key": "cga_0068_15cc3488"
    },
    {
      "kind": "paragraph",
      "key": "cga_0069_89cb68de"
    },
    {
      "kind": "heading",
      "key": "cga_0070_072b9067"
    },
    {
      "kind": "paragraph",
      "key": "cga_0071_4dff312c"
    },
    {
      "kind": "paragraph",
      "key": "cga_0072_afefcda7"
    },
    {
      "kind": "paragraph",
      "key": "cga_0073_5f4e882d"
    },
    {
      "kind": "paragraph",
      "key": "cga_0074_45002bba"
    },
    {
      "kind": "paragraph",
      "key": "cga_0075_37b71812"
    },
    {
      "kind": "paragraph",
      "key": "cga_0076_0cda3070"
    },
    {
      "kind": "paragraph",
      "key": "cga_0077_241c5bed"
    },
    {
      "kind": "paragraph",
      "key": "cga_0078_93d0560a"
    },
    {
      "kind": "heading",
      "key": "cga_0079_667b8b78"
    },
    {
      "kind": "paragraph",
      "key": "cga_0080_7070359f"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0081_b98f158d",
        "cga_0082_0f727e75",
        "cga_0083_48bc5aa6",
        "cga_0084_21572fed",
        "cga_0085_f822022f"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0086_20e1539f"
    },
    {
      "kind": "paragraph",
      "key": "cga_0087_d6d6dc8a"
    },
    {
      "kind": "heading",
      "key": "cga_0088_bb232ea2"
    },
    {
      "kind": "paragraph",
      "key": "cga_0089_e2ca21f2"
    },
    {
      "kind": "paragraph",
      "key": "cga_0090_4e563fe7"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0091_f0b6721c",
        "cga_0092_dff028ef",
        "cga_0093_f78659de",
        "cga_0094_f6a50c52",
        "cga_0095_84630f08",
        "cga_0096_146df782",
        "cga_0097_5e39aa99"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0098_069b6b5d"
    },
    {
      "kind": "paragraph",
      "key": "cga_0099_91ffed96"
    },
    {
      "kind": "paragraph",
      "key": "cga_0100_fbaae28b"
    },
    {
      "kind": "paragraph",
      "key": "cga_0101_deb62937"
    },
    {
      "kind": "heading",
      "key": "cga_0102_a2c0e258"
    },
    {
      "kind": "paragraph",
      "key": "cga_0103_6741bfda"
    },
    {
      "kind": "paragraph",
      "key": "cga_0104_b743150d"
    },
    {
      "kind": "paragraph",
      "key": "cga_0105_238ae125"
    },
    {
      "kind": "paragraph",
      "key": "cga_0106_aaabd377"
    },
    {
      "kind": "paragraph",
      "key": "cga_0107_4f09a372"
    },
    {
      "kind": "paragraph",
      "key": "cga_0108_fe198fb0"
    },
    {
      "kind": "paragraph",
      "key": "cga_0109_23fd45ae"
    },
    {
      "kind": "heading",
      "key": "cga_0110_7e333f6b"
    },
    {
      "kind": "paragraph",
      "key": "cga_0111_74687762"
    },
    {
      "kind": "paragraph",
      "key": "cga_0112_8739fbfd"
    },
    {
      "kind": "paragraph",
      "key": "cga_0113_513c4224"
    },
    {
      "kind": "paragraph",
      "key": "cga_0114_9c43e048"
    },
    {
      "kind": "heading",
      "key": "cga_0115_054b0000"
    },
    {
      "kind": "paragraph",
      "key": "cga_0116_95fa26d4"
    },
    {
      "kind": "paragraph",
      "key": "cga_0117_92d303b2"
    },
    {
      "kind": "paragraph",
      "key": "cga_0118_3086820a"
    },
    {
      "kind": "paragraph",
      "key": "cga_0119_0505b765"
    },
    {
      "kind": "paragraph",
      "key": "cga_0120_50ddaac9"
    },
    {
      "kind": "paragraph",
      "key": "cga_0121_0e3e59f4"
    },
    {
      "kind": "heading",
      "key": "cga_0122_61deaf9a"
    },
    {
      "kind": "paragraph",
      "key": "cga_0123_d1b2f421"
    },
    {
      "kind": "paragraph",
      "key": "cga_0124_e7069dee"
    },
    {
      "kind": "paragraph",
      "key": "cga_0125_63b62305"
    },
    {
      "kind": "paragraph",
      "key": "cga_0126_9609b3c3"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0127_57b0a1d9",
        "cga_0128_ec0a3632",
        "cga_0129_e77e4554",
        "cga_0130_42a0c500",
        "cga_0131_459856ac",
        "cga_0132_a0af5a6f"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0133_624a7bfb"
    },
    {
      "kind": "heading",
      "key": "cga_0134_e0e745ed"
    },
    {
      "kind": "paragraph",
      "key": "cga_0135_9e0690ba"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0136_b2043a5a",
        "cga_0137_72f2b621",
        "cga_0138_d8e6add2",
        "cga_0139_e1d2797c",
        "cga_0140_98627b6b",
        "cga_0141_2c7fad29",
        "cga_0142_7b571b24",
        "cga_0143_234b640d",
        "cga_0144_afd154b2",
        "cga_0145_c6fc2fe2",
        "cga_0146_ef38acbb",
        "cga_0147_cd84e8fc",
        "cga_0148_5aa1292e",
        "cga_0149_9b633ca7",
        "cga_0150_75945a55",
        "cga_0151_20e93ca0",
        "cga_0152_2f301144",
        "cga_0153_e5f31dce",
        "cga_0154_c2209505",
        "cga_0155_e0c09dc3",
        "cga_0156_71be6bc9",
        "cga_0157_8b79c83b"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0158_ced4b06c"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0159_86d441e1",
        "cga_0160_1fec500f",
        "cga_0161_e93e53c6",
        "cga_0162_d25a483d",
        "cga_0163_fc08794b"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0164_3cdae42f"
    },
    {
      "kind": "paragraph",
      "key": "cga_0165_6c17125b"
    },
    {
      "kind": "paragraph",
      "key": "cga_0166_794d8a85"
    },
    {
      "kind": "heading",
      "key": "cga_0167_b8372220"
    },
    {
      "kind": "paragraph",
      "key": "cga_0168_478dbd44"
    },
    {
      "kind": "paragraph",
      "key": "cga_0169_4397dd43"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0170_ca047694",
        "cga_0171_50b13ce5",
        "cga_0172_eb7088dc",
        "cga_0173_da2b450d",
        "cga_0174_8220ef2b",
        "cga_0175_625a8262",
        "cga_0176_ff400dea",
        "cga_0177_47127a09"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0178_b7e2bf98"
    },
    {
      "kind": "paragraph",
      "key": "cga_0179_47395c3d"
    },
    {
      "kind": "paragraph",
      "key": "cga_0180_2d1d8dbf"
    },
    {
      "kind": "paragraph",
      "key": "cga_0181_d0a4205b"
    },
    {
      "kind": "heading",
      "key": "cga_0182_d1014980"
    },
    {
      "kind": "paragraph",
      "key": "cga_0183_a5e1ab84"
    },
    {
      "kind": "paragraph",
      "key": "cga_0184_4397dd43"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0185_f4281f58",
        "cga_0186_a4ce0e9e",
        "cga_0187_cb878423",
        "cga_0188_8c5fc5f4",
        "cga_0189_fae19e3d",
        "cga_0190_9f7040c3",
        "cga_0191_cefd149f"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0192_617c6d20"
    },
    {
      "kind": "paragraph",
      "key": "cga_0193_4f510c35"
    },
    {
      "kind": "paragraph",
      "key": "cga_0194_caee5008"
    },
    {
      "kind": "paragraph",
      "key": "cga_0195_d4bff851"
    },
    {
      "kind": "heading",
      "key": "cga_0196_f62094f9"
    },
    {
      "kind": "paragraph",
      "key": "cga_0197_ad36db81"
    },
    {
      "kind": "paragraph",
      "key": "cga_0198_4397dd43"
    },
    {
      "kind": "paragraph",
      "key": "cga_0199_812a26ba"
    },
    {
      "kind": "paragraph",
      "key": "cga_0200_dbfa92b5"
    },
    {
      "kind": "paragraph",
      "key": "cga_0201_07f0732e"
    },
    {
      "kind": "paragraph",
      "key": "cga_0202_8c5fc5f4"
    },
    {
      "kind": "paragraph",
      "key": "cga_0203_73bd6d5f"
    },
    {
      "kind": "paragraph",
      "key": "cga_0204_51d596ac"
    },
    {
      "kind": "paragraph",
      "key": "cga_0205_3cfd0cce"
    },
    {
      "kind": "paragraph",
      "key": "cga_0206_e9e959f5"
    },
    {
      "kind": "paragraph",
      "key": "cga_0207_18f817f5"
    },
    {
      "kind": "paragraph",
      "key": "cga_0208_d19db461"
    },
    {
      "kind": "paragraph",
      "key": "cga_0209_762c5bba"
    },
    {
      "kind": "paragraph",
      "key": "cga_0210_b4c387ce"
    },
    {
      "kind": "paragraph",
      "key": "cga_0211_ff920edb"
    },
    {
      "kind": "paragraph",
      "key": "cga_0212_2f110e69"
    },
    {
      "kind": "paragraph",
      "key": "cga_0213_d2311a30"
    },
    {
      "kind": "paragraph",
      "key": "cga_0214_92187fc8"
    },
    {
      "kind": "paragraph",
      "key": "cga_0215_75428b0f"
    },
    {
      "kind": "paragraph",
      "key": "cga_0216_32b1097a"
    },
    {
      "kind": "paragraph",
      "key": "cga_0217_f2be8f39"
    },
    {
      "kind": "paragraph",
      "key": "cga_0218_b17650a7"
    },
    {
      "kind": "paragraph",
      "key": "cga_0219_8ee6a8b8"
    },
    {
      "kind": "paragraph",
      "key": "cga_0220_0f6f0af2"
    },
    {
      "kind": "paragraph",
      "key": "cga_0221_540b93df"
    },
    {
      "kind": "paragraph",
      "key": "cga_0222_e1c12a58"
    },
    {
      "kind": "paragraph",
      "key": "cga_0223_cb719f29"
    },
    {
      "kind": "paragraph",
      "key": "cga_0224_8d5a7cdd"
    },
    {
      "kind": "paragraph",
      "key": "cga_0225_9cbbf4c8"
    },
    {
      "kind": "paragraph",
      "key": "cga_0226_a9b04ceb"
    },
    {
      "kind": "paragraph",
      "key": "cga_0227_22ab6cab"
    },
    {
      "kind": "heading",
      "key": "cga_0228_b7ea11a2"
    },
    {
      "kind": "paragraph",
      "key": "cga_0229_e45724eb"
    },
    {
      "kind": "paragraph",
      "key": "cga_0230_4397dd43"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0231_f19bce4d",
        "cga_0232_22166d4f",
        "cga_0233_df72db83",
        "cga_0234_b971bb01",
        "cga_0235_ba5f0b5b",
        "cga_0236_ca5e7f79",
        "cga_0237_9f7040c3",
        "cga_0238_2de3da4c",
        "cga_0239_b904bc2a",
        "cga_0240_84b21889"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0241_e5ed504b"
    },
    {
      "kind": "paragraph",
      "key": "cga_0242_762c5bba"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0243_b519e965",
        "cga_0244_ff920edb",
        "cga_0245_2f110e69",
        "cga_0246_fda3353c",
        "cga_0247_475bb04d",
        "cga_0248_2c6f775c",
        "cga_0249_6b481d2a"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0250_f2be8f39"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0251_acf8c6ec",
        "cga_0252_45f44880",
        "cga_0253_0f6f0af2",
        "cga_0254_540b93df",
        "cga_0255_e1c12a58",
        "cga_0256_cb719f29",
        "cga_0257_74fd6196"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0258_a8cde09d"
    },
    {
      "kind": "paragraph",
      "key": "cga_0259_5af0f40f"
    },
    {
      "kind": "paragraph",
      "key": "cga_0260_31eba565"
    },
    {
      "kind": "paragraph",
      "key": "cga_0261_8bf1bb28"
    },
    {
      "kind": "heading",
      "key": "cga_0262_92def17b"
    },
    {
      "kind": "paragraph",
      "key": "cga_0263_699c2d07"
    },
    {
      "kind": "paragraph",
      "key": "cga_0264_f2be8f39"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0265_ca920637",
        "cga_0266_d99b5ecd",
        "cga_0267_4d4e8922",
        "cga_0268_e31f5f48",
        "cga_0269_8167d1b8",
        "cga_0270_77da034c",
        "cga_0271_c5f12a4a",
        "cga_0272_8e98632e"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0273_12826950"
    },
    {
      "kind": "heading",
      "key": "cga_0274_1d66be8d"
    },
    {
      "kind": "paragraph",
      "key": "cga_0275_d96f5da3"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0276_e49f4c5e",
        "cga_0277_bd673bd8",
        "cga_0278_5643561a",
        "cga_0279_ee16363f",
        "cga_0280_7db6ac4c",
        "cga_0281_a05ff4bd"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0282_98abd1fc"
    },
    {
      "kind": "paragraph",
      "key": "cga_0283_73e4e160"
    },
    {
      "kind": "heading",
      "key": "cga_0284_284bbc09"
    },
    {
      "kind": "paragraph",
      "key": "cga_0285_e3f18405"
    },
    {
      "kind": "paragraph",
      "key": "cga_0286_52dd7b92"
    },
    {
      "kind": "paragraph",
      "key": "cga_0287_45441bd2"
    },
    {
      "kind": "paragraph",
      "key": "cga_0288_51ebf026"
    },
    {
      "kind": "paragraph",
      "key": "cga_0289_c72037ce"
    },
    {
      "kind": "heading",
      "key": "cga_0290_d1bffc13"
    },
    {
      "kind": "paragraph",
      "key": "cga_0291_8376a5b8"
    },
    {
      "kind": "paragraph",
      "key": "cga_0292_a2ac6ad1"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0293_416f1053",
        "cga_0294_331fab37",
        "cga_0295_41842df8",
        "cga_0296_5fa8393b",
        "cga_0297_e90080dc",
        "cga_0298_f25c2449"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0299_1885613e"
    },
    {
      "kind": "paragraph",
      "key": "cga_0300_c2b67c6d"
    },
    {
      "kind": "paragraph",
      "key": "cga_0301_0e2971e7"
    },
    {
      "kind": "paragraph",
      "key": "cga_0302_58918421"
    },
    {
      "kind": "heading",
      "key": "cga_0303_43314422"
    },
    {
      "kind": "paragraph",
      "key": "cga_0304_bf350da9"
    },
    {
      "kind": "paragraph",
      "key": "cga_0305_5376940a"
    },
    {
      "kind": "paragraph",
      "key": "cga_0306_b93bce98"
    },
    {
      "kind": "paragraph",
      "key": "cga_0307_868cee3e"
    },
    {
      "kind": "paragraph",
      "key": "cga_0308_1db59c9e"
    },
    {
      "kind": "heading",
      "key": "cga_0309_afc582ab"
    },
    {
      "kind": "paragraph",
      "key": "cga_0310_41bd9ada"
    },
    {
      "kind": "paragraph",
      "key": "cga_0311_855c0afb"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0312_8db2ced7",
        "cga_0313_ac21998e",
        "cga_0314_2d700e6a",
        "cga_0315_b02c31b5",
        "cga_0316_85120eb5",
        "cga_0317_b0efcffa",
        "cga_0318_b1a6d167"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0319_dc7647a8"
    },
    {
      "kind": "heading",
      "key": "cga_0320_96d85f13"
    },
    {
      "kind": "paragraph",
      "key": "cga_0321_6841d4eb"
    },
    {
      "kind": "paragraph",
      "key": "cga_0322_855c0afb"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0323_ac7951a4",
        "cga_0324_2383c84f",
        "cga_0325_308781b0",
        "cga_0326_0a10cc56",
        "cga_0327_001c5ec5"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0328_25a8b46d"
    },
    {
      "kind": "heading",
      "key": "cga_0329_403ab7f9"
    },
    {
      "kind": "heading",
      "key": "cga_0330_37bce6a7"
    },
    {
      "kind": "paragraph",
      "key": "cga_0331_dc4e2ffc"
    },
    {
      "kind": "paragraph",
      "key": "cga_0332_3c3c9937"
    },
    {
      "kind": "paragraph",
      "key": "cga_0333_f24a5c78"
    },
    {
      "kind": "heading",
      "key": "cga_0334_079147b4"
    },
    {
      "kind": "paragraph",
      "key": "cga_0335_9abdffed"
    },
    {
      "kind": "heading",
      "key": "cga_0336_0e31d944"
    },
    {
      "kind": "paragraph",
      "key": "cga_0337_47071ca0"
    },
    {
      "kind": "paragraph",
      "key": "cga_0338_301b2e72"
    },
    {
      "kind": "paragraph",
      "key": "cga_0339_52dde215"
    },
    {
      "kind": "heading",
      "key": "cga_0340_14fc9e61"
    },
    {
      "kind": "paragraph",
      "key": "cga_0341_d0bbb16b"
    },
    {
      "kind": "paragraph",
      "key": "cga_0342_e09a4659"
    },
    {
      "kind": "paragraph",
      "key": "cga_0343_6310ff8e"
    },
    {
      "kind": "paragraph",
      "key": "cga_0344_eaf31e3b"
    },
    {
      "kind": "paragraph",
      "key": "cga_0345_d7e40344"
    },
    {
      "kind": "paragraph",
      "key": "cga_0346_a364b614"
    },
    {
      "kind": "heading",
      "key": "cga_0347_94f487b2"
    },
    {
      "kind": "paragraph",
      "key": "cga_0348_63590655"
    },
    {
      "kind": "paragraph",
      "key": "cga_0349_2f5c56be"
    },
    {
      "kind": "paragraph",
      "key": "cga_0350_64f5618a"
    },
    {
      "kind": "paragraph",
      "key": "cga_0351_64518181"
    },
    {
      "kind": "paragraph",
      "key": "cga_0352_e42b4b3b"
    },
    {
      "kind": "heading",
      "key": "cga_0353_2cbbd7aa"
    },
    {
      "kind": "paragraph",
      "key": "cga_0354_c9ff7524"
    },
    {
      "kind": "paragraph",
      "key": "cga_0355_9f56a2ec"
    },
    {
      "kind": "paragraph",
      "key": "cga_0356_822e968a"
    },
    {
      "kind": "paragraph",
      "key": "cga_0357_ec8e2e3d"
    },
    {
      "kind": "heading",
      "key": "cga_0358_60e540a1"
    },
    {
      "kind": "paragraph",
      "key": "cga_0359_18d4d481"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0360_49ef567d",
        "cga_0361_a7777fd8",
        "cga_0362_f56bf3cb",
        "cga_0363_b7843f02",
        "cga_0364_7fa90190",
        "cga_0365_720bf607"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0366_bf4899ca"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0367_6a64649a",
        "cga_0368_a1eaff70",
        "cga_0369_f1e64f37",
        "cga_0370_a22a0894",
        "cga_0371_1dbc11d7",
        "cga_0372_77b6810f",
        "cga_0373_9b1a019c",
        "cga_0374_cecc0f61"
      ]
    },
    {
      "kind": "heading",
      "key": "cga_0375_acfcd65f"
    },
    {
      "kind": "paragraph",
      "key": "cga_0376_d49517a4"
    },
    {
      "kind": "paragraph",
      "key": "cga_0377_d4d6df44"
    },
    {
      "kind": "paragraph",
      "key": "cga_0378_0fec0765"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0379_58052ecd",
        "cga_0380_046343b2"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0381_d3d1a18f"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0382_8595fda2",
        "cga_0383_732f9cb0",
        "cga_0384_24f5fe62",
        "cga_0385_d26cef57",
        "cga_0386_c29249cc",
        "cga_0387_2e065cfc",
        "cga_0388_54f42fd9",
        "cga_0389_fea3bdd9",
        "cga_0390_4f5735c0",
        "cga_0391_7797b81c",
        "cga_0392_6e6e68c0",
        "cga_0393_53dc594f",
        "cga_0394_f8a51a25",
        "cga_0395_774608c8",
        "cga_0396_c65cc0ec"
      ]
    },
    {
      "kind": "heading",
      "key": "cga_0397_8ef5234c"
    },
    {
      "kind": "paragraph",
      "key": "cga_0398_9f229acd"
    },
    {
      "kind": "list",
      "keys": [
        "cga_0399_2cb33e7a",
        "cga_0400_24b50552",
        "cga_0401_036fdcbe",
        "cga_0402_ab43cbbb",
        "cga_0403_f27da62a",
        "cga_0404_349d7e38",
        "cga_0405_b2cca5f5",
        "cga_0406_58afa3cc",
        "cga_0407_2e50d069"
      ]
    },
    {
      "kind": "paragraph",
      "key": "cga_0408_3dd6a741"
    },
    {
      "kind": "paragraph",
      "key": "cga_0409_a945455e"
    },
    {
      "kind": "heading",
      "key": "cga_0410_01ad2f08"
    },
    {
      "kind": "paragraph",
      "key": "cga_0411_7cbf5f41"
    },
    {
      "kind": "paragraph",
      "key": "cga_0412_c57cc655"
    },
    {
      "kind": "paragraph",
      "key": "cga_0413_badc512f"
    },
    {
      "kind": "paragraph",
      "key": "cga_0414_5912ce5b"
    },
    {
      "kind": "paragraph",
      "key": "cga_0415_b8cce55f"
    },
    {
      "kind": "heading",
      "key": "cga_0416_60a94414"
    },
    {
      "kind": "paragraph",
      "key": "cga_0417_e48c0f96"
    },
    {
      "kind": "paragraph",
      "key": "cga_0418_0d990cb4"
    },
    {
      "kind": "paragraph",
      "key": "cga_0419_7dcac031"
    },
    {
      "kind": "heading",
      "key": "cga_0420_8e11f420"
    },
    {
      "kind": "paragraph",
      "key": "cga_0421_70cc54de"
    },
    {
      "kind": "heading",
      "key": "cga_0422_64bc9695"
    },
    {
      "kind": "paragraph",
      "key": "cga_0423_8e570e04"
    },
    {
      "kind": "paragraph",
      "key": "cga_0424_1bb549ac"
    },
    {
      "kind": "paragraph",
      "key": "cga_0425_37228ebd"
    },
    {
      "kind": "heading",
      "key": "cga_0426_ab458811"
    },
    {
      "kind": "paragraph",
      "key": "cga_0427_8f4c4870"
    },
    {
      "kind": "heading",
      "key": "cga_0428_add10adc"
    },
    {
      "kind": "paragraph",
      "key": "cga_0429_e117176b"
    },
    {
      "kind": "paragraph",
      "key": "cga_0430_9259b5c4"
    },
    {
      "kind": "paragraph",
      "key": "cga_0431_e5f86426"
    },
    {
      "kind": "paragraph",
      "key": "cga_0432_86f6e0f5"
    },
    {
      "kind": "heading",
      "key": "cga_0433_fb8af4e7"
    },
    {
      "kind": "paragraph",
      "key": "cga_0434_c1c1632b"
    },
    {
      "kind": "paragraph",
      "key": "cga_0435_ed77b953"
    }
  ]
} as const satisfies Record<
  LegalDocumentId,
  readonly LegalDocumentBlock[]
>;
