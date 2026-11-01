export type PiiRuleType = 'EMAIL' | 'CREDIT_CARD' | 'SSN' | 'BEARER_TOKEN';

export interface DLPInspectionResult {
  originalPayload: string;
  sanitizedPayload: string;
  redactedCount: number;
  detectedTypes: PiiRuleType[];
  wafBlocked: boolean;
  wafReason?: string;
}

const SQLI_OR_XSS_PATTERN =
  /(\bUNION\s+SELECT\b|\bDROP\s+TABLE\b|--\s*$|<\s*script\b|javascript:|OR\s+1\s*=\s*1)/i;

/**
 * Zero-Trust Edge PII Redaction & WAF Payload Inspector.
 * Automatically masks sensitive PII (Credit Cards, SSNs, Emails, Bearer Tokens) before logs/webhooks leave the edge,
 * and blocks SQLi / XSS injection signatures.
 */
export function inspectAndSanitizePayload(rawInput: string): DLPInspectionResult {
  const detected = new Set<PiiRuleType>();
  let redactedCount = 0;

  if (SQLI_OR_XSS_PATTERN.test(rawInput)) {
    return {
      originalPayload: rawInput,
      sanitizedPayload: '[BLOCKED_BY_AEGIS_EDGE_WAF]',
      redactedCount: 1,
      detectedTypes: [],
      wafBlocked: true,
      wafReason: 'OWASP CRS Signature Match: SQL Injection / Cross-Site Scripting payload blocked at edge.',
    };
  }

  let sanitized = rawInput;

  // 1. Redact Bearer / API tokens
  sanitized = sanitized.replace(
    /(Bearer\s+[A-Za-z0-9\-._~+/]+=*|aegis_live_[a-z0-9_]+)/gi,
    () => {
      detected.add('BEARER_TOKEN');
      redactedCount += 1;
      return '[REDACTED_SECRET_TOKEN]';
    }
  );

  // 2. Redact Credit Card numbers (13-16 digits with optional spaces/dashes)
  sanitized = sanitized.replace(/\b(?:\d[ -]*?){13,16}\b/g, (match) => {
    detected.add('CREDIT_CARD');
    redactedCount += 1;
    const last4 = match.replace(/\D/g, '').slice(-4);
    return `[REDACTED_PAN_****_${last4}]`;
  });

  // 3. Redact US SSNs
  sanitized = sanitized.replace(/\b\d{3}-\d{2}-\d{4}\b/g, () => {
    detected.add('SSN');
    redactedCount += 1;
    return '[REDACTED_SSN]';
  });

  // 4. Redact Email addresses
  sanitized = sanitized.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    (email) => {
      detected.add('EMAIL');
      redactedCount += 1;
      const [, domain] = email.split('@');
      return `[REDACTED_EMAIL@${domain}]`;
    }
  );

  return {
    originalPayload: rawInput,
    sanitizedPayload: sanitized,
    redactedCount,
    detectedTypes: Array.from(detected),
    wafBlocked: false,
  };
}
