import { getAddress, isAddress } from 'ethers';

/**
 * Protected collections: every official Yuga Labs / Bored Ape Yacht Club contract the wallet can see.
 *
 * Each address was checked on-chain on Nov 1, 2026 (name()/symbol() via public RPC, ERC-1155 via
 * supportsInterface(0xd9b67a26), and Alchemy getContractMetadata) and cross-checked against OpenSea's
 * verified-collection status (safelistRequestStatus "verified" + official slug). Extra sources are
 * listed per entry. Never add an address here without the same checks.
 *
 * The badge, the verified name and every protection come only from (chainId, contract). Off-chain
 * metadata never decides whether something is protected.
 */
export type ProtectedStandard = 'ERC-721' | 'ERC-1155' | 'ERC-20' | 'CryptoPunks';

export type ProtectedAsset = {
  key: string;
  name: string;
  short: string;
  chainId: 1 | 42161 | 56 | 33139;
  address: string;
  standard: ProtectedStandard;
  onchainName: string;
  source: string;
  note?: string;
  /** Who the collection belongs to. Omitted = Yuga Labs / BAYC. Yaper collections get the same protections and a "Protected" badge. */
  brand?: 'yaper';
};

export const PROTECTED_ASSETS: readonly ProtectedAsset[] = [
  { key: 'bayc', name: 'Bored Ape Yacht Club', short: 'BAYC', chainId: 1, address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', standard: 'ERC-721', onchainName: 'BoredApeYachtClub / BAYC', source: 'OpenSea verified boredapeyachtclub; yuga.com' },
  { key: 'mayc', name: 'Mutant Ape Yacht Club', short: 'MAYC', chainId: 1, address: '0x60E4d786628Fea6478F785A6d7e704777c86a7c6', standard: 'ERC-721', onchainName: 'MutantApeYachtClub / MAYC', source: 'OpenSea verified mutant-ape-yacht-club; yuga.com' },
  { key: 'bakc', name: 'Bored Ape Kennel Club', short: 'BAKC', chainId: 1, address: '0xba30E5F9Bb24caa003E9f2f0497Ad287FDF95623', standard: 'ERC-721', onchainName: 'BoredApeKennelClub / BAKC', source: 'OpenSea verified bored-ape-kennel-club; yuga.com' },
  { key: 'bacc', name: 'Bored Ape Chemistry Club', short: 'BACC', chainId: 1, address: '0x22c36BfdCef207F9c0CC941936eff94D4246d14A', standard: 'ERC-1155', onchainName: '(ERC-1155, no name())', source: 'OpenSea verified bored-ape-chemistry-club; yuga.com' },
  { key: 'otherdeed', name: 'Otherdeed for Otherside', short: 'OTHR', chainId: 1, address: '0x34d85c9CDeB23FA97cb08333b511ac86E1C4E258', standard: 'ERC-721', onchainName: 'Otherdeed / OTHR', source: 'OpenSea verified otherdeed' },
  { key: 'otherdeed-expanded', name: 'Otherdeed Expanded', short: 'EXP', chainId: 1, address: '0x790B2cF29Ed4F310bf7641f013C65D4560d28371', standard: 'ERC-721', onchainName: 'Otherdeed Expanded / EXP', source: 'OpenSea verified otherdeed-expanded; yuga.com' },
  { key: 'koda', name: 'Otherside Koda', short: 'KODA', chainId: 1, address: '0xE012Baf811CF9c05c408e879C399960D1f305903', standard: 'ERC-721', onchainName: 'Koda / KODA', source: 'OpenSea verified otherside-koda; yuga.com' },
  { key: 'kodamara', name: 'Kodamara', short: 'KODAMARA', chainId: 1, address: '0x56e6F1BFFde5DCcd9A183585cE31f2902FC52707', standard: 'ERC-721', onchainName: 'Kodamara / KODAMARA', source: 'OpenSea verified kodamara; yuga.com' },
  { key: 'mara', name: 'Otherside Mara', short: 'MARA', chainId: 1, address: '0x3Bdca51226202Fc2a64211Aa35A8d95D61C6ca99', standard: 'ERC-721', onchainName: 'Mara / MARA', source: 'OpenSea verified otherside-mara; yuga.com' },
  { key: 'vessels', name: 'Otherside Vessels', short: 'VSL', chainId: 1, address: '0x5b1085136a811e55b2Bb2CA1eA456bA82126A376', standard: 'ERC-721', onchainName: 'Vessel / VSL', source: 'OpenSea verified otherside-vessels' },
  { key: 'catalyst', name: 'Otherside Catalyst', short: 'CATALYST', chainId: 1, address: '0x41e4a828630dD4729fC010E9483CD900bb37FC79', standard: 'ERC-721', onchainName: 'Catalyst / CATALYST', source: 'OpenSea verified otherside-catalyst; Legends of the Mara FAQ (faq.lotm.gg)' },
  { key: 'ship-parts', name: 'Otherside Ship Parts', short: 'SHIP PARTS', chainId: 1, address: '0xDA98Cf8b3c6C4E05d568e6D38752cB6097414aB0', standard: 'ERC-1155', onchainName: '(ERC-1155, no name())', source: 'OpenSea verified otherside-ship-parts; Legends of the Mara FAQ' },
  { key: 'partner-loot', name: 'Otherside Partner Loot', short: 'PARTNER LOOT', chainId: 1, address: '0x307b00dd72A29e0828b52947a2AdcD9e899167c9', standard: 'ERC-1155', onchainName: '(ERC-1155, no name())', source: 'OpenSea verified otherside-partner-loot; Legends of the Mara FAQ' },
  { key: 'sewer-pass', name: 'Sewer Pass', short: 'SEWER', chainId: 1, address: '0x764AeebcF425d56800eF2c84F2578689415a2DAa', standard: 'ERC-721', onchainName: 'SewerPass / SEWER', source: 'OpenSea verified sewerpass', note: 'Dookey Dash pass.' },
  { key: 'hv-mtl', name: 'HV-MTL', short: 'HV-MTL', chainId: 1, address: '0x4b15a9c28034dC83db40CD810001427d3BD7163D', standard: 'ERC-721', onchainName: 'HV-MTL / HV-MTL', source: 'OpenSea verified hv-mtl' },
  { key: 'meebits', name: 'Meebits', short: 'MEEBITS', chainId: 1, address: '0x7Bd29408f11D2bFC23c34f18275bBf23bB716Bc7', standard: 'ERC-721', onchainName: 'Meebits', source: 'OpenSea verified meebits', note: 'Yuga sold the Meebits IP in early 2025; still protected.' },
  { key: 'cryptopunks', name: 'CryptoPunks', short: 'PUNKS', chainId: 1, address: '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB', standard: 'CryptoPunks', onchainName: 'CRYPTOPUNKS', source: 'OpenSea verified cryptopunks', note: 'Yuga sold the IP to Infinite Node Foundation in May 2025; still protected.' },
  { key: 'wrapped-punks', name: 'Wrapped CryptoPunks', short: 'WPUNKS', chainId: 1, address: '0xb7F7F6C52F2e2fdb1963Eab30438024864c313F6', standard: 'ERC-721', onchainName: 'Wrapped Cryptopunks / WPUNKS', source: 'OpenSea verified wrapped-cryptopunks', note: 'Community wrapper that holds real Punks.' },
  { key: 'v1-punks', name: 'CryptoPunks V1 (wrapped)', short: 'WPV1', chainId: 1, address: '0x282BDD42f4eb70e7A9D9F40c8fEA0825B7f68C5D', standard: 'ERC-721', onchainName: 'V1 Cryptopunks (Wrapped) / WPV1', source: 'OpenSea verified official-v1-punks' },
  { key: '10ktf', name: '10KTF Crafted Gear', short: '10KTF', chainId: 1, address: '0x0Cfb5d82BE2b949e8fa73A656dF91821E2aD99FD', standard: 'ERC-721', onchainName: '10KTF / 10KTF', source: 'OpenSea verified 10ktf; Etherscan tag "10KTF: 10KTF Token"' },
  { key: '10ktf-stockroom', name: '10KTF Stockroom', short: 'STOCKROOM', chainId: 1, address: '0x7DaEC605E9e2a1717326eeDFd660601e2753A057', standard: 'ERC-1155', onchainName: '(ERC-1155, no name())', source: 'OpenSea verified 10ktf-stockroom; Etherscan token "10KTF Stockroom"' },
  { key: 'ape-eth', name: 'ApeCoin', short: 'APE', chainId: 1, address: '0x4d224452801ACEd8B2F0aebE155379bb5D594381', standard: 'ERC-20', onchainName: 'ApeCoin / APE / 18', source: 'docs.apechain.com/ape-oft; apecoin.com' },
  { key: 'ape-arb', name: 'ApeCoin (Arbitrum)', short: 'APE', chainId: 42161, address: '0x7f9FBf9bDd3F4105C478b996B648FE6e828a1e98', standard: 'ERC-20', onchainName: 'ApeCoin / APE / 18', source: 'docs.apechain.com/ape-oft; ApeChain nativeToken in docs.apechain.com contract-information' },
  { key: 'ape-bsc', name: 'ApeCoin (BNB Chain)', short: 'APE', chainId: 56, address: '0x8f86a15EC17cb3369d8b3E666dAdBC11daA82b79', standard: 'ERC-20', onchainName: 'ApeCoin / APE / 18', source: 'docs.apechain.com/ape-oft' },
  // ApeChain (33139). Yuga "Shadow" collections mirror Ethereum ownership on ApeChain. Checked on-chain on Nov 3, 2026
  // via rpc.apechain.com: name()/symbol(), ERC-721 supportsInterface(0x80ac58cd), and owner(). BAYC / MAYC / BAKC / Koda
  // shadows sit at the SAME addresses as the Ethereum originals and were created by the same deployer accounts as on
  // Ethereum (Blockscout creator_address_hash). All six share one owner() 0x58a766b3210cee94ca150f767d842eb87a8d7ae8.
  { key: 'bayc-apechain', name: 'Bored Ape Yacht Club Shadow', short: 'BAYC', chainId: 33139, address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', standard: 'ERC-721', onchainName: 'Bored Ape Yacht Club Shadow / BAYC', source: 'ApeScan "Yuga Labs: BAYC Token"; creator 0xaBA7161A… (Ethereum BAYC deployer)' },
  { key: 'mayc-apechain', name: 'Mutant Ape Yacht Club Shadow', short: 'MAYC', chainId: 33139, address: '0x60E4d786628Fea6478F785A6d7e704777c86a7c6', standard: 'ERC-721', onchainName: 'Mutant Ape Yacht Club Shadow / MAYC', source: 'ApeScan "Yuga Labs: MAYC Token", creator "Yuga Labs: Deployer" 0x9056D15C… (Ethereum MAYC deployer)' },
  { key: 'bakc-apechain', name: 'Bored Ape Kennel Club Shadow', short: 'BAKC', chainId: 33139, address: '0xba30E5F9Bb24caa003E9f2f0497Ad287FDF95623', standard: 'ERC-721', onchainName: 'Bored Ape Kennel Club Shadow / BAKC', source: 'ApeScan "Yuga Labs: BAKC Token"; same owner() as BAYC/MAYC shadows' },
  { key: 'koda-apechain', name: 'Koda Shadow', short: 'KODA', chainId: 33139, address: '0xE012Baf811CF9c05c408e879C399960D1f305903', standard: 'ERC-721', onchainName: 'Koda Shadow / KODA', source: 'creator 0xCAC7c29b… (Ethereum Koda / Otherdeed Expanded deployer); same owner() as BAYC/MAYC shadows' },
  { key: 'otherdeed-expanded-apechain', name: 'Otherdeed Expanded Shadow', short: 'EXP', chainId: 33139, address: '0x000DeeD0005b8b7d8d87BAcA43AAD032A292155E', standard: 'ERC-721', onchainName: 'Otherdeed Expanded Shadow / EXP', source: 'same owner() as BAYC/MAYC shadows; ApeScan NFT list' },
  { key: 'punks-apechain', name: 'CryptoPunk Shadows', short: 'PUNKS', chainId: 33139, address: '0x000000000000a548CF4a87c15191945473068153', standard: 'ERC-721', onchainName: 'CryptoPunk Shadows / punks', source: 'same owner() as BAYC/MAYC shadows', note: 'Punks IP sold by Yuga in May 2025; still protected.' },
  // Yaper collections (Lil Apes, Lil Mutants): same top-tier NFT protections as Yuga, labeled "Protected", never "Yuga".
  // Checked Nov 3, 2026: OpenSea verified collections lil-apes (contract 0xAa84…650F, "By Yaper", 4,998 items, 2,310 owners)
  // and lil-mutants (contract 0x3B45…37ED, 9,999 items). Every contract below has owner() = yaper.eth
  // (0xAf4144C200CfCB09fc7695d38fF378225ddC5118, ENS-resolved). The Lil Apes OpenSea contract mirrors ownership of the
  // original Lil Baby Ape Club contract (same ownerOf(1); 5,000 minted, 2 at 0x…dEaD = 4,998), so both are protected.
  { key: 'lil-apes', name: 'Lil Apes', short: 'LIL APES', chainId: 1, address: '0xAa84ae8e0534cF682855222FD9186B2bcD9A650F', standard: 'ERC-721', onchainName: 'Lil Apes / LAPE (ERC-1967 proxy)', source: 'OpenSea verified lil-apes (By Yaper); owner() yaper.eth', brand: 'yaper' },
  { key: 'lil-apes-lbac', name: 'Lil Apes (original LBAC contract)', short: 'LBAC', chainId: 1, address: '0x918F677b3aB4B9290Ca96A95430FD228b2d84817', standard: 'ERC-721', onchainName: 'Lil Baby Ape Club / LBAC / 5,000', source: 'Etherscan "Lil Baby Ape Club: LBAC Token" (verified source); owner() yaper.eth; ownership mirrored by 0xAa84…650F', brand: 'yaper' },
  { key: 'lil-mutants', name: 'Lil Mutants', short: 'LIL MUTANTS', chainId: 1, address: '0x3B45542f6C97FE7f7aA3BB055c95e93B2c0437ED', standard: 'ERC-721', onchainName: 'LMACEXPERIMENT / LMAC / 10,000', source: 'OpenSea verified lil-mutants (By Yaper); Blockscout verified source; owner() yaper.eth', brand: 'yaper' },
  { key: 'lil-apes-apechain', name: 'Lil Apes Shadow', short: 'LAPE-S', chainId: 33139, address: '0x25F4b0339D6d026436342FA161fD2CE3C296A5e4', standard: 'ERC-721', onchainName: 'Lil Apes Shadow / LAPE-S', source: 'owner() yaper.eth (ApeScan: ownership accepted by yaper.eth); same deployer as the Ethereum Lil Apes proxy', brand: 'yaper' },
  { key: 'lil-mutants-apechain', name: 'Wrapped Lil Mutants', short: 'WLM', chainId: 33139, address: '0x3569347d4186557C51ACe5894bdD02366CF027B3', standard: 'ERC-721', onchainName: 'Wrapped Lil Mutants / WLM', source: 'owner() yaper.eth', brand: 'yaper' },
  { key: 'wape-apechain', name: 'Wrapped ApeCoin (ApeChain)', short: 'WAPE', chainId: 33139, address: '0x48b62137EdfA95a428D35C09E44256a739F6B557', standard: 'ERC-20', onchainName: 'Wrapped ApeCoin / WAPE / 18', source: 'docs.apechain.com/contract-decoding (wAPE token)' },
];

/**
 * Native APE on ApeChain has no token contract, so it is not in PROTECTED_ASSETS (whose lookups are by contract).
 * Sends, swaps and any dApp transaction that carries APE value on ApeChain get the same typed-name + PIN step.
 */
export const PROTECTED_NATIVE: Readonly<Partial<Record<number, ProtectedAsset>>> = {
  33139: { key: 'ape-apechain-native', name: 'ApeCoin (ApeChain)', short: 'APE', chainId: 33139, address: '0x0000000000000000000000000000000000000000', standard: 'ERC-20', onchainName: 'native gas token APE / 18', source: 'docs.apechain.com (APE is the ApeChain gas token)' },
};

export function protectedNativeFor(chainId: number): ProtectedAsset | null {
  return PROTECTED_NATIVE[chainId] ?? null;
}

const BY_CHAIN_ADDRESS = new Map<string, ProtectedAsset>(
  PROTECTED_ASSETS.map((asset) => [`${asset.chainId}:${asset.address.toLowerCase()}`, asset]),
);

export function protectedAssetFor(chainId: number, address: string | null | undefined): ProtectedAsset | null {
  if (!address || !isAddress(address)) {
    return null;
  }
  return BY_CHAIN_ADDRESS.get(`${chainId}:${getAddress(address).toLowerCase()}`) ?? null;
}

export function protectedAssetByKey(key: string): ProtectedAsset | null {
  return PROTECTED_ASSETS.find((asset) => asset.key === key) ?? null;
}

export function isProtectedNft(asset: ProtectedAsset | null): boolean {
  return Boolean(asset && asset.standard !== 'ERC-20');
}

/** Every protected address on any chain, lowercased. Used to spot protected contracts inside opaque payloads. */
export const PROTECTED_ADDRESSES_LOWER: ReadonlySet<string> = new Set(
  PROTECTED_ASSETS.map((asset) => asset.address.toLowerCase()),
);

// ---------------------------------------------------------------------------------------------
// Lookalike detection
// ---------------------------------------------------------------------------------------------

/** Characters that render like Latin letters. Mapped before matching. */
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic
  'а': 'a', 'в': 'b', 'с': 'c', 'ԁ': 'd', 'е': 'e', 'ё': 'e', 'һ': 'h', 'н': 'h', 'і': 'i', 'ї': 'i', 'ј': 'j',
  'к': 'k', 'ӏ': 'l', 'м': 'm', 'п': 'n', 'о': 'o', 'р': 'p', 'ԛ': 'q', 'г': 'r', 'ѕ': 's', 'т': 't',
  'и': 'u', 'ѵ': 'v', 'ԝ': 'w', 'х': 'x', 'у': 'y', 'ү': 'y', 'з': '3',
  // Greek
  'α': 'a', 'β': 'b', 'ϲ': 'c', 'δ': 'd', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'μ': 'u', 'ν': 'v',
  'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'γ': 'y', 'ω': 'w',
  // Greek / Cyrillic capitals that look like different Latin letters than their lowercase forms
  'Υ': 'y', 'Ν': 'n', 'Η': 'h', 'Ρ': 'p', 'Χ': 'x', 'Ζ': 'z', 'Μ': 'm', 'Κ': 'k', 'Τ': 't', 'Β': 'b', 'Α': 'a', 'Ε': 'e', 'Ι': 'i', 'Ο': 'o',
  'В': 'b', 'Н': 'h', 'М': 'm', 'Т': 't', 'К': 'k', 'Р': 'p', 'С': 'c', 'Х': 'x', 'У': 'y',
  // Misc lookalikes
  'ɑ': 'a', 'ɡ': 'g', 'ı': 'i', 'ȷ': 'j', 'ʏ': 'y', 'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e',
  'ʜ': 'h', 'ɪ': 'i', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ʀ': 'r', 'ꜱ': 's',
  'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ᴢ': 'z', 'ℓ': 'l', '℮': 'e', 'Ꭺ': 'a', 'Ᏼ': 'b', 'Ꮯ': 'c',
  'Ꭼ': 'e', 'Ꮋ': 'h', 'Ꮶ': 'k', 'Ꮇ': 'm', 'Ꮲ': 'p', 'Ꭲ': 't', 'Ꮃ': 'w',
};

/** Digit / symbol stand-ins used in fake names, e.g. "B0RED 4PE" or "B@YC". Only for the leet pass. */
const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'l',
};

const BRAND_PATTERNS: readonly string[] = [
  'boredape', 'bayc', 'mayc', 'bakc', 'bacc', 'mutantape', 'mutantserum', 'yachtclub', 'apeyacht', 'kennelclub',
  'chemistryclub', 'otherdeed', 'otherside', 'koda', 'yuga', 'apecoin', 'apechain', 'sewerpass', 'dookey',
  'hvmtl', 'meebit', 'cryptopunk', 'punks', '10ktf', 'tenktf',
  // Yaper
  'lilape', 'lilmutant', 'lilbabyape', 'lbac', 'yaper',
];

/** Lowercase, fold accents and homoglyphs, drop every non-alphanumeric (spacing / punctuation / zero-width). */
export function foldBrandText(value: string, leet = false): string {
  const decomposed = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  let out = '';
  for (const raw of decomposed) {
    const lower = raw.toLowerCase();
    const mapped = HOMOGLYPHS[raw] ?? HOMOGLYPHS[lower] ?? lower;
    out += leet ? (LEET[mapped] ?? mapped) : mapped;
  }
  // "l" vs "i" confusion: fold to "i" in the leet pass so "BAYC" / "8AYC" / "MAYC" variants and "1"→"i" match alike.
  const compact = out.replace(/[^a-z0-9]+/g, '');
  return leet ? compact.replace(/l/g, 'i') : compact;
}

/** Returns the brand pattern a text looks like, or null. Case-, spacing-, accent- and homoglyph-insensitive. */
export function yugaLookalikeMatch(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) {
      continue;
    }
    const plain = foldBrandText(text, false);
    const leet = foldBrandText(text, true);
    for (const pattern of BRAND_PATTERNS) {
      const leetPattern = pattern.replace(/l/g, 'i');
      if (plain.includes(pattern) || leet.includes(leetPattern)) {
        return pattern;
      }
    }
  }
  return null;
}

export const FAKE_LABEL = 'Fake: not the official contract';
export const VERIFIED_LABEL = 'Verified';
export const PROTECTED_LABEL = 'Protected';

/** Badge for a protected collection: Yuga Labs assets say "Verified", Yaper collections say "Protected". */
export function protectedBadgeLabel(asset: Pick<ProtectedAsset, 'brand'> | null | undefined): string {
  return asset?.brand === 'yaper' ? PROTECTED_LABEL : VERIFIED_LABEL;
}
