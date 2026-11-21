import crypto from 'node:crypto';
import QRCode from 'qrcode';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const EPHEMERAL_FALLBACK_SEED = crypto.randomBytes(32).toString('hex');
const HAS_PERSISTENT_2FA_SECRET = Boolean(process.env.TWO_FACTOR_SESSION_SECRET?.trim());

const SESSION_TOKEN_SECRET = crypto
  .createHash('sha256')
  .update(
    process.env.TWO_FACTOR_SESSION_SECRET?.trim() ||
      process.env.TRANSPONDER_SECRET?.trim() ||
      EPHEMERAL_FALLBACK_SEED
  )
  .digest();

export function isEphemeralTwoFactorSecret(): boolean {
  return !HAS_PERSISTENT_2FA_SECRET;
}

// Server-side registry of UIDs known to require 2FA + issued active session JTIs
const enforcedTwoFactorUids = new Set<string>();
const revokedTokens = new Set<string>();

export function setServerTwoFactorEnforcement(uid: string, enabled: boolean): void {
  if (!uid) return;
  if (enabled) {
    enforcedTwoFactorUids.add(uid);
  } else {
    enforcedTwoFactorUids.delete(uid);
  }
}

export function isServerTwoFactorEnforced(uid: string | undefined): boolean {
  if (!uid) return false;
  return enforcedTwoFactorUids.has(uid);
}

export function issueTwoFactorSessionToken(
  uid: string,
  ttlSeconds = 3600
): { token: string; expiresAt: number } {
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + ttlSeconds;
  const payload = {
    uid,
    iat: nowSec,
    exp,
    jti: crypto.randomBytes(10).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_TOKEN_SECRET).update(encoded).digest('base64url');
  return {
    token: `${encoded}.${sig}`,
    expiresAt: exp * 1000,
  };
}

export function verifyTwoFactorSessionToken(
  token: string | undefined,
  expectedUid?: string
): { valid: boolean; uid?: string; expiresAt?: number; reason?: string } {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, reason: 'Отсутствует серверный 2FA-токен сессии' };
  }
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) {
    return { valid: false, reason: 'Некорректный формат 2FA-токена' };
  }

  const expectedSig = crypto
    .createHmac('sha256', SESSION_TOKEN_SECRET)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'Подпись 2FA-токена недействительна' };
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      uid: string;
      exp: number;
      jti: string;
    };
    if (revokedTokens.has(parsed.jti)) {
      return { valid: false, reason: '2FA-токен отозван' };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (parsed.exp < nowSec) {
      return { valid: false, reason: 'Срок действия 2FA-сессии истёк, повторите ввод кода' };
    }
    if (expectedUid && parsed.uid !== expectedUid) {
      return { valid: false, reason: '2FA-токен принадлежит другому пользователю' };
    }
    return { valid: true, uid: parsed.uid, expiresAt: parsed.exp * 1000 };
  } catch {
    return { valid: false, reason: 'Повреждённая полезная нагрузка 2FA-токена' };
  }
}

export function revokeTwoFactorSessionToken(token: string | undefined): void {
  if (!token || !token.includes('.')) return;
  try {
    const [encoded] = token.split('.');
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { jti?: string };
    if (parsed.jti) revokedTokens.add(parsed.jti);
  } catch {
    // Ignore malformed token on revoke
  }
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

export function generateTotpCode(secret: string, timeStepOffset = 0): string {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30) + timeStepOffset;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 1_000_000;
  return otp.toString().padStart(6, '0');
}

export function verifyTotpCode(secret: string, code: string, window = 1): boolean {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }

  for (let offset = -window; offset <= window; offset++) {
    const expected = generateTotpCode(secret, offset);
    if (
      expected.length === normalized.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))
    ) {
      return true;
    }
  }

  return false;
}

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

export async function generateTotpSetup(email: string): Promise<{
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
  backupCodes: string[];
}> {
  const secret = base32Encode(crypto.randomBytes(20));
  const issuer = 'Vanguard SRE';
  const label = encodeURIComponent(`${issuer}:${email}`);
  const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
    width: 220,
    margin: 2,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
  const backupCodes = generateBackupCodes(8);
  return { secret, otpauthUrl, qrDataUrl, backupCodes };
}
