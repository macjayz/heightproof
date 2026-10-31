import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

/**
 * Airnode attestations.
 *
 * An Airnode signs every response it serves: an EIP-191 signature over
 * keccak256(requestHash ‖ uint256 timestamp ‖ body bytes). A verification observation that
 * carries one is no longer just "a third provider said so" — anyone holding the signed body
 * can check, offline and without trusting Heightproof, which address answered which request
 * at which time.
 *
 * What a signature does not prove is that the answer is correct. It is attribution, not
 * truth: an attested reference can be stale like any other endpoint, and detectors treat it
 * as one more comparable peer, never as an oracle.
 *
 * Spec: https://airnodehub-docs.api3.org/airnode/attestation
 */

export type AirnodeAttestation = {
  /** The address the response claims to be signed by (X-Airnode-Address). */
  signer: string;
  requestHash: string;
  /** Unix seconds at which the response was signed. */
  timestamp: string;
  signature: string;
};

export type AirnodeAttestationCheck = {
  /** The signature recovers to `signer` over exactly this body, request and time. */
  signatureValid: boolean;
  /** The request hash is the one this exact request derives, so the answer is ours. */
  requestBound: boolean;
};

const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

/** Reads the four attestation headers. Undefined unless all four are present and well formed. */
export function readAirnodeAttestation(
  headers: Pick<Headers, "get">
): AirnodeAttestation | undefined {
  const signer = headers.get("x-airnode-address");
  const requestHash = headers.get("x-airnode-request-hash");
  const timestamp = headers.get("x-airnode-timestamp");
  const signature = headers.get("x-airnode-signature");

  if (!signer || !HEX_ADDRESS.test(signer)) return undefined;
  if (!requestHash || !HEX_32.test(requestHash)) return undefined;
  if (!timestamp || !/^\d+$/.test(timestamp)) return undefined;
  if (!signature || !HEX_SIGNATURE.test(signature)) return undefined;

  return { signer, requestHash, timestamp, signature };
}

/**
 * The request hash an Airnode derives for a passthrough request.
 *
 * keccak256(utf8(JSON.stringify(["passthrough", METHOD, path, queryEntries, headerEntries, body])))
 * where `path` excludes the `/api` prefix and query entries keep their sent order with every
 * `x-airnode-*` parameter removed.
 */
export function airnodePassthroughRequestHash(input: {
  method: string;
  /** Full request URL, including the `/api` prefix and the query. */
  url: string;
  body: string;
  headerEntries?: [string, string][];
}): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return undefined;
  }

  const apiIndex = parsed.pathname.indexOf("/api/");
  if (apiIndex === -1) return undefined;

  const path = parsed.pathname.slice(apiIndex + "/api".length);
  const queryEntries = [...parsed.searchParams.entries()].filter(
    ([name]) => !name.startsWith("x-airnode-")
  );
  const headerEntries = [...(input.headerEntries ?? [])].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );

  const serialized = JSON.stringify([
    "passthrough",
    input.method.toUpperCase(),
    path,
    queryEntries,
    headerEntries,
    input.body
  ]);

  return toHex(keccak_256(utf8ToBytes(serialized)));
}

/** Recovers the address that signed `body` under this attestation, or undefined if malformed. */
export function recoverAirnodeSigner(
  attestation: AirnodeAttestation,
  body: string
): string | undefined {
  try {
    const timestamp = BigInt(attestation.timestamp);
    const digest = keccak_256(
      concatBytes(
        hexToBytes(attestation.requestHash.slice(2)),
        hexToBytes(timestamp.toString(16).padStart(64, "0")),
        utf8ToBytes(body)
      )
    );
    const prefixed = keccak_256(
      concatBytes(utf8ToBytes("\x19Ethereum Signed Message:\n32"), digest)
    );

    const signature = hexToBytes(attestation.signature.slice(2));
    const recovery = signature[64]! >= 27 ? signature[64]! - 27 : signature[64]!;
    const publicKey = secp256k1.Signature.fromCompact(signature.slice(0, 64))
      .addRecoveryBit(recovery)
      .recoverPublicKey(prefixed)
      .toRawBytes(false);

    return toHex(keccak_256(publicKey.slice(1)).slice(-20));
  } catch {
    return undefined;
  }
}

/**
 * Checks an attestation against the body that arrived and, when known, the request that
 * was sent. Never throws: a malformed attestation is simply not valid.
 *
 * `body` must be the response text exactly as received. Parsing and re-serializing it
 * changes the bytes and every signature then fails.
 */
export function checkAirnodeAttestation(
  attestation: AirnodeAttestation,
  body: string,
  expectedRequestHash?: string
): AirnodeAttestationCheck {
  const recovered = recoverAirnodeSigner(attestation, body);

  return {
    signatureValid:
      recovered !== undefined && recovered.toLowerCase() === attestation.signer.toLowerCase(),
    requestBound:
      expectedRequestHash !== undefined &&
      expectedRequestHash.toLowerCase() === attestation.requestHash.toLowerCase()
  };
}

/**
 * Re-checks an attestation that arrived on an ingested event, without trusting the SDK.
 *
 * `signatureValid` survives only when the kept body still carries the signature *and*
 * holds the very result whose hash was compared — otherwise a valid signature over some
 * other answer could vouch for this one. Without a kept body there is nothing to check, so
 * it is false. `requestBound` is the SDK's: re-deriving it needs the exact request bytes
 * and endpoint URL, which are deliberately never transmitted.
 */
export function reverifyAttestation<
  T extends AirnodeAttestation & { signatureValid: boolean; signedBody?: string }
>(
  attestation: T,
  method: string,
  resultHash: string | undefined,
  hashResult: (result: unknown, method: string) => string
): T {
  if (!attestation.signedBody) return { ...attestation, signatureValid: false };

  const { signatureValid } = checkAirnodeAttestation(attestation, attestation.signedBody);
  if (!signatureValid) return { ...attestation, signatureValid: false };

  let coversResult = resultHash === undefined;
  if (resultHash !== undefined) {
    try {
      const parsed = JSON.parse(attestation.signedBody) as { result?: unknown };
      coversResult =
        parsed.result !== undefined && hashResult(parsed.result, method) === resultHash;
    } catch {
      coversResult = false;
    }
  }

  return { ...attestation, signatureValid: coversResult };
}

function toHex(bytes: Uint8Array): string {
  return `0x${bytesToHex(bytes)}`;
}
