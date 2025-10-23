;; Fractional Asset Engine
;;
;; This smart contract provides a decentralized ledger for managing fractional ownership
;; of real-world assets on the Stacks blockchain. It enables asset origination, multi-tier
;; verification workflows, token issuance, and secure peer-to-peer transfers with built-in
;; regulatory compliance validation. The system maintains complete audit trails and supports
;; asset lifecycle transitions from initial registration through final retirement.

;; Error Codes
(define-constant FAIL-INSUFFICIENT-AUTH (err u100))
(define-constant FAIL-ASSET-EXISTS (err u101))
(define-constant FAIL-ASSET-MISSING (err u102))
(define-constant FAIL-NOT-VERIFIED (err u103))
(define-constant FAIL-LOW-BALANCE (err u104))
(define-constant FAIL-TRANSFER-REJECTED (err u105))
(define-constant FAIL-ALREADY-TOKENIZED (err u106))
(define-constant FAIL-INVALID-INPUT (err u107))
(define-constant FAIL-VERIFIER-FORBIDDEN (err u108))
(define-constant FAIL-RETIREMENT-BLOCKED (err u109))
(define-constant FAIL-REGULATORY-BREACH (err u110))
(define-constant FAIL-TRANSFER-AMOUNT-INVALID (err u111))

;; System Configuration
(define-constant SYSTEM-ADMIN tx-sender)
(define-constant STATE-PENDING-REVIEW u1)
(define-constant STATE-APPROVED-BY-VERIFIER u2)
(define-constant STATE-VERIFICATION-REJECTED u3)
(define-constant STATE-ACTIVELY-TOKENIZED u4)
(define-constant STATE-LIFECYCLE-CONCLUDED u5)

;; Data Maps and Storage

;; Asset repository - maintains core asset records
(define-map digital-assets
  { asset-code: (string-ascii 36) }
  {
    originator: principal,
    current-state: uint,
    authorized-verifier: (optional principal),
    verify-timestamp: (optional uint),
    asset-metadata-location: (string-utf8 256),
    record-timestamp: uint,
    state-change-timestamp: uint,
    regulation-proof: (string-ascii 64),
    lifecycle-ended: bool
  }
)

;; Token inventory for tokenized assets
(define-map token-ledger
  { asset-code: (string-ascii 36) }
  {
    max-tokens: uint,
    precision-scale: uint,
    token-reference-uri: (string-utf8 256),
    issuance-block: uint
  }
)

;; Account-based token holdings tracker
(define-map account-holdings
  { asset-code: (string-ascii 36), account-holder: principal }
  { tokens-held: uint }
)

;; Verifier registry and management
(define-map verifier-registry
  { verifier-address: principal }
  { enabled: bool, registration-block: uint }
)

;; Transaction log with transfer details
(define-map transaction-ledger
  { asset-code: (string-ascii 36), sequence-number: uint }
  {
    sender: principal,
    receiver: principal,
    token-qty: uint,
    tx-block-height: uint
  }
)

;; State Variables
(define-data-var tx-sequence-counter uint u0)
(define-data-var active-verifier-tally uint u0)
(define-data-var registered-asset-count uint u0)

;; Private Helper Functions

;; Admin authorization check
(define-private (verify-admin-access)
  (is-eq tx-sender SYSTEM-ADMIN)
)

;; Verifier authorization check
(define-private (verify-verifier-access)
  (default-to false (get enabled (map-get? verifier-registry { verifier-address: tx-sender })))
)

;; Asset existence lookup
(define-private (asset-present (asset-code (string-ascii 36)))
  (is-some (map-get? digital-assets { asset-code: asset-code }))
)

;; Asset ownership verification
(define-private (verify-asset-originator (asset-code (string-ascii 36)))
  (let ((record (map-get? digital-assets { asset-code: asset-code })))
    (if (is-some record)
      (is-eq tx-sender (get originator (unwrap-panic record)))
      false
    )
  )
)

;; Tokenization state verification
(define-private (verify-token-active (asset-code (string-ascii 36)))
  (let ((record (map-get? digital-assets { asset-code: asset-code })))
    (if (is-some record)
      (is-eq (get current-state (unwrap-panic record)) STATE-ACTIVELY-TOKENIZED)
      false
    )
  )
)

;; Retirement status check
(define-private (verify-asset-active (asset-code (string-ascii 36)))
  (let ((record (map-get? digital-assets { asset-code: asset-code })))
    (if (is-some record)
      (not (get lifecycle-ended (unwrap-panic record)))
      false
    )
  )
)

;; Token balance retrieval
(define-private (query-account-balance (asset-code (string-ascii 36)) (account principal))
  (default-to u0 
    (get tokens-held (map-get? account-holdings { asset-code: asset-code, account-holder: account }))
  )
)

;; Get next transaction identifier
(define-private (fetch-next-sequence-id)
  (let ((current (var-get tx-sequence-counter)))
    (var-set tx-sequence-counter (+ current u1))
    current
  )
)

;; Validate transfer eligibility
(define-private (validate-transfer-allowed (asset-code (string-ascii 36)) (from-account principal) (to-account principal) (quantity uint))
  (let ((record (map-get? digital-assets { asset-code: asset-code })))
    (if (is-some record)
      (and 
        (not (get lifecycle-ended (unwrap-panic record)))
        (is-eq (get current-state (unwrap-panic record)) STATE-ACTIVELY-TOKENIZED)
        (>= (query-account-balance asset-code from-account) quantity)
        (> quantity u0)
      )
      false
    )
  )
)

;; Execute balance adjustments
(define-private (perform-balance-update (asset-code (string-ascii 36)) (from-account principal) (to-account principal) (quantity uint))
  (let (
    (from-current (query-account-balance asset-code from-account))
    (to-current (query-account-balance asset-code to-account))
  )
    ;; Deduct from sender
    (map-set account-holdings 
      { asset-code: asset-code, account-holder: from-account }
      { tokens-held: (- from-current quantity) }
    )
    
    ;; Add to recipient
    (map-set account-holdings
      { asset-code: asset-code, account-holder: to-account }
      { tokens-held: (+ to-current quantity) }
    )
    
    ;; Log transaction
    (map-set transaction-ledger
      { asset-code: asset-code, sequence-number: (fetch-next-sequence-id) }
      {
        sender: from-account,
        receiver: to-account,
        token-qty: quantity,
        tx-block-height: block-height
      }
    )
    
    (ok true)
  )
)

;; Read-Only Functions

;; Query verifier status
(define-read-only (read-verifier-status (account principal))
  (default-to false (get enabled (map-get? verifier-registry { verifier-address: account })))
)

;; Fetch asset information
(define-read-only (read-asset-data (asset-code (string-ascii 36)))
  (if (asset-present asset-code)
    (ok (map-get? digital-assets { asset-code: asset-code }))
    FAIL-ASSET-MISSING
  )
)

;; Get tokenization metadata
(define-read-only (read-token-metadata (asset-code (string-ascii 36)))
  (if (verify-token-active asset-code)
    (ok (map-get? token-ledger { asset-code: asset-code }))
    FAIL-NOT-VERIFIED
  )
)

;; Query account balance information
(define-read-only (read-account-balance (asset-code (string-ascii 36)) (account principal))
  (ok { 
    asset-code: asset-code, 
    account: account, 
    balance: (query-account-balance asset-code account) 
  })
)

;; Pre-flight compliance validation
(define-read-only (validate-transfer-compliance (asset-code (string-ascii 36)) (from-account principal) (to-account principal) (quantity uint))
  (if (validate-transfer-allowed asset-code from-account to-account quantity)
    (ok true)
    FAIL-REGULATORY-BREACH
  )
)

;; Public Functions

;; Initialize new asset in ledger
(define-public (register-new-asset 
  (asset-code (string-ascii 36)) 
  (asset-metadata-location (string-utf8 256))
  (regulation-proof (string-ascii 64))
)
  (let ((current-block block-height))
    (if (asset-present asset-code)
      FAIL-ASSET-EXISTS
      (begin
        (map-set digital-assets
          { asset-code: asset-code }
          {
            originator: tx-sender,
            current-state: STATE-PENDING-REVIEW,
            authorized-verifier: none,
            verify-timestamp: none,
            asset-metadata-location: asset-metadata-location,
            record-timestamp: current-block,
            state-change-timestamp: current-block,
            regulation-proof: regulation-proof,
            lifecycle-ended: false
          }
        )
        (var-set registered-asset-count (+ (var-get registered-asset-count) u1))
        (ok { asset-code: asset-code, state: STATE-PENDING-REVIEW })
      )
    )
  )
)

;; Modify asset metadata
(define-public (update-asset-data
  (asset-code (string-ascii 36))
  (asset-metadata-location (string-utf8 256))
)
  (let ((record (map-get? digital-assets { asset-code: asset-code })))
    (if (is-none record)
      FAIL-ASSET-MISSING
      (if (not (verify-asset-originator asset-code))
        FAIL-INSUFFICIENT-AUTH
        (if (not (verify-asset-active asset-code))
          FAIL-RETIREMENT-BLOCKED
          (begin
            (map-set digital-assets
              { asset-code: asset-code }
              (merge (unwrap-panic record)
                {
                  asset-metadata-location: asset-metadata-location,
                  state-change-timestamp: block-height
                }
              )
            )
            (ok { asset-code: asset-code, modified: true })
          )
        )
      )
    )
  )
)

;; Enlist new verifier
(define-public (enlist-verifier (account principal))
  (if (verify-admin-access)
    (begin
      (map-set verifier-registry
        { verifier-address: account }
        { enabled: true, registration-block: block-height }
      )
      (var-set active-verifier-tally (+ (var-get active-verifier-tally) u1))
      (ok { account: account, enlisted: true })
    )
    FAIL-INSUFFICIENT-AUTH
  )
)

;; Delist existing verifier
(define-public (delist-verifier (account principal))
  (if (verify-admin-access)
    (begin
      (map-set verifier-registry
        { verifier-address: account }
        { enabled: false, registration-block: (default-to block-height (get registration-block (map-get? verifier-registry { verifier-address: account }))) }
      )
      (var-set active-verifier-tally (- (var-get active-verifier-tally) u1))
      (ok { account: account, delisted: true })
    )
    FAIL-INSUFFICIENT-AUTH
  )
)

;; Execute asset verification workflow
(define-public (execute-verification (asset-code (string-ascii 36)) (approval bool))
  (let ((record (map-get? digital-assets { asset-code: asset-code })))
    (if (is-none record)
      FAIL-ASSET-MISSING
      (if (not (verify-verifier-access))
        FAIL-VERIFIER-FORBIDDEN
        (begin
          (map-set digital-assets
            { asset-code: asset-code }
            (merge (unwrap-panic record)
              {
                current-state: (if approval STATE-APPROVED-BY-VERIFIER STATE-VERIFICATION-REJECTED),
                authorized-verifier: (some tx-sender),
                verify-timestamp: (some block-height),
                state-change-timestamp: block-height
              }
            )
          )
          (ok { 
            asset-code: asset-code, 
            approved: approval, 
            state: (if approval STATE-APPROVED-BY-VERIFIER STATE-VERIFICATION-REJECTED)
          })
        )
      )
    )
  )
)

;; Issue tokens for verified asset
(define-public (issue-fractional-tokens
  (asset-code (string-ascii 36))
  (max-tokens uint)
  (precision-scale uint)
  (token-reference-uri (string-utf8 256))
)
  (let ((record (map-get? digital-assets { asset-code: asset-code })))
    (if (is-none record)
      FAIL-ASSET-MISSING
      (if (not (verify-asset-originator asset-code))
        FAIL-INSUFFICIENT-AUTH
        (if (not (is-eq (get current-state (unwrap-panic record)) STATE-APPROVED-BY-VERIFIER))
          FAIL-NOT-VERIFIED
          (if (verify-token-active asset-code)
            FAIL-ALREADY-TOKENIZED
            (begin
              ;; Update asset to tokenized state
              (map-set digital-assets
                { asset-code: asset-code }
                (merge (unwrap-panic record)
                  {
                    current-state: STATE-ACTIVELY-TOKENIZED,
                    state-change-timestamp: block-height
                  }
                )
              )
              
              ;; Record token details
              (map-set token-ledger
                { asset-code: asset-code }
                {
                  max-tokens: max-tokens,
                  precision-scale: precision-scale,
                  token-reference-uri: token-reference-uri,
                  issuance-block: block-height
                }
              )
              
              ;; Allocate all tokens to originator
              (map-set account-holdings
                { asset-code: asset-code, account-holder: tx-sender }
                { tokens-held: max-tokens }
              )
              
              (ok { 
                asset-code: asset-code, 
                max-tokens: max-tokens,
                originator: tx-sender,
                state: STATE-ACTIVELY-TOKENIZED
              })
            )
          )
        )
      )
    )
  )
)

;; Execute inter-account token transfer
(define-public (execute-token-transfer
  (asset-code (string-ascii 36))
  (to-account principal)
  (quantity uint)
)
  (let ((from-account tx-sender))
    (if (not (asset-present asset-code))
      FAIL-ASSET-MISSING
      (if (not (verify-token-active asset-code))
        FAIL-NOT-VERIFIED
        (if (not (verify-asset-active asset-code))
          FAIL-RETIREMENT-BLOCKED
          (if (<= quantity u0)
            FAIL-TRANSFER-AMOUNT-INVALID
            (if (> quantity (query-account-balance asset-code from-account))
              FAIL-LOW-BALANCE
              (if (not (validate-transfer-allowed asset-code from-account to-account quantity))
                FAIL-REGULATORY-BREACH
                (perform-balance-update asset-code from-account to-account quantity)
              )
            )
          )
        )
      )
    )
  )
)

;; Complete asset lifecycle
(define-public (conclude-asset-lifecycle (asset-code (string-ascii 36)))
  (let ((record (map-get? digital-assets { asset-code: asset-code })))
    (if (is-none record)
      FAIL-ASSET-MISSING
      (if (and (not (verify-asset-originator asset-code)) (not (verify-admin-access)))
        FAIL-INSUFFICIENT-AUTH
        (if (get lifecycle-ended (unwrap-panic record))
          FAIL-RETIREMENT-BLOCKED
          (begin
            (map-set digital-assets
              { asset-code: asset-code }
              (merge (unwrap-panic record)
                {
                  current-state: STATE-LIFECYCLE-CONCLUDED,
                  lifecycle-ended: true,
                  state-change-timestamp: block-height
                }
              )
            )
            (ok { asset-code: asset-code, concluded: true })
          )
        )
      )
    )
  )
)
