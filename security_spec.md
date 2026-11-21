# Vanguard SRE Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Identity & Email Verification**: Every write requires `request.auth != null` and `request.auth.token.email_verified == true`.
2. **PII & Secret Isolation**: `users/{userId}` is readable only by its owner or an admin. `users/{userId}/security/{docId}` (TOTP secrets & backup codes) is strictly accessible ONLY by the owner (`request.auth.uid == userId`).
3. **Privilege Escalation Prevention**: Non-admin users cannot set `role: "admin"`, cannot modify their own `role`, `status`, or RBAC boolean flags (`canRunAgent`, `canApproveIrreversible`, `canManageIntegrations`, `canExportAuditLogs`).
4. **Master Gate**: Creating or reading messages in `sessions/{sessionId}/messages/{messageId}` requires the parent `sessions/{sessionId}` document to exist and belong to `request.auth.uid` (or caller is admin).
5. **Immutable Append-Only Audit Log**: Documents in `auditLogs/{logId}` can be created by verified authenticated users with `ownerId == request.auth.uid` and `createdAt == request.time`, and can NEVER be updated or deleted by non-admins.
6. **Terminal Session Locking**: Once an `AgentSession` reaches `status == "COMPLETED"` or `"ROLLBACK_PARTIAL"`, non-admins cannot mutate it further.
7. **Strict Boundaries & Temporal Integrity**: All document IDs match `^[a-zA-Z0-9_\-]+$` with length `<= 128`. All strings enforce blueprint `maxLength`. All `createdAt` / `updatedAt` timestamps must equal `request.time`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Admin Registration**: Non-admin creates `/users/{uid}` with `role: "admin"` -> `PERMISSION_DENIED`.
2. **Role Escalation Update**: Operator updates own `/users/{uid}` with `role: "admin"` -> `PERMISSION_DENIED`.
3. **Shadow Field Injection**: User updates `/users/{uid}` with extra field `isSuperUser: true` -> `PERMISSION_DENIED`.
4. **PII Snooping**: User B executes `get` on `/users/{userA}` -> `PERMISSION_DENIED`.
5. **2FA Secret Exfiltration**: Admin or User B attempts `get` on `/users/{userA}/security/totp` -> `PERMISSION_DENIED`.
6. **Spoofed Email Claim**: Request with admin email but `email_verified: false` -> `PERMISSION_DENIED`.
7. **Orphaned Message Write**: User creates `/sessions/nonexistent_id/messages/msg1` -> `PERMISSION_DENIED`.
8. **Audit Log Tampering**: User attempts `update` or `delete` on `/auditLogs/{logId}` -> `PERMISSION_DENIED`.
9. **Terminal Session Mutation**: User updates `/sessions/{sessionId}` after `status == "COMPLETED"` -> `PERMISSION_DENIED`.
10. **ID Poisoning**: User creates `/sessions/{200-char-invalid-id}` -> `PERMISSION_DENIED`.
11. **Timestamp Forgery**: User creates `/sessions/{id}` with backdated `createdAt` != `request.time` -> `PERMISSION_DENIED`.
12. **Unbounded Array Attack**: User writes `backupCodes` with 50 items (> 8) in `/users/{uid}/security/totp` -> `PERMISSION_DENIED`.
