// Generated from contract JSONL. Do not edit by hand.
/* eslint-disable */

export interface ClaimV1 {
  "confidence_level"?: "low" | "medium" | "high";
  "text": string;
}

export interface RawV1 {
  "content_hash": string;
  "payload_ref": string;
}

export const accessors = {
  claim_v1: {
    confidence_level: (row: ClaimV1) => row["confidence_level"],
    text: (row: ClaimV1) => row["text"],
  },
  raw_v1: {
    content_hash: (row: RawV1) => row["content_hash"],
    payload_ref: (row: RawV1) => row["payload_ref"],
  },
} as const;

export const fieldRefs = {
  claim_v1: {
    confidence_level: "claim.v1#confidence_level",
    text: "claim.v1#text",
  },
  raw_v1: {
    content_hash: "raw.v1#content_hash",
    payload_ref: "raw.v1#payload_ref",
  },
} as const;
