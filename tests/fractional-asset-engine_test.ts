import { Clarinet, Tx, types } from "https://deno.land/x/clarinet@v1.0.0/index.ts";
import { assertEquals } from "https://deno.land/std@0.90.0/testing/asserts.ts";

Clarinet.test({
  name: "Asset registration creates pending entry in ledger",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get("deployer")!;
    
    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("PROP-REAL-ESTATE-2024"),
          types.utf8("https://metadata.service.io/real-estate-001"),
          types.ascii("hash_e7f3c5b9a2d8e1f4c7b9e2d5a8f1c4e7")
        ],
        deployer.address
      ),
    ]);

    assertEquals(block.receipts.length, 1);
    assertEquals(block.receipts[0].result.expectOk(), {
      "asset-code": "PROP-REAL-ESTATE-2024",
      state: types.uint(1), // STATE-PENDING-REVIEW
    });
  },
});

Clarinet.test({
  name: "Prevent duplicate asset code registration",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get("deployer")!;
    
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("ART-PIECE-MONET-001"),
          types.utf8("https://storage.io/art/monet"),
          types.ascii("sha256_verification_hash_placeholder_string")
        ],
        deployer.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("ART-PIECE-MONET-001"),
          types.utf8("https://storage.io/art/monet2"),
          types.ascii("sha256_different_hash_placeholder_value")
        ],
        deployer.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectErr(), types.uint(101)); // FAIL-ASSET-EXISTS
  },
});

Clarinet.test({
  name: "Only asset originator can modify asset metadata",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const originator = accounts.get("deployer")!;
    const otherParty = accounts.get("wallet_1")!;
    
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("COMMODITY-SILVER-BAR"),
          types.utf8("https://vault.example.com/silver"),
          types.ascii("hash_silver_commodity_proof_12345678")
        ],
        originator.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "update-asset-data",
        [
          types.ascii("COMMODITY-SILVER-BAR"),
          types.utf8("https://vault.example.com/silver-updated")
        ],
        otherParty.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectErr(), types.uint(100)); // FAIL-INSUFFICIENT-AUTH
  },
});

Clarinet.test({
  name: "Authorized admin can enlist verifiers",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const admin = accounts.get("deployer")!;
    const verifierCandidate = accounts.get("wallet_2")!;
    
    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "enlist-verifier",
        [types.principal(verifierCandidate.address)],
        admin.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectOk(), {
      account: types.principal(verifierCandidate.address),
      enlisted: true,
    });
  },
});

Clarinet.test({
  name: "Non-admin cannot enlist verifiers",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const unauthorized = accounts.get("wallet_3")!;
    const verifierCandidate = accounts.get("wallet_4")!;
    
    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "enlist-verifier",
        [types.principal(verifierCandidate.address)],
        unauthorized.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectErr(), types.uint(100)); // FAIL-INSUFFICIENT-AUTH
  },
});

Clarinet.test({
  name: "Authorized verifier can execute asset verification",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const admin = accounts.get("deployer")!;
    const verifier = accounts.get("wallet_5")!;
    const assetOwner = accounts.get("wallet_6")!;
    
    // Register asset
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("JEWEL-DIAMOND-CERT"),
          types.utf8("https://gemstones.io/diamond-001"),
          types.ascii("cert_sha256_hash_diamond_validation")
        ],
        assetOwner.address
      ),
    ]);

    // Add verifier
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "enlist-verifier",
        [types.principal(verifier.address)],
        admin.address
      ),
    ]);

    // Execute verification
    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-verification",
        [
          types.ascii("JEWEL-DIAMOND-CERT"),
          types.true,
        ],
        verifier.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectOk(), {
      "asset-code": "JEWEL-DIAMOND-CERT",
      approved: true,
      state: types.uint(2), // STATE-APPROVED-BY-VERIFIER
    });
  },
});

Clarinet.test({
  name: "Unauthorized account cannot verify assets",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get("deployer")!;
    const unauthorized = accounts.get("wallet_7")!;
    
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("MEDAL-GOLD-OLYMPIC"),
          types.utf8("https://historic.items.io/olympic"),
          types.ascii("cert_olympic_medal_authentication_proof")
        ],
        deployer.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-verification",
        [
          types.ascii("MEDAL-GOLD-OLYMPIC"),
          types.true,
        ],
        unauthorized.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectErr(), types.uint(108)); // FAIL-VERIFIER-FORBIDDEN
  },
});

Clarinet.test({
  name: "Verified asset can be converted to tokens",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const admin = accounts.get("deployer")!;
    const verifier = accounts.get("wallet_8")!;
    const assetOwner = accounts.get("wallet_9")!;
    
    // Register
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("WINE-VINTAGE-2000"),
          types.utf8("https://collectors.io/wine"),
          types.ascii("hash_wine_authentication_certificate_001")
        ],
        assetOwner.address
      ),
    ]);

    // Enlist verifier
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "enlist-verifier",
        [types.principal(verifier.address)],
        admin.address
      ),
    ]);

    // Verify
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-verification",
        [
          types.ascii("WINE-VINTAGE-2000"),
          types.true,
        ],
        verifier.address
      ),
    ]);

    // Tokenize
    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "issue-fractional-tokens",
        [
          types.ascii("WINE-VINTAGE-2000"),
          types.uint(100000000), // 100M tokens
          types.uint(6),
          types.utf8("https://token.metadata.io/wine-2000")
        ],
        assetOwner.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectOk(), {
      "asset-code": "WINE-VINTAGE-2000",
      "max-tokens": types.uint(100000000),
      originator: types.principal(assetOwner.address),
      state: types.uint(4), // STATE-ACTIVELY-TOKENIZED
    });
  },
});

Clarinet.test({
  name: "Cannot tokenize unverified asset",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const owner = accounts.get("deployer")!;
    
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("RARE-BOOK-FIRST-ED"),
          types.utf8("https://rare.books.io/first-edition"),
          types.ascii("hash_rare_book_certification_data")
        ],
        owner.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "issue-fractional-tokens",
        [
          types.ascii("RARE-BOOK-FIRST-ED"),
          types.uint(50000000),
          types.uint(6),
          types.utf8("https://token.io/book")
        ],
        owner.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectErr(), types.uint(103)); // FAIL-NOT-VERIFIED
  },
});

Clarinet.test({
  name: "Asset originator receives all tokens upon tokenization",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const admin = accounts.get("deployer")!;
    const verifier = accounts.get("wallet_10")!;
    const owner = accounts.get("wallet_11")!;
    
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("SCULPTURE-BRONZE"),
          types.utf8("https://art.gallery.io/bronze"),
          types.ascii("auth_sculpture_authenticity_verification")
        ],
        owner.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "enlist-verifier",
        [types.principal(verifier.address)],
        admin.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-verification",
        [
          types.ascii("SCULPTURE-BRONZE"),
          types.true,
        ],
        verifier.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "issue-fractional-tokens",
        [
          types.ascii("SCULPTURE-BRONZE"),
          types.uint(200000000),
          types.uint(6),
          types.utf8("https://tokens.io/sculpture")
        ],
        owner.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "read-account-balance",
        [
          types.ascii("SCULPTURE-BRONZE"),
          types.principal(owner.address)
        ],
        owner.address
      ),
    ]);

    const response = block.receipts[0].result.expectOk();
    assertEquals(response.balance, types.uint(200000000));
  },
});

Clarinet.test({
  name: "Execute token transfer with valid state",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const admin = accounts.get("deployer")!;
    const verifier = accounts.get("wallet_12")!;
    const owner = accounts.get("wallet_13")!;
    const recipient = accounts.get("wallet_14")!;
    
    // Setup: register, verify, tokenize
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("MINERAL-RUBY-GEM"),
          types.utf8("https://gemology.io/ruby"),
          types.ascii("cert_gemology_ruby_certificate_data")
        ],
        owner.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "enlist-verifier",
        [types.principal(verifier.address)],
        admin.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-verification",
        [
          types.ascii("MINERAL-RUBY-GEM"),
          types.true,
        ],
        verifier.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "issue-fractional-tokens",
        [
          types.ascii("MINERAL-RUBY-GEM"),
          types.uint(500000000),
          types.uint(6),
          types.utf8("https://tokens.io/ruby")
        ],
        owner.address
      ),
    ]);

    // Execute transfer
    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-token-transfer",
        [
          types.ascii("MINERAL-RUBY-GEM"),
          types.principal(recipient.address),
          types.uint(50000000)
        ],
        owner.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectOk(), true);
  },
});

Clarinet.test({
  name: "Reject transfer when insufficient token balance",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const admin = accounts.get("deployer")!;
    const verifier = accounts.get("wallet_15")!;
    const owner = accounts.get("wallet_16")!;
    const recipient = accounts.get("wallet_17")!;
    
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("PEARL-STRAND"),
          types.utf8("https://jewelry.io/pearl"),
          types.ascii("auth_pearl_strand_certificate_hash")
        ],
        owner.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "enlist-verifier",
        [types.principal(verifier.address)],
        admin.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-verification",
        [
          types.ascii("PEARL-STRAND"),
          types.true,
        ],
        verifier.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "issue-fractional-tokens",
        [
          types.ascii("PEARL-STRAND"),
          types.uint(100000000),
          types.uint(6),
          types.utf8("https://tokens.io/pearl")
        ],
        owner.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-token-transfer",
        [
          types.ascii("PEARL-STRAND"),
          types.principal(recipient.address),
          types.uint(200000000) // More than owned
        ],
        owner.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectErr(), types.uint(104)); // FAIL-LOW-BALANCE
  },
});

Clarinet.test({
  name: "Prevent transfer of zero or negative amounts",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const admin = accounts.get("deployer")!;
    const verifier = accounts.get("wallet_18")!;
    const owner = accounts.get("wallet_19")!;
    const recipient = accounts.get("wallet_20")!;
    
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("VASE-CERAMIC"),
          types.utf8("https://pottery.io/ceramic"),
          types.ascii("auth_ceramic_vase_authentication_proof")
        ],
        owner.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "enlist-verifier",
        [types.principal(verifier.address)],
        admin.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-verification",
        [
          types.ascii("VASE-CERAMIC"),
          types.true,
        ],
        verifier.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "issue-fractional-tokens",
        [
          types.ascii("VASE-CERAMIC"),
          types.uint(75000000),
          types.uint(6),
          types.utf8("https://tokens.io/vase")
        ],
        owner.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-token-transfer",
        [
          types.ascii("VASE-CERAMIC"),
          types.principal(recipient.address),
          types.uint(0)
        ],
        owner.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectErr(), types.uint(111)); // FAIL-TRANSFER-AMOUNT-INVALID
  },
});

Clarinet.test({
  name: "Receiver balance increases upon token transfer reception",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const admin = accounts.get("deployer")!;
    const verifier = accounts.get("wallet_21")!;
    const owner = accounts.get("wallet_22")!;
    const receiver = accounts.get("wallet_23")!;
    
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("STAMP-RARE-ANTIQUE"),
          types.utf8("https://philately.io/stamps"),
          types.ascii("auth_stamp_collection_verification")
        ],
        owner.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "enlist-verifier",
        [types.principal(verifier.address)],
        admin.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-verification",
        [
          types.ascii("STAMP-RARE-ANTIQUE"),
          types.true,
        ],
        verifier.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "issue-fractional-tokens",
        [
          types.ascii("STAMP-RARE-ANTIQUE"),
          types.uint(300000000),
          types.uint(6),
          types.utf8("https://tokens.io/stamps")
        ],
        owner.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-token-transfer",
        [
          types.ascii("STAMP-RARE-ANTIQUE"),
          types.principal(receiver.address),
          types.uint(75000000)
        ],
        owner.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "read-account-balance",
        [
          types.ascii("STAMP-RARE-ANTIQUE"),
          types.principal(receiver.address)
        ],
        receiver.address
      ),
    ]);

    const response = block.receipts[0].result.expectOk();
    assertEquals(response.balance, types.uint(75000000));
  },
});

Clarinet.test({
  name: "Retiring asset prevents further token transfers",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const admin = accounts.get("deployer")!;
    const verifier = accounts.get("wallet_24")!;
    const owner = accounts.get("wallet_25")!;
    const recipient = accounts.get("wallet_26")!;
    
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("COIN-BITCOIN-2009"),
          types.utf8("https://numismatics.io/bitcoin"),
          types.ascii("auth_bitcoin_coin_verification_data")
        ],
        owner.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "enlist-verifier",
        [types.principal(verifier.address)],
        admin.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-verification",
        [
          types.ascii("COIN-BITCOIN-2009"),
          types.true,
        ],
        verifier.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "issue-fractional-tokens",
        [
          types.ascii("COIN-BITCOIN-2009"),
          types.uint(400000000),
          types.uint(6),
          types.utf8("https://tokens.io/bitcoin")
        ],
        owner.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "conclude-asset-lifecycle",
        [types.ascii("COIN-BITCOIN-2009")],
        owner.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-token-transfer",
        [
          types.ascii("COIN-BITCOIN-2009"),
          types.principal(recipient.address),
          types.uint(50000000)
        ],
        owner.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectErr(), types.uint(109)); // FAIL-RETIREMENT-BLOCKED
  },
});

Clarinet.test({
  name: "Admin can delist verifiers",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const admin = accounts.get("deployer")!;
    const verifier = accounts.get("wallet_27")!;
    
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "enlist-verifier",
        [types.principal(verifier.address)],
        admin.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "delist-verifier",
        [types.principal(verifier.address)],
        admin.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectOk(), {
      account: types.principal(verifier.address),
      delisted: true,
    });
  },
});

Clarinet.test({
  name: "Delisted verifier cannot execute verification",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const admin = accounts.get("deployer")!;
    const verifier = accounts.get("wallet_28")!;
    const owner = accounts.get("wallet_29")!;
    
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("PAINTING-OIL"),
          types.utf8("https://art.io/painting"),
          types.ascii("auth_oil_painting_certification_hash")
        ],
        owner.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "enlist-verifier",
        [types.principal(verifier.address)],
        admin.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "delist-verifier",
        [types.principal(verifier.address)],
        admin.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-verification",
        [
          types.ascii("PAINTING-OIL"),
          types.true,
        ],
        verifier.address
      ),
    ]);

    assertEquals(block.receipts[0].result.expectErr(), types.uint(108)); // FAIL-VERIFIER-FORBIDDEN
  },
});

Clarinet.test({
  name: "Query asset data returns correct information",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const owner = accounts.get("deployer")!;
    
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("FURNITURE-CHAIR"),
          types.utf8("https://antiques.io/furniture"),
          types.ascii("cert_furniture_authenticity_hash_data")
        ],
        owner.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "read-asset-data",
        [types.ascii("FURNITURE-CHAIR")],
        owner.address
      ),
    ]);

    const result = block.receipts[0].result.expectOk();
    assertEquals(result.originator, types.principal(owner.address));
    assertEquals(result["current-state"], types.uint(1)); // STATE-PENDING-REVIEW
  },
});

Clarinet.test({
  name: "Multiple sequential token transfers maintain correct balances",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const admin = accounts.get("deployer")!;
    const verifier = accounts.get("wallet_30")!;
    const owner = accounts.get("wallet_31")!;
    const alice = accounts.get("wallet_32")!;
    const bob = accounts.get("wallet_33")!;
    
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "register-new-asset",
        [
          types.ascii("DOCUMENT-MANUSCRIPT"),
          types.utf8("https://library.io/manuscripts"),
          types.ascii("auth_manuscript_document_certification")
        ],
        owner.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "enlist-verifier",
        [types.principal(verifier.address)],
        admin.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-verification",
        [
          types.ascii("DOCUMENT-MANUSCRIPT"),
          types.true,
        ],
        verifier.address
      ),
    ]);

    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "issue-fractional-tokens",
        [
          types.ascii("DOCUMENT-MANUSCRIPT"),
          types.uint(1000000000),
          types.uint(6),
          types.utf8("https://tokens.io/manuscript")
        ],
        owner.address
      ),
    ]);

    // Transfer 1: Owner → Alice
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-token-transfer",
        [
          types.ascii("DOCUMENT-MANUSCRIPT"),
          types.principal(alice.address),
          types.uint(250000000)
        ],
        owner.address
      ),
    ]);

    // Transfer 2: Owner → Bob
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-token-transfer",
        [
          types.ascii("DOCUMENT-MANUSCRIPT"),
          types.principal(bob.address),
          types.uint(300000000)
        ],
        owner.address
      ),
    ]);

    // Transfer 3: Alice → Bob
    chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "execute-token-transfer",
        [
          types.ascii("DOCUMENT-MANUSCRIPT"),
          types.principal(bob.address),
          types.uint(100000000)
        ],
        alice.address
      ),
    ]);

    // Verify final balances
    let ownerBlock = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "read-account-balance",
        [
          types.ascii("DOCUMENT-MANUSCRIPT"),
          types.principal(owner.address)
        ],
        owner.address
      ),
    ]);

    let aliceBlock = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "read-account-balance",
        [
          types.ascii("DOCUMENT-MANUSCRIPT"),
          types.principal(alice.address)
        ],
        alice.address
      ),
    ]);

    let bobBlock = chain.mineBlock([
      Tx.contractCall(
        "fractional-asset-engine",
        "read-account-balance",
        [
          types.ascii("DOCUMENT-MANUSCRIPT"),
          types.principal(bob.address)
        ],
        bob.address
      ),
    ]);

    assertEquals(ownerBlock.receipts[0].result.expectOk().balance, types.uint(450000000));
    assertEquals(aliceBlock.receipts[0].result.expectOk().balance, types.uint(150000000));
    assertEquals(bobBlock.receipts[0].result.expectOk().balance, types.uint(400000000));
  },
});
